"""
Control Reproceso - Database Layer (asyncpg)
Pool async — no bloquea el event loop de FastAPI.
Parámetros: $1, $2, ... (sintaxis asyncpg, no %s)
"""
import asyncpg
import ssl as _ssl
import os
import logging
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    raise ValueError("Falta la variable de entorno DATABASE_URL")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Extraer el password crudo de la URL para evitar que asyncpg lo corrompa por 
# culpa del urllib.parse.unquote (ej. si Railway generó un password con '%')
raw_password = None
if "://" in DATABASE_URL and "@" in DATABASE_URL:
    body = DATABASE_URL.split("://", 1)[1]
    user_pass = body.split("@", 1)[0]
    if ":" in user_pass:
        raw_password = user_pass.split(":", 1)[1]

logger = logging.getLogger("reproceso.db")

# ─── SSL Context ─────────────────────────────
# Replica el comportamiento de sslmode='require' de psycopg2:
# exige cifrado pero no verifica el certificado del servidor.
# Para producción con CA válida, reemplazar por ssl=True.
_ssl_ctx = _ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = _ssl.CERT_NONE

# ─── Connection Pool ──────────────────────────
_pool: asyncpg.Pool | None = None


async def _get_pool() -> asyncpg.Pool:
    """Lazy-init del pool de conexiones async."""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            DATABASE_URL,
            password=raw_password,
            min_size=2,
            max_size=10,
            ssl=_ssl_ctx,
        )
        logger.info("[DB] asyncpg pool creado (min=2, max=10)")
    return _pool


@asynccontextmanager
async def get_conn():
    """Obtiene una conexión del pool y la libera al salir."""
    pool = await _get_pool()
    async with pool.acquire() as conn:
        yield conn


# ─── Schema + Índices ────────────────────────
SCHEMA = """
CREATE TABLE IF NOT EXISTS reproceso_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reproceso_usuarios (
    id            SERIAL PRIMARY KEY,
    nombre        TEXT NOT NULL UNIQUE,
    rol           TEXT NOT NULL DEFAULT 'Operario',
    avatar        TEXT DEFAULT '',
    password_hash TEXT
);

CREATE TABLE IF NOT EXISTS reproceso_audit_logs (
    id         SERIAL PRIMARY KEY,
    timestamp  TIMESTAMPTZ DEFAULT NOW(),
    usuario_id INTEGER REFERENCES reproceso_usuarios(id),
    accion     TEXT NOT NULL,
    detalles   TEXT
);

CREATE TABLE IF NOT EXISTS reproceso_skus (
    id     SERIAL PRIMARY KEY,
    codigo TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS reproceso_procesos (
    id                TEXT PRIMARY KEY,
    operario_id       INTEGER REFERENCES reproceso_usuarios(id),
    sku_destino       TEXT NOT NULL,
    estado            TEXT NOT NULL DEFAULT 'CREADO',
    es_urgente        BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    started_at        TIMESTAMPTZ,
    finished_at       TIMESTAMPTZ,
    last_state_change TIMESTAMPTZ DEFAULT NOW(),
    stock_inicial     INTEGER,
    stock_final       INTEGER
);

CREATE TABLE IF NOT EXISTS reproceso_pausas (
    id         SERIAL PRIMARY KEY,
    proceso_id TEXT REFERENCES reproceso_procesos(id) ON DELETE CASCADE,
    inicio     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fin        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stock_rules (
    id             SERIAL PRIMARY KEY,
    sku            TEXT NOT NULL UNIQUE,
    stock_minimo   INTEGER NOT NULL DEFAULT 10,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS active_skus (
    sku         TEXT PRIMARY KEY,
    descripcion TEXT NOT NULL DEFAULT '',
    caja        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS product_times (
    sku              TEXT PRIMARY KEY,
    minutos_por_caja NUMERIC(8,2) NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_produccion (
    id              SERIAL PRIMARY KEY,
    fecha           DATE NOT NULL,
    sku             TEXT NOT NULL,
    cajas_plan      INTEGER NOT NULL DEFAULT 0,
    operario_id     INTEGER REFERENCES reproceso_usuarios(id),
    es_emergencia   BOOLEAN DEFAULT FALSE,
    cajas_real      INTEGER,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (fecha, sku, operario_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_fecha ON plan_produccion(fecha DESC);

CREATE INDEX IF NOT EXISTS idx_procesos_operario  ON reproceso_procesos(operario_id);
CREATE INDEX IF NOT EXISTS idx_procesos_estado    ON reproceso_procesos(estado);
CREATE INDEX IF NOT EXISTS idx_pausas_proceso     ON reproceso_pausas(proceso_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp    ON reproceso_audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_stock_rules_sku    ON stock_rules(sku);
"""


