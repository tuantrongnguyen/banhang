import json
import math
import re
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import exists, func, inspect, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .excel import build_invoice_xlsx, build_orders_xlsx
from .db import Base, engine, get_db, SessionLocal
from .deps import current_user, require_admin, require_any_permission, require_permission
from .models import (
    AuditLog,
    Category,
    Customer,
    Expense,
    Order,
    OrderItem,
    Product,
    Purchase,
    PurchaseItem,
    StockMovement,
    Supplier,
    User,
)
from .schemas import (
    CategoryIn,
    ChangePasswordIn,
    CustomerIn,
    ExpenseIn,
    LoginIn,
    OrderIn,
    ProductIn,
    ProductUpdate,
    PurchaseIn,
    StockIn,
    SupplierIn,
    UserIn,
    UserUpdate,
)
from .security import hash_password, make_token, verify_password

Base.metadata.create_all(bind=engine)


def ensure_columns():
    """Tự thêm cột mới vào bảng đã tồn tại (create_all không làm việc này) - an toàn cho DB đang chạy online."""
    insp = inspect(engine)
    dialect = engine.dialect
    q = dialect.identifier_preparer.quote
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                ddl = f"ALTER TABLE {q(table.name)} ADD COLUMN {q(col.name)} {col.type.compile(dialect=dialect)}"
                d = col.default
                if d is not None and getattr(d, "is_scalar", False):
                    v = d.arg
                    if isinstance(v, bool):
                        lit = ("TRUE" if v else "FALSE") if dialect.name == "postgresql" else str(int(v))
                    elif isinstance(v, (int, float)):
                        lit = str(v)
                    else:
                        lit = "'" + str(v).replace("'", "''") + "'"
                    ddl += f" DEFAULT {lit}"
                conn.execute(text(ddl))


try:
    ensure_columns()
except Exception as e:  # không để lỗi migrate làm sập app
    print("ensure_columns lỗi:", e)

app = FastAPI(title="Shop Manager", version="6.0")


def seed():
    db = SessionLocal()
    try:
        if not db.query(User).filter_by(username="admin").first():
            db.add(
                User(
                    username="admin",
                    password_hash=hash_password("admin123"),
                    full_name="Quản trị viên",
                    role="admin",
                    permissions='["*"]',
                )
            )
        if not db.query(User).filter_by(username="nhanvien").first():
            db.add(
                User(
                    username="nhanvien",
                    password_hash=hash_password("nv123"),
                    full_name="Nhân viên bán hàng",
                    role="employee",
                    permissions='["dashboard","pos","customers","orders"]',
                )
            )
        if db.query(Product).count() == 0:
            db.add_all(
                [
                    Product(code="SP001", name="Sản phẩm mẫu A", category="Danh mục A", price=100000, cost=70000, stock=20),
                    Product(code="SP002", name="Sản phẩm mẫu B", category="Danh mục B", price=150000, cost=90000, stock=12),
                    Product(code="SP003", name="Sản phẩm mẫu C", category="Danh mục A", price=59000, cost=35000, stock=3, min_stock=5),
                ]
            )
        db.commit()
    finally:
        db.close()


seed()


def ensure_category(db, name):
    """Trả về tên danh mục chuẩn; tự tạo nếu chưa có (không phân biệt hoa thường)."""
    name = (name or "").strip()
    if not name:
        return ""
    for c in db.query(Category):
        if c.name.casefold() == name.casefold():
            return c.name
    db.add(Category(name=name))
    db.flush()
    return name


def sync_categories():
    """Đưa các danh mục đang gõ tay trong sản phẩm cũ vào bảng danh mục."""
    db = SessionLocal()
    try:
        for (cat,) in db.query(Product.category).distinct().all():
            ensure_category(db, cat)
        db.commit()
    finally:
        db.close()


def next_code(db, model, prefix, width):
    """Mã tiếp theo dạng PREFIX + số, ví dụ SP004 / KH0012 (lấy số lớn nhất đang có + 1)."""
    pat = re.compile(rf"^{re.escape(prefix)}(\d+)$", re.IGNORECASE)
    nums = []
    for (c,) in db.query(model.code).filter(model.code.like(f"{prefix}%")).all():
        m = pat.match(c or "")
        if m:
            nums.append(int(m.group(1)))
    return f"{prefix}{max(nums, default=0) + 1:0{width}d}"


def backfill_customer_codes():
    """Khách hàng cũ chưa có mã: gán KH0001, KH0002... theo thứ tự tạo."""
    db = SessionLocal()
    try:
        for c in db.query(Customer).filter(or_(Customer.code.is_(None), Customer.code == "")).order_by(Customer.id).all():
            c.code = next_code(db, Customer, "KH", 4)
            db.flush()
        db.commit()
    finally:
        db.close()


sync_categories()
backfill_customer_codes()


# ---------- health ----------
@app.get("/api/health")
def health():
    return {"ok": True, "version": "6.0"}


# ---------- auth ----------
@app.post("/api/auth/login")
def login(x: LoginIn, db: Session = Depends(get_db)):
    u = db.query(User).filter_by(username=x.username).first()
    if not u or not u.active or not verify_password(x.password, u.password_hash):
        raise HTTPException(401, "Sai tài khoản hoặc mật khẩu")
    return {"access_token": make_token(u), "token_type": "bearer"}


@app.get("/api/me")
def me(u=Depends(current_user)):
    return {
        "id": u.id,
        "username": u.username,
        "full_name": u.full_name,
        "role": u.role,
        "permissions": json.loads(u.permissions or "[]"),
    }


@app.post("/api/auth/change-password")
def change_password(x: ChangePasswordIn, db: Session = Depends(get_db), u=Depends(current_user)):
    if not verify_password(x.old_password, u.password_hash):
        raise HTTPException(400, "Mật khẩu cũ không đúng")
    if len(x.new_password) < 6:
        raise HTTPException(400, "Mật khẩu mới tối thiểu 6 ký tự")
    u.password_hash = hash_password(x.new_password)
    db.commit()
    return {"ok": True}


