import jwt
from fastapi import HTTPException, Header
from config import JWT_SECRET, JWT_ALGORITHM


def validate_jwt(token: str) -> bool:
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return True
    except Exception:
        return False


def require_jwt(authorization: str = Header(...)) -> str:
    """FastAPI dependency: enforces a valid Bearer JWT on protected endpoints."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ", 1)[1]
    if not validate_jwt(token):
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return token