async def init_db():
    """Crea tablas, índices y datos iniciales si no existen."""
    from auth import get_password_hash

    async with get_conn() as conn:
        # DDL: tablas e índices (múltiples sentencias, sin parámetros)
        await conn.execute(SCHEMA)

        # Migración: agregar password_hash si no existe (bases de datos antiguas)
        col_exists = await conn.fetchval("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'reproceso_usuarios' AND column_name = 'password_hash'
        """)
        if not col_exists:
            logger.info("[DB] Migración: añadiendo columna password_hash...")
            await conn.execute("ALTER TABLE reproceso_usuarios ADD COLUMN password_hash TEXT")

        # Migración: agregar stock_inicial y stock_final
        stocks_exist = await conn.fetchval("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'reproceso_procesos' AND column_name = 'stock_inicial'
        """)
        if not stocks_exist:
            logger.info("[DB] Migración: añadiendo columnas de stock...")
            await conn.execute("ALTER TABLE reproceso_procesos ADD COLUMN stock_inicial INTEGER")
            await conn.execute("ALTER TABLE reproceso_procesos ADD COLUMN stock_final INTEGER")

        # Migración: eliminar stock_critico de stock_rules (ahora solo stock_minimo)
        critico_exists = await conn.fetchval("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'stock_rules' AND column_name = 'stock_critico'
        """)
        if critico_exists:
            logger.info("[DB] Migración: eliminando columna stock_critico de stock_rules...")
            await conn.execute("ALTER TABLE stock_rules DROP COLUMN stock_critico")

        # Migración: agregar columna caja a active_skus
        caja_exists = await conn.fetchval("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'active_skus' AND column_name = 'caja'
        """)
        if not caja_exists:
            logger.info("[DB] Migración: añadiendo columna caja a active_skus...")
            await conn.execute("ALTER TABLE active_skus ADD COLUMN caja TEXT NOT NULL DEFAULT ''")

        # Seed usuarios
        user_count = await conn.fetchval("SELECT COUNT(*) FROM reproceso_usuarios")
        if user_count == 0:
            users = [
                ("Admin",     "Maestro",  "AD", "mega123"),
                ("Usuario 1", "Operario", "U1", "1234"),
                ("Usuario 2", "Operario", "U2", "1234"),
                ("Usuario 3", "Operario", "U3", "1234"),
            ]
            async with conn.transaction():
                for nombre, rol, avatar, pw in users:
                    await conn.execute(
                        "INSERT INTO reproceso_usuarios (nombre, rol, avatar, password_hash) "
                        "VALUES ($1, $2, $3, $4) ON CONFLICT (nombre) DO NOTHING",
                        nombre, rol, avatar, get_password_hash(pw)
                    )
            logger.info("[DB] Usuarios por defecto creados.")

        # Seed config de pausas obligatorias y jornada
        await conn.execute("""
            INSERT INTO reproceso_config (key, value) VALUES
                ('break_enabled',       'false'),
                ('break_work_minutes',  '90'),
                ('break_rest_minutes',  '10'),
                ('horas_jornada',       '6.5')
            ON CONFLICT (key) DO NOTHING
        """)

        # Seed SKUs
        sku_count = await conn.fetchval("SELECT COUNT(*) FROM reproceso_skus")
        if sku_count == 0:
            skus = [
                "GCMD", "GGAL070", "IMOCA", "IMOCP", "MCCE",
                "SCCA", "SECC090", "SECPI", "SEKOF", "SEKQB",
                "SEKRN", "SEPASP", "SEPC", "SEPEIC", "SEPOD",
                "SEPOF", "SESCD", "SGEP", "SKPXL",
            ]
            async with conn.transaction():
                for sku in skus:
                    await conn.execute(
                        "INSERT INTO reproceso_skus (codigo) VALUES ($1) ON CONFLICT (codigo) DO NOTHING",
                        sku
                    )
            logger.info("[DB] SKUs por defecto creados.")

        # Seed mock: productos activos agrupados por caja con tiempos de producción
        active_count = await conn.fetchval("SELECT COUNT(*) FROM active_skus")
        if active_count == 0:
            # (sku, descripcion, caja, minutos_por_caja)
            mock_products = [
                ("GCMD",    "Galleta Chocolate Mediana",       "Caja 1",  35.0),
                ("GGAL070", "Galleta Galletita 70g",           "Caja 1",  28.0),
                ("IMOCA",   "Imperial Moca",                   "Caja 2",  42.0),
                ("IMOCP",   "Imperial Moca Plus",              "Caja 2",  45.0),
                ("MCCE",    "Muffin Chocolate Chips Estándar", "Caja 2",  50.0),
                ("SCCA",    "Sándwich Crema Caramelo",         "Caja 3",  38.0),
                ("SECC090", "Selección Crema Choco 90g",       "Caja 3",  32.0),
                ("SECPI",   "Selección Crema Pi",              "Caja 3",  33.0),
                ("SEKOF",   "Sekof Original",                  "Caja 4",  40.0),
                ("SEKQB",   "Sekof QB",                        "Caja 4",  41.0),
                ("SEKRN",   "Sekof Relleno Natural",           "Caja 4",  39.0),
                ("SEPASP",  "Selección Pasp",                  "Caja 5",  36.0),
                ("SEPC",    "Selección Pecado",                "Caja 5",  37.0),
                ("SEPEIC",  "Selección Peic",                  "Caja 5",  34.0),
                ("SEPOD",   "Selección Pod",                   "Caja 6",  43.0),
                ("SEPOF",   "Selección Pof",                   "Caja 6",  44.0),
                ("SESCD",   "Selección SCD",                   "Caja 6",  31.0),
                ("SGEP",    "Surtido Gep",                     "Caja 7",  48.0),
                ("SKPXL",   "Sekof XL",                        "Caja 7",  55.0),
            ]
            async with conn.transaction():
                for sku, desc, caja, mins in mock_products:
                    await conn.execute(
                        "INSERT INTO active_skus (sku, descripcion, caja) VALUES ($1, $2, $3) "
                        "ON CONFLICT (sku) DO NOTHING",
                        sku, desc, caja
                    )
                    await conn.execute(
                        "INSERT INTO product_times (sku, minutos_por_caja) VALUES ($1, $2) "
                        "ON CONFLICT (sku) DO NOTHING",
                        sku, mins
                    )
            logger.info("[DB] Productos mock con caja y tiempos creados.")

    logger.info("[DB] Control Reproceso DB inicializada en PostgreSQL (asyncpg).")


