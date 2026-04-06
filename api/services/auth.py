import datetime
import jwt
from fastapi import HTTPException, Header
from config import JWT_SECRET, JWT_ALGORITHM


def create_jwt(payload: dict, expires_minutes: int = 480) -> str:
    """Mint a signed JWT with an exp claim (default 8 hours)."""
    data = {
        **payload,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=expires_minutes),
    }
    return jwt.encode(data, JWT_SECRET, algorithm=JWT_ALGORITHM)


def validate_jwt(token: str) -> bool:
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return True
    except Exception:
        return False


def decode_jwt(token: str) -> dict | None:
    """Decode and validate a JWT. Returns full payload or None on failure."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None


def _extract_bearer(authorization: str) -> str | None:
    if not authorization.startswith("Bearer "):
        return None
    return authorization.split(" ", 1)[1]


def require_jwt(authorization: str = Header(...)) -> dict:
    """FastAPI dependency: accepts admin OR workspace user JWT. Returns decoded payload."""
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    payload = decode_jwt(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


def require_admin_jwt(authorization: str = Header(...)) -> dict:
    """FastAPI dependency: accepts only admin JWTs (role=admin)."""
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    payload = decode_jwt(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


def optional_user_jwt(authorization: str = Header(default="")) -> dict | None:
    """FastAPI dependency: returns decoded payload if a valid JWT is present, else None."""
    if not authorization:
        return None
    token = _extract_bearer(authorization)
    if not token:
        return None
    return decode_jwt(token)
