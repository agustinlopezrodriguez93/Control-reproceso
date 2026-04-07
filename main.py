"""
Control Reproceso - Main Server
Mismo patrón que consolidador: FastAPI + Jinja2 + PostgreSQL
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from db import get_db, init_db
from api.endpoints import router as api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Gestor del ciclo de vida de la aplicacion FastAPI.

    Al arrancar el servidor (startup) inicializa la base de datos PostgreSQL:
    crea las tablas si no existen y siembra los datos por defecto (usuarios y SKUs).
    Si la conexion falla, se imprime el error pero el servidor continua arrancando
    para no bloquear el proceso en entornos donde la BD puede estar momentaneamente
    no disponible.

    Yield separa el bloque de startup del de shutdown (actualmente sin logica de cierre).
    """
    # Startup: Initialize database tables and seed data
    print("--- [REPROCESO] Iniciando aplicación...")
    try:
        init_db()
        print("--- [REPROCESO] Base de datos lista. Sistema operativo.")
    except Exception as e:
        print(f"--- [REPROCESO] ERROR CRÍTICO DE CONEXIÓN: {e}")
    yield


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = FastAPI(title="Control de Reproceso SKU", lifespan=lifespan)

# Static files (CSS, JS, images)
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

# HTML Templates
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

# API Routes
app.include_router(api_router)


# ─── Page Routes ───────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Main page - serves the SPA shell."""
    return templates.TemplateResponse(request=request, name="index.html")