# ─────────────────────────────────────────────
# Query functions — todas async, usan el pool
# ─────────────────────────────────────────────

async def get_usuarios() -> list[dict]:
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT id, nombre, rol, avatar FROM reproceso_usuarios ORDER BY id"
        )
        return [dict(r) for r in rows]


async def get_usuario_por_nombre(nombre: str) -> dict | None:
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT id, nombre, rol, avatar, password_hash FROM reproceso_usuarios WHERE nombre = $1",
            nombre
        )
        return dict(row) if row else None


async def get_usuario_por_id(user_id: int) -> dict | None:
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT id, nombre, rol, avatar FROM reproceso_usuarios WHERE id = $1",
            user_id
        )
        return dict(row) if row else None


async def crear_usuario(nombre: str, password: str, rol: str, avatar: str = "") -> int:
    from auth import get_password_hash
    pw_hash = get_password_hash(password)
    async with get_conn() as conn:
        new_id = await conn.fetchval(
            "INSERT INTO reproceso_usuarios (nombre, rol, avatar, password_hash) "
            "VALUES ($1, $2, $3, $4) RETURNING id",
            nombre, rol, avatar, pw_hash
        )
        return new_id


async def borrar_usuario(user_id: int) -> None:
    async with get_conn() as conn:
        await conn.execute(
            "DELETE FROM reproceso_usuarios WHERE id = $1", user_id
        )


