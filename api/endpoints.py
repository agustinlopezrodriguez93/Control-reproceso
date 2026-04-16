"""
Control Reproceso - API Endpoints
Todas las llamadas a db.py y auth.py son async — no se bloquea el event loop.
"""
import asyncio
import uuid
from fastapi import APIRouter, HTTPException, status, Depends, Request
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, field_validator
from typing import Optional

import asyncpg
from db import (
    get_usuarios, get_skus, get_procesos, get_proceso,
    crear_proceso, actualizar_estado, get_proceso_activo,
    get_performance, get_usuario_por_nombre, get_usuario_por_id,
    crear_usuario, borrar_usuario, get_audit_logs, log_audit,
    get_dashboard_stats, get_operator_kpis, get_sku_human_resources,
    get_break_config, set_break_config, get_conn,
    get_active_skus_full, set_active_skus, get_daily_report
)
from auth import (
    verify_password, verify_password_async, create_access_token,
    get_current_user, get_current_user_with_role,
    check_rate_limit, register_failed_attempt, clear_failed_attempts
)

router = APIRouter(prefix="/api", tags=["reproceso"])

# ─── Caché en memoria ──────────────────────────
import time as _time

_public_users_cache: dict = {"data": None, "ts": 0.0}
_PUBLIC_USERS_TTL = 60  # segundos — los usuarios cambian raramente


# ─── Request Models ───────────────────────────

class CrearProcesoRequest(BaseModel):
    operario: str
    sku_destino: str
    es_urgente: bool = False
    stock_inicial: int = 0


_VALID_ACTIONS = {"start", "pause", "resume", "finish"}


class AccionProcesoRequest(BaseModel):
    accion: str
    stock_final: Optional[int] = None

    @field_validator("accion")
    @classmethod
    def validate_accion(cls, v: str) -> str:
        if v not in _VALID_ACTIONS:
            raise ValueError(f"Acción debe ser una de: {', '.join(sorted(_VALID_ACTIONS))}")
        return v


class CrearUsuarioRequest(BaseModel):
    nombre: str
    password: str
    rol: str = "Operario"
    avatar: str = ""

    @field_validator("rol")
    @classmethod
    def validate_rol(cls, v: str) -> str:
        if v not in ("Maestro", "Operario"):
            raise ValueError("Rol debe ser 'Maestro' u 'Operario'")
        return v


class BreakConfigRequest(BaseModel):
    enabled: bool
    work_minutes: int
    rest_minutes: int

    @field_validator("work_minutes", "rest_minutes")
    @classmethod
    def validate_positive(cls, v: int) -> int:
        if v < 1 or v > 480:
            raise ValueError("El valor debe estar entre 1 y 480 minutos")
        return v


# ─── Dependencies ──────────────────────────────

async def require_maestro(token_data: dict = Depends(get_current_user_with_role)):
    """Requiere rol Maestro. Lee el rol directamente del JWT — sin query a DB.
    Retorna dict con nombre y rol del usuario autenticado."""
    if token_data.get("rol") != "Maestro":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Acceso denegado")
    return token_data


# ─── Endpoints ─────────────────────────────────

@router.get("/users-public")
async def api_public_users():
    """Lista usuarios para el picker de login. Sin autenticación.
    Cacheado en memoria por 60s — los usuarios cambian raramente."""
    import logging
    _log = logging.getLogger("reproceso.users-public")
    now = _time.monotonic()
    if _public_users_cache["data"] is None or now - _public_users_cache["ts"] > _PUBLIC_USERS_TTL:
        try:
            usuarios = await get_usuarios()
            _public_users_cache["data"] = [
                {"nombre": u["nombre"], "avatar": u["avatar"], "rol": u["rol"]} for u in usuarios
            ]
            _public_users_cache["ts"] = now
        except Exception as e:
            _log.error(f"[users-public] Error al obtener usuarios: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Error de base de datos: {str(e)}")
    return {"users": _public_users_cache["data"]}


@router.post("/login")
async def api_login(request: Request, form_data: OAuth2PasswordRequestForm = Depends()):
    """
    Autentica un usuario y devuelve un JWT.
    Rate limiting por IP (Redis o memoria). Bloquea tras MAX_ATTEMPTS intentos fallidos.

    Raises:
        HTTP 401: usuario o contraseña incorrectos.
        HTTP 429: IP bloqueada por exceso de intentos fallidos.
    """
    client_ip = request.client.host if request.client else "unknown"
    await check_rate_limit(client_ip)

    user = await get_usuario_por_nombre(form_data.username)
    if not user or not await verify_password_async(form_data.password, user.get("password_hash") or ""):
        await register_failed_attempt(client_ip)
        if user:
            await log_audit(user["nombre"], "LOGIN_FALLIDO", f"Intento fallido desde {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )

    await clear_failed_attempts(client_ip)
    # Incluir rol en el token para evitar query a DB en cada endpoint protegido
    access_token = create_access_token(data={"sub": user["nombre"], "rol": user["rol"]})
    await log_audit(user["nombre"], "LOGIN", f"Inicio de sesión exitoso desde {client_ip}")

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "nombre": user["nombre"],
            "rol": user["rol"],
            "avatar": user["avatar"]
        }
    }


