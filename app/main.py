import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func
from sqlalchemy.orm import Session

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
@app.post("/api/orders")
def create_order(x: OrderIn, db: Session = Depends(get_db), u=Depends(require_permission("pos"))):
    if not x.items:
        raise HTTPException(400, "Giỏ hàng trống")
    if x.payment == "cash" and x.cash_received < x.total:
        raise HTTPException(400, "Tiền khách đưa chưa đủ")
    o = Order(
        customer_id=x.customer_id,
        customer_name=x.customer_name,
        payment=x.payment,
        subtotal=x.subtotal,
        discount=x.discount,
        shipping=x.shipping,
        total=x.total,
        note=x.note,
        created_by=u.id,
    )
    db.add(o)
    db.flush()
    cost = 0
    for it in x.items:
        p = db.get(Product, it.product_id)
        if not p or p.stock < it.qty:
            raise HTTPException(400, f"Sản phẩm '{p.name if p else it.product_id}' không đủ tồn kho")
        p.stock -= it.qty
        cost += p.cost * it.qty
        db.add(OrderItem(order_id=o.id, product_id=p.id, product_name=p.name, qty=it.qty, price=p.price, cost=p.cost))
        db.add(StockMovement(product_id=p.id, movement_type="sale", qty=-it.qty, note=f"Đơn #{o.id}", created_by=u.id))
    o.cost = cost
    o.profit = o.total - cost
    db.add(AuditLog(user_id=u.id, action="create_order", detail=f"Đơn #{o.id} · {money(o.total)}"))
    db.commit()
    return {"id": o.id, "change": max(0, x.cash_received - x.total) if x.payment == "cash" else 0}


def money(v):
    return f"{v:,.0f}đ"


@app.get("/api/orders")
def list_orders(db: Session = Depends(get_db), u=Depends(require_permission("orders"))):
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
            "created_at": o.created_at.isoformat(),
        }
        for o in db.query(Order).order_by(Order.created_at.desc()).limit(500)
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
        "created_at": o.created_at.isoformat(),
        "items": [{"name": i.product_name, "qty": i.qty, "price": i.price} for i in items],
    }


# ---------- dashboard ----------
@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db), u=Depends(require_permission("dashboard"))):
    today = datetime.now().date()
    today_rows = db.query(Order).filter(func.date(Order.created_at) == str(today)).all()

    chart = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        rows = db.query(Order).filter(func.date(Order.created_at) == str(d)).all()
        chart.append({"date": d.strftime("%d/%m"), "revenue": sum(o.total for o in rows), "profit": sum(o.profit for o in rows)})

    top_products = (
        db.query(OrderItem.product_name, func.sum(OrderItem.qty).label("qty"))
        .join(Order, Order.id == OrderItem.order_id)
        .filter(func.date(Order.created_at) >= str(today - timedelta(days=30)))
        .group_by(OrderItem.product_name)
        .order_by(func.sum(OrderItem.qty).desc())
        .limit(5)
        .all()
    )

    low_stock_items = (
        db.query(Product)
        .filter(Product.active == True, Product.stock <= Product.min_stock)  # noqa: E712
        .order_by(Product.stock)
        .limit(8)
        .all()
    )

    return {
        "orders": len(today_rows),
        "revenue": sum(o.total for o in today_rows),
        "profit": sum(o.profit for o in today_rows),
        "low_stock": db.query(Product).filter(Product.active == True, Product.stock <= Product.min_stock).count(),  # noqa: E712
        "customers": db.query(Customer).count(),
        "chart": chart,
        "top_products": [{"name": n, "qty": q} for n, q in top_products],
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
                "created_at": m.created_at.isoformat(),
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
        {"id": e.id, "title": e.title, "amount": e.amount, "note": e.note, "created_at": e.created_at.isoformat()}
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
@app.get("/api/users")
def list_users(db: Session = Depends(get_db), u=Depends(require_admin)):
    return [
        {"id": x.id, "username": x.username, "full_name": x.full_name, "role": x.role, "active": x.active}
        for x in db.query(User)
    ]


@app.post("/api/users")
def add_user(x: UserIn, db: Session = Depends(get_db), u=Depends(require_admin)):
    if db.query(User).filter_by(username=x.username).first():
        raise HTTPException(400, "Username đã tồn tại")
    a = User(
        username=x.username,
        password_hash=hash_password(x.password),
        full_name=x.full_name,
        role=x.role,
        permissions=json.dumps(x.permissions),
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
    if "permissions" in data:
        data["permissions"] = json.dumps(data["permissions"])
    for k, v in data.items():
        setattr(a, k, v)
    db.commit()
    return {"ok": True}


# ---------- backup ----------
@app.post("/api/backup")
def backup(db: Session = Depends(get_db), u=Depends(require_admin)):
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
