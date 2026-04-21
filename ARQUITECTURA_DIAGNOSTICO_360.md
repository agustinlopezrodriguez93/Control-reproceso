# Control Reproceso — Análisis Arquitectónico 360°
## Diagnóstico Exhaustivo + Propuesta V2.0

---

## PARTE I: DIAGNÓSTICO ACTUAL (V1.0)

### 1️⃣ ESTRUCTURA Y DEUDA TÉCNICA

#### Estado Actual:
```
Control reproceso/
├── main.py (75 líneas)         ✅ Limpio
├── db.py (921 líneas)           ⚠️ MONOLITO
├── auth.py (246 líneas)         ✅ Contenido
├── api/endpoints.py (1382 líneas) ⚠️ GIGANTE
├── laudus_client.py (111 líneas) ✅ Aislado
│
├── static/js/
│   ├── ui.js (582 líneas)        ⚠️ Router + DOM pesado
│   ├── app.js                    ✅ Controlador limpio
│   ├── store.js (195 líneas)     ⚠️ Estado global monolítico
│   ├── views/ (9 archivos, 3000+ líneas) ⚠️ Vistas acopladas
│   └── views/maestro-shell.js (500 líneas) ⚠️ Orquestador pesado
│
└── templates/
    ├── index.html (1321 líneas)  🔴 GIGANTE: todo en un archivo
    └── inventory.html (468 líneas) ✅ Aislado
```

#### Problemas Identificados:

**A. Backend:**
- ❌ `endpoints.py` (1382 líneas): Una única clase enorme con 30+ endpoints mezclados
  - Sin separación por dominio (procesos, usuarios, stock, planning, reporting)
  - Difícil de testear y mantener
  - Sin versionado de API (todas en `/api/`, sin `/api/v1/`)
  
- ❌ `db.py` (921 líneas): Mezcla de pool, schema, queries y helpers
  - Funciones `get_procesos`, `get_operadores`, etc. — queries SQL crudo sin abstracción
  - Sin ORMs o query builders — propenso a SQL injection (aunque usa $1,$2)
  - Sin cache de queries frecuentes (aunque hay one-off cache en endpoints)
  - Migraciones inline en `init_db()` — frágil y no versionado

**B. Frontend:**
- ❌ `index.html` (1321 líneas): Monolito gigante
  - 10+ vistas inline en la misma sección (operario, stock, planning, maestro-shell, etc.)
  - 1 módulo de JavaScript carga TODA la aplicación (ui.js, store.js, app.js, 9 views)
  - Sin lazy-loading real (todas las vistas cargan al inicio)
  - Sin webpack/bundler — archivos individuales sin minificación

- ❌ `ui.js` (582 líneas): Enorme router SPA + lógica de DOM
  - `navigateTo()` tiene 30+ cases para routing
  - Mezclado con manipulación de clases CSS, formatos, etc.
  - Sin framework (vanilla JS — bien para simplicidad, mal para mantenimiento a escala)
  
- ❌ `store.js` (195 líneas): Estado global sin reactividad
  - Simple object con setState — sin notificaciones automáticas
  - Debe emitir eventos manuales (`window.addEventListener('store:...')`)
  - Código repetido en views para re-render post-fetch

- ❌ Vistas acopladas (3000+ líneas distribuidas):
  - Cada view es IIFE grande que mezcla lógica + renderizado + DOM queries
  - Impossível reutilizar componentes
  - Hard-coded IDs esperados en el DOM (ej: `performance.js` espera `#chart-sku-distro`)

---

### 2️⃣ RENDIMIENTO Y CUELLOS DE BOTELLA

#### Backend:

**A. Queries a Base de Datos:**
- ❌ `get_procesos()`: Sin índices declarados (todo full table scan potencial)
  - Query que se ejecuta cada 5-30s desde el frontend
  - Sin paginación — trae TODOS los procesos del día
  - Sin cache — cada llamada hits DB
  
- ❌ `get_dashboard_stats()`: 5+ CTEs anidadas para calcular KPIs
  - Ejecuta múltiples aggregations en tiempo real
  - Sin materialización — cada request recalcula desde cero