async def log_audit(username: str, accion: str, detalles: str = "") -> None:
    """Registra una acción de auditoría en un solo roundtrip (INSERT + subselect)."""
    async with get_conn() as conn:
        await conn.execute("""
            INSERT INTO reproceso_audit_logs (usuario_id, accion, detalles)
            SELECT id, $1, $2 FROM reproceso_usuarios WHERE nombre = $3
        """, accion, detalles, username)


async def get_audit_logs(limit: int = 100) -> list[dict]:
    async with get_conn() as conn:
        rows = await conn.fetch("""
            SELECT a.*, u.nombre as username
            FROM reproceso_audit_logs a
            LEFT JOIN reproceso_usuarios u ON u.id = a.usuario_id
            ORDER BY a.timestamp DESC
            LIMIT $1
        """, limit)
        return [dict(r) for r in rows]


_skus_cache: list[str] | None = None


async def get_skus() -> list[str]:
    """Retorna SKUs activos (active_skus). Cacheados en memoria — se invalida con invalidate_skus_cache()."""
    global _skus_cache
    if _skus_cache is None:
        async with get_conn() as conn:
            rows = await conn.fetch("SELECT sku FROM active_skus ORDER BY sku")
            _skus_cache = [r["sku"] for r in rows]
        logger.info(f"[DB] SKUs activos cacheados ({len(_skus_cache)} items).")
    return _skus_cache


def invalidate_skus_cache():
    global _skus_cache
    _skus_cache = None


async def get_active_skus_full() -> list[dict]:
    """Retorna SKUs activos con descripción y caja."""
    async with get_conn() as conn:
        rows = await conn.fetch("SELECT sku, descripcion, caja FROM active_skus ORDER BY caja, sku")
    return [dict(r) for r in rows]


async def set_active_skus(skus: list[dict]):
    """Reemplaza la lista completa de SKUs activos. Cada item: {sku, descripcion, caja?}."""
    async with get_conn() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM active_skus")
            if skus:
                await conn.executemany(
                    "INSERT INTO active_skus (sku, descripcion, caja) VALUES ($1, $2, $3)",
                    [(s["sku"].upper(), s.get("descripcion", ""), s.get("caja", "")) for s in skus]
                )
    invalidate_skus_cache()


async def _attach_pausas_batch(conn: asyncpg.Connection, procesos: list[dict]) -> list[dict]:
    """Carga todas las pausas en una sola query y las adjunta a sus procesos (evita N+1)."""
    if not procesos:
        return procesos

    proc_ids = [p["id"] for p in procesos]
    rows = await conn.fetch("""
        SELECT proceso_id, inicio, fin
        FROM reproceso_pausas
        WHERE proceso_id = ANY($1::text[])
        ORDER BY inicio
    """, proc_ids)

    pausas_map: dict[str, list] = {}
    for r in rows:
        pid = r["proceso_id"]
        pausas_map.setdefault(pid, []).append({"inicio": r["inicio"], "fin": r["fin"]})

    for proc in procesos:
        proc["pausas"] = pausas_map.get(proc["id"], [])

    return procesos


