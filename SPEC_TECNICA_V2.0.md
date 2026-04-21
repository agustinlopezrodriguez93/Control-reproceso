# Especificación Técnica V2.0
## Control Reproceso — Nueva Arquitectura Moderna

---

## 1. STACK TECNOLÓGICO

### Backend
- **FastAPI 0.100+** (async, validación automática, auto-docs OpenAPI)
- **SQLAlchemy 2.0** (ORM type-safe con Core + asyncpg)
- **Alembic** (versionado de migraciones)
- **PostgreSQL 15+** (JSONB, índices avanzados, full-text search)
- **Redis 7+** (cache, sessions, pub/sub para real-time)
- **Celery 5.3+** (async tasks, scheduler)
- **RabbitMQ o Redis** (message broker para Celery)
- **Pytest + pytest-asyncio** (testing)
- **Pydantic 2.0** (validation)
- **Python-jose** (JWT)

### Frontend
- **Next.js 14+** (React, SSR, Static Gen, built-in API routes)
- **TypeScript 5.x** (type safety)
- **Tailwind CSS 3.x** (styling)
- **React Query / SWR** (data fetching + caching)
- **Zustand** (state management)
- **TanStack Table v8** (data tables)
- **Recharts / Plotly** (charting)
- **Framer Motion** (animations)
- **Socket.io** (WebSockets for real-time)
- **Vitest + React Testing Library** (testing)
- **ESLint + Prettier** (linting + formatting)

### Infraestructura & DevOps
- **Docker + docker-compose** (local + prod)
- **GitHub Actions** (CI/CD pipeline)
- **Prometheus + Grafana** (monitoring)
- **ELK Stack** (logging: Elasticsearch + Logstash + Kibana)
- **Railway / AWS ECS** (deployment)
- **AWS RDS** (managed PostgreSQL)
- **AWS ElastiCache** (managed Redis)

---

## 2. ARQUITECTURA BACKEND

### 2.1 Estructura de Directorios

```
control-reproceso-v2/
├── app/
│   ├── __init__.py
│   ├── main.py                  # FastAPI app factory
│   ├── config.py                # Pydantic Settings
│   │
│   ├── core/
│   │   ├── security.py          # JWT, password hashing
│   │   ├── exceptions.py        # Custom exceptions
│   │   └── constants.py         # Enums, constants
│   │
│   ├── middleware/
│   │   ├── auth.py
│   │   ├── rate_limit.py
│   │   ├── logging.py
│   │   └── error_handler.py
│   │
│   ├── models/                  # SQLAlchemy ORM
│   │   ├── __init__.py
│   │   ├── base.py              # Declarative base
│   │   ├── usuario.py
│   │   ├── proceso.py
│   │   ├── plan_produccion.py
│   │   ├── pausa.py
│   │   ├── product_time.py
│   │   └── audit_log.py
│   │
│   ├── schemas/                 # Pydantic request/response
│   │   ├── __init__.py
│   │   ├── usuario.py
│   │   ├── proceso.py
│   │   └── planning.py
│   │
│   ├── repositories/            # Data access layer (CRUD)
│   │   ├── base.py              # BaseRepository genérico
│   │   ├── usuario_repo.py
│   │   ├── proceso_repo.py
│   │   ├── planning_repo.py
│   │   └── __init__.py
│   │
│   ├── services/                # Business logic
│   │   ├── usuario_service.py
│   │   ├── proceso_service.py
│   │   ├── planning_service.py
│   │   ├── optimization_service.py    # ← IA/ML
│   │   ├── forecast_service.py        # ← Stock projection
│   │   ├── reporting_service.py
│   │   └── __init__.py
│   │
│   ├── api/
│   │   ├── v1/
│   │   │   ├── endpoints/
│   │   │   │   ├── usuarios.py       # CRUD usuarios
│   │   │   │   ├── procesos.py       # CRUD procesos
│   │   │   │   ├── planning.py       # Planning endpoints
│   │   │   │   ├── stock.py          # Stock rules
│   │   │   │   ├── reporting.py      # Reports + dashboard
│   │   │   │   ├── optimization.py   # ← Sugerencias asignación
│   │   │   │   └── auth.py
│   │   │   └── router.py
│   │   ├── v2/  (futuro)
│   │   └── health.py            # Health check endpoint
│   │
│   ├── tasks/                   # Celery background jobs
│   │   ├── __init__.py
│   │   ├── process_tasks.py     # Procesos async
│   │   ├── planning_tasks.py    # Auto-planning semanal
│   │   ├── forecast_tasks.py    # Stock forecasting (ML)
│   │   └── notification_tasks.py # Email/SMS
│   │
│   ├── cache/
│   │   ├── base.py              # Cache interface
│   │   ├── redis_cache.py       # Redis implementation
│   │   ├── memory_cache.py      # In-memory fallback
│   │   └── decorators.py        # @cached decorator
│   │
│   ├── database.py              # DB connection factory
│   ├── events.py                # Startup/shutdown events
│   └── dependencies.py          # FastAPI Depends factories
│
├── migrations/                  # Alembic versions
│   ├── versions/
│   │   ├── 001_initial_schema.py
│   │   ├── 002_add_indexes.py
│   │   └── 003_add_forecast_table.py
│   ├── env.py
│   └── script.py.mako
│
├── tests/
│   ├── conftest.py              # Pytest fixtures
│   ├── unit/
│   │   ├── test_usuario_repo.py
│   │   ├── test_proceso_service.py
│   │   └── test_optimization_service.py
│   ├── integration/
│   │   ├── test_procesos_endpoint.py
│   │   └── test_planning_workflow.py
│   └── e2e/
│       ├── test_crear_y_finalizar_proceso.py
│       └── test_planning_completo.py
│
├── scripts/
│   ├── seed_db.py               # Seed de datos de prueba
│   ├── migrate.py               # Script migraciones manual
│   └── export_data.py           # Export para análisis
│
├── docker-compose.yml           # Local dev stack
├── Dockerfile
├── requirements.txt
├── pyproject.toml               # Poetry / pip-tools
├── pytest.ini
├── .env.example
└── README.md
```