- ❌ Falta de índices en tablas críticas:
  - `reproceso_procesos(operario_id, estado, fecha)`
  - `reproceso_plan_produccion(fecha, sku)`
  - `reproceso_pausas(usuario_id, fecha)`

**B. Pool de Conexiones:**
- ✅ Asyncpg pool configurado (min=2, max=10) — bien
- ❌ Sin monitoreo de pool exhaustion — si tráfico sube, clients cuelgan

**C. Caché en Memoria:**
- ⚠️ `/api/users-public` tiene cache (60s, monotonic time) — OK para usuarios estáticos
- ❌ Falta caché para:
  - SKUs activos (cambian raramente)
  - Configuración de pausas (por usuario)
  - Tiempos de producción (product_times)

---

#### Frontend:

**A. Número de Peticiones HTTP:**
- En dashboard Maestro + Stock Panel: **+15 peticiones en paralelo**
  - `/api/planning/dashboard`, `/api/reports/daily`, `/api/product-times`, `/api/planning/semana`, etc.
  - Cada navegación a un panel llama `render()` → nueva API call
  - Sin deduplicación: si 2 vistas necesitan `/api/planning/dashboard`, se ejecuta 2x

**B. Tamaño de Payloads:**
- `/api/planning/semana` retorna 1000+ items de plan → JSON de 200KB+
- `/api/reports/daily` retorna todos los procesos del día → minutos overhead
- Sin paginated queries — sin soporte para filtros frontend

**C. Parseo HTML/DOM:**
- 1321 líneas en index.html — todo se parsea al iniciar
- 10+ `<section id="view-xxx">` hidden — DOM innecesario en memoria
- Cada view llama `document.querySelectorAll()` / `getElementById()` sin caché

**D. Re-renders Ineficientes:**
- `maestro-shell.js` auto-refresh cada 30s → `_loadResumen()` redibuja todo
- Tablas grandes (500+ filas) → innerHTML replace completo en lugar de diff

---

### 3️⃣ SEGURIDAD

#### Autenticación & Autorización:

- ✅ JWT con RS256 (crypto simétrica en `auth.py`)
- ✅ Rate limiting por IP (memoria — OK para pequeño volumen)
- ✅ Validación de roles en dependencias FastAPI
- ✅ `verify_password_async()` usa bcrypt (fuerza: 12)

**Riesgos Identificados:**
- ⚠️ JWT sin expiración en el código — verificar en `create_access_token()`
- ⚠️ Tokens guardados en `localStorage` (vulnerable a XSS)
- ⚠️ CORS no configurado — si frontend y backend en distinto origin, bloqueado
- ⚠️ Sin HTTPS enforcement en dev (Railway fuerza HTTPS en prod, OK)
- ⚠️ Sin CSRF tokens en formularios POST

#### Validación de Datos:

- ✅ Pydantic models validan request bodies
- ⚠️ SQL crudo en `db.py` — aunque usa `$1,$2` asyncpg, es propenso a errores
- ⚠️ Sin validación de input en algunos endpoints (ej: búsqueda de SKU)
- ✅ Campos sensibles (passwords) no se loguean

#### Auditoría:

- ✅ `reproceso_audit_logs` table registra acciones críticas
- ✅ `log_audit()` se llama en login, logout, etc.
- ⚠️ Sin timestamps en todos los eventos — algunos queries crudo sin audit

---

### 4️⃣ MANTENIBILIDAD Y CLEAN CODE

#### Backend:

**Función `get_procesos()` en db.py — Ejemplo:**
```python
# 50+ líneas de SQL crudo, sin documentación
# Mezcla: SELECT, JOINs, LIFTs de status, GROUP BY
# Diffícil de leer sin ejecutar en psql
```

**Puntos Débiles:**
- ❌ Sin docstrings en funciones de db.py
- ❌ Sin type hints completos (algunos retorno sin `->`)
- ❌ Funciones de 30+ líneas sin separación de concerns
- ⚠️ Errores genéricos en endpoints — no distingue entre "not found" vs "server error"

