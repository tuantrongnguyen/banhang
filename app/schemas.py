from typing import Optional

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    username: str
    password: str


class ProductIn(BaseModel):
    code: str = ""  # để trống = tự sinh SP001, SP002...
    name: str
    category: str = ""
    price: float = 0
    cost: float = 0
    stock: int = 0
    min_stock: int = 5
    supplier_id: Optional[int] = None
    unit: str = ""


class CategoryIn(BaseModel):
    name: str


class ProductUpdate(BaseModel):
    code: Optional[str] = None
    unit: Optional[str] = None
    supplier_id: Optional[int] = None
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
    tax_code: str = ""
    note: str = ""


class ItemIn(BaseModel):
    product_id: int
    qty: int = Field(gt=0)
    discount_pct: float = Field(default=0, ge=0, le=100)


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
    invoice: bool = False  # True = bán có hóa đơn
    no_stock: bool = False  # True = không trừ tồn kho
    buyer_name: str = ""
    buyer_tax_code: str = ""
    buyer_phone: str = ""
    buyer_address: str = ""
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
    password: Optional[str] = None
    role: Optional[str] = None
    permissions: Optional[list[str]] = None
    active: Optional[bool] = None


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str


class SupplierIn(BaseModel):
    code: str = ""
    name: str
    tax_code: str = ""
    address: str = ""
    phone: str = ""


class PurchaseItemIn(BaseModel):
    product_id: int
    qty: int = Field(gt=0)
    unit_cost: float = Field(ge=0)
    vat_rate: float = Field(default=0, ge=0, le=100)


class PurchaseIn(BaseModel):
    supplier_id: int
    note: str = ""
    vat_inclusive: bool = False
    items: list[PurchaseItemIn]


class InvoiceIn(BaseModel):
    buyer_name: str = ""
    tax_code: str = ""
    phone: str = ""
    address: str = ""
    note: str = ""


class InvoiceUpdate(BaseModel):
    buyer_name: str
    tax_code: str = ""
    phone: str = ""
    address: str = ""
    note: str = ""
    issued_date: Optional[str] = None
