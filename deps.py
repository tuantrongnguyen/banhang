import json

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .security import decode_token

bearer = HTTPBearer()


def current_user(c: HTTPAuthorizationCredentials = Depends(bearer), db: Session = Depends(get_db)):
    p = decode_token(c.credentials)
    if not p:
        raise HTTPException(401, "Token không hợp lệ hoặc đã hết hạn")
    u = db.get(User, int(p["sub"]))
    if not u or not u.active:
        raise HTTPException(401, "Tài khoản không hoạt động")
    return u


def require_admin(u=Depends(current_user)):
    if u.role != "admin":
        raise HTTPException(403, "Chỉ Admin được thực hiện thao tác này")
    return u


def require_permission(name: str):
    def check(u=Depends(current_user)):
        if u.role != "admin" and name not in json.loads(u.permissions or "[]"):
            raise HTTPException(403, "Bạn không có quyền truy cập mục này")
        return u

    return check