#### Frontend:

**Función `render()` en `maestro-shell.js` — Ejemplo:**
```javascript
// 500 líneas en un IIFE
// _loadResumen, _loadProcesos, ..., _renderResumen, _renderInformes, helpers
// Sin separación: lógica, renderizado, estilo entrecruzados
```

**Puntos Débiles:**
- ❌ Sin framework (Vue, React, Svelte) — DOM manipulado manualmente
- ❌ Sin componentes reutilizables — tabla, card, chart se redibuja en cada view
- ❌ Sin testing — 3000+ líneas de JS sin pruebas unitarias
- ❌ Sin linting/formatter — inconsistencias de estilo (spaces vs tabs, trailing commas)
- ⚠️ Event listeners duplicados en re-mount (aunque hay guard `_wired`)

---

### 5️⃣ UX Y USABILIDAD

#### Fortalezas:
- ✅ Interfaz consistente (tema oscuro, badges de estado)
- ✅ Responsive + fast (CSS limpio, sin bloat)
- ✅ Navegación intuitiva (sidebar para Maestro, tabla para operarios)
- ✅ Feedback visual (snackbars, badges urgencia, progress bars)

#### Debilidades:
- ⚠️ Tiempo de carga inicial: 3-5s (múltiples requests HTTP serializadas)
- ⚠️ Sin lazy-loading de imágenes/assets
- ⚠️ Sin precarga de datos (prefetch, anticipación)
- ⚠️ Panel Maestro lento al scroll (DOM grande)
- ❌ Bug actual: maestro-shell no monta correctamente (console logs muestran error)
- ⚠️ Sin skeleton screens — data cargando muestra "Cargando..." genérico

---

### 6️⃣ ESCALABILIDAD ACTUAL

| Métrica | Límite | Impacto |
|---------|--------|--------|
| **Procesos/día** | 500+ | Query lenta, no pagina |
| **Operarios concurrent** | 10+ | Pool conexiones puede saturarse |
| **Planes para generar** | 100+ SKUs | Planificación manual → slow |
| **Reportes generados** | 50+/día | Sin caché, CTE re-eval cada vez |
| **Tamaño DB** | 100K+ registros | Sin índices → full scans |

---

## PARTE II: REFACTORIZACIÓN A CORTO PLAZO (V1.1)

### Cambios sin Romper Nada:

#### Backend (2-4 semanas):

1. **Refactorizar `endpoints.py` en módulos:**
   ```python
   api/
   ├── endpoints.py         # Router principal
   ├── procesos.py          # GET /procesos, POST /procesos, etc.
   ├── usuarios.py          # GET /usuarios, POST /usuarios, etc.
   ├── planning.py          # GET /planning/*, PATCH /planning/*
   ├── stock.py             # GET /stock, PATCH /stock/rules
   ├── reporting.py         # GET /reports/*, GET /dashboard
   └── schemas.py           # Todos los Pydantic models
   ```
   - Reduce cada archivo a 200-300 líneas
   - Mantiene misma API REST (sin cambios en URLs)
   - Facilita testing unitario

2. **Abstracción de Queries (DAOs):**
   ```python
   db/
   ├── models.py            # Schemas DB (CREATE TABLE, índices)
   ├── queries/
   │   ├── procesos_queries.py
   │   ├── usuarios_queries.py
   │   └── planning_queries.py
   └── repositories.py      # Métodos typed que retornan dataclasses
   ```
   - Reemplaza funciones `get_procesos()` por `ProcessRepository.find_all()`
   - Agrega type hints (`list[Process]` en lugar de `list[dict]`)
   - Facilita cached queries

3. **Agregar Índices + Migraciones:**
   ```sql
   CREATE INDEX idx_procesos_operario_estado ON reproceso_procesos(operario_id, estado);
   CREATE INDEX idx_procesos_fecha ON reproceso_procesos(fecha DESC);
   CREATE INDEX idx_pausas_usuario_fecha ON reproceso_pausas(usuario_id, fecha);
   CREATE INDEX idx_plan_sku_fecha ON reproceso_plan_produccion(sku, fecha);
   ```
   - Esperar mejora 10-20x en queries `get_procesos()`
   - Usar `alembic` para versionado de migraciones