### 2.2 Modelos SQLAlchemy (ORM)

```python
# app/models/usuario.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.orm import relationship
from app.models.base import Base
from datetime import datetime

class Usuario(Base):
    __tablename__ = "usuarios"
    
    id = Column(Integer, primary_key=True)
    nombre = Column(String(100), unique=True, index=True, nullable=False)
    rol = Column(String(20), default="Operario", nullable=False)
    password_hash = Column(String(255))
    avatar = Column(String(500), default="")
    activo = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    procesos = relationship("Proceso", back_populates="operario", cascade="all, delete-orphan")
    pausas = relationship("Pausa", back_populates="usuario", cascade="all, delete-orphan")
    logs = relationship("AuditLog", back_populates="usuario")
    
    __table_args__ = (
        Index('idx_usuarios_nombre', 'nombre'),
    )

# app/models/proceso.py
class Proceso(Base):
    __tablename__ = "procesos"
    
    id = Column(String(36), primary_key=True, default=uuid4)
    operario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    sku_destino = Column(String(50), index=True, nullable=False)
    estado = Column(String(20), default="CREADO", index=True)
    es_urgente = Column(Boolean, default=False)
    stock_inicial = Column(Integer, default=0)
    stock_final = Column(Integer, nullable=True)
    
    tiempo_inicio = Column(DateTime, nullable=True)
    tiempo_pausa = Column(DateTime, nullable=True)
    tiempo_reanudacion = Column(DateTime, nullable=True)
    tiempo_finalizacion = Column(DateTime, nullable=True)
    
    fecha = Column(DateTime, default=datetime.utcnow, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    operario = relationship("Usuario", back_populates="procesos")
    
    __table_args__ = (
        Index('idx_procesos_operario_estado', 'operario_id', 'estado'),
        Index('idx_procesos_fecha', 'fecha'),
    )

# app/models/plan_produccion.py
class PlanProduccion(Base):
    __tablename__ = "plan_produccion"
    
    id = Column(Integer, primary_key=True)
    sku = Column(String(50), index=True, nullable=False)
    fecha = Column(Date, index=True, nullable=False)
    cajas_plan = Column(Integer, nullable=False)
    cajas_real = Column(Integer, nullable=True)
    minutos_plan = Column(Float, nullable=True)
    estado = Column(String(20), default="PENDIENTE")
    
    # Asignación a operarios
    asignaciones = relationship("AsignacionPlan", back_populates="plan")
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint('sku', 'fecha', name='uq_plan_sku_fecha'),
        Index('idx_plan_estado', 'estado'),
    )
```

### 2.3 Repositories (Data Access Layer)

