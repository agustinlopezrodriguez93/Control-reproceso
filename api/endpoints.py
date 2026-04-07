"""
Control Reproceso - API Endpoints
Same router pattern as consolidador
"""
import uuid
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import Optional

from db import (
    get_usuarios, get_skus, get_procesos, get_proceso,
    crear_proceso, actualizar_estado, get_proceso_activo,
    get_performance, get_usuario_por_nombre, crear_usuario,
    borrar_usuario, get_audit_logs, log_audit,
    get_dashboard_stats, get_operator_kpis
)
from auth import (
    verify_password, create_access_token, get_current_user,
    check_rate_limit, register_failed_attempt, clear_failed_attempts
)
from fastapi.security import OAuth2PasswordRequestForm
from fastapi import Depends, Request

router = APIRouter(prefix="/api", tags=["reproceso"])


# ─── Request Models ───────────────────────────

class CrearProcesoRequest(BaseModel):
    operario: str
    sku_destino: str
    es_urgente: bool = False


class AccionProcesoRequest(BaseModel):
    accion: str  # 'start', 'pause', 'resume', 'finish'


class CrearUsuarioRequest(BaseModel):
    nombre: str
    password: str
    rol: str = "Operario"
    avatar: str = ""


# ─── Endpoints ─────────────────────────────────

@router.get("/public/users")
async def api_public_users():
    """Retorna lista de usuarios para mostrar en pantalla de login. No requiere autenticación."""
    usuarios = get_usuarios()
    # Solo exponer nombre y avatar (no roles ni IDs sensibles)
    return {"users": [{"nombre": u["nombre"], "avatar": u["avatar"]} for u in usuarios]}