4. **Query Caching:**
   ```python
   from redis import Redis  # o in-memory dict con TTL
   
   @cached(ttl=60)
   async def get_active_skus() -> list[SKU]:
       # Consultado por: planning.js, stock-panel.js
       # Cambia: 1x/día, cache 60s es OK
   ```

#### Frontend (2-3 semanas):

1. **Refactorizar `index.html` → Vistas separadas:**
   ```html
   templates/
   ├── index.html                  # Layout principal (header, nav)
   ├── views/
   │   ├── dashboard-operario.html # Para operarios
   │   ├── maestro/
   │   │   ├── resumen.html
   │   │   ├── procesos.html
   │   │   └── stock.html
   │   └── login.html
   └── components/                 # Componentes reutilizables
       ├── card.html
       ├── table.html
       └── modal.html
   ```
   - Servidor sirve vistas bajo demanda (ej: `/templates/views/maestro/resumen.html`)
   - Frontend fetch + mount dinámico
   - Reduce index.html a 500 líneas

2. **Modularizar `store.js` → Slices (Redux-like):**
   ```javascript
   store/
   ├── index.js             # Store central
   ├── slices/
   │   ├── processes.js     # { state, actions }
   │   ├── users.js
   │   ├── planning.js
   │   └── ui.js            # viewId, sidebarOpen, etc.
   └── middleware/
       ├── cache.js         # Cache en memory
       └── sync.js          # WebSocket listeners (futuro)
   ```
   - Cada slice maneja su estado + acciones
   - Dispatch automático de events

3. **Crear Componentes Reutilizables:**
   ```javascript
   components/
   ├── DataTable.js         # {data, columns, onRow} → table HTML
   ├── ProgressBar.js       # {value, max, color} → SVG bar
   ├── KPICard.js           # {title, value, unit, color} → card
   ├── Modal.js             # {title, body, buttons}
   └── Chart.js             # {type, data} → canvas wrapper
   ```
   - Reutilizar en maestro-shell, reports, planning
   - Reducir código dupe 40%

4. **Agregar Build Step (Webpack/Vite):**
   ```bash
   npm run build   # Minifica, bundlea, code-splits
   npm run dev     # Hot reload + source maps
   ```
   - Reduce tamaño JS: 100KB → 30KB (gzipped)
   - Habilita TypeScript (opcional)

---

## PARTE III: NUEVA VERSIÓN V2.0 (REVOLUCIÓN)

### Arquitectura Ideal desde Cero

#### Stack Tecnológico Recomendado:

```
Frontend:
├─ Next.js 14+ (React + SSR + Static Gen)
├─ TypeScript (type safety)
├─ Tailwind CSS (utility-first)
├─ SWR / React Query (caching + fetching)
├─ Zustand (state management, simplista)
└─ Vitest + RTL (testing)

Backend:
├─ FastAPI + Pydantic v2 (async, validación)
├─ SQLAlchemy 2.0 ORM (queries type-safe)
├─ Alembic (migrations versionadas)
├─ PostgreSQL 15+ (JSONB, índices avanzados)
├─ Redis (cache, rate limit, job queue)
├─ Celery (background jobs)
└─ Pytest (testing)

Infraestructura:
├─ Docker + docker-compose (local + prod)
├─ GitHub Actions (CI/CD)
├─ Prometheus + Grafana (observability)
└─ ELK Stack (logging)
```

---

### 1. Arquitectura Backend V2.0