@router.get("/me")
async def api_me(current_user: str = Depends(get_current_user)):
    """Retorna datos del usuario autenticado."""
    user = await get_usuario_por_nombre(current_user)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"id": user["id"], "nombre": user["nombre"], "rol": user["rol"], "avatar": user["avatar"]}


@router.get("/config")
async def api_config(current_user: str = Depends(get_current_user)):
    """Retorna usuarios y SKUs para poblar formularios del frontend."""
    usuarios, skus = await get_usuarios(), await get_skus()
    return {"users": usuarios, "availableSKUs": skus}


@router.get("/procesos")
async def api_listar_procesos(
    operario: Optional[str] = None,
    current_user: str = Depends(get_current_user)
):
    """Lista procesos con pausas incluidas. Urgentes primero."""
    return {"procesos": await get_procesos(operario)}


@router.get("/procesos/{proceso_id}")
async def api_get_proceso(proceso_id: str, current_user: str = Depends(get_current_user)):
    """Detalle completo de un proceso."""
    proc = await get_proceso(proceso_id)
    if not proc:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")
    return proc


@router.post("/procesos")
async def api_crear_proceso(
    req: CrearProcesoRequest,
    current_user: str = Depends(get_current_user)
):
    """Crea un nuevo proceso.
    Un Operario solo puede crear procesos asignados a sí mismo."""
    caller = await get_usuario_por_nombre(current_user)
    if not caller:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")

    if caller["rol"] != "Maestro" and req.operario != current_user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Un Operario solo puede crear procesos asignados a sí mismo."
        )

    proceso_id = str(uuid.uuid4())
    try:
        proc = await crear_proceso(proceso_id, req.operario, req.sku_destino, req.es_urgente, req.stock_inicial)
        await log_audit(
            current_user, "PROCESO_CREADO",
            f"SKU: {req.sku_destino}, Operario: {req.operario}, Urgente: {req.es_urgente}, Stock Inicial: {req.stock_inicial}"
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"ok": True, "proceso": proc}


@router.put("/procesos/{proceso_id}")
async def api_actualizar_proceso(
    proceso_id: str,
    req: AccionProcesoRequest,
    current_user: str = Depends(get_current_user)
):
    """Actualiza estado: start, pause, resume, finish.
    Un Operario solo puede modificar sus propios procesos."""
    # Fetch caller y proceso en paralelo para reducir latencia
    caller, proc = await asyncio.gather(
        get_usuario_por_nombre(current_user),
        get_proceso(proceso_id),
    )

    if not caller:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")
    if not proc:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")

    if caller["rol"] != "Maestro" and proc["operario_nombre"] != current_user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para modificar este proceso."
        )

    if req.accion in ("start", "resume"):
        activo = await get_proceso_activo(proc["operario_nombre"])
        if activo and activo["id"] != proceso_id:
            # Auto-pausar el proceso activo anterior en lugar de bloquear
            try:
                await actualizar_estado(activo["id"], "pause")
                await log_audit(
                    current_user, "PROCESO_AUTO_PAUSA",
                    f"Proceso {activo['sku_destino']} (ID: {activo['id']}) pausado automáticamente al iniciar otro"
                )
            except ValueError:
                pass  # Si ya estaba pausado o finalizado, continuar sin error

    try:
        updated = await actualizar_estado(proceso_id, req.accion, req.stock_final)
        await log_audit(current_user, f"PROCESO_{req.accion.upper()}", f"ID: {proceso_id}, Stock Final: {req.stock_final if req.accion == 'finish' else '-'}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"ok": True, "proceso": updated}


@router.get("/performance")
async def api_performance(maestro=Depends(require_maestro)):
    """Ranking de rendimiento por operario. Solo Maestro."""
    return {"performance": await get_performance()}


@router.get("/dashboard/kpis")
async def api_dashboard_kpis(maestro=Depends(require_maestro)):
    """KPIs globales para el dashboard. Solo Maestro.
    Queries secuenciales — asyncpg no soporta gather sobre la misma conexión."""
    from db import get_conn
    async with get_conn() as conn:
        counts = await conn.fetchrow("""
            SELECT
                COUNT(*) AS total_tasks,
                COUNT(CASE WHEN estado = 'INICIADO' THEN 1 END) AS active_tasks,
                COUNT(CASE WHEN estado = 'FINALIZADO' AND finished_at >= CURRENT_DATE THEN 1 END) AS finished_today,
                COUNT(CASE WHEN es_urgente = TRUE AND estado != 'FINALIZADO' THEN 1 END) AS pending_urgent
            FROM reproceso_procesos
        """)
        global_avg = await conn.fetchval("""
            WITH pause_totals AS (
                SELECT proceso_id,
                       SUM(EXTRACT(EPOCH FROM (COALESCE(fin, NOW()) - inicio))) / 60 AS total_pause_min
                FROM reproceso_pausas GROUP BY proceso_id
            )
            SELECT AVG(
                EXTRACT(EPOCH FROM (p.finished_at - p.started_at)) / 60
                - COALESCE(pt.total_pause_min, 0)
            )
            FROM reproceso_procesos p
            LEFT JOIN pause_totals pt ON pt.proceso_id = p.id
            WHERE p.estado = 'FINALIZADO'
        """)
        sku_rows = await conn.fetch("""
            SELECT sku_destino, COUNT(*) AS count
            FROM reproceso_procesos
            GROUP BY sku_destino ORDER BY count DESC LIMIT 5
        """)
    stats = dict(counts)
    stats["global_avg_minutes"] = float(global_avg) if global_avg else 0.0
    stats["sku_distribution"] = [dict(r) for r in sku_rows]
    return stats


@router.get("/dashboard/operator/{user_id}")
async def api_operator_kpis(user_id: int, maestro=Depends(require_maestro)):
    """Métricas de un operario vs promedio global. Solo Maestro."""
    return await get_operator_kpis(user_id)


# ─── User Management (Maestro Only) ───────────

@router.get("/users")
async def api_get_users(maestro=Depends(require_maestro)):
    """Lista todos los usuarios. Solo Maestro."""
    return {"users": await get_usuarios()}


@router.post("/users")
async def api_add_user(req: CrearUsuarioRequest, maestro=Depends(require_maestro)):
    """Crea un usuario. Contraseña hasheada con bcrypt. Solo Maestro."""
    try:
        new_id = await crear_usuario(req.nombre, req.password, req.rol, req.avatar)
        _public_users_cache["data"] = None  # Invalidar caché al agregar usuario
        await log_audit(maestro["nombre"], "USUARIO_CREADO", f"Nombre: {req.nombre}, Rol: {req.rol}")
        return {"ok": True, "id": new_id}
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=409, detail=f"Ya existe un usuario con el nombre '{req.nombre}'.")
    except Exception:
        raise HTTPException(status_code=500, detail="Error interno al crear el usuario.")


