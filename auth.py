"""
Control Reproceso - Autenticacion y seguridad.
Maneja el hashing de contrasenas con bcrypt y la generacion/validacion
de tokens JWT para proteger los endpoints de la API.
"""
import os
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv

load_dotenv()

# --- Configuracion -------------------------------------------------------

# La SECRET_KEY DEBE venir del .env. No se acepta valor por defecto inseguro.
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY no esta definida en las variables de entorno. "
        "Agrega SECRET_KEY=<valor_aleatorio_seguro> en el archivo .env"
    )

ALGORITHM = "HS256"

# La expiración del token puede sobreescribirse desde .env (en minutos).
# Por defecto: 480 minutos (8 horas). Máximo recomendado: 1440 (24 horas).
_expire_env = os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES")
try:
    ACCESS_TOKEN_EXPIRE_MINUTES = max(1, min(int(_expire_env), 1440)) if _expire_env else 480
except (ValueError, TypeError):
    ACCESS_TOKEN_EXPIRE_MINUTES = 480

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")


# --- Rate Limiting en memoria --------------------------------------------
# Registra intentos fallidos por IP: { ip: [timestamp, ...] }
_failed_attempts: dict = defaultdict(list)
MAX_ATTEMPTS = 5            # intentos fallidos maximos antes de bloquear
BLOCK_WINDOW_SECONDS = 300  # ventana deslizante de 5 minutos


def check_rate_limit(ip: str):
    """
    Verifica si la IP esta temporalmente bloqueada por demasiados intentos
    fallidos de login. Lanza HTTP 429 si se supera el limite.
    """
    now = time.time()
    _failed_attempts[ip] = [
        t for t in _failed_attempts[ip]
        if now - t < BLOCK_WINDOW_SECONDS
    ]
    if len(_failed_attempts[ip]) >= MAX_ATTEMPTS:
        wait = int(BLOCK_WINDOW_SECONDS - (now - _failed_attempts[ip][0]))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Demasiados intentos fallidos. Intente nuevamente en {wait} segundos.",
        )


def register_failed_attempt(ip: str):
    """Registra un intento fallido de login para la IP dada."""
    _failed_attempts[ip].append(time.time())


def clear_failed_attempts(ip: str):
    """Limpia los contadores de intentos fallidos tras un login exitoso."""
    _failed_attempts.pop(ip, None)


# --- Utilidades de contrasena --------------------------------------------

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifica una contrasena en texto plano contra su hash bcrypt."""
    if not hashed_password:
        return False
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Devuelve el hash bcrypt de una contrasena."""
    return pwd_context.hash(password)


# --- Utilidades JWT ------------------------------------------------------

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Crea un JWT firmado con la SECRET_KEY del entorno."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    """
    Dependencia FastAPI: extrae y valida el usuario desde el Bearer token.
    Lanza HTTP 401 si el token es invalido o ha expirado.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar las credenciales. Inicie sesion nuevamente.",
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
