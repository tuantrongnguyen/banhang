import json
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import jwt, JWTError

from .config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def make_token(user):
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {
            "sub": str(user.id),
            "username": user.username,
            "role": user.role,
            "permissions": json.loads(user.permissions or "[]"),
            "exp": exp,
        },
        settings.SECRET_KEY,
        algorithm="HS256",
    )


def decode_token(token: str):
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except JWTError:
        return None
