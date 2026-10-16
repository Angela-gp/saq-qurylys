from __future__ import annotations

import secrets
import threading
import time
from collections import defaultdict
from contextvars import ContextVar

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models import User

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])
router_actor: ContextVar[str] = ContextVar("router_actor", default="Система")
password_hasher = PasswordHasher()
MAX_LOGIN_FAILURES = 5
LOGIN_WINDOW_SECONDS = 15 * 60
_login_failures: dict[str, list[float]] = defaultdict(list)
_login_lock = threading.Lock()


class LoginPayload(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def _user_json(user: User) -> dict[str, str]:
    return {"username": user.username, "display_name": user.display_name, "role": user.role}


def _login_key(request: Request, username: str) -> str:
    host = request.client.host if request.client else "unknown"
    return f"{host}:{username.casefold()}"


def _is_rate_limited(key: str) -> bool:
    now = time.monotonic()
    with _login_lock:
        recent = [stamp for stamp in _login_failures[key] if now - stamp < LOGIN_WINDOW_SECONDS]
        _login_failures[key] = recent
        return len(recent) >= MAX_LOGIN_FAILURES


def _record_failure(key: str) -> None:
    now = time.monotonic()
    with _login_lock:
        _login_failures[key] = [
            stamp for stamp in _login_failures[key] if now - stamp < LOGIN_WINDOW_SECONDS
        ] + [now]


def _clear_failures(key: str) -> None:
    with _login_lock:
        _login_failures.pop(key, None)


async def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user_id = request.session.get("user_id")
    user = db.get(User, user_id) if isinstance(user_id, int) else None
    if not user or not user.active:
        request.session.clear()
        raise HTTPException(401, "authentication_required")
    if request.method not in {"GET", "HEAD", "OPTIONS"} and user.role != "analyst":
        raise HTTPException(403, "analyst_role_required")
    router_actor.set(user.display_name)
    return user


@auth_router.post("/login")
def login(payload: LoginPayload, request: Request, db: Session = Depends(get_db)):
    key = _login_key(request, payload.username)
    if _is_rate_limited(key):
        raise HTTPException(429, "login_rate_limited")
    user = db.scalar(select(User).where(User.username == payload.username, User.active.is_(True)))
    valid_password = False
    if user:
        try:
            valid_password = password_hasher.verify(user.password_hash, payload.password)
        except (VerifyMismatchError, InvalidHashError):
            valid_password = False
    if not valid_password or not user:
        _record_failure(key)
        raise HTTPException(401, "invalid_credentials")
    _clear_failures(key)
    request.session.clear()
    request.session["user_id"] = user.id
    request.session["csrf_nonce"] = secrets.token_urlsafe(16)
    return {"user": _user_json(user)}


@auth_router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@auth_router.get("/me")
def current_session(user: User = Depends(get_current_user)):
    return {"user": _user_json(user)}