@router.delete("/users/{user_id}")
async def api_delete_user(user_id: int, maestro=Depends(require_maestro)):
    """Elimina un usuario. Solo Maestro.
    No se puede eliminar la propia cuenta ni la cuenta 'Admin'."""
    target_user = await get_usuario_por_id(user_id)

    # Comparar por nombre (disponible en JWT) en lugar de por id numérico
    if target_user and target_user["nombre"] == maestro["nombre"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes eliminar tu propia cuenta mientras estás autenticado."
        )

    if target_user and target_user["nombre"] == "Admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El usuario 'Admin' es una cuenta de sistema protegida y no puede eliminarse."
        )

    await borrar_usuario(user_id)
    _public_users_cache["data"] = None  # Invalidar caché al eliminar usuario
    await log_audit(
        maestro["nombre"], "USUARIO_ELIMINADO",
        f"ID: {user_id}, Nombre: {target_user['nombre'] if target_user else 'desconocido'}"
    )
    return {"ok": True}


# ─── Reports (Maestro Only) ───────────────────

@router.get("/reports/daily")
async def api_daily_report(maestro=Depends(require_maestro)):
    """Informe diario consolidado para gerencia."""
    return await get_daily_report()


# ─── Audit Logs (Maestro Only) ────────────────

@router.get("/sku-stats")
async def api_sku_stats(maestro=Depends(require_maestro)):
    """Recurso humano por SKU: horas-hombre, promedio, min/max por proceso. Solo Maestro."""
    return {"sku_stats": await get_sku_human_resources()}


@router.get("/audit")
async def api_audit(maestro=Depends(require_maestro)):
    """Últimas 100 entradas del log de auditoría. Solo Maestro."""
    return {"logs": await get_audit_logs()}


# ─── Break Config ─────────────────────────────

@router.get("/break-config")
async def api_get_break_config():
    """Configuración de pausas obligatorias. Sin autenticación — el frontend operario lo necesita."""
    return await get_break_config()


@router.put("/break-config")
async def api_set_break_config(req: BreakConfigRequest, maestro=Depends(require_maestro)):
    """Actualiza la configuración de pausas obligatorias. Solo Maestro."""
    result = await set_break_config(req.enabled, req.work_minutes, req.rest_minutes)
    await log_audit(
        maestro["nombre"], "CONFIG_PAUSAS",
        f"enabled={req.enabled}, work={req.work_minutes}min, rest={req.rest_minutes}min"
    )
    return result


# ─── Inventario Laudus (Maestro Only) ─────────

# Caché en memoria: evita llamar a Laudus en cada request (TTL 5 minutos)
import time as _time_inv
_inventory_cache: dict = {"data": None, "ts": 0.0}
_INVENTORY_TTL = 300  # 5 minutos