# ---------- products ----------
@app.get("/api/products")
def list_products(db: Session = Depends(get_db), u=Depends(require_permission("pos"))):
    return [
        {
            "id": p.id,
            "code": p.code,
            "name": p.name,
            "category": p.category,
            "price": p.price,
            "cost": p.cost,
            "stock": p.stock,
            "min_stock": p.min_stock,
            "active": p.active,
        }
        for p in db.query(Product).filter_by(active=True).order_by(Product.name)
    ]


@app.post("/api/products")
def add_product(x: ProductIn, db: Session = Depends(get_db), u=Depends(require_admin)):
    data = x.model_dump()
    data["code"] = data["code"].strip()
    if data["code"] and db.query(Product).filter_by(code=data["code"]).first():
        raise HTTPException(400, "Mã sản phẩm đã tồn tại")
    auto = not data["code"]
    for attempt in range(3):
        if auto:
            data["code"] = next_code(db, Product, "SP", 3)
        data["category"] = ensure_category(db, x.category)
        p = Product(**data)
        db.add(p)
        try:
            db.commit()
            break
        except IntegrityError:  # trùng mã do hai người tạo cùng lúc: sinh lại mã
            db.rollback()
            if not auto or attempt == 2:
                raise HTTPException(400, "Không tạo được mã sản phẩm, vui lòng thử lại")
    db.refresh(p)
    return {"id": p.id, "code": p.code}


@app.put("/api/products/{product_id}")
def update_product(product_id: int, x: ProductUpdate, db: Session = Depends(get_db), u=Depends(require_admin)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "Không tìm thấy sản phẩm")
    data = x.model_dump(exclude_unset=True)
    if "category" in data:
        data["category"] = ensure_category(db, data["category"])
    for k, v in data.items():
        setattr(p, k, v)
    db.commit()
    return {"ok": True}


@app.delete("/api/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db), u=Depends(require_admin)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "Không tìm thấy sản phẩm")
    p.active = False
    db.commit()
    return {"ok": True}


# ---------- customers ----------
@app.get("/api/customers")
def list_customers(db: Session = Depends(get_db), u=Depends(require_any_permission("customers", "pos"))):
    counts = dict(
        db.query(Order.customer_id, func.count(Order.id)).filter(Order.customer_id.isnot(None)).group_by(Order.customer_id).all()
    )
    return [
        {"id": c.id, "code": c.code, "name": c.name, "phone": c.phone, "address": c.address, "tax_code": c.tax_code, "note": c.note, "order_count": int(counts.get(c.id, 0))}
        for c in db.query(Customer).order_by(Customer.name)
    ]


@app.post("/api/customers")
def add_customer(x: CustomerIn, db: Session = Depends(get_db), u=Depends(require_any_permission("customers", "pos"))):
    c = Customer(**x.model_dump(), code=next_code(db, Customer, "KH", 4))
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id, "code": c.code}


@app.put("/api/customers/{customer_id}")
def update_customer(customer_id: int, x: CustomerIn, db: Session = Depends(get_db), u=Depends(require_permission("customers"))):
    c = db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404, "Không tìm thấy khách hàng")
    for k, v in x.model_dump().items():
        setattr(c, k, v)
    db.commit()
    return {"ok": True}


@app.delete("/api/customers/{customer_id}")
def delete_customer(customer_id: int, db: Session = Depends(get_db), u=Depends(require_admin)):
    c = db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404, "Không tìm thấy khách hàng")
    # đơn hàng cũ vẫn giữ nguyên (kể cả tên khách đã lưu trên đơn), chỉ gỡ liên kết tới khách hàng
    db.query(Order).filter(Order.customer_id == c.id).update({Order.customer_id: None})
    db.delete(c)
    db.commit()
    return {"ok": True}


# ---------- orders ----------
def vnd(x):
    """Làm tròn nửa lên - khớp với Math.round ở frontend."""
    return int(math.floor(x + 0.5))


def calc_vat(after, rate, inclusive):
    """VAT tính trên số tiền sau chiết khấu (không tính trên phí ship).
    inclusive=True: giá đã gồm VAT (tách VAT ra khỏi giá); False: VAT cộng thêm vào giá."""
    if rate <= 0:
        return 0
    return vnd(after * rate / (100 + rate)) if inclusive else vnd(after * rate / 100)


@app.post("/api/orders")
def create_order(x: OrderIn, db: Session = Depends(get_db), u=Depends(require_permission("pos"))):
    if not x.items:
        raise HTTPException(400, "Giỏ hàng trống")

    # 1. kiểm tra tồn kho + tính tiền từng dòng (đã trừ chiết khấu mặt hàng) ngay trên server
    remaining, lines = {}, []
    for it in x.items:
        p = db.get(Product, it.product_id)
        if not p or not p.active:
            raise HTTPException(400, "Có sản phẩm không tồn tại hoặc đã bị ẩn")
        remaining.setdefault(p.id, p.stock)
        if remaining[p.id] < it.qty:
            raise HTTPException(400, f"Sản phẩm '{p.name}' không đủ tồn kho")
        remaining[p.id] -= it.qty
        lines.append((p, it, vnd(p.price * it.qty * (100 - it.discount_pct) / 100)))

    subtotal = sum(net for _, _, net in lines)
    discount = min(max(x.discount, 0), subtotal)
    shipping = max(x.shipping, 0)
    total = subtotal - discount + shipping
    if x.payment == "cash" and x.cash_received < total:
        raise HTTPException(400, "Tiền khách đưa chưa đủ")

    # 2. tạo đơn
    o = Order(
        customer_id=x.customer_id,
        customer_name=x.customer_name,
        payment=x.payment,
        subtotal=subtotal,
        discount=discount,
        shipping=shipping,
        total=total,
        note=x.note,
        created_by=u.id,
    )
    db.add(o)
    db.flush()
    cost = 0
    for p, it, net in lines:
        p.stock -= it.qty
        cost += p.cost * it.qty
        db.add(OrderItem(order_id=o.id, product_id=p.id, product_name=p.name, qty=it.qty, price=p.price, cost=p.cost, discount_pct=it.discount_pct))
        db.add(StockMovement(product_id=p.id, movement_type="sale", qty=-it.qty, note=f"Đơn #{o.id}", created_by=u.id))
    o.cost = cost
    o.profit = total - cost
    db.add(AuditLog(user_id=u.id, action="create_order", detail=f"Đơn #{o.id} · {money(o.total)}"))
    db.commit()
    return {"id": o.id, "total": total, "change": max(0, x.cash_received - total) if x.payment == "cash" else 0}


