from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

load_dotenv()

from backend.app import models  # noqa: E402, F401
from backend.app.api.routes import router  # noqa: E402
from backend.app.database import Base, engine  # noqa: E402

Base.metadata.create_all(bind=engine)
app = FastAPI(
    title="SAQ QURYLYS API",
    description=(
        "Инструмент мониторинга открытых сведений о новостройках. Решения и факты подтверждает аналитик."
    ),
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
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