```python
# app/repositories/base.py
from typing import TypeVar, Generic, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

T = TypeVar('T')

class BaseRepository(Generic[T]):
    def __init__(self, session: AsyncSession, model_class: type[T]):
        self.session = session
        self.model_class = model_class
    
    async def find_all(self) -> List[T]:
        stmt = select(self.model_class)
        result = await self.session.execute(stmt)
        return result.scalars().all()
    
    async def find_by_id(self, id) -> Optional[T]:
        stmt = select(self.model_class).where(self.model_class.id == id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
    
    async def create(self, obj_in: dict) -> T:
        obj = self.model_class(**obj_in)
        self.session.add(obj)
        await self.session.flush()
        return obj
    
    async def update(self, id, obj_in: dict) -> T:
        obj = await self.find_by_id(id)
        for key, value in obj_in.items():
            setattr(obj, key, value)
        await self.session.flush()
        return obj
    
    async def delete(self, id) -> None:
        obj = await self.find_by_id(id)
        await self.session.delete(obj)
        await self.session.flush()

# app/repositories/proceso_repo.py
class ProcesoRepository(BaseRepository[Proceso]):
    async def find_by_operario(self, operario_id: int) -> List[Proceso]:
        stmt = select(Proceso)\
            .where(Proceso.operario_id == operario_id)\
            .order_by(Proceso.fecha.desc())
        result = await self.session.execute(stmt)
        return result.scalars().all()
    
    async def find_activos(self) -> List[Proceso]:
        stmt = select(Proceso)\
            .where(Proceso.estado.in_(['CREADO', 'INICIADO', 'PAUSADO']))\
            .order_by(Proceso.fecha.desc())
        result = await self.session.execute(stmt)
        return result.scalars().all()
    
    async def find_urgentes(self) -> List[Proceso]:
        stmt = select(Proceso)\
            .where(Proceso.es_urgente == True)\
            .order_by(Proceso.fecha.desc())
        result = await self.session.execute(stmt)
        return result.scalars().all()
```

### 2.4 Services (Business Logic)

```python
# app/services/proceso_service.py
from app.repositories import ProcesoRepository
from app.cache import CacheManager
from app.core.exceptions import ValidationError

class ProcesoService:
    def __init__(self, repo: ProcesoRepository, cache: CacheManager):
        self.repo = repo
        self.cache = cache
    
    async def get_procesos_activos(self) -> List[dict]:
        """
        Get procesos activos con caché automático (TTL: 30s)
        """
        cache_key = "procesos:activos"
        cached = await self.cache.get(cache_key)
        if cached:
            return cached
        
        procesos = await self.repo.find_activos()
        data = [p.to_dict() for p in procesos]
        
        await self.cache.set(cache_key, data, ttl=30)
        return data
    
    async def crear_proceso(self, operario_id: int, sku: str, es_urgente: bool = False) -> str:
        """
        Crear proceso con validaciones:
        - Operario existe
        - SKU existe y está activo
        - Stock disponible
        """
        # Validar operario
        operario = await self.repo.session.get(Usuario, operario_id)
        if not operario:
            raise ValidationError("Operario no existe")
        
        # Validar SKU (consultar Laudus o tabla local)
        # ... validaciones
        
        # Crear
        proc = Proceso(
            operario_id=operario_id,
            sku_destino=sku,
            es_urgente=es_urgente,
        )
        self.repo.session.add(proc)
        await self.repo.session.flush()
        
        # Invalidar caché
        await self.cache.invalidate("procesos:*")
        
        # Audit
        await self._log_audit("PROCESO_CREADO", proc.id, operario_id)
        
        # Notificar maestro si urgente
        if es_urgente:
            await self._notify_maestro_urgencia(proc.id)
        
        return proc.id
    
    async def finalizar_proceso(self, proceso_id: str, stock_final: int) -> None:
        """Finalizar proceso + calcular métricas"""
        proc = await self.repo.find_by_id(proceso_id)
        if not proc:
            raise ValidationError("Proceso no existe")
        
        proc.estado = "FINALIZADO"
        proc.stock_final = stock_final
        proc.tiempo_finalizacion = datetime.utcnow()
        
        await self.repo.session.flush()
        await self.cache.invalidate("procesos:*")
        
        # Trigger: calcular rendimiento operario
        await self._update_operario_metrics(proc.operario_id)
```

### 2.5 API Endpoints (v1)

