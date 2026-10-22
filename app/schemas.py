from typing import Optional

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    username: str
    password: str


class ProductIn(BaseModel):
    code: str
    name: str
    category: str = ""
    price: float = 0
    cost: float = 0
    stock: int = 0
    min_stock: int = 5


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = None
    cost: Optional[float] = None
    min_stock: Optional[int] = None
    active: Optional[bool] = None


class CustomerIn(BaseModel):
    name: str
    phone: str = ""
    address: str = ""
    note: str = ""


class ItemIn(BaseModel):
    product_id: int
    qty: int = Field(gt=0)


class OrderIn(BaseModel):
    customer_id: Optional[int] = None
    customer_name: str = "Khách lẻ"
    payment: str = "cash"
    subtotal: float = 0
    discount: float = 0
    shipping: float = 0
    total: float = 0
    cash_received: float = 0
    note: str = ""
    items: list[ItemIn]


class StockIn(BaseModel):
    product_id: int
    qty: int
    movement_type: str = "import"
    note: str = ""


class ExpenseIn(BaseModel):
    title: str
    amount: float
    note: str = ""


class UserIn(BaseModel):
    username: str
    password: str
    full_name: str = ""
    role: str = "employee"
    permissions: list[str] = ["dashboard", "pos", "customers", "orders"]


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    permissions: Optional[list[str]] = None
    active: Optional[bool] = None


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str