@router.get("/inventory/stock")
async def api_inventory_stock(maestro=Depends(require_maestro)):
    """
    Obtiene el inventario actualizado desde Laudus.
    Cruza /production/products/list (metadata) con /production/products/stock (cantidades).
    Cacheado 5 minutos para no saturar la API externa.
    """
    import logging
    _log = logging.getLogger("reproceso.inventory")

    now = _time_inv.monotonic()
    if _inventory_cache["data"] is not None and now - _inventory_cache["ts"] < _INVENTORY_TTL:
        return {"products": _inventory_cache["data"], "cached": True}

    from laudus_client import LaudusClient
    client = LaudusClient()

    try:
        # Llamada 1: metadata de productos
        products_raw = await client.post(
            "/production/products/list",
            {"fields": ["productId", "sku", "description"]}
        )
        if not isinstance(products_raw, list):
            raise ValueError(f"Respuesta inesperada de products/list: {type(products_raw)}")

        # Llamada 2: stock por bodega
        stock_raw = await client.get("/production/products/stock")
        stock_map: dict = {}
        if isinstance(stock_raw, dict) and "products" in stock_raw:
            for item in stock_raw["products"]:
                pid = item.get("productId")
                if pid is not None:
                    stock_map[pid] = item.get("stock", 0)
        elif isinstance(stock_raw, list):
            for item in stock_raw:
                pid = item.get("productId")
                if pid is not None:
                    stock_map[pid] = item.get("stock", 0)

        # Cruzar datos
        merged = []
        for prod in products_raw:
            pid = prod.get("productId")
            merged.append({
                "productId": pid,
                "sku": prod.get("sku", ""),
                "description": prod.get("description", ""),
                "stock": stock_map.get(pid, 0),
            })

        _inventory_cache["data"] = merged
        _inventory_cache["ts"] = now
        _log.info(f"[Laudus] Inventario actualizado: {len(merged)} productos.")
        return {"products": merged, "cached": False}

    except Exception as e:
        _log.error(f"[Laudus] Error al obtener inventario: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Error al conectar con Laudus: {str(e)}")


# ─── Stock Rules ──────────────────────────────

class StockRuleIn(BaseModel):
    sku: str
    stock_minimo: int

    @field_validator('sku')
    @classmethod
    def sku_not_empty(cls, v):
        if not v.strip():
            raise ValueError('SKU no puede estar vacío')
        return v.strip().upper()

    @field_validator('stock_minimo')
    @classmethod
    def non_negative(cls, v):
        if v < 0:
            raise ValueError('El umbral debe ser >= 0')
        return v


@router.get("/stock-rules")
async def get_stock_rules(maestro=Depends(require_maestro)):
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT id, sku, stock_minimo, updated_at FROM stock_rules ORDER BY sku"
        )
    return {"rules": [dict(r) for r in rows]}


@router.post("/stock-rules", status_code=201)
async def create_stock_rule(body: StockRuleIn, maestro=Depends(require_maestro)):
    async with get_conn() as conn:
        try:
            row = await conn.fetchrow(
                """INSERT INTO stock_rules (sku, stock_minimo)
                   VALUES ($1, $2)
                   RETURNING id, sku, stock_minimo, updated_at""",
                body.sku, body.stock_minimo
            )
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=409, detail=f"Ya existe una regla para SKU {body.sku}")
    return dict(row)


@router.put("/stock-rules/{rule_id}")
async def update_stock_rule(rule_id: int, body: StockRuleIn, maestro=Depends(require_maestro)):
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """UPDATE stock_rules
               SET sku=$1, stock_minimo=$2, updated_at=NOW()
               WHERE id=$3
               RETURNING id, sku, stock_minimo, updated_at""",
            body.sku, body.stock_minimo, rule_id
        )
    if not row:
        raise HTTPException(status_code=404, detail="Regla no encontrada")
    return dict(row)