```python
# app/api/v1/endpoints/procesos.py
from fastapi import APIRouter, Depends, HTTPException, status
from app.services import ProcesoService
from app.schemas import ProcesoCreate, ProcesoResponse
from app.core.security import get_current_user

router = APIRouter(prefix="/procesos", tags=["procesos"])

def get_proceso_service(
    session = Depends(get_db_session),
    cache = Depends(get_cache)
) -> ProcesoService:
    return ProcesoService(
        ProcesoRepository(session, Proceso),
        cache
    )

@router.get("", response_model=List[ProcesoResponse])
async def get_procesos(
    operario_id: Optional[int] = None,
    user = Depends(get_current_user),
    service = Depends(get_proceso_service)
):
    """
    GET /api/v1/procesos
    - Si Maestro: todos los procesos
    - Si Operario: solo sus procesos
    """
    if user.rol == "Maestro":
        procesos = await service.get_procesos_activos()
    else:
        procesos = await service.get_procesos_by_operario(user.id)
    
    return procesos

@router.post("", response_model=ProcesoResponse, status_code=status.HTTP_201_CREATED)
async def create_proceso(
    req: ProcesoCreate,
    user = Depends(get_current_user),
    service = Depends(get_proceso_service)
):
    """
    POST /api/v1/procesos
    Crear nuevo proceso (solo Maestro)
    """
    if user.rol != "Maestro":
        raise HTTPException(status_code=403, detail="Solo Maestro puede crear procesos")
    
    try:
        proc_id = await service.crear_proceso(
            operario_id=req.operario_id,
            sku=req.sku_destino,
            es_urgente=req.es_urgente
        )
        return await service.get_proceso_by_id(proc_id)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.patch("/{proceso_id}/accion", status_code=status.HTTP_204_NO_CONTENT)
async def realizar_accion(
    proceso_id: str,
    accion: str,  # start, pause, resume, finish
    user = Depends(get_current_user),
    service = Depends(get_proceso_service)
):
    """
    PATCH /api/v1/procesos/{id}/accion
    Realizar acción en proceso (start, pause, resume, finish)
    """
    if accion not in ("start", "pause", "resume", "finish"):
        raise HTTPException(status_code=400, detail="Acción inválida")
    
    try:
        await service.realizar_accion(proceso_id, accion, user.id)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

# app/api/v1/endpoints/optimization.py (← NUEVO)
@router.get("/suggest-assignment", response_model=List[AssignmentSuggestion])
async def suggest_assignment(
    pending_items: int = 10,
    user = Depends(get_current_user),
    service = Depends(get_optimization_service)
):
    """
    GET /api/v1/optimization/suggest-assignment?pending_items=10
    Retorna sugerencias de asignación (ML-powered)
    
    Response: [
      {proceso_id, operario_id, operario_nombre, score, razon}
    ]
    """
    suggestions = await service.suggest_assignment(pending_items)
    return suggestions
```

### 2.6 Background Tasks (Celery)

```python
# app/tasks/planning_tasks.py
from celery import shared_task
from app.services import PlanningService

@shared_task
def generate_weekly_auto_plan(week_start_str: str):
    """
    Generar plan semanal automáticamente (Lunes 00:01 AM).
    
    1. Fetch demanda estimada (histórica + Laudus)
    2. Fetch disponibilidad operarios
    3. Optimizar asignación
    4. Persistir plan
    5. Notificar maestro
    """
    logger.info(f"[Task] Generando plan para semana {week_start_str}")
    
    try:
        service = PlanningService()
        week_start = datetime.fromisoformat(week_start_str).date()
        
        # 1. Demanda
        demand = service.estimate_weekly_demand(week_start)
        
        # 2. Disponibilidad
        availability = service.get_operario_availability(week_start)
        
        # 3. Optimización (usa ILP o greedy)
        assignments = service.optimize_assignments(demand, availability)
        
        # 4. Persistir
        plan_id = service.save_plan(assignments)
        
        # 5. Notificar
        notify_maestro(f"✅ Plan {week_start} generado automáticamente")
        
        logger.info(f"[Task] Plan generado exitosamente: {plan_id}")
        return {"plan_id": plan_id, "status": "success"}
        
    except Exception as e:
        logger.error(f"[Task] Error generando plan: {e}", exc_info=True)
        notify_maestro(f"❌ Error generando plan: {str(e)}", priority="high")
        raise

# Scheduler (celery beat)
# beat_schedule = {
#     'generate-weekly-plan': {
#         'task': 'app.tasks.planning_tasks.generate_weekly_auto_plan',
#         'schedule': crontab(hour=0, minute=1, day_of_week=1),  # Lunes 00:01
#         'args': (datetime.now().isoformat(),)
#     },
#     'update-stock-forecast': {
#         'task': 'app.tasks.forecast_tasks.update_stock_forecast',
#         'schedule': crontab(hour=6, minute=0),  # Diario 6 AM
#     }
# }
```