def iso(d):
    return d.isoformat() + "Z"


def money(v):
    return f"{v:,.0f}đ"


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def pos_or_orders(u=Depends(current_user)):
    perms = json.loads(u.permissions or "[]")
    if u.role != "admin" and "pos" not in perms and "orders" not in perms:
        raise HTTPException(403, "Bạn không có quyền truy cập mục này")
    return u


def parse_day(s):
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "Ngày không hợp lệ (định dạng YYYY-MM-DD)")


def filter_by_date(q, date_from, date_to):
    """Lọc theo ngày (giờ Việt Nam), bao gồm cả ngày bắt đầu và ngày kết thúc."""
    d1, d2 = parse_day(date_from), parse_day(date_to)
    if d1:
        q = q.filter(Order.created_at >= vn_day_start_utc(d1))
    if d2:
        q = q.filter(Order.created_at < vn_day_start_utc(d2 + timedelta(days=1)))
    return q


@app.post("/api/orders/draft-export")
def export_draft(x: OrderIn, db: Session = Depends(get_db), u=Depends(require_permission("pos"))):
    """Xuất Excel phiếu tạm tính TRƯỚC khi thanh toán: không lưu đơn, không trừ kho."""
    if not x.items:
        raise HTTPException(400, "Giỏ hàng trống")
    items, subtotal = [], 0
    for it in x.items:
        p = db.get(Product, it.product_id)
        if not p:
            raise HTTPException(400, "Có sản phẩm không tồn tại")
        subtotal += vnd(p.price * it.qty * (100 - it.discount_pct) / 100)
        items.append(SimpleNamespace(order_id=None, product_name=p.name, qty=it.qty, price=p.price, cost=p.cost, discount_pct=it.discount_pct))
    discount = min(max(x.discount, 0), subtotal)
    shipping = max(x.shipping, 0)
    now = datetime.utcnow()
    order = SimpleNamespace(
        id=None, created_at=now, customer_name=x.customer_name, payment=x.payment,
        subtotal=subtotal, discount=discount, shipping=shipping, total=subtotal - discount + shipping,
    )
    name = f"phieu_tam_tinh_{(now + VN_OFFSET):%Y%m%d_%H%M}.xlsx"
    return Response(
        build_invoice_xlsx(order, items, draft=True, customer=db.get(Customer, x.customer_id) if x.customer_id else None),
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


def apply_search(q, text):
    """Tìm theo mã đơn, tên khách, mã số thuế, SĐT, ghi chú. Query cần outer join Customer."""
    t = (text or "").strip()
    if not t:
        return q
    conds = [
        Order.customer_name.icontains(t, autoescape=True),
        Order.note.icontains(t, autoescape=True),
        Customer.tax_code.icontains(t, autoescape=True),
        Customer.phone.icontains(t, autoescape=True),
    ]
    num = t.lstrip("#").strip()
    if num.isdigit() and len(num) <= 9:
        conds.append(Order.id == int(num))
    return q.filter(or_(*conds))


@app.get("/api/orders/export")
def export_orders(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    u=Depends(require_permission("orders")),
):
    rows = (
        apply_search(filter_by_date(db.query(Order, Customer.tax_code).outerjoin(Customer, Customer.id == Order.customer_id), date_from, date_to), q)
        .order_by(Order.created_at.desc())
        .limit(5000)
        .all()
    )
    orders = [o for o, _ in rows]
    taxes = {o.id: (t or "") for o, t in rows}
    items = (
        apply_search(
            filter_by_date(
                db.query(OrderItem).join(Order, Order.id == OrderItem.order_id).outerjoin(Customer, Customer.id == Order.customer_id),
                date_from,
                date_to,
            ),
            q,
        )
        .order_by(OrderItem.order_id.desc(), OrderItem.id)
        .all()
    )
    name = f"don_hang_{(datetime.utcnow() + VN_OFFSET):%Y%m%d_%H%M}.xlsx"
    return Response(
        build_orders_xlsx(orders, items, taxes),
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.get("/api/orders")
def list_orders(date_from: Optional[str] = None, date_to: Optional[str] = None, q: Optional[str] = None, db: Session = Depends(get_db), u=Depends(require_permission("orders"))):
    return [
        {
            "id": o.id,
            "tax_code": tax or "",
            "customer_name": o.customer_name,
            "payment": o.payment,
            "status": o.status,
            "subtotal": o.subtotal,
            "discount": o.discount,
            "shipping": o.shipping,
            "total": o.total,
            "profit": o.profit,
            "note": o.note,
            "created_at": iso(o.created_at),
        }
        for o, tax in apply_search(
            filter_by_date(db.query(Order, Customer.tax_code).outerjoin(Customer, Customer.id == Order.customer_id), date_from, date_to), q
        ).order_by(Order.created_at.desc()).limit(500)
    ]


@app.get("/api/orders/{order_id}")
def order_detail(order_id: int, db: Session = Depends(get_db), u=Depends(require_permission("orders"))):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(404, "Không tìm thấy đơn hàng")
    items = db.query(OrderItem).filter_by(order_id=order_id).all()
    cu = db.get(Customer, o.customer_id) if o.customer_id else None
    return {
        "id": o.id,
        "customer_id": o.customer_id,
        "customer": {"tax_code": cu.tax_code, "address": cu.address, "phone": cu.phone} if cu else None,
        "customer_name": o.customer_name,
        "payment": o.payment,
        "status": o.status,
        "subtotal": o.subtotal,
        "discount": o.discount,
        "shipping": o.shipping,
        "total": o.total,
        "profit": o.profit,
        "note": o.note,
        "created_at": iso(o.created_at),
        "items": [{"product_id": i.product_id, "name": i.product_name, "qty": i.qty, "price": i.price, "discount_pct": i.discount_pct or 0} for i in items],
    }


@app.put("/api/orders/{order_id}")
def update_order(order_id: int, x: OrderIn, db: Session = Depends(get_db), u=Depends(require_admin)):
    """Sửa đơn: hoàn kho theo đơn cũ, kiểm tra tồn rồi trừ kho theo đơn mới (ghi lịch sử kho phần chênh lệch)."""
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(404, "Không tìm thấy đơn hàng")
    if not x.items:
        raise HTTPException(400, "Đơn hàng cần ít nhất một sản phẩm")
    old_items = db.query(OrderItem).filter_by(order_id=o.id).all()

    before, old_price = {}, {}
    for it in old_items:  # 1. hoàn kho theo đơn cũ
        p = db.get(Product, it.product_id)
        if p:
            before.setdefault(p.id, p.stock)
            p.stock += it.qty
        old_price.setdefault(it.product_id, (it.price, it.cost))

    remaining, lines = {}, []
    for it in x.items:  # 2. kiểm tra tồn kho + tính tiền theo đơn mới
        p = db.get(Product, it.product_id)
        if not p or (not p.active and it.product_id not in old_price):
            raise HTTPException(400, "Có sản phẩm không tồn tại hoặc đã bị ẩn")
        before.setdefault(p.id, p.stock)
        remaining.setdefault(p.id, p.stock)
        if remaining[p.id] < it.qty:
            raise HTTPException(400, f"Sản phẩm '{p.name}' không đủ tồn kho (còn {remaining[p.id]})")
        remaining[p.id] -= it.qty
        price, cost = old_price.get(p.id, (p.price, p.cost))  # sản phẩm đã có trong đơn: giữ giá bán / giá vốn lúc bán
        lines.append((p, it, vnd(price * it.qty * (100 - it.discount_pct) / 100), price, cost))

    subtotal = sum(net for _, _, net, _, _ in lines)
    discount = min(max(x.discount, 0), subtotal)
    shipping = max(x.shipping, 0)
    total = subtotal - discount + shipping

    db.query(OrderItem).filter_by(order_id=o.id).delete()
    cost_sum = 0
    for p, it, net, price, cost in lines:
        p.stock -= it.qty
        cost_sum += cost * it.qty
        db.add(OrderItem(order_id=o.id, product_id=p.id, product_name=p.name, qty=it.qty, price=price, cost=cost, discount_pct=it.discount_pct))
    for pid, b in before.items():  # 3. ghi lịch sử kho phần chênh lệch
        delta = db.get(Product, pid).stock - b
        if delta:
            db.add(StockMovement(product_id=pid, movement_type="sale" if delta < 0 else "return", qty=delta, note=f"Sửa đơn #{o.id}", created_by=u.id))

    cu = db.get(Customer, x.customer_id) if x.customer_id else None
    o.customer_id = cu.id if cu else None
    o.customer_name = cu.name if cu else (x.customer_name or "Khách lẻ")
    o.payment, o.note = x.payment, x.note
    o.subtotal, o.discount, o.shipping, o.total = subtotal, discount, shipping, total
    o.cost, o.profit = cost_sum, total - cost_sum
    db.add(AuditLog(user_id=u.id, action="update_order", detail=f"Sửa đơn #{o.id} · {money(total)}"))
    db.commit()
    return {"id": o.id, "total": total}


@app.delete("/api/orders/{order_id}")
def delete_order(order_id: int, db: Session = Depends(get_db), u=Depends(require_admin)):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(404, "Không tìm thấy đơn hàng")
    for it in db.query(OrderItem).filter_by(order_id=o.id).all():  # hoàn kho
        p = db.get(Product, it.product_id)
        if p:
            p.stock += it.qty
            db.add(StockMovement(product_id=p.id, movement_type="return", qty=it.qty, note=f"Xóa đơn #{o.id}", created_by=u.id))
    db.query(OrderItem).filter_by(order_id=o.id).delete()
    db.add(AuditLog(user_id=u.id, action="delete_order", detail=f"Xóa đơn #{o.id} · {money(o.total)}"))
    db.delete(o)
    db.commit()
    return {"ok": True}


@app.get("/api/orders/{order_id}/export")
def export_order(order_id: int, db: Session = Depends(get_db), u=Depends(pos_or_orders)):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(404, "Không tìm thấy đơn hàng")
    items = db.query(OrderItem).filter_by(order_id=order_id).order_by(OrderItem.id).all()
    cust = db.get(Customer, o.customer_id) if o.customer_id else None
    return Response(
        build_invoice_xlsx(o, items, customer=cust),
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="hoa_don_{o.id}.xlsx"'},
    )


# ---------- dashboard ----------
VN_OFFSET = timedelta(hours=7)  # DB lưu giờ UTC; "hôm nay" tính theo giờ Việt Nam


def vn_day_start_utc(day):
    """Thời điểm 00:00 (giờ VN) của `day`, quy đổi về UTC để so sánh với created_at."""
    return datetime.combine(day, datetime.min.time()) - VN_OFFSET


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db), u=Depends(require_permission("dashboard"))):
    # Không dùng func.date()/so sánh chuỗi để chạy được trên cả SQLite lẫn PostgreSQL/MySQL.
    today = (datetime.utcnow() + VN_OFFSET).date()
    first = today - timedelta(days=6)

    rows = (
        db.query(Order.created_at, Order.total, Order.profit)
        .filter(Order.created_at >= vn_day_start_utc(first), Order.created_at < vn_day_start_utc(today + timedelta(days=1)))
        .all()
    )
    by_day = {}
    for created, total, profit in rows:
        d = (created + VN_OFFSET).date()
        r = by_day.setdefault(d, {"orders": 0, "revenue": 0.0, "profit": 0.0})
        r["orders"] += 1
        r["revenue"] += float(total or 0)
        r["profit"] += float(profit or 0)

    chart = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        r = by_day.get(d, {"revenue": 0.0, "profit": 0.0})
        chart.append({"date": d.strftime("%d/%m"), "revenue": r["revenue"], "profit": r["profit"]})
    t = by_day.get(today, {"orders": 0, "revenue": 0.0, "profit": 0.0})

    top_products = (
        db.query(OrderItem.product_name, func.sum(OrderItem.qty).label("qty"))
        .join(Order, Order.id == OrderItem.order_id)
        .filter(Order.created_at >= vn_day_start_utc(today - timedelta(days=30)))
        .group_by(OrderItem.product_name)
        .order_by(func.sum(OrderItem.qty).desc())
        .limit(5)
        .all()
    )

    low_q = db.query(Product).filter(Product.active.is_(True), Product.stock <= Product.min_stock)
    low_stock_items = low_q.order_by(Product.stock).limit(8).all()

    return {
        "orders": t["orders"],
        "revenue": t["revenue"],
        "profit": t["profit"],
        "low_stock": low_q.count(),
        "customers": db.query(Customer).count(),
        "chart": chart,
        "top_products": [{"name": n, "qty": int(q or 0)} for n, q in top_products],
        "low_stock_items": [{"name": p.name, "code": p.code, "stock": p.stock, "min_stock": p.min_stock} for p in low_stock_items],
    }