@router.delete("/stock-rules/{rule_id}", status_code=204)
async def delete_stock_rule(rule_id: int, maestro=Depends(require_maestro)):
    async with get_conn() as conn:
        result = await conn.execute("DELETE FROM stock_rules WHERE id=$1", rule_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Regla no encontrada")


# ─── Active SKUs ──────────────────────────────

class ActiveSkusIn(BaseModel):
    skus: list[dict]   # [{sku, descripcion}, ...]


@router.get("/active-skus")
async def api_get_active_skus(maestro=Depends(require_maestro)):
    items = await get_active_skus_full()
    return {"skus": items}


@router.post("/active-skus")
async def api_set_active_skus(body: ActiveSkusIn, maestro=Depends(require_maestro)):
    """Reemplaza la lista completa de SKUs activos."""
    await set_active_skus(body.skus)
    return {"saved": len(body.skus)}


@router.get("/stock-status")
async def api_stock_status(maestro=Depends(require_maestro)):
    """
    Estado del stock del día para Maestros.
    Cruza las reglas de stock configuradas con el caché de inventario Laudus.
    No dispara una nueva llamada a Laudus — usa solo el caché existente.
    """
    async with get_conn() as conn:
        rule_rows = await conn.fetch(
            "SELECT sku, stock_minimo FROM stock_rules ORDER BY sku"
        )

    rules: dict = {
        r["sku"].upper(): {"stock_minimo": r["stock_minimo"]}
        for r in rule_rows
    }

    # Usar caché de inventario sin disparar llamada a Laudus
    inventory_data = _inventory_cache.get("data")
    stock_map: dict = {}
    if inventory_data:
        for item in inventory_data:
            sku = (item.get("sku") or "").strip().upper()
            if sku:
                stock_map[sku] = item.get("stock", 0)

    bajos, ok, sin_datos = [], [], []

    for sku, rule in rules.items():
        if sku in stock_map:
            stock_val = stock_map[sku]
            diferencia = stock_val - rule["stock_minimo"]
            entry = {
                "sku": sku,
                "stock": stock_val,
                "stock_minimo": rule["stock_minimo"],
                "diferencia": diferencia,
            }
            if stock_val <= rule["stock_minimo"]:
                bajos.append(entry)
            else:
                ok.append(entry)
        else:
            sin_datos.append({
                "sku": sku,
                "stock_minimo": rule["stock_minimo"],
                "diferencia": None,
            })

    return {
        "has_inventory": bool(inventory_data),
        "bajos": sorted(bajos, key=lambda x: x["diferencia"]),
        "ok": sorted(ok, key=lambda x: x["sku"]),
        "sin_datos": sorted(sin_datos, key=lambda x: x["sku"]),
        "total_reglas": len(rules),
    }


@router.get("/laudus/products")
async def api_laudus_products(maestro=Depends(require_maestro)):
    """Devuelve todos los productos de Laudus (productId, sku, description) — para el selector."""
    from laudus_client import LaudusClient
    client = LaudusClient()
    try:
        products_raw = await client.post(
            "/production/products/list",
            {"fields": ["productId", "sku", "description"]}
        )
        if isinstance(products_raw, dict) and "products" in products_raw:
            products_raw = products_raw["products"]
        products = [
            {"sku": p.get("sku", ""), "descripcion": p.get("description", "")}
            for p in products_raw if p.get("sku")
        ]
        return {"products": products}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error al conectar con Laudus: {str(e)}")


# ─── Product Times ────────────────────────────

@router.get("/product-times")
async def api_get_product_times(maestro=Depends(require_maestro)):
    """Retorna tiempos de producción por SKU (minutos por caja)."""
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT sku, minutos_por_caja, updated_at FROM product_times ORDER BY sku"
        )
    return {"times": [dict(r) for r in rows]}


# ─── CSV Upload ───────────────────────────────

from fastapi import UploadFile, File
import csv
import io


@router.post("/upload/productos-csv")
async def upload_productos_csv(
    file: UploadFile = File(...),
    maestro=Depends(require_maestro)
):
    """
    Carga masiva de productos activos desde CSV.
    Formato esperado: sku,descripcion,caja
    Reemplaza SOLO los registros presentes en el CSV (upsert).
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="El archivo debe ser .csv")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # utf-8-sig maneja BOM de Excel
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))

    # Normalizar nombres de columna (strip + lower)
    required = {"sku", "descripcion", "caja"}
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV vacío o sin encabezados")

    headers = {h.strip().lower() for h in reader.fieldnames}
    missing = required - headers
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Columnas faltantes: {', '.join(sorted(missing))}. "
                   f"Se esperan: sku, descripcion, caja"
        )

    rows = []
    for i, row in enumerate(reader, start=2):
        sku = (row.get("sku") or row.get("SKU") or "").strip().upper()
        desc = (row.get("descripcion") or row.get("Descripcion") or row.get("descripción") or "").strip()
        caja = (row.get("caja") or row.get("Caja") or "").strip()
        if not sku:
            continue
        rows.append((sku, desc, caja))

    if not rows:
        raise HTTPException(status_code=400, detail="El CSV no contiene filas válidas")

    async with get_conn() as conn:
        async with conn.transaction():
            for sku, desc, caja in rows:
                await conn.execute(
                    """INSERT INTO active_skus (sku, descripcion, caja)
                       VALUES ($1, $2, $3)
                       ON CONFLICT (sku) DO UPDATE
                       SET descripcion = EXCLUDED.descripcion, caja = EXCLUDED.caja""",
                    sku, desc, caja
                )

    return {"ok": True, "upserted": len(rows)}


@router.post("/upload/tiempos-csv")
async def upload_tiempos_csv(
    file: UploadFile = File(...),
    maestro=Depends(require_maestro)
):
    """
    Carga masiva de tiempos de producción desde CSV.
    Formato esperado: sku,minutos_por_caja
    Reemplaza (upsert) los registros presentes en el CSV.
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="El archivo debe ser .csv")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV vacío o sin encabezados")

    headers = {h.strip().lower() for h in reader.fieldnames}
    required = {"sku", "minutos_por_caja"}
    missing = required - headers
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Columnas faltantes: {', '.join(sorted(missing))}. "
                   f"Se esperan: sku, minutos_por_caja"
        )

    rows = []
    for row in reader:
        sku = (row.get("sku") or row.get("SKU") or "").strip().upper()
        try:
            mins = float((row.get("minutos_por_caja") or "").strip().replace(",", "."))
        except (ValueError, AttributeError):
            continue
        if not sku or mins < 0:
            continue
        rows.append((sku, mins))

    if not rows:
        raise HTTPException(status_code=400, detail="El CSV no contiene filas válidas")

    async with get_conn() as conn:
        async with conn.transaction():
            for sku, mins in rows:
                await conn.execute(
                    """INSERT INTO product_times (sku, minutos_por_caja)
                       VALUES ($1, $2)
                       ON CONFLICT (sku) DO UPDATE
                       SET minutos_por_caja = EXCLUDED.minutos_por_caja, updated_at = NOW()""",
                    sku, mins
                )

    return {"ok": True, "upserted": len(rows)}