@router.post("/login")
async def api_login(request: Request, form_data: OAuth2PasswordRequestForm = Depends()):
    """
    Autentica un usuario y devuelve un token JWT de acceso.

    Acepta datos en formato application/x-www-form-urlencoded (estandar OAuth2).
    Aplica rate limiting por IP: bloquea durante BLOCK_WINDOW_SECONDS si se superan
    MAX_ATTEMPTS intentos fallidos consecutivos. Los intentos fallidos quedan registrados
    en el log de auditoria si el usuario existe en el sistema.

    Returns:
        JSON con 'access_token', 'token_type' y los datos del usuario
        (id, nombre, rol, avatar).

    Raises:
        HTTP 401: Si el usuario no existe o la contrasena es incorrecta.
        HTTP 429: Si la IP esta bloqueada por exceso de intentos fallidos.
    """
    # Obtener IP del cliente para rate limiting
    client_ip = request.client.host if request.client else "unknown"

    # Verificar si la IP esta bloqueada por intentos excesivos
    check_rate_limit(client_ip)

    user = get_usuario_por_nombre(form_data.username)
    if not user or not verify_password(form_data.password, user.get("password_hash") or ""):
        register_failed_attempt(client_ip)
        # Registrar intento fallido en audit log si el usuario existe
        if user:
            log_audit(user["nombre"], "LOGIN_FALLIDO", f"Intento fallido desde {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contrasena incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Login exitoso: limpiar contador de intentos y generar token
    clear_failed_attempts(client_ip)
    access_token = create_access_token(data={"sub": user["nombre"]})
    log_audit(user["nombre"], "LOGIN", f"Inicio de sesion exitoso desde {client_ip}")

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
    """
    Retorna los datos del usuario autenticado actualmente.

    Extrae el nombre de usuario desde el token JWT y consulta la base de datos
    para devolver el perfil completo (sin incluir el hash de contrasena).

    Returns:
        JSON con id, nombre, rol y avatar del usuario autenticado.

    Raises:
        HTTP 404: Si el usuario del token ya no existe en la base de datos.
    """
    user = get_usuario_por_nombre(current_user)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {
        "id": user["id"],
        "nombre": user["nombre"],
        "rol": user["rol"],
        "avatar": user["avatar"]
    }


@router.get("/config")
async def api_config(current_user: str = Depends(get_current_user)):
    """
    Retorna la configuracion necesaria para poblar los formularios del frontend.

    Devuelve la lista completa de usuarios (sin contrasenas) y el catalogo de SKUs
    disponibles. Utilizado por el frontend al cargar la pantalla de nuevo proceso.

    Returns:
        JSON con 'users' (lista de usuarios con id, nombre, rol, avatar) y
        'availableSKUs' (lista de codigos de SKU ordenados alfabeticamente).
    """
    usuarios = get_usuarios()
    skus = get_skus()
    return {
        "users": usuarios,
        "availableSKUs": skus
    }


@router.get("/procesos")
async def api_listar_procesos(operario: Optional[str] = None, current_user: str = Depends(get_current_user)):
    """
    Lista todos los procesos de reproceso, con sus pausas incluidas.

    El Maestro ve todos los procesos del sistema. El frontend puede solicitar
    el filtro por operario usando el parametro de query '?operario=<nombre>'.
    Los procesos urgentes aparecen primero.

    Args (query params):
        operario: Nombre del operario para filtrar. Si se omite, retorna todos.

    Returns:
        JSON con clave 'procesos': lista de procesos con sus campos y pausas.
    """
    procesos = get_procesos(operario)
    return {"procesos": procesos}


@router.get("/procesos/{proceso_id}")
async def api_get_proceso(proceso_id: str, current_user: str = Depends(get_current_user)):
    """
    Retorna el detalle completo de un proceso por su ID.

    Args:
        proceso_id: ID de texto (UUID) del proceso.

    Returns:
        JSON con todos los campos del proceso, nombre del operario y lista de pausas.

    Raises:
        HTTP 404: Si no existe ningun proceso con ese ID.
    """
    proc = get_proceso(proceso_id)
    if not proc:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")
    return proc


@router.post("/procesos")
async def api_crear_proceso(req: CrearProcesoRequest, current_user: str = Depends(get_current_user)):
    """Create a new process.

    Reglas de autorización:
    - Un Maestro puede crear procesos para cualquier operario.
    - Un Operario solo puede crear procesos asignados a sí mismo.
    """
    caller = get_usuario_por_nombre(current_user)
    if not caller:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")

    # Un Operario no puede crear procesos en nombre de otro usuario
    if caller["rol"] != "Maestro" and req.operario != current_user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Un Operario solo puede crear procesos asignados a sí mismo."
        )

    proceso_id = str(uuid.uuid4())
    try:
        crear_proceso(proceso_id, req.operario, req.sku_destino, req.es_urgente)
        log_audit(current_user, "PROCESO_CREADO", f"SKU: {req.sku_destino}, Operario: {req.operario}, Urgente: {req.es_urgente}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    proc = get_proceso(proceso_id)
    return {"ok": True, "proceso": proc}


@router.put("/procesos/{proceso_id}")
async def api_actualizar_proceso(proceso_id: str, req: AccionProcesoRequest, current_user: str = Depends(get_current_user)):
    """Update process state: start, pause, resume, finish.

    Reglas de autorización:
    - Un Maestro puede modificar cualquier proceso.
    - Un Operario solo puede modificar procesos asignados a sí mismo.
    """
    proc = get_proceso(proceso_id)
    if not proc:
        raise HTTPException(status_code=404, detail="Proceso no encontrado")

    caller = get_usuario_por_nombre(current_user)
    if not caller:
        raise HTTPException(status_code=401, detail="Usuario no encontrado")

    # Un Operario no puede actuar sobre procesos de otro operario
    if caller["rol"] != "Maestro" and proc["operario_nombre"] != current_user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para modificar este proceso."
        )

    # Validation: if starting or resuming, check no other active process for that operator
    if req.accion in ("start", "resume"):
        activo = get_proceso_activo(proc["operario_nombre"])
        if activo and activo["id"] != proceso_id:
            raise HTTPException(
                status_code=409,
                detail=f"El operario ya tiene el proceso {activo['sku_destino']} INICIADO. Paúselo antes."
            )

    try:
        updated = actualizar_estado(proceso_id, req.accion)
        log_audit(current_user, f"PROCESO_{req.accion.upper()}", f"ID: {proceso_id}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"ok": True, "proceso": updated}


@router.get("/performance")
async def api_performance(current_user: str = Depends(get_current_user)):
    """
    Retorna el ranking de rendimiento por operario. Solo accesible para el Maestro.

    Returns:
        JSON con clave 'performance': lista de dicts con id, user, completed, total y avg_minutes
        para cada operario con rol 'Operario'.

    Raises:
        HTTP 403: Si el usuario autenticado no tiene rol Maestro.
    """
    user = get_usuario_por_nombre(current_user)
    if user["rol"] != "Maestro":
        raise HTTPException(status_code=403, detail="Acceso denegado")
    data = get_performance()
    return {"performance": data}


@router.get("/dashboard/kpis")
async def api_dashboard_kpis(current_user: str = Depends(get_current_user)):
    """
    Retorna los KPIs globales para el dashboard del Maestro.

    Incluye: procesos activos, terminados hoy, promedio de tarea en minutos,
    urgencias pendientes y distribucion de los top 5 SKUs mas procesados.

    Returns:
        JSON con las claves: total_tasks, active_tasks, finished_today,
        pending_urgent, global_avg_minutes y sku_distribution.

    Raises:
        HTTP 403: Si el usuario autenticado no tiene rol Maestro.
    """
    user = get_usuario_por_nombre(current_user)
    if user["rol"] != "Maestro":
        raise HTTPException(status_code=403, detail="Acceso denegado")

    return get_dashboard_stats()


@router.get("/dashboard/operator/{user_id}")
async def api_operator_kpis(user_id: int, current_user: str = Depends(get_current_user)):
    """
    Retorna metricas detalladas de un operario especifico comparadas contra el promedio global.

    Usado en el drill-down del modulo de rendimiento para analizar a un operario individual.

    Args:
        user_id: ID entero del operario a consultar.

    Returns:
        JSON con total, finished, avg_minutes, global_avg_minutes y desglose por SKU.

    Raises:
        HTTP 403: Si el usuario autenticado no tiene rol Maestro.
    """
    user = get_usuario_por_nombre(current_user)
    if user["rol"] != "Maestro":
        raise HTTPException(status_code=403, detail="Acceso denegado")

    return get_operator_kpis(user_id)


# ─── User Management (Maestro Only) ───────────

@router.get("/users")
async def api_get_users(current_user: str = Depends(get_current_user)):
    """
    Lista todos los usuarios del sistema. Solo accesible para el Maestro.

    Returns:
        JSON con clave 'users': lista de todos los usuarios (id, nombre, rol, avatar).

    Raises:
        HTTP 403: Si el usuario autenticado no tiene rol Maestro.
    """
    user = get_usuario_por_nombre(current_user)
    if user["rol"] != "Maestro":
        raise HTTPException(status_code=403, detail="Acceso denegado")
    return {"users": get_usuarios()}


@router.post("/users")
async def api_add_user(req: CrearUsuarioRequest, current_user: str = Depends(get_current_user)):
    """
    Crea un nuevo usuario en el sistema. Solo accesible para el Maestro.

    La contrasena se hashea con bcrypt antes de guardarse; nunca se almacena en texto plano.
    La accion queda registrada en el log de auditoria.

    Args (body JSON):
        nombre: Nombre unico del usuario.
        password: Contrasena en texto plano (se hasheara).
        rol: 'Operario' o 'Maestro'. Por defecto 'Operario'.
        avatar: Texto corto para el avatar (ej. 'U1', 'AD'). Por defecto vacio.

    Returns:
        JSON con 'ok': True y el 'id' del nuevo usuario creado.

    Raises:
        HTTP 400: Si el nombre ya existe u otro error de validacion de datos.
        HTTP 403: Si el usuario autenticado no tiene rol Maestro.
    """
    user = get_usuario_por_nombre(current_user)
    if user["rol"] != "Maestro":
        raise HTTPException(status_code=403, detail="Acceso denegado")
    
    try:
        new_id = crear_usuario(req.nombre, req.password, req.rol, req.avatar)
        log_audit(current_user, "USUARIO_CREADO", f"Nombre: {req.nombre}, Rol: {req.rol}")
        return {"ok": True, "id": new_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/users/{user_id}")
async def api_delete_user(user_id: int, current_user: str = Depends(get_current_user)):
    """
    Elimina un usuario del sistema por su ID. Solo accesible para el Maestro.

    Restricciones de seguridad:
    - Un Maestro no puede eliminar su propia cuenta.
    - El usuario 'admin' es una cuenta de sistema protegida y no puede eliminarse.

    Args:
        user_id: ID entero del usuario a eliminar.

    Returns:
        JSON con 'ok': True si la eliminacion fue exitosa.

    Raises:
        HTTP 400: Si se intenta eliminar la propia cuenta o la cuenta 'admin'.
        HTTP 403: Si el usuario autenticado no tiene rol Maestro.
    """
    caller = get_usuario_por_nombre(current_user)
    if not caller or caller["rol"] != "Maestro":
        raise HTTPException(status_code=403, detail="Acceso denegado")

    # Impedir auto-borrado
    if caller["id"] == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes eliminar tu propia cuenta mientras estás autenticado."
        )

    # Impedir borrado del usuario protegido 'admin'
    target = get_usuarios()
    target_user = next((u for u in target if u["id"] == user_id), None)
    if target_user and target_user["nombre"] == "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El usuario 'admin' es una cuenta de sistema protegida y no puede eliminarse."
        )

    borrar_usuario(user_id)
    log_audit(current_user, "USUARIO_ELIMINADO", f"ID: {user_id}, Nombre: {target_user['nombre'] if target_user else 'desconocido'}")
    return {"ok": True}


# ─── Audit Logs (Maestro Only) ────────────────

@router.get("/audit")
async def api_audit(current_user: str = Depends(get_current_user)):
    """
    Retorna el registro de auditoria con las ultimas 100 acciones del sistema.

    Cada entrada incluye: timestamp, nombre del usuario responsable, codigo de accion
    (ej. LOGIN, PROCESO_CREADO, PROCESO_START, USUARIO_ELIMINADO) y detalles contextuales.

    Returns:
        JSON con clave 'logs': lista de hasta 100 entradas ordenadas por timestamp descendente.

    Raises:
        HTTP 403: Si el usuario autenticado no tiene rol Maestro.
    """
    user = get_usuario_por_nombre(current_user)
    if user["rol"] != "Maestro":
        raise HTTPException(status_code=403, detail="Acceso denegado")
    return {"logs": get_audit_logs()}
