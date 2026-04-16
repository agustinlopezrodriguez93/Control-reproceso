"""
LaudusClient async — wrapper para la API de Laudus.
Usa httpx (async) para no bloquear el event loop de FastAPI.
Gestiona autenticación automática con token JWT.
"""
import os
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("reproceso.laudus")

LAUDUS_BASE_URL = "https://api.laudus.cl"
LAUDUS_USER     = os.getenv("LAUDUS_USER", "")
LAUDUS_PASS     = os.getenv("LAUDUS_PASS", "")
LAUDUS_VAT      = os.getenv("LAUDUS_VAT", "")   # RUT empresa: ej. "76012551-2"


class LaudusClient:
    """Cliente async para la API REST de Laudus."""

    def __init__(self, user: str = LAUDUS_USER, password: str = LAUDUS_PASS, vat: str = LAUDUS_VAT):
        self.user = user
        self.password = password
        self.vat = vat
        self._token: Optional[str] = None
        self._token_expiry: Optional[datetime] = None
        self._lock = asyncio.Lock()

    # ── Autenticación ─────────────────────────────

    def _is_token_valid(self) -> bool:
        if not self._token or not self._token_expiry:
            return False
        # Renovar si quedan menos de 5 minutos
        now = datetime.now(timezone.utc)
        if self._token_expiry.tzinfo is None:
            self._token_expiry = self._token_expiry.replace(tzinfo=timezone.utc)
        return (self._token_expiry - now).total_seconds() > 300

    async def authenticate(self) -> bool:
        """Obtiene un nuevo JWT. Llamada automática si el token es inválido."""
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                resp = await client.post(
                    f"{LAUDUS_BASE_URL}/security/login",
                    json={
                        "userName": self.user,
                        "password": self.password,
                        "companyVATId": self.vat,
                    },
                    headers={"Content-Type": "application/json", "Accept": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()
                self._token = data.get("token")
                expiry_str = data.get("expiration", "")
                try:
                    self._token_expiry = datetime.fromisoformat(expiry_str.replace("Z", "+00:00"))
                except Exception:
                    self._token_expiry = None
                logger.info("[Laudus] Autenticado correctamente.")
                return True
            except Exception as e:
                logger.error(f"[Laudus] Error de autenticación: {e}")
                return False

    async def _ensure_auth(self) -> bool:
        async with self._lock:
            if not self._is_token_valid():
                return await self.authenticate()
        return True

    def _headers(self, is_post: bool = False) -> dict:
        h = {"Accept": "application/json"}
        if is_post:
            h["Content-Type"] = "application/json"
        if self._token:
            h["Authorization"] = f"Bearer {self._token}"
        return h

    # ── Métodos HTTP ──────────────────────────────

    async def get(self, endpoint: str, params: dict = None):
        if not await self._ensure_auth():
            raise RuntimeError("No se pudo autenticar con Laudus")
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{LAUDUS_BASE_URL}{endpoint}",
                headers=self._headers(),
                params=params,
            )
            resp.raise_for_status()
            return resp.json()

    async def post(self, endpoint: str, data: dict):
        if not await self._ensure_auth():
            raise RuntimeError("No se pudo autenticar con Laudus")
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{LAUDUS_BASE_URL}{endpoint}",
                headers=self._headers(is_post=True),
                json=data,
            )
            resp.raise_for_status()
            return resp.json()