# ─── Planificación de Producción ─────────────

from datetime import date as _date, timedelta as _timedelta


class PlanItemIn(BaseModel):
    fecha: str          # ISO: YYYY-MM-DD
    sku: str
    cajas_plan: int
    operario_id: Optional[int] = None
    es_emergencia: bool = False

    @field_validator('cajas_plan')
    @classmethod
    def cajas_positive(cls, v):
        if v < 0:
            raise ValueError('cajas_plan debe ser >= 0')
        return v


class PlanCierreIn(BaseModel):
    cajas_real: int


@router.get("/planning/semana")
async def api_plan_semana(
    fecha_inicio: Optional[str] = None,
    maestro=Depends(require_maestro)
):
    """
    Retorna el plan semanal (7 días desde fecha_inicio) junto con tiempos y capacidad.
    Si no se indica fecha_inicio, usa el lunes de la semana actual.
    """
    if fecha_inicio:
        try:
            start = _date.fromisoformat(fecha_inicio)
        except ValueError:
            raise HTTPException(status_code=400, detail="fecha_inicio debe ser YYYY-MM-DD")
    else:
        today = _date.today()
        start = today - _timedelta(days=today.weekday())  # lunes

    end = start + _timedelta(days=6)

    async with get_conn() as conn:
        plan_rows = await conn.fetch(
            """SELECT p.id, p.fecha, p.sku, p.cajas_plan, p.operario_id,
                      u.nombre AS operario_nombre, p.es_emergencia, p.cajas_real,
                      pt.minutos_por_caja
               FROM plan_produccion p
               LEFT JOIN reproceso_usuarios u ON u.id = p.operario_id
               LEFT JOIN product_times pt ON pt.sku = p.sku
               WHERE p.fecha BETWEEN $1 AND $2
               ORDER BY p.fecha, p.sku""",
            start, end
        )
        times_rows = await conn.fetch(
            "SELECT sku, minutos_por_caja FROM product_times ORDER BY sku"
        )
        operarios = await conn.fetch(
            "SELECT id, nombre FROM reproceso_usuarios WHERE rol = 'Operario' ORDER BY nombre"
        )
        horas_cfg = await conn.fetchval(
            "SELECT value FROM reproceso_config WHERE key = 'horas_jornada'"
        )

    horas_jornada = float(horas_cfg) if horas_cfg else 6.5
    minutos_jornada = horas_jornada * 60
    n_operarios = len(operarios)

    plan_by_date: dict = {}
    for r in plan_rows:
        f = r["fecha"].isoformat()
        if f not in plan_by_date:
            plan_by_date[f] = []
        plan_by_date[f].append(dict(r))

    semana = []
    for i in range(7):
        dia = (start + _timedelta(days=i)).isoformat()
        items = plan_by_date.get(dia, [])
        minutos_plan = sum(
            (it.get("minutos_por_caja") or 0) * it["cajas_plan"]
            for it in items
        )
        cap = minutos_jornada * n_operarios
        semana.append({
            "fecha": dia,
            "items": items,
            "minutos_plan": round(minutos_plan, 1),
            "minutos_disponibles": round(cap, 1),
            "pct_uso": round(minutos_plan / cap * 100, 1) if cap else 0,
        })

    return {
        "semana": semana,
        "horas_jornada": horas_jornada,
        "n_operarios": n_operarios,
        "operarios": [dict(o) for o in operarios],
        "product_times": {r["sku"]: float(r["minutos_por_caja"]) for r in times_rows},
    }


@router.post("/planning", status_code=201)
async def api_crear_plan(body: PlanItemIn, maestro=Depends(require_maestro)):
    """Crea o actualiza un ítem del plan de producción."""
    try:
        fecha = _date.fromisoformat(body.fecha)
    except ValueError:
        raise HTTPException(status_code=400, detail="fecha debe ser YYYY-MM-DD")

    async with get_conn() as conn:
        try:
            row = await conn.fetchrow(
                """INSERT INTO plan_produccion (fecha, sku, cajas_plan, operario_id, es_emergencia)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (fecha, sku, operario_id) DO UPDATE
                   SET cajas_plan = EXCLUDED.cajas_plan, es_emergencia = EXCLUDED.es_emergencia
                   RETURNING id, fecha, sku, cajas_plan, operario_id, es_emergencia, cajas_real""",
                fecha, body.sku.upper(), body.cajas_plan, body.operario_id, body.es_emergencia
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
    return dict(row)


@router.patch("/planning/{plan_id}/cierre")
async def api_cierre_plan(plan_id: int, body: PlanCierreIn, maestro=Depends(require_maestro)):
    """Registra el cierre real del día (cajas realmente producidas)."""
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "UPDATE plan_produccion SET cajas_real=$1 WHERE id=$2 "
            "RETURNING id, fecha, sku, cajas_plan, cajas_real",
            body.cajas_real, plan_id
        )
    if not row:
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    return dict(row)


