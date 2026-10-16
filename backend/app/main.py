from __future__ import annotations

import os
import secrets
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware

load_dotenv()

from backend.app import models  # noqa: E402, F401
from backend.app.api.routes import router  # noqa: E402
from backend.app.auth import auth_router  # noqa: E402
from backend.app.database import Base, engine  # noqa: E402

Base.metadata.create_all(bind=engine)
app = FastAPI(
    title="SAQ QURYLYS API",
    description=(
        "Инструмент мониторинга открытых сведений о новостройках. Решения и факты подтверждает аналитик."
    ),
    version="0.1.0",
)


def _error_code(detail, status_code: int) -> str:
    if isinstance(detail, str) and detail.isascii() and detail.replace("_", "").isalnum():
        return detail
    if status_code == 404:
        return "not_found"
    if status_code == 409:
        return "conflict"
    if status_code == 413:
        return "file_too_large"
    if status_code == 415:
        return "unsupported_file_type"
    return "validation_error" if status_code == 422 else f"http_{status_code}"


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, error: StarletteHTTPException):
    # Keep the legacy `detail` field for API consumers and add a stable locale-neutral code.
    return JSONResponse(
        status_code=error.status_code,
        headers=error.headers,
        content={"detail": error.detail, "error_code": _error_code(error.detail, error.status_code)},
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, error: RequestValidationError):
    # Keep FastAPI's legacy structured detail while excluding non-JSON `ctx.error` objects.
    details = [{key: value for key, value in issue.items() if key != "ctx"} for issue in error.errors()]
    return JSONResponse(
        status_code=422,
        content={"detail": details, "error_code": "validation_error"},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET") or secrets.token_urlsafe(32),
    max_age=60 * 60 * 12,
    same_site="lax",
    https_only=os.getenv("SESSION_HTTPS_ONLY", "false").lower() == "true",
)
app.include_router(auth_router)
app.include_router(router)

dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if dist.exists():

    class SPAStaticFiles(StaticFiles):
        async def get_response(self, path: str, scope):
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as error:
                if error.status_code == 404:
                    return await super().get_response("index.html", scope)
                raise

    app.mount("/", SPAStaticFiles(directory=dist, html=True), name="frontend")