async def get_procesos(operario_nombre: str | None = None) -> list[dict]:
    """Retorna procesos con pausas. Usa batch loading (2 queries totales)."""
    async with get_conn() as conn:
        if operario_nombre:
            rows = await conn.fetch("""
                SELECT p.*, u.nombre as operario_nombre
                FROM reproceso_procesos p
                JOIN reproceso_usuarios u ON u.id = p.operario_id
                WHERE u.nombre = $1
                ORDER BY p.es_urgente DESC, p.created_at DESC
            """, operario_nombre)
        else:
            rows = await conn.fetch("""
                SELECT p.*, u.nombre as operario_nombre
                FROM reproceso_procesos p
                JOIN reproceso_usuarios u ON u.id = p.operario_id
                ORDER BY p.es_urgente DESC, p.created_at DESC
            """)

        procesos = [dict(r) for r in rows]
        await _attach_pausas_batch(conn, procesos)
        return procesos


async def get_proceso(proceso_id: str) -> dict | None:
    """Retorna un proceso con sus pausas (2 queries en 1 conexión)."""
    async with get_conn() as conn:
        row = await conn.fetchrow("""
            SELECT p.*, u.nombre as operario_nombre
            FROM reproceso_procesos p
            JOIN reproceso_usuarios u ON u.id = p.operario_id
            WHERE p.id = $1
        """, proceso_id)

        if not row:
            return None

        proc = dict(row)
        pausas = await conn.fetch(
            "SELECT inicio, fin FROM reproceso_pausas WHERE proceso_id = $1 ORDER BY inicio",
            proceso_id
        )
        proc["pausas"] = [dict(p) for p in pausas]
        return proc


async def crear_proceso(
    proceso_id: str, operario_nombre: str, sku_destino: str, es_urgente: bool = False, stock_inicial: int = 0
) -> dict:
    """Crea un proceso y retorna el dict completo (sin segunda query)."""
    async with get_conn() as conn:
        user_id = await conn.fetchval(
            "SELECT id FROM reproceso_usuarios WHERE nombre = $1", operario_nombre
        )
        if not user_id:
            raise ValueError(f"Operario '{operario_nombre}' no encontrado")

        row = await conn.fetchrow("""
            INSERT INTO reproceso_procesos (id, operario_id, sku_destino, estado, es_urgente, stock_inicial)
            VALUES ($1, $2, $3, 'CREADO', $4, $5)
            RETURNING id, operario_id, sku_destino, estado, es_urgente,
                      created_at, started_at, finished_at, last_state_change, stock_inicial
        """, proceso_id, user_id, sku_destino, es_urgente, stock_inicial)

        result = dict(row)
        result["operario_nombre"] = operario_nombre
        result["pausas"] = []
        return result