---

## 3. ARQUITECTURA FRONTEND (Next.js)

### 3.1 Estructura de Directorios

```
frontend/
├── pages/
│   ├── _app.tsx              # App wrapper + providers
│   ├── _document.tsx         # Next.js document
│   ├── index.tsx             # Login page (public)
│   │
│   ├── dashboard/
│   │   ├── index.tsx         # Dashboard home (role-based)
│   │   ├── procesos/
│   │   │   ├── index.tsx     # Lista procesos (DataTable)
│   │   │   ├── [id].tsx      # Detalle proceso
│   │   │   └── nuevo.tsx     # Crear proceso (solo Maestro)
│   │   ├── planning/
│   │   │   ├── index.tsx     # Vista planificación (Gantt)
│   │   │   └── semanal.tsx   # Planeamiento semanal
│   │   ├── stock/
│   │   │   ├── index.tsx     # Panel stock
│   │   │   ├── reglas.tsx    # Stock rules editor
│   │   │   └── proyeccion.tsx # Forecast 7 días
│   │   ├── reportes/
│   │   │   ├── index.tsx     # Dashboard reportes
│   │   │   ├── diario.tsx    # Daily report
│   │   │   ├── rendimiento.tsx # Performance metrics
│   │   │   └── analytics.tsx # BI/Analytics (Metabase)
│   │   │
│   │   └── admin/ (solo Maestro)
│   │       ├── usuarios.tsx
│   │       ├── configuracion.tsx
│   │       └── auditoria.tsx
│   │
│   └── api/
│       ├── auth/[...nextauth].ts  # NextAuth endpoints
│       └── trpc/[trpc].ts         # tRPC endpoints
│
├── components/
│   ├── layout/
│   │   ├── Header.tsx        # Header principal
│   │   ├── Sidebar.tsx       # Sidebar (Maestro | Operario)
│   │   ├── Layout.tsx        # Layout wrapper
│   │   └── MobileNav.tsx     # Mobile navigation
│   │
│   ├── shared/
│   │   ├── DataTable.tsx     # Tabla genérica (TanStack Table)
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Badge.tsx
│   │   ├── KPICard.tsx       # KPI display
│   │   ├── ProgressBar.tsx
│   │   ├── Alert.tsx
│   │   ├── Skeleton.tsx      # Loading skeleton
│   │   ├── Toast.tsx         # Toast notifications
│   │   └── CommandPalette.tsx # Ctrl+K search
│   │
│   ├── process/
│   │   ├── ProcessList.tsx
│   │   ├── ProcessCard.tsx
│   │   ├── ProcessDetail.tsx
│   │   ├── ProcessForm.tsx
│   │   ├── UrgentBadge.tsx
│   │   └── StateTransition.tsx
│   │
│   ├── planning/
│   │   ├── PlanningView.tsx      # Container
│   │   ├── GanttChart.tsx        # Gantt visualization
│   │   ├── PlanForm.tsx          # Create/edit plan
│   │   ├── AssignmentSuggestion.tsx # ML suggestions
│   │   ├── AutoPlanButton.tsx    # Trigger auto-plan
│   │   └── BulkAssign.tsx        # Asignar múltiples
│   │
│   ├── stock/
│   │   ├── StockPanel.tsx
│   │   ├── StockRules.tsx
│   │   ├── ForecastChart.tsx
│   │   └── StockAlert.tsx
│   │
│   └── reporting/
│       ├── PerformanceChart.tsx
│       ├── SKUDistribution.tsx
│       ├── TrendChart.tsx
│       └── ExportButton.tsx
│
├── hooks/
│   ├── useAuth.ts            # Auth context + logic
│   ├── useProcesses.ts       # SWR wrapper
│   ├── usePlanning.ts
│   ├── useOptimization.ts
│   ├── useStockForecast.ts
│   ├── useCache.ts           # IndexedDB cache
│   ├── useLocalStorage.ts
│   ├── useDebounce.ts
│   └── useIsMobile.ts
│
├── store/
│   ├── auth.ts               # Zustand: user, token, permissions
│   ├── ui.ts                 # Zustand: activeTab, sidebarOpen, theme
│   ├── processes.ts          # Zustand: procesos en memoria
│   ├── notifications.ts      # Zustand: snackbars, modals, toasts
│   └── filters.ts            # Zustand: filtros de búsqueda
│
├── services/
│   ├── api.ts                # Axios instance + interceptors
│   ├── auth.ts               # Auth service (login, logout)
│   ├── process.ts            # Process API calls
│   ├── planning.ts           # Planning API calls
│   ├── websocket.ts          # WebSocket manager
│   ├── cache.ts              # IndexedDB wrapper
│   ├── notifications.ts      # Toast/notification manager
│   └── offline.ts            # Offline mode (PWA)
│
├── lib/
│   ├── api.ts                # tRPC client
│   ├── utils.ts              # Helper functions
│   ├── constants.ts          # App constants
│   ├── validators.ts         # Zod/Yup schemas
│   ├── date.ts               # Date utilities
│   ├── format.ts             # Formatting utilities
│   └── analytics.ts          # Tracking
│
├── styles/
│   ├── globals.css           # Tailwind globals
│   ├── animations.css
│   ├── components.css
│   └── variables.css         # CSS vars (themes)
│
├── public/
│   ├── icons/
│   ├── images/
│   └── fonts/
│
├── tests/
│   ├── unit/
│   │   ├── useAuth.test.ts
│   │   ├── api.test.ts
│   │   └── format.test.ts
│   ├── integration/
│   │   ├── login.test.ts
│   │   └── create_process.test.ts
│   └── e2e/
│       └── full_workflow.spec.ts (Cypress)
│
├── .env.local.example
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
├── jest.config.js
├── cypress.config.js
└── package.json
```