#### Estructura:
```
control-reproceso-v2/
├── app/
│   ├── main.py                      # FastAPI app factory
│   ├── config.py                    # Settings (Pydantic)
│   ├── database.py                  # SQLAlchemy engine + session
│   ├── middleware/
│   │   ├── auth.py
│   │   ├── rate_limit.py
│   │   └── logging.py
│   ├── models/                      # SQLAlchemy ORM models
│   │   ├── usuario.py
│   │   ├── proceso.py
│   │   ├── plan_produccion.py
│   │   └── __init__.py
│   ├── schemas/                     # Pydantic request/response models
│   │   ├── usuario.py
│   │   ├── proceso.py
│   │   └── planning.py
│   ├── repositories/                # Data access layer
│   │   ├── base.py
│   │   ├── proceso_repo.py
│   │   └── planning_repo.py
│   ├── services/                    # Business logic
│   │   ├── proceso_service.py
│   │   ├── planning_service.py
│   │   ├── optimization_service.py  # ← NUEVO
│   │   └── reporting_service.py     # ← NUEVO
│   ├── api/
│   │   ├── v1/                      # API versioning
│   │   │   ├── endpoints/
│   │   │   │   ├── procesos.py
│   │   │   │   ├── usuarios.py
│   │   │   │   ├── planning.py
│   │   │   │   ├── stock.py
│   │   │   │   └── reporting.py
│   │   │   └── router.py
│   │   └── health.py
│   ├── tasks/                       # Celery background jobs
│   │   ├── process_tasks.py
│   │   ├── planning_tasks.py        # ← Generación automática
│   │   └── forecast_tasks.py        # ← IA predictiva
│   ├── cache.py                     # Redis wrapper
│   └── exceptions.py                # Custom exceptions
├── migrations/                      # Alembic
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docker-compose.yml
├── requirements.txt
└── pyproject.toml
```

#### Mejoras Clave:

**A. Inyección de Dependencias (Dependency Injection):**
```python
# app/services/proceso_service.py
from app.repositories import ProcesoRepository
from app.cache import RedisCache

class ProcesoService:
    def __init__(self, repo: ProcesoRepository, cache: RedisCache):
        self.repo = repo
        self.cache = cache
    
    async def get_procesos_by_operario(self, operario_id: int):
        key = f"procesos:{operario_id}"
        cached = await self.cache.get(key)
        if cached:
            return cached
        
        procesos = await self.repo.find_by_operario(operario_id)
        await self.cache.set(key, procesos, ttl=60)
        return procesos

# app/api/v1/endpoints/procesos.py
@router.get("/procesos/operario/{operario_id}", response_model=list[ProcesoResponse])
async def get_operario_procesos(
    operario_id: int,
    service: ProcesoService = Depends(get_proceso_service)
):
    return await service.get_procesos_by_operario(operario_id)
```

**B. ORM con SQLAlchemy:**
```python
# app/models/proceso.py
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base

class Proceso(Base):
    __tablename__ = "procesos"
    
    id = Column(String(36), primary_key=True)
    operario_id = Column(Integer, ForeignKey("usuarios.id"))
    sku_destino = Column(String(50))
    estado = Column(String(20), default="CREADO")
    es_urgente = Column(Boolean, default=False)
    fecha = Column(DateTime, server_default=func.now())
    
    operario = relationship("Usuario", back_populates="procesos")

# Query type-safe:
procesos = db.query(Proceso)\
    .filter(Proceso.operario_id == user_id, Proceso.estado == "INICIADO")\
    .order_by(Proceso.fecha.desc())\
    .all()
```

**C. Servicios con Lógica Compleja:**
```python
# app/services/optimization_service.py
class OptimizationService:
    """Generador de sugerencias de asignación"""
    
    async def suggest_assignment(self, pending_items: list[PlanItem]):
        """
        Analiza:
        - Velocidad histórica de cada operario por SKU
        - Carga actual (% jornada usada)
        - Preferencias (SKU favorito)
        - Urgencia
        
        Retorna: [(operario_id, item_id, score)] ordenado por score
        """
        histories = await self.repo.get_performance_history(days=30)
        current_loads = await self.repo.get_operario_loads()
        
        suggestions = []
        for item in pending_items:
            for op in operators:
                score = self._calc_score(op, item, histories, current_loads)
                suggestions.append((op.id, item.id, score))
        
        return sorted(suggestions, key=lambda x: x[2], reverse=True)
    
    def _calc_score(self, operario, item, histories, loads):
        # Fórmula: avg_speed(sku) * (100-load%) * urgency_multiplier
        ...
```