# ---------- stock ----------
@app.post("/api/stock")
def stock_movement(x: StockIn, db: Session = Depends(get_db), u=Depends(require_admin)):
    p = db.get(Product, x.product_id)
    if not p:
        raise HTTPException(404, "Không tìm thấy sản phẩm")
    if x.qty < 0 or (x.movement_type != "adjust" and x.qty == 0):
        raise HTTPException(400, "Số lượng không hợp lệ")
    if x.movement_type == "import":
        p.stock += x.qty
        delta = x.qty
    elif x.movement_type == "remove":
        if p.stock < x.qty:
            raise HTTPException(400, "Tồn kho không đủ")
        p.stock -= x.qty
        delta = -x.qty
    elif x.movement_type == "adjust":
        delta = x.qty - p.stock
        p.stock = x.qty
    else:
        raise HTTPException(400, "Loại kho không hợp lệ")
    db.add(StockMovement(product_id=p.id, movement_type=x.movement_type, qty=delta, note=x.note, created_by=u.id))
    db.commit()
    return {"stock": p.stock}


@app.get("/api/stock/history")
def stock_history(db: Session = Depends(get_db), u=Depends(require_admin)):
    rows = db.query(StockMovement).order_by(StockMovement.created_at.desc()).limit(300).all()
    out = []
    for m in rows:
        p = db.get(Product, m.product_id)
        out.append(
            {
                "product": p.name if p else "?",
                "code": p.code if p else "",
                "movement_type": m.movement_type,
                "qty": m.qty,
                "note": m.note,
                "created_at": iso(m.created_at),
            }
        )
    return out