async def actualizar_estado(proceso_id: str, nueva_accion: str, stock_final: int = None) -> dict:
    """Actualiza estado y retorna el proceso completo — todo en una sola conexión."""
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT estado FROM reproceso_procesos WHERE id = $1", proceso_id
        )
        if not row:
            raise ValueError("Proceso no encontrado")

        estado_actual = row["estado"]

        # Validar la transición antes de entrar en la transacción
        if nueva_accion == "start" and estado_actual != "CREADO":
            raise ValueError("Solo procesos CREADOS pueden iniciarse")
        elif nueva_accion == "pause" and estado_actual != "INICIADO":
            raise ValueError("Solo procesos INICIADOS pueden pausarse")
        elif nueva_accion == "resume" and estado_actual != "PAUSADO":
            raise ValueError("Solo procesos PAUSADOS pueden reanudarse")
        elif nueva_accion == "finish" and estado_actual == "FINALIZADO":
            raise ValueError("Proceso ya finalizado")
        elif nueva_accion not in ("start", "pause", "resume", "finish"):
            raise ValueError(f"Acción desconocida: {nueva_accion}")

        async with conn.transaction():
            if nueva_accion == "start":
                await conn.execute("""
                    UPDATE reproceso_procesos
                    SET estado = 'INICIADO', started_at = NOW(), last_state_change = NOW()
                    WHERE id = $1
                """, proceso_id)

            elif nueva_accion == "pause":
                await conn.execute("""
                    UPDATE reproceso_procesos
                    SET estado = 'PAUSADO', last_state_change = NOW()
                    WHERE id = $1
                """, proceso_id)
                await conn.execute(
                    "INSERT INTO reproceso_pausas (proceso_id, inicio) VALUES ($1, NOW())",
                    proceso_id
                )

            elif nueva_accion == "resume":
                await conn.execute("""
                    UPDATE reproceso_procesos
                    SET estado = 'INICIADO', last_state_change = NOW()
                    WHERE id = $1
                """, proceso_id)
                await conn.execute("""
                    UPDATE reproceso_pausas SET fin = NOW()
                    WHERE proceso_id = $1 AND fin IS NULL
                """, proceso_id)

            elif nueva_accion == "finish":
                if estado_actual == "PAUSADO":
                    await conn.execute("""
                        UPDATE reproceso_pausas SET fin = NOW()
                        WHERE proceso_id = $1 AND fin IS NULL
                    """, proceso_id)
                await conn.execute("""
                    UPDATE reproceso_procesos
                    SET estado = 'FINALIZADO', finished_at = NOW(), last_state_change = NOW(), stock_final = $2
                    WHERE id = $1
                """, proceso_id, stock_final)

        # Leer el proceso actualizado en la misma conexión (sin segundo round-trip TCP)
        updated = dict(await conn.fetchrow("""
            SELECT p.*, u.nombre as operario_nombre
            FROM reproceso_procesos p
            JOIN reproceso_usuarios u ON u.id = p.operario_id
            WHERE p.id = $1
        """, proceso_id))
        pausas = await conn.fetch(
            "SELECT inicio, fin FROM reproceso_pausas WHERE proceso_id = $1 ORDER BY inicio",
            proceso_id
        )
        updated["pausas"] = [dict(p) for p in pausas]
        return updated


async def get_proceso_activo(operario_nombre: str) -> dict | None:
    async with get_conn() as conn:
        row = await conn.fetchrow("""
            SELECT p.id, p.sku_destino
            FROM reproceso_procesos p
            JOIN reproceso_usuarios u ON u.id = p.operario_id
            WHERE u.nombre = $1 AND p.estado = 'INICIADO'
            LIMIT 1
        """, operario_nombre)
        return dict(row) if row else None


async def get_performance() -> list[dict]:
    async with get_conn() as conn:
        # CTE pre-agrega pausas una sola vez (O(n+m) en lugar de O(n×m))
        rows = await conn.fetch("""
            WITH pause_totals AS (
                SELECT proceso_id,
                       SUM(EXTRACT(EPOCH FROM (COALESCE(fin, NOW()) - inicio))) / 60 AS total_pause_min
                FROM reproceso_pausas
                GROUP BY proceso_id
            )
            SELECT
                u.id,
                u.nombre AS user,
                COUNT(CASE WHEN p.estado = 'FINALIZADO' THEN 1 END) AS completed,
                COUNT(p.id) AS total,
                AVG(CASE
                    WHEN p.estado = 'FINALIZADO' THEN
                        EXTRACT(EPOCH FROM (p.finished_at - p.started_at)) / 60
                        - COALESCE(pt.total_pause_min, 0)
                END) AS avg_minutes
            FROM reproceso_usuarios u
            LEFT JOIN reproceso_procesos p ON p.operario_id = u.id
            LEFT JOIN pause_totals pt ON pt.proceso_id = p.id
            WHERE u.rol = 'Operario'
            GROUP BY u.id, u.nombre
            ORDER BY u.nombre
        """)
        return [dict(r) for r in rows]


