# Plan Detallado de Refactorización V1.1
## Evolución sin Roturas (2-4 semanas)

---

## OBJETIVO
Mejorar significativamente rendimiento, mantenibilidad y confiabilidad del sistema actual sin cambiar URLs de API ni romper el frontend. Preparar base sólida para futura evolución a V2.0.

---

## SEMANA 1: BACKEND MODULARIZACIÓN

### 1.1 Crear estructura de directorios

```bash
mkdir -p api/routes
mkdir -p db/migrations
mkdir -p db/queries
mkdir -p cache
mkdir -p tests/{unit,integration}
```

### 1.2 Modularizar `endpoints.py`

**Antes:**
```python
# api/endpoints.py (1382 líneas)
@router.get("/procesos")
async def get_procesos(...): ...

@router.post("/procesos")
async def create_proceso(...): ...

@router.get("/usuarios")
async def get_usuarios(...): ...

# ... 25 más endpoints entrecruzados
```

**Después:**
```python
# api/routes/procesos.py (250 líneas)
router = APIRouter(prefix="/procesos", tags=["procesos"])

@router.get("")
async def get_procesos(operario: Optional[str] = None, ...): ...

@router.post("")
async def create_proceso(req: CrearProcesoRequest, ...): ...

# api/routes/usuarios.py (180 líneas)
router = APIRouter(prefix="/usuarios", tags=["usuarios"])

@router.get("")
async def get_usuarios(...): ...

# api/endpoints.py (refactorized a 50 líneas)
from api.routes import procesos, usuarios, planning, stock, reporting

router = APIRouter(prefix="/api")
router.include_router(procesos.router)
router.include_router(usuarios.router)
router.include_router(planning.router)
router.include_router(stock.router)
router.include_router(reporting.router)
```