# ---------- expenses ----------
@app.post("/api/expenses")
def add_expense(x: ExpenseIn, db: Session = Depends(get_db), u=Depends(require_admin)):
    e = Expense(title=x.title, amount=x.amount, note=x.note, created_by=u.id)
    db.add(e)
    db.commit()
    return {"id": e.id}


@app.get("/api/expenses")
def list_expenses(db: Session = Depends(get_db), u=Depends(require_admin)):
    return [
        {"id": e.id, "title": e.title, "amount": e.amount, "note": e.note, "created_at": iso(e.created_at)}
        for e in db.query(Expense).order_by(Expense.created_at.desc())
    ]


@app.delete("/api/expenses/{expense_id}")
def delete_expense(expense_id: int, db: Session = Depends(get_db), u=Depends(require_admin)):
    e = db.get(Expense, expense_id)
    if not e:
        raise HTTPException(404, "Không tìm thấy khoản chi")
    db.delete(e)
    db.commit()
    return {"ok": True}


# ---------- users ----------
ALL_PERMS = ["dashboard", "pos", "orders", "customers"]


def other_active_admins(db, user_id):
    return db.query(User).filter(User.role == "admin", User.active.is_(True), User.id != user_id).count()


@app.get("/api/users")
def list_users(db: Session = Depends(get_db), u=Depends(require_admin)):
    return [
        {
            "id": x.id,
            "username": x.username,
            "full_name": x.full_name,
            "role": x.role,
            "active": x.active,
            "permissions": json.loads(x.permissions or "[]"),
        }
        for x in db.query(User).order_by(User.id)
    ]


@app.post("/api/users")
def add_user(x: UserIn, db: Session = Depends(get_db), u=Depends(require_admin)):
    if not x.username.strip():
        raise HTTPException(400, "Tên đăng nhập không được để trống")
    if db.query(User).filter_by(username=x.username).first():
        raise HTTPException(400, "Username đã tồn tại")
    if len(x.password) < 6:
        raise HTTPException(400, "Mật khẩu tối thiểu 6 ký tự")
    if x.role not in ("admin", "employee"):
        raise HTTPException(400, "Vai trò không hợp lệ")
    a = User(
        username=x.username.strip(),
        password_hash=hash_password(x.password),
        full_name=x.full_name,
        role=x.role,
        permissions=json.dumps(["*"] if x.role == "admin" else x.permissions),
    )
    db.add(a)
    db.commit()
    return {"id": a.id}