### 3.2 Data Fetching con SWR

```typescript
// hooks/useProcesses.ts
import useSWR, { SWRConfiguration } from 'swr'
import { getProcesses } from '@/services/process'

interface UseProcessesOptions {
  operarioId?: number
  pollInterval?: number
  revalidateOnFocus?: boolean
}

export function useProcesses(options: UseProcessesOptions = {}) {
  const {
    operarioId,
    pollInterval = 30000,      // Poll cada 30s
    revalidateOnFocus = false
  } = options
  
  const { data, error, isLoading, mutate } = useSWR(
    operarioId ? `/api/v1/procesos?operario=${operarioId}` : null,
    (url) => getProcesses({ operarioId }),
    {
      revalidateOnFocus,
      dedupingInterval: 60000,  // Dedupe 1 min
      focusThrottleInterval: 600000, // Re-validate 10 min after focus
      refreshInterval: pollInterval,
      onError: (error) => {
        console.error('Error fetching processes:', error)
      }
    }
  )
  
  return {
    procesos: data || [],
    isLoading,
    error,
    mutate,  // Manual refresh
    isValidating: isLoading || (error && !data)
  }
}

// pages/dashboard/procesos/index.tsx
export default function ProcesosPage() {
  const { procesos, isLoading, mutate } = useProcesses()
  
  if (isLoading) return <ProcessListSkeleton />
  
  return (
    <div>
      <DataTable
        columns={COLUMNS}
        data={procesos}
        onRefresh={() => mutate()}
        onCreate={() => router.push('/dashboard/procesos/nuevo')}
      />
    </div>
  )
}
```

### 3.3 State Management (Zustand)

```typescript
// store/auth.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  user: { id: number; nombre: string; rol: 'Maestro' | 'Operario' } | null
  token: string | null
  isLoading: boolean
  
  // Actions
  login: (token: string, user: any) => void
  logout: () => void
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isLoading: false,
      
      login: (token, user) => set({ user, token }),
      logout: () => set({ user: null, token: null }),
      setLoading: (isLoading) => set({ isLoading })
    }),
    { name: 'auth-storage' }  // Persist to localStorage
  )
)

// store/ui.ts
interface UIState {
  activeTab: string
  sidebarOpen: boolean
  theme: 'light' | 'dark'
  
  setActiveTab: (tab: string) => void
  toggleSidebar: () => void
  setTheme: (theme: 'light' | 'dark') => void
}

export const useUIStore = create<UIState>((set) => ({
  activeTab: 'dashboard',
  sidebarOpen: true,
  theme: 'dark',
  
  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setTheme: (theme) => set({ theme })
}))
```

### 3.4 Componentes Reutilizables (Headless)