**Archivos a crear:**
- `api/routes/procesos.py` — GET/POST/PATCH /procesos
- `api/routes/usuarios.py` — GET/POST /usuarios
- `api/routes/planning.py` — GET/PATCH /planning/*
- `api/routes/stock.py` — GET /stock, PATCH /rules
- `api/routes/reporting.py` — GET /reports/*, /dashboard
- `api/schemas.py` — Todos los Pydantic models (extraído de endpoints)

**Ventajas:**
- Cada archivo ≤ 300 líneas (legible)
- Fácil de testear (mock dependencies)
- Sin cambio en URLs → frontend sigue funcionando
- Facilita agregar features (nuevo dominio = nuevo router)

---

### 1.3 Crear capa de repositorios

**Antes:**
```python
# db.py
async def get_procesos(operario_id=None):
    async with get_conn() as conn:
        q = """
        SELECT p.*, u.nombre, ...
        FROM reproceso_procesos p
        LEFT JOIN reproceso_usuarios u ON ...
        WHERE ...
        ORDER BY ...
        """
        return await conn.fetch(q, ...)
```

**Después:**
```python
# db/repositories/proceso_repo.py
from dataclasses import dataclass
from typing import Optional, List

@dataclass
class ProcesoResult:
    id: str
    operario_id: int
    sku_destino: str
    estado: str
    es_urgente: bool
    # ... más campos

class ProcesoRepository:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool
    
    async def find_all(self, operario_id: Optional[int] = None) -> List[ProcesoResult]:
        """
        Buscar procesos con optional filter por operario.
        
        Args:
            operario_id: Si es None, retorna todos. Si no, solo del operario.
        
        Returns:
            List de ProcesoResult ordenado por fecha DESC.
        """
        async with self.pool.acquire() as conn:
            query = """
            SELECT p.id, p.operario_id, p.sku_destino, p.estado, ...
            FROM reproceso_procesos p
            WHERE ($1::INT IS NULL OR p.operario_id = $1)
            ORDER BY p.fecha DESC
            """
            rows = await conn.fetch(query, operario_id)
            return [ProcesoResult(**row) for row in rows]
    
    async def find_by_id(self, id: str) -> Optional[ProcesoResult]:
        # ...
    
    async def create(self, data: dict) -> str:
        # Retorna ID del proceso creado
        # ...
    
    async def update_estado(self, id: str, estado: str) -> None:
        # ...

# db/repositories/__init__.py
async def get_proceso_repository(pool = Depends(get_pool)) -> ProcesoRepository:
    return ProcesoRepository(pool)

# api/routes/procesos.py
@router.get("")
async def get_procesos(
    operario: Optional[str] = None,
    repo: ProcesoRepository = Depends(get_proceso_repository)
):
    procesos = await repo.find_all(operario)
    return {"procesos": procesos}  # Pydantic auto-serializa dataclasses
```

**Ventajas:**
- Queries centralizadas (reutilizables, testables)
- Type hints → IDE autocomplete
- Fácil caching (decorator en method level)
- Separación: endpoint delega a repo, no escribe SQL

**Archivos:**
- `db/repositories/base.py` — BaseRepository genérico
- `db/repositories/proceso_repo.py`
- `db/repositories/usuario_repo.py`
- `db/repositories/planning_repo.py`

---

### 1.4 Crear capa de servicios (business logic)

```python
# db/services/proceso_service.py
from db.repositories import ProcesoRepository
from cache import CacheManager

class ProcesoService:
    def __init__(self, repo: ProcesoRepository, cache: CacheManager):
        self.repo = repo
        self.cache = cache
    
    async def get_procesos_with_cache(self, operario_id: Optional[int] = None):
        """
        Get procesos con caché automático.
        Cache key: "procesos:{operario_id}" (None -> "todos")
        TTL: 60 segundos
        """
        key = f"procesos:{operario_id or 'todos'}"
        
        # Try cache
        cached = await self.cache.get(key)
        if cached:
            return cached
        
        # Fallback to DB
        data = await self.repo.find_all(operario_id)
        await self.cache.set(key, data, ttl=60)
        return data
    
    async def create_and_notify(self, data: dict, token: str):
        """
        Crear proceso + log audit + notificar a maestro
        (Lógica de negocio compleja)
        """
        # 1. Validar stock inicial
        sku_stock = await self._check_stock(data['sku'])
        if sku_stock < data['stock_inicial']:
            raise ValueError("Stock insuficiente")
        
        # 2. Crear
        proc_id = await self.repo.create(data)
        
        # 3. Log audit
        await self.repo.log_action("PROCESO_CREADO", proc_id, data)
        
        # 4. Notificar maestro (si urgente)
        if data['es_urgente']:
            await self._notify_maestro(proc_id)
        
        # 5. Invalidar caché
        await self.cache.invalidate("procesos:*")
        
        return proc_id

# api/routes/procesos.py
def get_proceso_service(
    repo = Depends(get_proceso_repository),
    cache = Depends(get_cache)
) -> ProcesoService:
    return ProcesoService(repo, cache)

@router.post("")
async def create_proceso(
    req: CrearProcesoRequest,
    user = Depends(get_current_user),
    service = Depends(get_proceso_service)
):
    proc_id = await service.create_and_notify(req.dict(), user['token'])
    return {"id": proc_id, "estado": "CREADO"}
```

**Ventajas:**
- Business logic centralizada (reutilizable en tasks, webhooks, etc.)
- Caché transparente
- Fácil de testear (mock repo + cache)

---

### 1.5 Agregar índices a base de datos

**Archivo: `db/migrations/001_add_indexes.sql`**

```sql
-- Índices para queries críticas (usadas cada 5-30s)
CREATE INDEX IF NOT EXISTS idx_procesos_operario_estado 
  ON reproceso_procesos(operario_id, estado);

CREATE INDEX IF NOT EXISTS idx_procesos_estado_fecha 
  ON reproceso_procesos(estado, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_procesos_sku_fecha 
  ON reproceso_procesos(sku_destino, fecha DESC);

-- Pausas
CREATE INDEX IF NOT EXISTS idx_pausas_usuario_fecha 
  ON reproceso_pausas(usuario_id, fecha);

-- Planning
CREATE INDEX IF NOT EXISTS idx_plan_sku_fecha 
  ON reproceso_plan_produccion(sku, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_plan_estado 
  ON reproceso_plan_produccion(estado);

-- Audit
CREATE INDEX IF NOT EXISTS idx_audit_usuario_fecha 
  ON reproceso_audit_logs(usuario_id, timestamp DESC);
```

**Script de aplicación:**
```python
# db/migrations/runner.py
async def apply_migrations():
    async with get_conn() as conn:
        with open('db/migrations/001_add_indexes.sql') as f:
            await conn.execute(f.read())
        logger.info("Índices aplicados")

# main.py
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Iniciando...")
    await init_db()
    await apply_migrations()  # ← Aquí
    yield
```

---

## SEMANA 2: CACHÉ + ASYNC OPTIMIZATIONS

### 2.1 Implementar Redis caché

```python
# cache.py
from redis import Redis
import json
import asyncio

class CacheManager:
    def __init__(self, redis_url: str):
        self.redis = Redis.from_url(redis_url, decode_responses=True)
    
    async def get(self, key: str):
        """Get con async wrapper"""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.redis.get, key)
    
    async def set(self, key: str, value, ttl: int = 60):
        """Set con serialización automática"""
        loop = asyncio.get_event_loop()
        serialized = json.dumps(value, default=str)
        await loop.run_in_executor(None, self.redis.setex, key, ttl, serialized)
    
    async def invalidate(self, pattern: str):
        """Invalidar keys con patrón"""
        loop = asyncio.get_event_loop()
        keys = await loop.run_in_executor(None, self.redis.keys, pattern)
        if keys:
            await loop.run_in_executor(None, self.redis.delete, *keys)

# main.py
from cache import CacheManager

cache_manager = CacheManager(os.getenv("REDIS_URL", "redis://localhost:6379"))

@app.get("/health")
async def health():
    try:
        await cache_manager.get("ping")
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Cache error: {e}")
        return {"status": "degraded", "cache": "offline"}
```

### 2.2 Cachear queries frecuentes

```python
# db/services/planning_service.py
class PlanningService:
    async def get_weekly_plan(self, week_start: date):
        """GET /api/planning/semana — se llama cada vez que el maestro abre la vista"""
        cache_key = f"plan:week:{week_start.isoformat()}"
        
        cached = await self.cache.get(cache_key)
        if cached:
            return cached
        
        # Query costosa: múltiples JOINs, CTEs
        plan = await self._fetch_and_compute_plan(week_start)
        
        # Caché 30 minutos (plan cambia cuando maestro actualiza)
        await self.cache.set(cache_key, plan, ttl=1800)
        
        return plan
    
    async def on_plan_updated(self, plan_id: int):
        """Invalidar caché cuando plan es actualizado"""
        await self.cache.invalidate("plan:week:*")
        logger.info(f"Caché plan invalidada (plan_id={plan_id})")
```

---

### 2.3 Implementar connection pooling optimization

```python
# db.py
async def _get_pool() -> asyncpg.Pool:
    """Pool mejorado con monitoreo"""
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            DATABASE_URL,
            password=raw_password,
            min_size=5,      # ↑ de 2
            max_size=20,     # ↑ de 10
            max_queries=50000,  # Reconectar después de 50K queries
            max_cached_statement_lifetime=3600,
            max_cacheable_statement_size=15000,
            ssl=_ssl_ctx,
        )
        
        # Monitoreo
        async def _monitor_pool():
            while True:
                await asyncio.sleep(60)
                size = _pool._holders.__len__()
                logger.debug(f"[Pool] size={size}, queue={_pool._queue.qsize()}")
        
        asyncio.create_task(_monitor_pool())
        logger.info("[DB] asyncpg pool creado (min=5, max=20)")
    return _pool
```

---

## SEMANA 3: TESTING + ERROR HANDLING

### 3.1 Estructura de tests

```python
# tests/conftest.py (Pytest fixtures)
import pytest
import asyncpg
from app import create_app
from db import init_db

@pytest.fixture
async def db_pool():
    """Pool de test (DB en-memory o test server)"""
    pool = await asyncpg.create_pool(
        "postgresql://user:pass@localhost/reproceso_test"
    )
    yield pool
    await pool.close()

@pytest.fixture
async def app():
    """FastAPI app para test"""
    test_app = create_app()
    return test_app

@pytest.fixture
def client(app):
    """HTTP test client"""
    return TestClient(app)

# tests/unit/test_proceso_repo.py
@pytest.mark.asyncio
async def test_find_all_sin_filtro(db_pool):
    repo = ProcesoRepository(db_pool)
    result = await repo.find_all()
    assert isinstance(result, list)
    assert all(isinstance(p, ProcesoResult) for p in result)

@pytest.mark.asyncio
async def test_find_all_con_operario(db_pool):
    repo = ProcesoRepository(db_pool)
    result = await repo.find_all(operario_id=1)
    assert all(p.operario_id == 1 for p in result)

# tests/integration/test_procesos_endpoint.py
@pytest.mark.asyncio
async def test_get_procesos_endpoint(client, auth_token):
    response = client.get(
        "/api/procesos",
        headers={"Authorization": f"Bearer {auth_token}"}
    )
    assert response.status_code == 200
    assert "procesos" in response.json()

# tests/e2e/test_flujo_completo.py
@pytest.mark.asyncio
async def test_crear_y_finalizar_proceso(client, auth_token):
    # 1. Crear
    res_create = client.post("/api/procesos", json={...})
    proc_id = res_create.json()["id"]
    
    # 2. Iniciar
    res_start = client.patch(f"/api/procesos/{proc_id}", json={"accion": "start"})
    assert res_start.status_code == 200
    
    # 3. Finalizar
    res_finish = client.patch(f"/api/procesos/{proc_id}", json={"accion": "finish"})
    assert res_finish.status_code == 200
```

### 3.2 Global exception handler

```python
# app/exceptions.py
class BusinessLogicError(Exception):
    """Error en lógica de negocio (user-facing)"""
    def __init__(self, message: str, code: str):
        self.message = message
        self.code = code

class ValidationError(BusinessLogicError):
    pass

class ResourceNotFoundError(BusinessLogicError):
    pass

# main.py
from fastapi.exception_handlers import HTTPException as HTTPExc

@app.exception_handler(BusinessLogicError)
async def business_exception_handler(request: Request, exc: BusinessLogicError):
    return JSONResponse(
        status_code=400,
        content={"error": exc.message, "code": exc.code}
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "code": "INTERNAL_ERROR"}
    )
```

---

## SEMANA 4: FRONTEND IMPROVEMENTS

### 4.1 Agrupar CSS + minificar JS

```html
<!-- templates/index.html (antes: 1321 líneas) -->
<!-- Extraer CSS inline → static/css/index.css -->
<!-- Extractar cada <section> → static/html/views/*.html -->
<!-- Resultado: index.html → 400 líneas -->
```

### 4.2 Lazy-loading de vistas

```javascript
// static/js/view-loader.js (NUEVO)
const ViewLoader = {
    _loaded: {},
    
    async load(viewId) {
        if (this._loaded[viewId]) return this._loaded[viewId];
        
        const html = await fetch(`/static/html/views/${viewId}.html`);
        const section = document.createElement('section');
        section.id = viewId;
        section.className = 'view hidden';
        section.innerHTML = await html.text();
        
        document.querySelector('#app-container').appendChild(section);
        this._loaded[viewId] = section;
        
        return section;
    }
};

// ui.js
async navigateTo(viewId) {
    const section = await ViewLoader.load(viewId);
    // ... resto del routing
}
```

### 4.3 Mejorar render performance

**Antes (maestro-shell.js):**
```javascript
_renderResumen(db, rp) {
    // Genera 2000+ chars HTML con string concatenation
    let html = `<div>...${ops.forEach(op => html += `<div>...`)}...</div>`
    body.innerHTML = html  // ← Reflow + Repaint entera
}
```

**Después:**
```javascript
_renderResumen(db, rp) {
    // Usar DocumentFragment para batching
    const fragment = document.createDocumentFragment()
    
    db.operators.forEach(op => {
        const card = this._createOperarioCard(op)
        fragment.appendChild(card)
    })
    
    body.innerHTML = ''  // Clear una vez
    body.appendChild(fragment)  // Insert todo junto
}

_createOperarioCard(op) {
    // Retorna Element, no string
    const card = document.createElement('div')
    card.className = 'card'
    card.innerHTML = `...`
    return card
}
```

---

## VALIDACIÓN Y ROLLOUT

### Checklist Pre-Deploy:

- [ ] Todos los tests pasan (`pytest`)
- [ ] 0 console errors en navegador (F12)
- [ ] Load testing: 50 concurrent users OK (Locust)
- [ ] Caché funcionando (Redis espía)
- [ ] Índices creados (EXPLAIN en queries críticas)
- [ ] Rollback plan: script para revert migraciones
- [ ] Documentación actualizada
- [ ] Backup de BD antes de deploy

### Estrategia de Rollout:

1. **Staging:** Deploy a rama staging, testing manual + auto tests
2. **Canary:** Deploy a 10% de usuarios (feature flag)
3. **Full:** Rollout a 100%, monitorear errores 24h
4. **Revert:** Si errores críticos, script rollback automático

---

## ESTIMACIÓN DE ESFUERZO

| Semana | Tarea | Horas | Owner |
|--------|-------|-------|-------|
| 1 | Modularizar endpoints, repos | 25 | Backend |
| 2 | Caché + índices | 20 | Backend |
| 3 | Tests + error handling | 20 | QA/Backend |
| 4 | Frontend lazy-load + perf | 15 | Frontend |
| **Total** | | **80h** | **1-2 personas** |

---

## IMPACTO ESPERADO

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|--------|
| **Tiempo carga inicial** | 4-5s | 2-3s | -40% |
| **Tiempo query procesos** | 500ms | 100ms | -80% |
| **Latencia API promedio** | 400ms | 150ms | -62% |
| **Uso memoria frontend** | 80MB | 50MB | -37% |
| **Test coverage** | 0% | 60% | ✅ |
| **Líneas de código Backend** | 1382 | 250+250+200+... | Modular |

---

## PRÓXIMOS PASOS

1. **Hoy:** Validar roadmap con equipo
2. **Mañana:** Crear ramas feature para cada módulo
3. **Semana 1:** Empezar refactorización endpoints
4. **Semana 2:** Revisar + merge PRs modularización
5. **Semana 3:** Deploy a staging
6. **Semana 4:** Full rollout a producción

---

**Preguntas frecuentes:**

**¿Rompe con frontend actual?**
No. URLs de API siguen igual. Frontend funciona sin cambios.

**¿Redis es obligatorio?**
No. Caché puede ser en-memory dict (menos escala pero funciona). Redis recomendado para >100 usuarios concurrent.

**¿Cuándo empezamos V2.0?**
Después de validar V1.1 en producción (1-2 semanas post-deploy).