@app.put("/api/users/{user_id}")
def update_user(user_id: int, x: UserUpdate, db: Session = Depends(get_db), u=Depends(require_admin)):
    a = db.get(User, user_id)
    if not a:
        raise HTTPException(404, "Không tìm thấy tài khoản")
    data = x.model_dump(exclude_unset=True)

    if "role" in data and data["role"] not in ("admin", "employee"):
        raise HTTPException(400, "Vai trò không hợp lệ")
    if a.id == u.id and (data.get("role", a.role) != a.role or data.get("active") is False):
        raise HTTPException(400, "Bạn không thể tự đổi vai trò hoặc khóa chính mình")
    loses_admin = a.role == "admin" and a.active and (data.get("role", "admin") != "admin" or data.get("active") is False)
    if loses_admin and other_active_admins(db, a.id) == 0:
        raise HTTPException(400, "Phải còn ít nhất một quản trị viên đang hoạt động")

    pw = data.pop("password", None)
    if pw:
        if len(pw) < 6:
            raise HTTPException(400, "Mật khẩu mới tối thiểu 6 ký tự")
        a.password_hash = hash_password(pw)

    if data.get("role") == "admin":
        data["permissions"] = ["*"]
    elif data.get("role") == "employee" and "permissions" not in data and a.role == "admin":
        data["permissions"] = ALL_PERMS
    if "permissions" in data:
        data["permissions"] = json.dumps(data["permissions"])
    for k, v in data.items():
        setattr(a, k, v)
    db.commit()
    return {"ok": True}


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), u=Depends(require_admin)):
    a = db.get(User, user_id)
    if not a:
        raise HTTPException(404, "Không tìm thấy tài khoản")
    if a.id == u.id:
        raise HTTPException(400, "Bạn không thể xóa chính mình")
    if a.role == "admin" and a.active and other_active_admins(db, a.id) == 0:
        raise HTTPException(400, "Phải còn ít nhất một quản trị viên đang hoạt động")
    has_history = (
        db.query(Order).filter(Order.created_by == a.id).count()
        + db.query(StockMovement).filter(StockMovement.created_by == a.id).count()
        + db.query(Expense).filter(Expense.created_by == a.id).count()
        + db.query(Purchase).filter(Purchase.created_by == a.id).count()
        + db.query(AuditLog).filter(AuditLog.user_id == a.id).count()
    )
    if has_history:
        raise HTTPException(409, "Tài khoản này đã có lịch sử bán hàng/kho/chi phí nên không thể xóa để giữ số liệu. Hãy dùng 'Khóa' thay thế.")
    db.delete(a)
    db.commit()
    return {"ok": True}


@app.get("/api/codes/next")
def preview_next_code(kind: str, db: Session = Depends(get_db), u=Depends(current_user)):
    """Xem trước mã sẽ được tạo (mã thật vẫn do server cấp khi lưu)."""
    perms = json.loads(u.permissions or "[]")
    if kind == "product" and u.role == "admin":
        return {"code": next_code(db, Product, "SP", 3)}
    if kind == "customer" and (u.role == "admin" or "customers" in perms or "pos" in perms):
        return {"code": next_code(db, Customer, "KH", 4)}
    raise HTTPException(403, "Không có quyền hoặc loại mã không hợp lệ")


# ---------- danh mục sản phẩm ----------
@app.get("/api/categories")
def list_categories(db: Session = Depends(get_db), u=Depends(require_admin)):
    counts = dict(
        db.query(Product.category, func.count(Product.id)).filter(Product.active.is_(True)).group_by(Product.category).all()
    )
    return [{"id": c.id, "name": c.name, "count": int(counts.get(c.name, 0))} for c in db.query(Category).order_by(Category.name)]


def _check_cat_name(db, name, exclude_id=None):
    name = (name or "").strip()
    if not name:
        raise HTTPException(400, "Vui lòng nhập tên danh mục")
    for c in db.query(Category):
        if c.id != exclude_id and c.name.casefold() == name.casefold():
            raise HTTPException(400, f"Danh mục '{c.name}' đã tồn tại")
    return name


@app.post("/api/categories")
def add_category(x: CategoryIn, db: Session = Depends(get_db), u=Depends(require_admin)):
    name = _check_cat_name(db, x.name)
    c = Category(name=name)
    db.add(c)
    db.commit()
    return {"id": c.id, "name": c.name}


@app.put("/api/categories/{category_id}")
def rename_category(category_id: int, x: CategoryIn, db: Session = Depends(get_db), u=Depends(require_admin)):
    c = db.get(Category, category_id)
    if not c:
        raise HTTPException(404, "Không tìm thấy danh mục")
    name = _check_cat_name(db, x.name, exclude_id=c.id)
    db.query(Product).filter(Product.category == c.name).update({Product.category: name})  # đổi tên đồng bộ cho sản phẩm
    c.name = name
    db.commit()
    return {"ok": True, "name": name}