```typescript
// components/shared/DataTable.tsx
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'

interface DataTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  onRowClick?: (row: T) => void
  sortable?: boolean
  filterable?: boolean
  paginated?: boolean
  pageSize?: number
}

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  sortable = true,
  filterable = true,
  paginated = true,
  pageSize = 10
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: sortable ? getSortedRowModel() : undefined,
    getFilteredRowModel: filterable ? getFilteredRowModel() : undefined,
    getPaginationRowModel: paginated ? getPaginationRowModel() : undefined,
  })
  
  table.setPageSize(pageSize)
  
  return (
    <div>
      <table className="w-full">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  onClick={header.column.getToggleSortingHandler()}
                  className="cursor-pointer"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {header.column.getIsSorted() && (
                    <span>{header.column.getIsSorted() === 'asc' ? ' ▲' : ' ▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row.original)}
              className="cursor-pointer hover:bg-gray-100"
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      
      {paginated && (
        <div className="flex gap-2 mt-4">
          <button onClick={() => table.previousPage()}>← Anterior</button>
          <span>{table.getState().pagination.pageIndex + 1} / {table.getPageCount()}</span>
          <button onClick={() => table.nextPage()}>Siguiente →</button>
        </div>
      )}
    </div>
  )
}
```

### 3.5 Real-time con WebSockets

```typescript
// services/websocket.ts
import io from 'socket.io-client'
import { useAuthStore } from '@/store/auth'
import { useNotifications } from '@/hooks/useNotifications'

class WebSocketService {
  private socket: Socket | null = null
  
  connect(token: string) {
    this.socket = io(process.env.NEXT_PUBLIC_WS_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    })
    
    this.socket.on('connect', () => {
      console.log('✅ WebSocket conectado')
    })
    
    this.socket.on('disconnect', () => {
      console.log('❌ WebSocket desconectado')
    })
    
    // Listeners
    this.socket.on('proceso:actualizado', (data) => {
      // Actualizar SWR cache automáticamente
      mutate(`/api/v1/procesos/${data.id}`, data)
      
      // Notificar user
      useNotifications.getState().addToast({
        title: `Proceso ${data.id} → ${data.estado}`,
        type: 'info'
      })
    })
    
    this.socket.on('urgencia:nueva', (data) => {
      // Badge urgencias
      useUIStore.getState().setUrgencyCount(data.count)
    })
  }
  
  disconnect() {
    this.socket?.disconnect()
  }
}

export const wsService = new WebSocketService()

// Usar en _app.tsx
export default function App({ Component, pageProps }: AppProps) {
  const token = useAuthStore((s) => s.token)
  
  useEffect(() => {
    if (token) {
      wsService.connect(token)
      return () => wsService.disconnect()
    }
  }, [token])
  
  return <Component {...pageProps} />
}
```

---

## 4. BASES DE DATOS & MIGRATIONS

### 4.1 Schema PostgreSQL V2.0

```sql
-- Usuarios
CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) UNIQUE NOT NULL,
  rol VARCHAR(20) DEFAULT 'Operario',
  password_hash VARCHAR(255),
  avatar VARCHAR(500),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Procesos
CREATE TABLE procesos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operario_id INT NOT NULL REFERENCES usuarios(id),
  sku_destino VARCHAR(50) NOT NULL,
  estado VARCHAR(20) DEFAULT 'CREADO',
  es_urgente BOOLEAN DEFAULT false,
  stock_inicial INT DEFAULT 0,
  stock_final INT,
  
  tiempo_inicio TIMESTAMPTZ,
  tiempo_pausa TIMESTAMPTZ,
  tiempo_reanudacion TIMESTAMPTZ,
  tiempo_finalizacion TIMESTAMPTZ,
  
  fecha TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices críticos
CREATE INDEX idx_procesos_operario_estado ON procesos(operario_id, estado);
CREATE INDEX idx_procesos_estado_fecha ON procesos(estado, fecha DESC);
CREATE INDEX idx_procesos_sku_fecha ON procesos(sku_destino, fecha DESC);

-- Plan de Producción
CREATE TABLE plan_produccion (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(50) NOT NULL,
  fecha DATE NOT NULL,
  cajas_plan INT NOT NULL,
  cajas_real INT,
  minutos_plan FLOAT,
  estado VARCHAR(20) DEFAULT 'PENDIENTE',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(sku, fecha)
);

CREATE INDEX idx_plan_sku_fecha ON plan_produccion(sku, fecha DESC);
CREATE INDEX idx_plan_estado ON plan_produccion(estado);

-- Stock Forecast
CREATE TABLE stock_forecast (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(50) NOT NULL,
  fecha DATE NOT NULL,
  stock_actual INT,
  stock_proyectado INT,
  diferencia INT,
  confianza FLOAT,  -- 0-1 (confidence level)
  alerta BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(sku, fecha)
);

-- Audit logs
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  usuario_id INT REFERENCES usuarios(id),
  accion VARCHAR(100) NOT NULL,
  entidad VARCHAR(50),
  entidad_id VARCHAR(100),
  detalles JSONB,
  ip_address INET
);

CREATE INDEX idx_audit_usuario_fecha ON audit_logs(usuario_id, timestamp DESC);
```

