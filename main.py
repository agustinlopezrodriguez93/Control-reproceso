"""
Control Reproceso - Main Server
Mismo patrón que consolidador: FastAPI + Jinja2 + PostgreSQL
"""
import os
import logging
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from db import init_db
from api.endpoints import router as api_router

# 1. Configuración de Logs (Requisito 6)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("reproceso")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Gestor del ciclo de vida de la aplicacion FastAPI.
    """
    # Startup: Initialize database tables and seed data (async — no bloquea el event loop)
    logger.info("--- [REPROCESO] Iniciando aplicación...")
    try:
        await init_db()
        logger.info("--- [REPROCESO] Base de datos lista. Sistema operativo.")
    except Exception as e:
        logger.error(f"--- [REPROCESO] ERROR CRÍTICO DE CONEXIÓN: {e}")
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

@app.get("/inventory", response_class=HTMLResponse)
async def inventory(request: Request):
    """Inventory page - Laudus ERP stock view."""
    return templates.TemplateResponse(request=request, name="inventory.html")

# 2. Main Flow Orderly (Requisito 9) y Entrypoint (Requisito 1)
def main():
    try:
        # Railway usa la variable de entorno PORT (Requisito 3)
        port = int(os.getenv("PORT", 8000))
        host = os.getenv("HOST", "0.0.0.0")
        
        logger.info(f"Lanzando servidor en {host}:{port}")
        uvicorn.run(app, host=host, port=port)
    except Exception as e:
        logger.error(f"Error fatal al iniciar: {e}")

if __name__ == "__main__":
    main()