@router.delete("/planning/{plan_id}", status_code=204)
async def api_eliminar_plan(plan_id: int, maestro=Depends(require_maestro)):
    async with get_conn() as conn:
        result = await conn.execute("DELETE FROM plan_produccion WHERE id=$1", plan_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Plan no encontrado")


@router.get("/planning/daily-report")
async def api_daily_report_planning(
    fecha: Optional[str] = None,
    maestro=Depends(require_maestro)
):
    """
    Informe diario: compara planificado vs. real, % de uso del tiempo y KPI en personas.
    Costo: $3.000/hora, jornada 6.5h → $19.500/persona-día.
    """
    target = _date.fromisoformat(fecha) if fecha else _date.today()
    COSTO_HORA = 3000

    async with get_conn() as conn:
        horas_cfg = await conn.fetchval(
            "SELECT value FROM reproceso_config WHERE key = 'horas_jornada'"
        )
        horas_jornada = float(horas_cfg) if horas_cfg else 6.5

        operarios = await conn.fetch(
            "SELECT id, nombre FROM reproceso_usuarios WHERE rol = 'Operario'"
        )
        n_operarios = len(operarios)
        minutos_disponibles = horas_jornada * 60 * n_operarios

        plan_rows = await conn.fetch(
            """SELECT p.sku, p.cajas_plan, p.cajas_real, p.es_emergencia,
                      u.nombre AS operario, pt.minutos_por_caja
               FROM plan_produccion p
               LEFT JOIN reproceso_usuarios u ON u.id = p.operario_id
               LEFT JOIN product_times pt ON pt.sku = p.sku
               WHERE p.fecha = $1""",
            target
        )

        proc_rows = await conn.fetch(
            """WITH pause_totals AS (
                SELECT proceso_id,
                       COALESCE(SUM(EXTRACT(EPOCH FROM
                           (COALESCE(fin, NOW()) - inicio))/60), 0) AS pausa_min
                FROM reproceso_pausas GROUP BY proceso_id
            )
            SELECT p.sku_destino, u.nombre AS operario,
                   GREATEST(0,
                       EXTRACT(EPOCH FROM (p.finished_at - p.started_at))/60
                       - COALESCE(pt.pausa_min, 0)
                   ) AS minutos_netos
            FROM reproceso_procesos p
            JOIN reproceso_usuarios u ON u.id = p.operario_id
            LEFT JOIN pause_totals pt ON pt.proceso_id = p.id
            WHERE p.finished_at::date = $1 AND p.estado = 'FINALIZADO'""",
            target
        )

    minutos_trabajados = sum(float(r["minutos_netos"] or 0) for r in proc_rows)
    minutos_plan = sum(
        float(r["minutos_por_caja"] or 0) * r["cajas_plan"] for r in plan_rows
    )

    pct_tiempo = round(minutos_trabajados / minutos_disponibles * 100, 1) if minutos_disponibles else 0
    pct_cumplimiento = round(minutos_trabajados / minutos_plan * 100, 1) if minutos_plan else None

    horas_trabajadas = minutos_trabajados / 60
    horas_disponibles = minutos_disponibles / 60
    diferencia_horas = horas_disponibles - horas_trabajadas
    personas_equivalente = round(diferencia_horas / horas_jornada, 2) if horas_jornada else 0

    return {
        "fecha": target.isoformat(),
        "n_operarios": n_operarios,
        "horas_jornada": horas_jornada,
        "minutos_disponibles": round(minutos_disponibles, 1),
        "minutos_trabajados": round(minutos_trabajados, 1),
        "minutos_plan": round(minutos_plan, 1),
        "pct_uso_tiempo": pct_tiempo,
        "pct_cumplimiento_plan": pct_cumplimiento,
        "personas_equivalente_diferencia": personas_equivalente,
        "costo_jornada_pesos": round(horas_jornada * COSTO_HORA * n_operarios),
        "plan_detalle": [dict(r) for r in plan_rows],
        "procesos_dia": [dict(r) for r in proc_rows],
    }


@router.get("/planning/optimize")
async def api_optimize_assignment(
    fecha: Optional[str] = None,
    maestro=Depends(require_maestro)
):
    """
    Optimización de asignación: para cada SKU del plan del día, sugiere la operaria
    más rápida basándose en el promedio de minutos por proceso histórico.
    También muestra la carga asignada vs. capacidad disponible de cada operaria.
    """
    target = _date.fromisoformat(fecha) if fecha else _date.today()

    async with get_conn() as conn:
        horas_cfg = await conn.fetchval(
            "SELECT value FROM reproceso_config WHERE key = 'horas_jornada'"
        )
        horas_jornada = float(horas_cfg) if horas_cfg else 6.5
        minutos_jornada = horas_jornada * 60

        # Operarios activos
        operarios = await conn.fetch(
            "SELECT id, nombre FROM reproceso_usuarios WHERE rol = 'Operario' ORDER BY nombre"
        )

        # Velocidad histórica por operaria × SKU (promedio minutos netos por proceso)
        velocidad_rows = await conn.fetch(
            """WITH pause_totals AS (
                SELECT proceso_id,
                       COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(fin, NOW())-inicio))/60),0) AS pausa_min
                FROM reproceso_pausas GROUP BY proceso_id
            )
            SELECT p.operario_id, u.nombre AS operario, p.sku_destino AS sku,
                   AVG(
                       EXTRACT(EPOCH FROM (p.finished_at - p.started_at))/60
                       - COALESCE(pt.pausa_min, 0)
                   ) AS avg_min,
                   COUNT(*) AS muestras
            FROM reproceso_procesos p
            JOIN reproceso_usuarios u ON u.id = p.operario_id
            LEFT JOIN pause_totals pt ON pt.proceso_id = p.id
            WHERE p.estado = 'FINALIZADO'
              AND p.finished_at IS NOT NULL AND p.started_at IS NOT NULL
            GROUP BY p.operario_id, u.nombre, p.sku_destino
            ORDER BY p.sku_destino, avg_min"""
        )

        # Plan del día (si existe)
        plan_rows = await conn.fetch(
            """SELECT p.id, p.sku, p.cajas_plan, p.operario_id, u.nombre AS operario_nombre,
                      pt.minutos_por_caja
               FROM plan_produccion p
               LEFT JOIN reproceso_usuarios u ON u.id = p.operario_id
               LEFT JOIN product_times pt ON pt.sku = p.sku
               WHERE p.fecha = $1""",
            target
        )

    # Construir mapa de velocidades: {sku: [{operario_id, nombre, avg_min, muestras}]}
    velocidad: dict = {}
    for r in velocidad_rows:
        sku = r["sku"]
        if sku not in velocidad:
            velocidad[sku] = []
        if r["avg_min"] and r["avg_min"] > 0:
            velocidad[sku].append({
                "operario_id": r["operario_id"],
                "operario": r["operario"],
                "avg_min": round(float(r["avg_min"]), 1),
                "muestras": r["muestras"],
            })

    # Mapa de carga actual del plan por operaria (minutos asignados)
    carga: dict = {o["id"]: 0.0 for o in operarios}
    for r in plan_rows:
        if r["operario_id"] and r["minutos_por_caja"]:
            carga[r["operario_id"]] = carga.get(r["operario_id"], 0) + float(r["minutos_por_caja"]) * r["cajas_plan"]

    # Sugerencias por SKU del plan
    sugerencias = []
    for r in plan_rows:
        sku = r["sku"]
        opciones = velocidad.get(sku, [])
        sugerencias.append({
            "plan_id": r["id"],
            "sku": sku,
            "cajas_plan": r["cajas_plan"],
            "minutos_por_caja": float(r["minutos_por_caja"] or 0),
            "operario_asignado": r["operario_nombre"],
            "sugerencia": opciones[0] if opciones else None,  # la más rápida (ya ordenado por avg_min)
            "ranking": opciones[:3],  # top 3
        })

    # Carga vs. capacidad por operaria
    capacidad_operarias = []
    for o in operarios:
        carga_min = carga.get(o["id"], 0.0)
        pct = round(carga_min / minutos_jornada * 100, 1) if minutos_jornada else 0
        capacidad_operarias.append({
            "operario_id": o["id"],
            "nombre": o["nombre"],
            "minutos_asignados": round(carga_min, 1),
            "minutos_disponibles": round(minutos_jornada, 1),
            "pct_carga": pct,
            "disponible": round(minutos_jornada - carga_min, 1),
        })

    return {
        "fecha": target.isoformat(),
        "horas_jornada": horas_jornada,
        "sugerencias": sugerencias,
        "capacidad_operarias": capacidad_operarias,
        "sin_historial": [s["sku"] for s in sugerencias if not s["ranking"]],
    }


@router.post("/config/horas-jornada")
async def api_set_horas_jornada(body: dict, maestro=Depends(require_maestro)):
    """Actualiza las horas de jornada diaria (parámetro configurable)."""
    horas = body.get("horas")
    if not isinstance(horas, (int, float)) or horas <= 0 or horas > 24:
        raise HTTPException(status_code=400, detail="horas debe ser un número entre 0 y 24")
    async with get_conn() as conn:
        await conn.execute(
            "INSERT INTO reproceso_config (key, value) VALUES ('horas_jornada', $1) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            str(horas)
        )
    return {"ok": True, "horas_jornada": horas}