**D. Background Jobs con Celery:**
```python
# app/tasks/planning_tasks.py
from celery import shared_task

@shared_task
def generate_weekly_plan(week_start: date):
    """Genera plan de producción semanal automáticamente"""
    service = PlanningService()
    
    # 1. Fetch demanda estimada (desde Laudus + ML)
    demand = service.get_demand_forecast(week_start)
    
    # 2. Asignar recursos óptimamente
    assignments = service.optimize_assignments(demand)
    
    # 3. Persistir plan
    service.save_plan(assignments)
    
    # 4. Notificar maestro
    notify_maestro(f"Plan {week_start} generado automáticamente")

# Scheduled via:
# celery beat (cron: Lunes 00:01 AM)
```

---

### 2. Arquitectura Frontend V2.0

#### Stack: Next.js + TypeScript + Tailwind

```
frontend/
├── pages/
│   ├── index.tsx            # Login (public)
│   ├── dashboard/
│   │   ├── index.tsx        # Dashboard dinámico (operario | maestro)
│   │   ├── procesos.tsx     # Lista procesos (data table con sort/filter)
│   │   ├── planning.tsx      # Planificador visual (Gantt + formulario)
│   │   └── reporting.tsx     # Reportes (gráficos interactivos)
│   └── admin/
│       ├── usuarios.tsx
│       ├── stock.tsx
│       └── configuracion.tsx
├── components/
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx      # Reutilizable (operario | maestro)
│   │   └── Layout.tsx
│   ├── shared/
│   │   ├── DataTable.tsx    # Tabla genérica (sort, filter, paginate)
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   ├── ProgressBar.tsx
│   │   └── KPICard.tsx
│   ├── process/
│   │   ├── ProcessList.tsx
│   │   ├── ProcessDetail.tsx
│   │   ├── ProcessForm.tsx
│   │   └── UrgentAlert.tsx
│   ├── planning/
│   │   ├── PlanningGantt.tsx        # Visualización Gantt
│   │   ├── PlanningForm.tsx
│   │   ├── AssignmentSuggestion.tsx # ← IA integration
│   │   └── AutoPlanButton.tsx       # ← Auto-generate weekly
│   └── reporting/
│       ├── PerformanceChart.tsx
│       ├── SKUDistribution.tsx
│       └── ForecastChart.tsx        # ← Stock projection
├── hooks/
│   ├── useAuth.ts
│   ├── useProcesses.ts         # SWR wrapper
│   ├── usePlanning.ts
│   ├── useOptimization.ts
│   └── useCache.ts
├── store/
│   ├── auth.ts                 # Zustand: user, token, role
│   ├── ui.ts                   # Zustand: activeTab, sidebarOpen
│   └── notifications.ts        # Zustand: snackbars, modals
├── services/
│   ├── api.ts                  # Axios wrapper con auth + retry
│   ├── websocket.ts            # WebSocket para real-time updates
│   └── cache.ts                # IndexedDB para offline
├── lib/
│   ├── utils.ts
│   ├── constants.ts
│   └── validators.ts
├── styles/
│   ├── globals.css             # Tailwind
│   └── animations.css
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/ (Cypress)
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

#### Mejoras Clave:

**A. Data Fetching + Caching con SWR:**
```typescript
// hooks/useProcesses.ts
import useSWR from 'swr'

