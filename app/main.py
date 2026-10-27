import json
import math
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, inspect, text
from sqlalchemy.orm import Session

from .config import settings
from .excel import build_invoice_xlsx, build_orders_xlsx
from .db import Base, engine, get_db, SessionLocal
from .deps import current_user, require_admin, require_permission
from .models import (
    AuditLog,
    Customer,
    Expense,
    Order,
    OrderItem,
    Product,
    StockMovement,
    User,
)
from .schemas import (
    ChangePasswordIn,
    CustomerIn,
    ExpenseIn,
    LoginIn,
    OrderIn,
    ProductIn,
    ProductUpdate,
    StockIn,
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
    if db.query(Product).filter_by(code=x.code).first():
        raise HTTPException(400, "Mã sản phẩm đã tồn tại")
    p = Product(**x.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": p.id}


@app.put("/api/products/{product_id}")
def update_product(product_id: int, x: ProductUpdate, db: Session = Depends(get_db), u=Depends(require_admin)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "Không tìm thấy sản phẩm")
    for k, v in x.model_dump(exclude_unset=True).items():
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
def list_customers(db: Session = Depends(get_db), u=Depends(require_permission("customers"))):
    return [
        {"id": c.id, "name": c.name, "phone": c.phone, "address": c.address, "note": c.note}
        for c in db.query(Customer).order_by(Customer.name)
    ]


@app.post("/api/customers")
def add_customer(x: CustomerIn, db: Session = Depends(get_db), u=Depends(require_permission("customers"))):
    c = Customer(**x.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id}


@app.put("/api/customers/{customer_id}")
def update_customer(customer_id: int, x: CustomerIn, db: Session = Depends(get_db), u=Depends(require_permission("customers"))):
    c = db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404, "Không tìm thấy khách hàng")
    for k, v in x.model_dump().items():
        setattr(c, k, v)
    db.commit()
    return {"ok": True}


# ---------- orders ----------
def vnd(x):
    """Làm tròn nửa lên - khớp với Math.round ở frontend."""
    return int(math.floor(x + 0.5))


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
        build_invoice_xlsx(order, items, draft=True),
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.get("/api/orders/export")
def export_orders(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    u=Depends(require_permission("orders")),
):
    orders = filter_by_date(db.query(Order), date_from, date_to).order_by(Order.created_at.desc()).limit(5000).all()
    items = (
        filter_by_date(db.query(OrderItem).join(Order, Order.id == OrderItem.order_id), date_from, date_to)
        .order_by(OrderItem.order_id.desc(), OrderItem.id)
        .all()
    )
    name = f"don_hang_{(datetime.utcnow() + VN_OFFSET):%Y%m%d_%H%M}.xlsx"
    return Response(
        build_orders_xlsx(orders, items),
        media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.get("/api/orders")
def list_orders(date_from: Optional[str] = None, date_to: Optional[str] = None, db: Session = Depends(get_db), u=Depends(require_permission("orders"))):
    return [
        {
            "id": o.id,
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
        for o in filter_by_date(db.query(Order), date_from, date_to).order_by(Order.created_at.desc()).limit(500)
    ]


@app.get("/api/orders/{order_id}")
def order_detail(order_id: int, db: Session = Depends(get_db), u=Depends(require_permission("orders"))):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(404, "Không tìm thấy đơn hàng")
    items = db.query(OrderItem).filter_by(order_id=order_id).all()
    return {
        "id": o.id,
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
        "items": [{"name": i.product_name, "qty": i.qty, "price": i.price, "discount_pct": i.discount_pct or 0} for i in items],
    }


@app.get("/api/orders/{order_id}/export")
def export_order(order_id: int, db: Session = Depends(get_db), u=Depends(pos_or_orders)):
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(404, "Không tìm thấy đơn hàng")
    items = db.query(OrderItem).filter_by(order_id=order_id).order_by(OrderItem.id).all()
    return Response(
        build_invoice_xlsx(o, items),
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
    rows = db.query(StockMovement).order_by(StockMovement.created_at.desc()).limit(100).all()
    out = []
    for m in rows:
        p = db.get(Product, m.product_id)
        out.append(
            {
                "product": p.name if p else "?",
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
        + db.query(AuditLog).filter(AuditLog.user_id == a.id).count()
    )
    if has_history:
        raise HTTPException(409, "Tài khoản này đã có lịch sử bán hàng/kho/chi phí nên không thể xóa để giữ số liệu. Hãy dùng 'Khóa' thay thế.")
    db.delete(a)
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