async def get_dashboard_stats() -> dict:
    """3 queries secuenciales sobre la misma conexión del pool.
    IMPORTANTE: asyncpg no soporta múltiples queries en paralelo sobre una sola conexión.
    NO usar asyncio.gather() aquí — causa 'another operation is in progress' en producción."""
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
                FROM reproceso_pausas
                GROUP BY proceso_id
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
            GROUP BY sku_destino
            ORDER BY count DESC
            LIMIT 5
        """)

    stats = dict(counts)
    stats["global_avg_minutes"] = float(global_avg) if global_avg else 0.0
    stats["sku_distribution"] = [dict(r) for r in sku_rows]
    return stats


async def get_sku_human_resources() -> list[dict]:
    """
    Recurso humano por SKU: para cada SKU retorna cuántos procesos se hicieron,
    cuántas horas-hombre efectivas (sin pausas) se invirtieron en total,
    el promedio por proceso y cuántos operarios distintos lo trabajaron.
    Solo incluye procesos FINALIZADOS para tener datos completos.
    """
    async with get_conn() as conn:
        rows = await conn.fetch("""
            WITH pause_totals AS (
                SELECT proceso_id,
                       SUM(EXTRACT(EPOCH FROM (COALESCE(fin, NOW()) - inicio))) AS total_pause_sec
                FROM reproceso_pausas
                GROUP BY proceso_id
            ),
            proceso_times AS (
                SELECT
                    p.sku_destino,
                    p.operario_id,
                    EXTRACT(EPOCH FROM (p.finished_at - p.started_at))
                        - COALESCE(pt.total_pause_sec, 0) AS effective_sec
                FROM reproceso_procesos p
                LEFT JOIN pause_totals pt ON pt.proceso_id = p.id
                WHERE p.estado = 'FINALIZADO'
                  AND p.started_at IS NOT NULL
                  AND p.finished_at IS NOT NULL
            )
            SELECT
                sku_destino,
                COUNT(*)                          AS total_procesos,
                COUNT(DISTINCT operario_id)        AS total_operarios,
                ROUND(SUM(effective_sec) / 3600.0, 2)  AS total_horas_hombre,
                ROUND(AVG(effective_sec) / 60.0, 1)    AS promedio_minutos,
                ROUND(MIN(effective_sec) / 60.0, 1)    AS minimo_minutos,
                ROUND(MAX(effective_sec) / 60.0, 1)    AS maximo_minutos
            FROM proceso_times
            GROUP BY sku_destino
            ORDER BY total_horas_hombre DESC
        """)
        return [dict(r) for r in rows]


async def get_operator_kpis(user_id: int) -> dict:
    """3 queries secuenciales — asyncpg no soporta gather sobre la misma conexión."""
    _PAUSE_CTE = """
        WITH pause_totals AS (
            SELECT proceso_id,
                   SUM(EXTRACT(EPOCH FROM (COALESCE(fin, NOW()) - inicio))) / 60 AS total_pause_min
            FROM reproceso_pausas
            GROUP BY proceso_id
        )
    """
    async with get_conn() as conn:
        op_row = await conn.fetchrow(f"""
            {_PAUSE_CTE}
            SELECT
                COUNT(*) AS total,
                COUNT(CASE WHEN p.estado = 'FINALIZADO' THEN 1 END) AS finished,
                AVG(CASE
                    WHEN p.estado = 'FINALIZADO' THEN
                        EXTRACT(EPOCH FROM (p.finished_at - p.started_at)) / 60
                        - COALESCE(pt.total_pause_min, 0)
                END) AS avg_minutes
            FROM reproceso_procesos p
            LEFT JOIN pause_totals pt ON pt.proceso_id = p.id
            WHERE p.operario_id = $1
        """, user_id)

        global_avg = await conn.fetchval(f"""
            {_PAUSE_CTE}
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
            WHERE operario_id = $1
            GROUP BY sku_destino
            ORDER BY count DESC
        """, user_id)

    op_stats = dict(op_row)
    op_stats["global_avg_minutes"] = float(global_avg) if global_avg else 0.0
    op_stats["skus"] = [dict(r) for r in sku_rows]
    return op_stats


# ─── Config de Pausas Obligatorias ───────────

async def get_break_config() -> dict:
    """Retorna la configuración de pausas obligatorias."""
    async with get_conn() as conn:
        rows = await conn.fetch("SELECT key, value FROM reproceso_config")
        cfg = {r["key"]: r["value"] for r in rows}
    return {
        "enabled":       cfg.get("break_enabled", "false") == "true",
        "work_minutes":  int(cfg.get("break_work_minutes", "90")),
        "rest_minutes":  int(cfg.get("break_rest_minutes", "10")),
    }


async def set_break_config(enabled: bool, work_minutes: int, rest_minutes: int) -> dict:
    """Actualiza la configuración de pausas obligatorias."""
    async with get_conn() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE reproceso_config SET value=$1 WHERE key='break_enabled'",
                "true" if enabled else "false"
            )
            await conn.execute(
                "UPDATE reproceso_config SET value=$1 WHERE key='break_work_minutes'",
                str(work_minutes)
            )
            await conn.execute(
                "UPDATE reproceso_config SET value=$1 WHERE key='break_rest_minutes'",
                str(rest_minutes)
            )
    return {"enabled": enabled, "work_minutes": work_minutes, "rest_minutes": rest_minutes}


async def get_daily_report() -> dict:
    """
    Obtiene los datos consolidados para el informe de gerencia del día actual.
    """
    async with get_conn() as conn:
        # 1. Productos procesados hoy (detalles por proceso)
        procesos_hoy = await conn.fetch("""
            SELECT
                p.sku_destino,
                u.nombre as operario,
                p.stock_inicial,
                p.stock_final,
                p.es_urgente,
                p.started_at,
                p.finished_at,
                EXTRACT(EPOCH FROM (p.finished_at - p.started_at)) / 60 AS duracion_min
            FROM reproceso_procesos p
            JOIN reproceso_usuarios u ON u.id = p.operario_id
            WHERE p.created_at >= CURRENT_DATE
            ORDER BY p.created_at ASC
        """)

        # 2. Resumen por SKU (agregado)
        resumen_sku = await conn.fetch("""
            SELECT
                sku_destino,
                COUNT(*) as cantidad_procesos,
                SUM(stock_final - stock_inicial) as unidades_reprocesadas,
                AVG(EXTRACT(EPOCH FROM (p.finished_at - p.started_at)) / 60) as tiempo_promedio_min
            FROM reproceso_procesos p
            WHERE p.created_at >= CURRENT_DATE AND p.estado = 'FINALIZADO'
            GROUP BY sku_destino
        """)

        # 3. Operarios activos hoy
        operarios_hoy = await conn.fetch("""
            SELECT DISTINCT u.nombre, u.avatar
            FROM reproceso_procesos p
            JOIN reproceso_usuarios u ON u.id = p.operario_id
            WHERE p.created_at >= CURRENT_DATE
        """)

        # 4. Emergencias
        emergencias = await conn.fetchval("""
            SELECT COUNT(*) FROM reproceso_procesos
            WHERE created_at >= CURRENT_DATE AND es_urgente = TRUE
        """)

    return {
        "fecha": "Hoy",
        "procesos": [dict(r) for r in procesos_hoy],
        "resumen_sku": [dict(r) for r in resumen_sku],
        "operarios": [dict(r) for r in operarios_hoy],
        "total_emergencias": emergencias or 0,
        "total_procesos": len(procesos_hoy)
    }