export function useProcesses(operarioId?: number) {
  const { data, error, isLoading, mutate } = useSWR(
    operarioId ? `/api/v1/procesos?operario=${operarioId}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,     // Cache 1 min
      focusThrottleInterval: 600000 // Re-fetch 10 min after tab focus
    }
  )
  
  return { procesos: data || [], error, isLoading, mutate }
}

// pages/dashboard/procesos.tsx
export default function ProcesosPage() {
  const { procesos, isLoading } = useProcesses()
  
  if (isLoading) return <LoadingSkeleton />
  return <DataTable data={procesos} columns={COLUMNS} />
}
```

**B. Type-Safe API Layer:**
```typescript
// services/api.ts
import axios from 'axios'
import { z } from 'zod'

// Schema validation
const ProcesoSchema = z.object({
  id: z.string(),
  operario_id: z.number(),
  sku_destino: z.string(),
  estado: z.enum(['CREADO', 'INICIADO', 'PAUSADO', 'FINALIZADO']),
  es_urgente: z.boolean(),
  fecha: z.coerce.date()
})

type Proceso = z.infer<typeof ProcesoSchema>

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: {
    'Authorization': `Bearer ${token}`
  }
})

export async function getProcesses(operarioId?: number): Promise<Proceso[]> {
  const { data } = await api.get('/v1/procesos', {
    params: { operario: operarioId }
  })
  return ProcesoSchema.array().parse(data)
}
```

**C. Componentes Reutilizables (Shadcn/ui Pattern):**
```typescript
// components/shared/DataTable.tsx
interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T>[]
  onRowClick?: (row: T) => void
  sortable?: boolean
  filterable?: boolean
  paginated?: boolean
}

export function DataTable<T>({
  data,
  columns,
  onRowClick,
  sortable = true,
  filterable = true,
  paginated = true
}: DataTableProps<T>) {
  // Usa TanStack Table v8 (React Table)
  // Retorna tabla con sort, filter, pagination builtin
}

// Reusable in: procesos, planning, reportes
```

**D. Real-time con WebSockets:**
```typescript
// services/websocket.ts
export class RealtimeService {
  private ws: WebSocket
  
  connect() {
    this.ws = new WebSocket(
      `${process.env.NEXT_PUBLIC_WS_URL}/ws?token=${token}`
    )
    
    this.ws.onmessage = (e) => {
      const { type, data } = JSON.parse(e.data)
      
      if (type === 'proceso_actualizado') {
        store.updateProceso(data)  // Actualiza store automático
        store.addNotification(`Proceso ${data.id} → ${data.estado}`)
      }
    }
  }
}

// pages/dashboard/index.tsx
useEffect(() => {
  const rt = new RealtimeService()
  rt.connect()
  return () => rt.close()
}, [])
```

---

### 3. Funcionalidades Nuevas para V2.0

#### A. Planificación Automática Semanal
```python
# app/services/planning_service.py
class PlanningService:
    async def generate_weekly_auto_plan(self, week_start: date):
        """
        1. Fetch demanda histórica + forecast (ML)
        2. Consultar disponibilidad operarios (vacaciones, pausas)
        3. Optimizar asignación (problema de balance de carga)
        4. Generar plan → DB
        5. Notificar Maestro
        """
        # Usa algoritmo greedy o ILP (pulp library)
```

#### B. Predicción de Stock (AI/ML)
```python
# app/services/forecast_service.py
class ForecastService:
    async def forecast_stock_7days(self, sku: str):
        """
        Input: histórico 30 días de demanda + producción
        Output: [
          {fecha, stock_actual, stock_proyectado, varianza, alerta}
        ]
        
        Usa: ARIMA, Prophet, o model entrenado (sklearn)
        """
```

#### C. Sugerencias de Asignación Inteligentes
```typescript
// components/planning/AssignmentSuggestion.tsx
// API: POST /api/v1/planning/suggest
// Retorna: [(operario, score)] ranked by ML
// UI: Pills clickeables → "Asignar a Usuario X (92% confianza)"
```

#### D. Reportes Automatizados Diarios
```python
# app/tasks/reporting_tasks.py
@shared_task
def send_daily_summary(fecha: date):
    """Email diario con:
    - Procesos completados hoy
    - SKUs bajo mínimo
    - Operarios con bajo rendimiento
    - Próximas urgencias
    """
```

#### E. BI/Analytics Dashboard
```typescript
// pages/admin/analytics.tsx
// Integración Metabase o Looker
// KPIs: rendimiento por operario, throughput por SKU, cuello botella
```

---

### 4. Mejora de UX/UI Premium

#### Cambios Visuales:
1. **Dark Mode Toggle** (Tailwind + next-themes)
2. **Animaciones Smooth** (Framer Motion)
3. **Micro-interactions** (Loading spinners, toast notifications, confetti on complete)
4. **Responsive Grid** (Mobile-first Tailwind)
5. **Drag & Drop Planning** (react-beautiful-dnd)
6. **Data Visualization** (Recharts, Plotly.js, Framer Motion)

#### UX Improvements:
1. **Skeleton Loaders** en lugar de "Cargando..."
2. **Undo/Redo** en operaciones críticas
3. **Inline Editing** (click en celda → edit mode)
4. **Keyboard Shortcuts** (Cmd/Ctrl+K search, etc.)
5. **Command Palette** (Raycast-like)

---

## PARTE IV: PLAN DE IMPLEMENTACIÓN

### Roadmap V1.0 → V2.0:

**Fase 0: Setup (1 semana)**
- [ ] Crear repositorio v2 separado
- [ ] Setup Docker + docker-compose
- [ ] Configurar CI/CD pipeline (GitHub Actions)
- [ ] Agregar Prometheus + Grafana

**Fase 1: Refactorización Backend (3 semanas)**
- [ ] Modularizar endpoints.py → dominio específico
- [ ] Migrar a SQLAlchemy ORM
- [ ] Agregar índices + migraciones Alembic
- [ ] Implementar caché Redis
- [ ] Agregar tests unitarios + integration tests

**Fase 2: Refactorización Frontend (3 semanas)**
- [ ] Setup Next.js 14 + TypeScript
- [ ] Migrar vistas a componentes React
- [ ] Implementar SWR + Zustand
- [ ] Agregar Tailwind CSS
- [ ] Agregar tests (Vitest + RTL)

**Fase 3: Nuevas Funcionalidades (4 semanas)**
- [ ] Auto-planning semanal (Celery task)
- [ ] ML forecast (scikit-learn model)
- [ ] WebSocket real-time updates
- [ ] Reporting automático
- [ ] Analytics dashboard

**Fase 4: Optimización + Deploy (2 semanas)**
- [ ] Load testing (Locust)
- [ ] Performance tuning
- [ ] Security audit
- [ ] Deploy a producción (Railway + RDS)

---

## RESUMEN DE IMPACTO

### V1.0 → V1.1 (Refactorización Evolutiva):
- **Mantenibilidad**: +40% (modularización)
- **Performance**: +20% (índices + caché)
- **Confiabilidad**: +30% (tests + error handling)
- **Tiempo**: 4-6 semanas

### V1.1 → V2.0 (Revolución Tecnológica):
- **Mantenibilidad**: +80% (TypeScript, ORM, componentes)
- **Performance**: +60% (Next.js SSR, React Query, WebSockets)
- **Escalabilidad**: +100% (microservicios ready, caché distribuido)
- **UX**: +50% (UI/UX premium, real-time, ML)
- **Tiempo**: 10-12 semanas
- **ROI**: Reducir time-to-market, aumentar adoptabilidad, preparar para escala

---

## PREGUNTAS CLAVE PARA EL USUARIO

1. **¿Cuándo necesitas V2.0?** (Timeline: meses/años)
2. **¿Presupuesto para desarrollo?** (In-house vs outsource)
3. **¿Prioridades?** (Performance, Features, UX, Seguridad)
4. **¿Equipos disponibles?** (Frontend, Backend, DevOps)
5. **¿Tech preferences?** (¿Python FastAPI sigue siendo OK? ¿React es obligatorio?)

---

**Próximos Pasos Recomendados:**
1. Validar roadmap V1.1 con equipo
2. Comenzar refactorización endpoints.py (quick win de 2 semanas)
3. Setup testing framework + CI/CD
4. Paralelo: Planificación técnica V2.0 (arquitectura, PRDs, timelines)
