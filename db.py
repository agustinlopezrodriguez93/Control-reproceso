"""
Control Reproceso - Database Layer
Mismo patrón que el consolidador: PostgreSQL via psycopg2
"""
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')


def get_db():
    """Returns a new PostgreSQL connection with RealDictCursor."""
    if not DATABASE_URL:
        raise ConnectionError("DATABASE_URL is not set in environment or .env file")
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS reproceso_usuarios (
    id       SERIAL PRIMARY KEY,
    nombre   TEXT NOT NULL UNIQUE,
    rol      TEXT NOT NULL DEFAULT 'Operario',
    avatar   TEXT DEFAULT '',
    password_hash TEXT
);

CREATE TABLE IF NOT EXISTS reproceso_audit_logs (
    id          SERIAL PRIMARY KEY,
    timestamp   TIMESTAMPTZ DEFAULT NOW(),
    usuario_id  INTEGER REFERENCES reproceso_usuarios(id),
    accion      TEXT NOT NULL,
    detalles    TEXT
);

CREATE TABLE IF NOT EXISTS reproceso_skus (
    id       SERIAL PRIMARY KEY,
    codigo   TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS reproceso_procesos (
    id              TEXT PRIMARY KEY,
    operario_id     INTEGER REFERENCES reproceso_usuarios(id),
    sku_destino     TEXT NOT NULL,
    estado          TEXT NOT NULL DEFAULT 'CREADO',
    es_urgente      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    last_state_change TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reproceso_pausas (
    id          SERIAL PRIMARY KEY,
    proceso_id  TEXT REFERENCES reproceso_procesos(id) ON DELETE CASCADE,
    inicio      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fin         TIMESTAMPTZ
);
"""


def init_db():
    """Create tables if they don't exist and seed initial data."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute(SCHEMA)

        # Check if migration needed (add password_hash if not exists)
        cur.execute("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name='reproceso_usuarios' AND column_name='password_hash'
        """)
        if not cur.fetchone():
            print("[DB] Migración: Añadiendo columna password_hash...")
            cur.execute("ALTER TABLE reproceso_usuarios ADD COLUMN password_hash TEXT")

        conn.commit()

        # Seed default users
        # Import here to avoid circular dependency
        from auth import get_password_hash

        # Seed default users if empty
        cur.execute("SELECT COUNT(*) FROM reproceso_usuarios")
        count = cur.fetchone()[0]

        if count == 0:
            # Usuarios por defecto: Admin/mega123, OperariosN/1234,
            # admin/admin123 (rol Maestro), viewer/viewer123 (rol Operario)
            users = [
                # (nombre, rol, avatar, password)
                ("Admin",      "Maestro",  "AD", "mega123"),
                ("Usuario 1",  "Operario", "U1", "1234"),
                ("Usuario 2",  "Operario", "U2", "1234"),
                ("Usuario 3",  "Operario", "U3", "1234"),
                ("admin",      "Maestro",  "AD", "admin123"),
                ("viewer",     "Operario", "VW", "viewer123"),
            ]
            for nombre, rol, avatar, pw in users:
                cur.execute(
                    "INSERT INTO reproceso_usuarios (nombre, rol, avatar, password_hash) "
                    "VALUES (%s, %s, %s, %s) ON CONFLICT (nombre) DO NOTHING",
                    (nombre, rol, avatar, get_password_hash(pw))
                )
            conn.commit()
            print("[DB] Usuarios por defecto creados (admin/admin123, viewer/viewer123, Admin/mega123).")
        else:
            # Asegurar que los usuarios admin/viewer existen aunque la tabla ya tenga datos
            for nombre, rol, avatar, pw in [
                ("admin",  "Maestro",  "AD", "admin123"),
                ("viewer", "Operario", "VW", "viewer123"),
            ]:
                cur.execute(
                    "INSERT INTO reproceso_usuarios (nombre, rol, avatar, password_hash) "
                    "VALUES (%s, %s, %s, %s) ON CONFLICT (nombre) DO NOTHING",
                    (nombre, rol, avatar, get_password_hash(pw))
                )
            conn.commit()
            print("[DB] Usuarios admin/viewer verificados.")

        # Seed default SKUs if empty
        cur.execute("SELECT COUNT(*) FROM reproceso_skus")
        count = cur.fetchone()[0]
        if count == 0:
            skus = [
                "GCMD", "GGAL070", "IMOCA", "IMOCP", "MCCE",
                "SCCA", "SECC090", "SECPI", "SEKOF", "SEKQB",
                "SEKRN", "SEPASP", "SEPC", "SEPEIC", "SEPOD",
                "SEPOF", "SESCD", "SGEP", "SKPXL"
            ]
            for sku in skus:
                cur.execute(
                    "INSERT INTO reproceso_skus (codigo) VALUES (%s) ON CONFLICT (codigo) DO NOTHING",
                    (sku,)
                )
            conn.commit()
            print("[DB] SKUs por defecto creados.")

        cur.close()
    finally:
        conn.close()
    print("[DB] Control Reproceso DB initialized on PostgreSQL.")


# ─────────────────────────────────────────────
# Query functions
# ─────────────────────────────────────────────

def get_usuarios():
    """
    Retorna la lista completa de usuarios registrados en el sistema.

    Returns:
        Lista de dicts con campos: id, nombre, rol, avatar.
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT id, nombre, rol, avatar FROM reproceso_usuarios ORDER BY id")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]


def get_usuario_por_nombre(nombre):
    """
    Busca un usuario por su nombre exacto, incluyendo el campo password_hash.

    Args:
        nombre: Nombre de usuario a buscar.

    Returns:
        Dict con todos los campos del usuario, o None si no existe.
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT * FROM reproceso_usuarios WHERE nombre = %s", (nombre,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return dict(row) if row else None


def crear_usuario(nombre, password, rol, avatar=""):
    """
    Crea un nuevo usuario con la contrasena hasheada en bcrypt.

    Args:
        nombre: Nombre unico del usuario.
        password: Contrasena en texto plano (se hashea antes de guardar).
        rol: Rol del usuario ('Operario' o 'Maestro').
        avatar: Texto corto para el avatar visual (ej. 'U1', 'S'). Por defecto vacio.

    Returns:
        ID entero del usuario recien creado.
    """
    from auth import get_password_hash
    conn = get_db()
    cur = conn.cursor()
    pw_hash = get_password_hash(password)
    cur.execute(
        "INSERT INTO reproceso_usuarios (nombre, rol, avatar, password_hash) VALUES (%s, %s, %s, %s) RETURNING id",
        (nombre, rol, avatar, pw_hash)
    )
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return new_id


def borrar_usuario(user_id):
    """
    Elimina un usuario de la base de datos por su ID.

    Args:
        user_id: ID entero del usuario a eliminar.
    """
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM reproceso_usuarios WHERE id = %s", (user_id,))
    conn.commit()
    cur.close()
    conn.close()


def log_audit(username, accion, detalles=""):
    """
    Inserta una entrada en el registro de auditoria.

    Args:
        username: Nombre del usuario que realizo la accion.
        accion: Codigo de accion en mayusculas (ej. 'LOGIN', 'PROCESO_CREADO').
        detalles: Informacion adicional de contexto. Por defecto cadena vacia.
    """
    conn = get_db()
    cur = conn.cursor()
    # Get user id from name
    cur.execute("SELECT id FROM reproceso_usuarios WHERE nombre = %s", (username,))
    row = cur.fetchone()
    user_id = row[0] if row else None
    
    cur.execute(
        "INSERT INTO reproceso_audit_logs (usuario_id, accion, detalles) VALUES (%s, %s, %s)",
        (user_id, accion, detalles)
    )
    conn.commit()
    cur.close()
    conn.close()


def get_audit_logs(limit=100):
    """
    Retorna las entradas mas recientes del registro de auditoria.

    Args:
        limit: Cantidad maxima de registros a retornar. Por defecto 100.

    Returns:
        Lista de dicts con campos: id, timestamp, accion, detalles, usuario_id, username.
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        SELECT a.*, u.nombre as username
        FROM reproceso_audit_logs a
        LEFT JOIN reproceso_usuarios u ON u.id = a.usuario_id
        ORDER BY a.timestamp DESC
        LIMIT %s
    """, (limit,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]


def get_skus():
    """
    Retorna la lista de codigos SKU disponibles en el catalogo, ordenados alfabeticamente.

    Returns:
        Lista de strings con los codigos de SKU.
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT codigo FROM reproceso_skus ORDER BY codigo")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [r["codigo"] for r in rows]


def get_procesos(operario_nombre=None):
    """
    Retorna la lista de procesos de reproceso, con su historial de pausas incluido.

    Si se proporciona 'operario_nombre', filtra solo los procesos asignados a ese operario.
    Los procesos urgentes aparecen primero; dentro del mismo nivel de urgencia,
    se ordenan por fecha de creacion descendente.

    Args:
        operario_nombre: Nombre exacto del operario a filtrar. Si es None, retorna todos.

    Returns:
        Lista de dicts. Cada dict incluye todos los campos de 'reproceso_procesos',
        el campo 'operario_nombre' (nombre del usuario), y una clave 'pausas' con
        la lista de registros de pausa (cada uno con 'inicio' y 'fin').
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    if operario_nombre:
        cur.execute("""
            SELECT p.*, u.nombre as operario_nombre
            FROM reproceso_procesos p
            JOIN reproceso_usuarios u ON u.id = p.operario_id
            WHERE u.nombre = %s
            ORDER BY p.es_urgente DESC, p.created_at DESC
        """, (operario_nombre,))
    else:
        cur.execute("""
            SELECT p.*, u.nombre as operario_nombre
            FROM reproceso_procesos p
            JOIN reproceso_usuarios u ON u.id = p.operario_id
            ORDER BY p.es_urgente DESC, p.created_at DESC
        """)

    rows = cur.fetchall()

    # Attach pauses to each process
    results = []
    for row in rows:
        proc = dict(row)
        cur.execute(
            "SELECT inicio, fin FROM reproceso_pausas WHERE proceso_id = %s ORDER BY inicio",
            (proc["id"],)
        )
        proc["pausas"] = [dict(p) for p in cur.fetchall()]
        results.append(proc)

    cur.close()
    conn.close()
    return results


def get_proceso(proceso_id):
    """
    Retorna un proceso de reproceso por su ID, incluyendo su historial de pausas.

    Args:
        proceso_id: ID de texto (UUID) del proceso a buscar.

    Returns:
        Dict con todos los campos del proceso, el nombre del operario y la lista
        de pausas, o None si no existe ningun proceso con ese ID.
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        SELECT p.*, u.nombre as operario_nombre
        FROM reproceso_procesos p
        JOIN reproceso_usuarios u ON u.id = p.operario_id
        WHERE p.id = %s
    """, (proceso_id,))
    row = cur.fetchone()

    if row:
        proc = dict(row)
        cur.execute(
            "SELECT inicio, fin FROM reproceso_pausas WHERE proceso_id = %s ORDER BY inicio",
            (proc["id"],)
        )
        proc["pausas"] = [dict(p) for p in cur.fetchall()]
    else:
        proc = None

    cur.close()
    conn.close()
    return proc


def crear_proceso(proceso_id, operario_nombre, sku_destino, es_urgente=False):
    """
    Inserta un nuevo proceso de reproceso en estado 'CREADO'.

    Args:
        proceso_id: ID de texto (UUID) para el nuevo proceso. Generado por el caller.
        operario_nombre: Nombre del operario responsable. Debe existir en la tabla de usuarios.
        sku_destino: Codigo del SKU destino del proceso.
        es_urgente: Si es True, el proceso se marca como urgente y aparece con prioridad. Por defecto False.

    Returns:
        El mismo proceso_id recibido como parametro, confirmando la insercion.

    Raises:
        ValueError: Si el operario_nombre no existe en la base de datos.
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Get operario ID
    cur.execute("SELECT id FROM reproceso_usuarios WHERE nombre = %s", (operario_nombre,))
    user = cur.fetchone()
    if not user:
        cur.close()
        conn.close()
        raise ValueError(f"Operario '{operario_nombre}' no encontrado")

    cur.execute("""
        INSERT INTO reproceso_procesos (id, operario_id, sku_destino, estado, es_urgente)
        VALUES (%s, %s, %s, 'CREADO', %s)
    """, (proceso_id, user["id"], sku_destino, es_urgente))

    conn.commit()
    cur.close()
    conn.close()
    return proceso_id


def actualizar_estado(proceso_id, nueva_accion):
    """
    Actualiza el estado de un proceso segun la accion recibida.

    Transiciones validas:
        - 'start':  CREADO   -> INICIADO  (registra started_at)
        - 'pause':  INICIADO -> PAUSADO   (crea registro en reproceso_pausas con inicio=NOW())
        - 'resume': PAUSADO  -> INICIADO  (cierra el registro de pausa con fin=NOW())
        - 'finish': cualquier estado no FINALIZADO -> FINALIZADO (registra finished_at;
          si estaba PAUSADO, cierra la pausa abierta antes de finalizar)

    Args:
        proceso_id: ID de texto (UUID) del proceso a modificar.
        nueva_accion: Una de las cadenas: 'start', 'pause', 'resume', 'finish'.

    Returns:
        Dict completo del proceso actualizado (equivalente a llamar get_proceso).

    Raises:
        ValueError: Si el proceso no existe, si la transicion no es valida para el
                    estado actual, o si la accion es desconocida.
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Get current state
    cur.execute("SELECT estado FROM reproceso_procesos WHERE id = %s", (proceso_id,))
    row = cur.fetchone()
    if not row:
        cur.close()
        conn.close()
        raise ValueError("Proceso no encontrado")

    estado_actual = row["estado"]

    if nueva_accion == "start":
        if estado_actual != "CREADO":
            raise ValueError("Solo procesos CREADOS pueden iniciarse")
        cur.execute("""
            UPDATE reproceso_procesos 
            SET estado = 'INICIADO', started_at = NOW(), last_state_change = NOW()
            WHERE id = %s
        """, (proceso_id,))

    elif nueva_accion == "pause":
        if estado_actual != "INICIADO":
            raise ValueError("Solo procesos INICIADOS pueden pausarse")
        cur.execute("""
            UPDATE reproceso_procesos 
            SET estado = 'PAUSADO', last_state_change = NOW()
            WHERE id = %s
        """, (proceso_id,))
        # Create pause record
        cur.execute("""
            INSERT INTO reproceso_pausas (proceso_id, inicio)
            VALUES (%s, NOW())
        """, (proceso_id,))

    elif nueva_accion == "resume":
        if estado_actual != "PAUSADO":
            raise ValueError("Solo procesos PAUSADOS pueden reanudarse")
        cur.execute("""
            UPDATE reproceso_procesos 
            SET estado = 'INICIADO', last_state_change = NOW()
            WHERE id = %s
        """, (proceso_id,))
        # Close open pause
        cur.execute("""
            UPDATE reproceso_pausas 
            SET fin = NOW()
            WHERE proceso_id = %s AND fin IS NULL
        """, (proceso_id,))

    elif nueva_accion == "finish":
        if estado_actual == "FINALIZADO":
            raise ValueError("Proceso ya finalizado")
        # Close open pause if paused
        if estado_actual == "PAUSADO":
            cur.execute("""
                UPDATE reproceso_pausas 
                SET fin = NOW()
                WHERE proceso_id = %s AND fin IS NULL
            """, (proceso_id,))
        cur.execute("""
            UPDATE reproceso_procesos 
            SET estado = 'FINALIZADO', finished_at = NOW(), last_state_change = NOW()
            WHERE id = %s
        """, (proceso_id,))

    else:
        raise ValueError(f"Acción desconocida: {nueva_accion}")

    conn.commit()
    cur.close()
    conn.close()

    return get_proceso(proceso_id)


def get_proceso_activo(operario_nombre):
    """
    Verifica si un operario tiene actualmente un proceso en estado 'INICIADO'.

    Util para validar que no se inicien o reanuden dos procesos de forma simultanea.

    Args:
        operario_nombre: Nombre del operario a consultar.

    Returns:
        Dict con 'id' y 'sku_destino' del proceso activo, o None si no hay ninguno.
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        SELECT p.id, p.sku_destino
        FROM reproceso_procesos p
        JOIN reproceso_usuarios u ON u.id = p.operario_id
        WHERE u.nombre = %s AND p.estado = 'INICIADO'
        LIMIT 1
    """, (operario_nombre,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return dict(row) if row else None


def get_performance():
    """
    Retorna estadisticas de rendimiento por operario para la vista del Maestro.

    Incluye solo usuarios con rol 'Operario'. Para cada operario calcula:
    - Procesos completados (estado FINALIZADO)
    - Total de procesos asignados
    - Tiempo promedio por tarea en minutos (solo tareas finalizadas)

    Returns:
        Lista de dicts con campos: id, user (nombre), completed, total, avg_minutes.
        avg_minutes puede ser None si el operario no tiene tareas finalizadas.
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("""
        SELECT 
            u.id,
            u.nombre as user,
            COUNT(CASE WHEN p.estado = 'FINALIZADO' THEN 1 END) as completed,
            COUNT(p.id) as total,
            AVG(CASE 
                WHEN p.estado = 'FINALIZADO' 
                THEN EXTRACT(EPOCH FROM (p.finished_at - p.started_at)) / 60 
            END) as avg_minutes
        FROM reproceso_usuarios u
        LEFT JOIN reproceso_procesos p ON p.operario_id = u.id
        WHERE u.rol = 'Operario'
        GROUP BY u.id, u.nombre
        ORDER BY u.nombre
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(r) for r in rows]


def get_dashboard_stats():
    """
    Retorna estadisticas agregadas globales para el dashboard del Maestro.

    Incluye:
    - total_tasks: total de procesos en el sistema
    - active_tasks: procesos en estado INICIADO
    - finished_today: procesos finalizados en el dia actual
    - pending_urgent: procesos urgentes que no estan finalizados
    - global_avg_minutes: tiempo promedio de tarea (minutos) sobre todas las tareas finalizadas
    - sku_distribution: lista de los top 5 SKUs mas procesados con su conteo

    Returns:
        Dict con todas las claves descritas arriba.
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # 1. Counts
    cur.execute("""
        SELECT 
            COUNT(*) as total_tasks,
            COUNT(CASE WHEN estado = 'INICIADO' THEN 1 END) as active_tasks,
            COUNT(CASE WHEN estado = 'FINALIZADO' AND finished_at >= CURRENT_DATE THEN 1 END) as finished_today,
            COUNT(CASE WHEN es_urgente = TRUE AND estado != 'FINALIZADO' THEN 1 END) as pending_urgent
        FROM reproceso_procesos
    """)
    stats = dict(cur.fetchone())
    
    # 2. General Efficiency (Avg minutes per task)
    cur.execute("""
        SELECT AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) / 60) as global_avg_minutes
        FROM reproceso_procesos
        WHERE estado = 'FINALIZADO'
    """)
    avg_row = cur.fetchone()
    stats["global_avg_minutes"] = float(avg_row["global_avg_minutes"]) if avg_row and avg_row["global_avg_minutes"] else 0
    
    # 3. SKU Distribution (Top 5)
    cur.execute("""
        SELECT sku_destino, COUNT(*) as count
        FROM reproceso_procesos
        GROUP BY sku_destino
        ORDER BY count DESC
        LIMIT 5
    """)
    stats["sku_distribution"] = [dict(r) for r in cur.fetchall()]
    
    cur.close()
    conn.close()
    return stats


def get_operator_kpis(user_id):
    """
    Retorna metricas detalladas de un operario comparadas contra el promedio global.

    Util para el drill-down individual en la vista de rendimiento del Maestro.

    Args:
        user_id: ID entero del operario en la tabla reproceso_usuarios.

    Returns:
        Dict con:
        - total: total de procesos del operario
        - finished: procesos finalizados
        - avg_minutes: tiempo promedio de tarea del operario (minutos), o None si no hay
        - global_avg_minutes: promedio global de todos los operarios para comparacion
        - skus: lista de dicts {sku_destino, count} con los SKUs que ha trabajado, ordenados por frecuencia
    """
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # 1. Operator base metrics
    cur.execute("""
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN estado = 'FINALIZADO' THEN 1 END) as finished,
            AVG(CASE 
                WHEN estado = 'FINALIZADO' 
                THEN EXTRACT(EPOCH FROM (finished_at - started_at)) / 60 
            END) as avg_minutes
        FROM reproceso_procesos
        WHERE operario_id = %s
    """, (user_id,))
    op_stats = dict(cur.fetchone())
    
    # 2. Global averages for comparison
    cur.execute("""
        SELECT 
            AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) / 60) as global_avg
        FROM reproceso_procesos
        WHERE estado = 'FINALIZADO'
    """)
    global_avg = cur.fetchone()["global_avg"]
    op_stats["global_avg_minutes"] = float(global_avg) if global_avg else 0
    
    # 3. Activity by SKU
    cur.execute("""
        SELECT sku_destino, COUNT(*) as count
        FROM reproceso_procesos
        WHERE operario_id = %s
        GROUP BY sku_destino
        ORDER BY count DESC
    """, (user_id,))
    op_stats["skus"] = [dict(r) for r in cur.fetchall()]
    
    cur.close()
    conn.close()
    return op_stats