---

## 5. DEPLOYMENT & INFRASTRUCTURE

### 5.1 Docker Compose (Local)

```yaml
# docker-compose.yml
version: '3.9'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: reproceso
      POSTGRES_PASSWORD: reproceso
      POSTGRES_DB: reproceso_v2
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  rabbitmq:
    image: rabbitmq:3.12-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    ports:
      - "5672:5672"
      - "15672:15672"
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://reproceso:reproceso@postgres:5432/reproceso_v2
      REDIS_URL: redis://redis:6379/0
      CELERY_BROKER_URL: amqp://guest:guest@rabbitmq:5672//
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      rabbitmq:
        condition: service_started
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    volumes:
      - ./backend:/app

  celery:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://reproceso:reproceso@postgres:5432/reproceso_v2
      REDIS_URL: redis://redis:6379/0
      CELERY_BROKER_URL: amqp://guest:guest@rabbitmq:5672//
    depends_on:
      - postgres
      - rabbitmq
    command: celery -A app.tasks worker --loglevel=info
    volumes:
      - ./backend:/app

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000/api
      NEXT_PUBLIC_WS_URL: http://localhost:8000
    command: npm run dev
    volumes:
      - ./frontend:/app

volumes:
  postgres_data:
  redis_data:
  rabbitmq_data:
```

### 5.2 GitHub Actions CI/CD

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        working-directory: ./backend
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
      
      - name: Run tests
        working-directory: ./backend
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/test_db
        run: pytest tests/

      - name: Run linting
        working-directory: ./backend
        run: |
          flake8 app/ --max-line-length=100
          black --check app/

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'

    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to Railway
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
        run: |
          npm install -g @railway/cli
          railway link --project ${{ secrets.RAILWAY_PROJECT_ID }}
          railway up
```

---

## 6. TESTING STRATEGY

### 6.1 Test Coverage Target: 80%

```python
# tests/unit/test_proceso_service.py
import pytest
from app.services import ProcesoService
from unittest.mock import AsyncMock, MagicMock

@pytest.fixture
async def proceso_service():
    repo = AsyncMock()
    cache = AsyncMock()
    return ProcesoService(repo, cache)

@pytest.mark.asyncio
async def test_crear_proceso_valido(proceso_service):
    # Arrange
    proceso_service.repo.find_by_id = AsyncMock(return_value=None)  # No existe
    
    # Act
    result = await proceso_service.crear_proceso(1, "GGAL070", es_urgente=True)
    
    # Assert
    assert result == "proc-id"
    proceso_service.repo.create.assert_called_once()
    proceso_service.cache.invalidate.assert_called_once_with("procesos:*")

@pytest.mark.asyncio
async def test_crear_proceso_operario_inexistente(proceso_service):
    # Arrange
    proceso_service.repo.find_by_id = AsyncMock(return_value=None)
    
    # Act & Assert
    with pytest.raises(ValidationError):
        await proceso_service.crear_proceso(999, "GGAL070")
```

---

## CONCLUSIÓN

Esta especificación técnica detalla la arquitectura V2.0 con:

✅ **Backend:** FastAPI + SQLAlchemy + Celery (modular, escalable, testeable)
✅ **Frontend:** Next.js + TypeScript + Tailwind (modern, type-safe, componentializado)
✅ **Real-time:** WebSockets + Redis + Celery (actualizaciones instantáneas)
✅ **AI/ML:** Servicios de optimización + forecasting integrados
✅ **Testing:** Unit + Integration + E2E con target 80% coverage
✅ **DevOps:** Docker, GitHub Actions, Railway deployment

**Tiempo estimado:** 10-12 semanas para equipo de 2-3 developers.

**Beneficios:**
- Performance: +60%
- Mantenibilidad: +80%
- Escalabilidad: +100%
- UX: +50%
- ROI: Capaz de 500+ usuarios concurrent
