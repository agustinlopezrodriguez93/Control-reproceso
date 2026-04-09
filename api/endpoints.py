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
    get_break_config, set_break_config
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
    """KPIs globales para el dashboard. Solo Maestro."""
    import logging
    _log = logging.getLogger("reproceso.kpis")
    try:
        return await get_dashboard_stats()
    except Exception as e:
        _log.error(f"[dashboard/kpis] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error interno: {str(e)}")


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
