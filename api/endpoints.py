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
    get_break_config, set_break_config, get_conn
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


_VALID_ACTIONS = {"start", "pause", "resume", "finish"}


class AccionProcesoRequest(BaseModel):
    accion: str

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
        proc = await crear_proceso(proceso_id, req.operario, req.sku_destino, req.es_urgente)
        await log_audit(
            current_user, "PROCESO_CREADO",
            f"SKU: {req.sku_destino}, Operario: {req.operario}, Urgente: {req.es_urgente}"
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
        updated = await actualizar_estado(proceso_id, req.accion)
        await log_audit(current_user, f"PROCESO_{req.accion.upper()}", f"ID: {proceso_id}")
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
    stock_critico: int

    @field_validator('sku')
    @classmethod
    def sku_not_empty(cls, v):
        if not v.strip():
            raise ValueError('SKU no puede estar vacío')
        return v.strip().upper()

    @field_validator('stock_minimo', 'stock_critico')
    @classmethod
    def non_negative(cls, v):
        if v < 0:
            raise ValueError('Los umbrales deben ser >= 0')
        return v


@router.get("/stock-rules")
async def get_stock_rules(maestro=Depends(require_maestro)):
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT id, sku, stock_minimo, stock_critico, updated_at FROM stock_rules ORDER BY sku"
        )
    return {"rules": [dict(r) for r in rows]}


@router.post("/stock-rules", status_code=201)
async def create_stock_rule(body: StockRuleIn, maestro=Depends(require_maestro)):
    async with get_conn() as conn:
        try:
            row = await conn.fetchrow(
                """INSERT INTO stock_rules (sku, stock_minimo, stock_critico)
                   VALUES ($1, $2, $3)
                   RETURNING id, sku, stock_minimo, stock_critico, updated_at""",
                body.sku, body.stock_minimo, body.stock_critico
            )
        except asyncpg.UniqueViolationError:
            raise HTTPException(status_code=409, detail=f"Ya existe una regla para SKU {body.sku}")
    return dict(row)


@router.put("/stock-rules/{rule_id}")
async def update_stock_rule(rule_id: int, body: StockRuleIn, maestro=Depends(require_maestro)):
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """UPDATE stock_rules
               SET sku=$1, stock_minimo=$2, stock_critico=$3, updated_at=NOW()
               WHERE id=$4
               RETURNING id, sku, stock_minimo, stock_critico, updated_at""",
            body.sku, body.stock_minimo, body.stock_critico, rule_id
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