@app.delete("/api/categories/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db), u=Depends(require_admin)):
    c = db.get(Category, category_id)
    if not c:
        raise HTTPException(404, "Không tìm thấy danh mục")
    n = db.query(Product).filter(Product.category == c.name).count()
    if n:
        raise HTTPException(409, f"Danh mục đang có {n} sản phẩm. Hãy chuyển các sản phẩm sang danh mục khác trước khi xóa.")
    db.delete(c)
    db.commit()
    return {"ok": True}


# ---------- đại lý (suppliers) ----------
def supplier_dict(x):
    return {"id": x.id, "code": x.code, "name": x.name, "tax_code": x.tax_code, "address": x.address, "phone": x.phone}


@app.get("/api/suppliers")
def list_suppliers(db: Session = Depends(get_db), u=Depends(require_admin)):
    return [supplier_dict(x) for x in db.query(Supplier).filter(Supplier.active.is_(True)).order_by(Supplier.name)]


@app.post("/api/suppliers")
def add_supplier(x: SupplierIn, db: Session = Depends(get_db), u=Depends(require_admin)):
    if not x.name.strip():
        raise HTTPException(400, "Vui lòng nhập tên đại lý")
    code = x.code.strip()
    if code:
        if db.query(Supplier).filter_by(code=code).first():
            raise HTTPException(400, "Mã số đại lý đã tồn tại")
    else:  # tự sinh mã DL001, DL002...
        n = db.query(func.max(Supplier.id)).scalar() or 0
        while True:
            n += 1
            code = f"DL{n:03d}"
            if not db.query(Supplier).filter_by(code=code).first():
                break
    s = Supplier(code=code, name=x.name.strip(), tax_code=x.tax_code.strip(), address=x.address.strip(), phone=x.phone.strip())
    db.add(s)
    db.commit()
    return {"id": s.id, "code": s.code}


@app.put("/api/suppliers/{supplier_id}")
def update_supplier(supplier_id: int, x: SupplierIn, db: Session = Depends(get_db), u=Depends(require_admin)):
    s = db.get(Supplier, supplier_id)
    if not s:
        raise HTTPException(404, "Không tìm thấy đại lý")
    if not x.name.strip():
        raise HTTPException(400, "Vui lòng nhập tên đại lý")
    code = x.code.strip() or s.code
    if code != s.code and db.query(Supplier).filter_by(code=code).first():
        raise HTTPException(400, "Mã số đại lý đã tồn tại")
    s.code, s.name = code, x.name.strip()
    s.tax_code, s.address, s.phone = x.tax_code.strip(), x.address.strip(), x.phone.strip()
    db.commit()
    return {"ok": True}


@app.delete("/api/suppliers/{supplier_id}")
def delete_supplier(supplier_id: int, db: Session = Depends(get_db), u=Depends(require_admin)):
    s = db.get(Supplier, supplier_id)
    if not s:
        raise HTTPException(404, "Không tìm thấy đại lý")
    s.active = False  # ẩn, giữ lại để phiếu mua cũ vẫn hiển thị đúng
    db.commit()
    return {"ok": True}


# ---------- phiếu mua hàng từ đại lý ----------
@app.post("/api/purchases")
def create_purchase(x: PurchaseIn, db: Session = Depends(get_db), u=Depends(require_admin)):
    sup = db.get(Supplier, x.supplier_id)
    if not sup or not sup.active:
        raise HTTPException(400, "Đại lý không tồn tại hoặc đã bị ẩn")
    if not x.items:
        raise HTTPException(400, "Phiếu mua hàng chưa có sản phẩm")
    pu = Purchase(supplier_id=sup.id, supplier_name=sup.name, note=x.note, created_by=u.id, total=0)
    db.add(pu)
    db.flush()
    total = 0
    vat_total = 0
    for it in x.items:
        p = db.get(Product, it.product_id)
        if not p or not p.active:
            raise HTTPException(400, "Có sản phẩm không tồn tại hoặc đã bị ẩn")
        old = p.stock
        # giá vốn luôn tính theo giá CHƯA VAT (VAT đầu vào tách riêng); nếu giá nhập đã gồm VAT thì tách VAT ra
        net_cost = it.unit_cost * 100 / (100 + it.vat_rate) if (x.vat_inclusive and it.vat_rate > 0) else it.unit_cost
        # giá vốn bình quân gia quyền giữa hàng tồn và hàng mới nhập
        p.cost = vnd((old * p.cost + it.qty * net_cost) / (old + it.qty)) if old > 0 else vnd(net_cost)
        p.stock = old + it.qty
        line = it.qty * it.unit_cost
        line_vat = calc_vat(line, it.vat_rate, x.vat_inclusive)  # VAT tính riêng cho từng mặt hàng
        total += line
        vat_total += line_vat
        db.add(PurchaseItem(purchase_id=pu.id, product_id=p.id, product_name=p.name, qty=it.qty, unit_cost=it.unit_cost, vat_rate=it.vat_rate, vat_amount=line_vat))
        db.add(StockMovement(product_id=p.id, movement_type="purchase", qty=it.qty, note=f"Phiếu mua #{pu.id} - {sup.name}", created_by=u.id))
    pu.vat_amount, pu.vat_inclusive = vat_total, x.vat_inclusive
    pu.total = total + (0 if x.vat_inclusive else vat_total)  # tổng thanh toán cho đại lý
    db.commit()
    return {"id": pu.id, "total": pu.total}


def apply_purchase_search(query, text):
    """Tìm phiếu mua theo tên/mã/mã số thuế đại lý, số phiếu, ghi chú, hoặc tên/mã sản phẩm trong phiếu."""
    t = (text or "").strip()
    if not t:
        return query
    item_hit = exists().where(
        PurchaseItem.purchase_id == Purchase.id,
        or_(
            PurchaseItem.product_name.icontains(t, autoescape=True),
            PurchaseItem.product_id.in_(select(Product.id).where(Product.code.icontains(t, autoescape=True))),
        ),
    )
    conds = [
        Purchase.supplier_name.icontains(t, autoescape=True),
        Purchase.note.icontains(t, autoescape=True),
        Supplier.tax_code.icontains(t, autoescape=True),
        Supplier.code.icontains(t, autoescape=True),
        item_hit,
    ]
    num = t.lstrip("#").strip()
    if num.isdigit() and len(num) <= 9:
        conds.append(Purchase.id == int(num))
    return query.filter(or_(*conds))


@app.get("/api/purchases")
def list_purchases(q: Optional[str] = None, db: Session = Depends(get_db), u=Depends(require_admin)):
    rows = (
        apply_purchase_search(db.query(Purchase, Supplier.tax_code).outerjoin(Supplier, Supplier.id == Purchase.supplier_id), q)
        .order_by(Purchase.created_at.desc())
        .limit(300)
        .all()
    )
    counts = {}
    if rows:
        counts = dict(
            db.query(PurchaseItem.purchase_id, func.count(PurchaseItem.id))
            .filter(PurchaseItem.purchase_id.in_([r.id for r, _ in rows]))
            .group_by(PurchaseItem.purchase_id)
            .all()
        )
    return [
        {
            "id": r.id,
            "supplier_name": r.supplier_name,
            "tax_code": tax or "",
            "vat_rate": r.vat_rate or 0,
            "vat_amount": r.vat_amount or 0,
            "total": r.total,
            "note": r.note,
            "item_count": int(counts.get(r.id, 0)),
            "created_at": iso(r.created_at),
        }
        for r, tax in rows
    ]


@app.get("/api/purchases/{purchase_id}")
def purchase_detail(purchase_id: int, db: Session = Depends(get_db), u=Depends(require_admin)):
    r = db.get(Purchase, purchase_id)
    if not r:
        raise HTTPException(404, "Không tìm thấy phiếu mua hàng")
    sup = db.get(Supplier, r.supplier_id)
    items = db.query(PurchaseItem).filter_by(purchase_id=r.id).order_by(PurchaseItem.id).all()
    return {
        "id": r.id,
        "supplier_id": r.supplier_id,
        "total": r.total,
        "vat_rate": r.vat_rate or 0,
        "vat_amount": r.vat_amount or 0,
        "vat_inclusive": bool(r.vat_inclusive),
        "goods_total": r.total - (0 if r.vat_inclusive else (r.vat_amount or 0)),
        "note": r.note,
        "created_at": iso(r.created_at),
        "supplier": supplier_dict(sup) if sup else {"name": r.supplier_name, "code": "", "tax_code": "", "address": "", "phone": ""},
        "items": [
            {"product_id": i.product_id, "name": i.product_name, "qty": i.qty, "unit_cost": i.unit_cost, "vat_rate": i.vat_rate or 0, "vat_amount": i.vat_amount or 0}
            for i in items
        ],
    }


def _purchase_net(unit_cost, rate, inclusive):
    """Đơn giá chưa VAT dùng để tính giá vốn."""
    return unit_cost * 100 / (100 + rate) if (inclusive and rate > 0) else unit_cost


def _reverse_purchase_line(p, qty, net):
    """Gỡ một dòng nhập khỏi tồn kho và giá vốn bình quân (chính xác nếu giá vốn chưa bị đổi sau đó, nếu không thì xấp xỉ)."""
    rest = p.stock - qty
    if rest > 0:
        p.cost = max(0, vnd((p.stock * p.cost - qty * net) / rest))
    p.stock = rest


def _apply_purchase_line(p, qty, net):
    old = p.stock
    p.cost = vnd((old * p.cost + qty * net) / (old + qty)) if old > 0 else vnd(net)
    p.stock = old + qty


@app.put("/api/purchases/{purchase_id}")
def update_purchase(purchase_id: int, x: PurchaseIn, db: Session = Depends(get_db), u=Depends(require_admin)):
    pu = db.get(Purchase, purchase_id)
    if not pu:
        raise HTTPException(404, "Không tìm thấy phiếu mua hàng")
    sup = db.get(Supplier, x.supplier_id)
    if not sup or (not sup.active and sup.id != pu.supplier_id):
        raise HTTPException(400, "Đại lý không tồn tại hoặc đã bị ẩn")
    if not x.items:
        raise HTTPException(400, "Phiếu mua hàng chưa có sản phẩm")
    old_items = db.query(PurchaseItem).filter_by(purchase_id=pu.id).all()
    old_pids = {i.product_id for i in old_items}

    before = {}
    for it in old_items:  # 1. gỡ ảnh hưởng của phiếu cũ
        p = db.get(Product, it.product_id)
        if p:
            before.setdefault(p.id, p.stock)
            _reverse_purchase_line(p, it.qty, _purchase_net(it.unit_cost, it.vat_rate or pu.vat_rate or 0, pu.vat_inclusive))

    total = vat_total = 0
    new_rows = []
    for it in x.items:  # 2. áp dụng phiếu mới
        p = db.get(Product, it.product_id)
        if not p or (not p.active and it.product_id not in old_pids):
            raise HTTPException(400, "Có sản phẩm không tồn tại hoặc đã bị ẩn")
        before.setdefault(p.id, p.stock)
        line = it.qty * it.unit_cost
        line_vat = calc_vat(line, it.vat_rate, x.vat_inclusive)
        total += line
        vat_total += line_vat
        _apply_purchase_line(p, it.qty, _purchase_net(it.unit_cost, it.vat_rate, x.vat_inclusive))
        new_rows.append(PurchaseItem(purchase_id=pu.id, product_id=p.id, product_name=p.name, qty=it.qty, unit_cost=it.unit_cost, vat_rate=it.vat_rate, vat_amount=line_vat))

    for pid in before:  # 3. không cho tồn kho âm (hàng đã bán bớt)
        p = db.get(Product, pid)
        if p.stock < 0:
            raise HTTPException(400, f"Không thể sửa: '{p.name}' đã bán/xuất bớt nên tồn kho sẽ bị âm ({p.stock}).")

    db.query(PurchaseItem).filter_by(purchase_id=pu.id).delete()
    db.add_all(new_rows)
    for pid, b in before.items():
        delta = db.get(Product, pid).stock - b
        if delta:
            db.add(StockMovement(product_id=pid, movement_type="purchase", qty=delta, note=f"Sửa phiếu mua #{pu.id}", created_by=u.id))
    pu.supplier_id, pu.supplier_name, pu.note = sup.id, sup.name, x.note
    pu.vat_rate, pu.vat_amount, pu.vat_inclusive = 0, vat_total, x.vat_inclusive
    pu.total = total + (0 if x.vat_inclusive else vat_total)
    db.commit()
    return {"id": pu.id, "total": pu.total}


@app.delete("/api/purchases/{purchase_id}")
def delete_purchase(purchase_id: int, db: Session = Depends(get_db), u=Depends(require_admin)):
    pu = db.get(Purchase, purchase_id)
    if not pu:
        raise HTTPException(404, "Không tìm thấy phiếu mua hàng")
    items = db.query(PurchaseItem).filter_by(purchase_id=pu.id).all()
    before, qty_by = {}, {}
    for it in items:  # trừ lại số lượng đã nhập, tính lại giá vốn
        p = db.get(Product, it.product_id)
        if p:
            before.setdefault(p.id, p.stock)
            qty_by[p.id] = qty_by.get(p.id, 0) + it.qty
            _reverse_purchase_line(p, it.qty, _purchase_net(it.unit_cost, it.vat_rate or pu.vat_rate or 0, pu.vat_inclusive))
    for pid, b in before.items():
        p = db.get(Product, pid)
        if p.stock < 0:
            raise HTTPException(400, f"Không thể xóa: '{p.name}' đã bán/xuất bớt (hiện còn {b}, phiếu này đã nhập {qty_by[pid]}).")
    for pid, b in before.items():
        db.add(StockMovement(product_id=pid, movement_type="purchase", qty=-qty_by[pid], note=f"Xóa phiếu mua #{pu.id}", created_by=u.id))
    db.query(PurchaseItem).filter_by(purchase_id=pu.id).delete()
    db.delete(pu)
    db.commit()
    return {"ok": True}


# ---------- backup ----------
@app.post("/api/backup")
def backup(db: Session = Depends(get_db), u=Depends(require_admin)):
    if not settings.DATABASE_URL.startswith("sqlite"):
        raise HTTPException(400, "Sao lưu qua API chỉ hỗ trợ SQLite. Với PostgreSQL/MySQL hãy dùng tính năng backup của nhà cung cấp database.")
    db.commit()
    Path("backups").mkdir(exist_ok=True)
    src = sqlite3.connect("data/shop.db")
    target = Path("backups") / f"shop_{datetime.now():%Y%m%d_%H%M%S}.db"
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    return {"ok": True, "file": str(target)}


app.mount("/", StaticFiles(directory="app/static", html=True), name="static")
