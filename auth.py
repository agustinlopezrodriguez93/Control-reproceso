"""
Control Reproceso - Autenticacion y seguridad.
Maneja el hashing de contraseñas con bcrypt y la generación/validación
de tokens JWT. Rate limiting en Redis (si REDIS_URL está configurada)
con fallback automático a implementación en memoria.
"""
import os
import time
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("reproceso.auth")

# --- Configuración -------------------------------------------------------

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY no está definida en las variables de entorno. "
        "Agrega SECRET_KEY=<valor_aleatorio_seguro> en el archivo .env"
    )

ALGORITHM = "HS256"

_expire_env = os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES")
try:
    ACCESS_TOKEN_EXPIRE_MINUTES = max(1, min(int(_expire_env), 1440)) if _expire_env else 480
except (ValueError, TypeError):
    ACCESS_TOKEN_EXPIRE_MINUTES = 480

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")

MAX_ATTEMPTS = 5
BLOCK_WINDOW_SECONDS = 300  # ventana deslizante de 5 minutos


# --- Redis Rate Limiting -------------------------------------------------
# Si REDIS_URL está configurada en .env, el rate limiting es compartido
# entre todas las instancias del servidor. Si Redis no está disponible,
# se usa la implementación en memoria automáticamente.

_redis_client = None
_redis_available: bool = False
_redis_checked: bool = False


async def _get_redis():
    """Inicializa el cliente Redis una sola vez. Fallback silencioso si no disponible."""
    global _redis_client, _redis_available, _redis_checked
    if _redis_checked:
        return _redis_client if _redis_available else None

    _redis_checked = True
    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        logger.info("[Auth] REDIS_URL no configurada — rate limiting en memoria (single-instance).")
        return None

    try:
        import redis.asyncio as aioredis
        _redis_client = aioredis.from_url(redis_url, decode_responses=True)
        await _redis_client.ping()
        _redis_available = True
        logger.info("[Auth] Redis conectado — rate limiting distribuido activo.")
    except Exception as e:
        logger.warning(f"[Auth] Redis no disponible ({e}) — usando rate limiting en memoria.")
        _redis_client = None
        _redis_available = False

    return _redis_client if _redis_available else None


# --- Rate Limiting en memoria (fallback) ---------------------------------
_failed_attempts: dict = defaultdict(list)


def _evict_expired(now: float) -> None:
    """Purga IPs cuya ventana de bloqueo ya expiró para evitar crecimiento ilimitado del dict."""
    expired = [
        ip for ip, ts_list in _failed_attempts.items()
        if not any(now - t < BLOCK_WINDOW_SECONDS for t in ts_list)
    ]
    for ip in expired:
        del _failed_attempts[ip]


# --- Rate Limiting público (async, Redis o memoria) ----------------------

async def check_rate_limit(ip: str) -> None:
    """
    Verifica si la IP está bloqueada por demasiados intentos fallidos.
    Usa Redis si está disponible; en caso contrario, implementación en memoria.
    Lanza HTTP 429 si se supera el límite.
    """
    r = await _get_redis()
    now = time.time()

    if r:
        # ── Redis: solo LEER el contador, nunca modificarlo aquí ──
        # El incremento ocurre exclusivamente en register_failed_attempt.
        key = f"rl:{ip}"
        try:
            raw = await r.get(key)
            if raw and int(raw) >= MAX_ATTEMPTS:
                ttl = await r.ttl(key)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Demasiados intentos fallidos. Intente nuevamente en {max(0, ttl)} segundos.",
                )
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"[Auth] Redis check_rate_limit falló ({e}), usando fallback en memoria.")
            _check_rate_limit_memory(ip, now)
    else:
        _check_rate_limit_memory(ip, now)


def _check_rate_limit_memory(ip: str, now: float) -> None:
    _evict_expired(now)
    _failed_attempts[ip] = [t for t in _failed_attempts[ip] if now - t < BLOCK_WINDOW_SECONDS]
    if len(_failed_attempts[ip]) >= MAX_ATTEMPTS:
        wait = int(BLOCK_WINDOW_SECONDS - (now - _failed_attempts[ip][0]))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Demasiados intentos fallidos. Intente nuevamente en {wait} segundos.",
        )


async def register_failed_attempt(ip: str) -> None:
    """Registra un intento fallido de login."""
    r = await _get_redis()
    now = time.time()

    if r:
        key = f"rl:{ip}"
        try:
            count = await r.incr(key)
            if count == 1:
                await r.expire(key, BLOCK_WINDOW_SECONDS)
            return
        except Exception as e:
            logger.warning(f"[Auth] Redis register_failed_attempt falló ({e}), usando fallback.")

    _failed_attempts[ip].append(now)


async def clear_failed_attempts(ip: str) -> None:
    """Limpia el contador de intentos fallidos tras un login exitoso."""
    r = await _get_redis()

    if r:
        try:
            await r.delete(f"rl:{ip}")
            return
        except Exception as e:
            logger.warning(f"[Auth] Redis clear_failed_attempts falló ({e}), usando fallback.")

    _failed_attempts.pop(ip, None)


# --- Utilidades de contraseña --------------------------------------------

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


# --- Utilidades JWT ------------------------------------------------------

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    """Dependencia FastAPI: extrae y valida el usuario desde el Bearer token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar las credenciales. Inicie sesión nuevamente.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        return username
    except JWTError:
        raise credentials_exception
