# Checklist de Ejecución — V1.1 Refactorización

## ANTES DE EMPEZAR (Pre-requisites)

- [ ] Crear rama `refactor/v1.1` desde `dev`
- [ ] Setup testing framework (pytest, pytest-asyncio)
- [ ] Configurar CI/CD (GitHub Actions) para run tests
- [ ] Backup de producción actual
- [ ] Comunicar a equipo: "Comienza refactor V1.1, cero downtime esperado"
- [ ] Reserve 4-6 semanas de developers (no interrupciones)

---

## SEMANA 1: MODULARIZACIÓN ENDPOINTS

### Monday - Estructura Base
- [ ] Crear directorio `api/routes/`
- [ ] Crear `api/routes/__init__.py`
- [ ] Crear `api/schemas.py` (extraer todos los models Pydantic)
- [ ] Commit: "refactor: preparar estructura de routers"

### Tuesday-Wednesday - Modularizar Endpoints
- [ ] Crear `api/routes/procesos.py` (mover endpoints procesos)
- [ ] Crear `api/routes/usuarios.py` (mover endpoints usuarios)
- [ ] Crear `api/routes/planning.py` (mover endpoints planning)
- [ ] Crear `api/routes/stock.py` (mover endpoints stock)
- [ ] Crear `api/routes/reporting.py` (mover endpoints reportes)
- [ ] Crear `api/routes/auth.py` (mover login/logout)

### Thursday - Wire up Routers
- [ ] Refactorizar `api/endpoints.py` → 50 líneas (solo include routers)
- [ ] Test: `GET /api/procesos` debe retornar datos
- [ ] Test: `POST /api/procesos` debe crear proceso
- [ ] Test: `GET /api/usuarios` debe retornar usuarios
- [ ] Commit: "refactor: modularizar endpoints por dominio"

### Friday - Validación
- [ ] Deploy a staging
- [ ] Smoke tests: probar 3-5 flows críticos
- [ ] Verificar: todas las URLs siguen funcionando
- [ ] Verificar: base de datos sin cambios
- [ ] Commit: "test: validación smoke tests modularización"

**Resultado esperado:** endpoints.py 1382 líneas → 50 líneas

---

## SEMANA 2: REPOSITORIES + SERVICIOS

### Monday - Crear Repositories
- [ ] Crear `db/repositories/base.py` (BaseRepository genérico)
- [ ] Crear `db/repositories/proceso_repo.py`
- [ ] Crear `db/repositories/usuario_repo.py`
- [ ] Crear `db/repositories/planning_repo.py`
- [ ] Refactorizar `db.py` → extrae queries a repos
- [ ] Commit: "refactor: crear capa repositories"

### Tuesday-Wednesday - Agregar Type Hints
- [ ] Crear dataclasses (ProcesoResult, UsuarioResult, etc.)
- [ ] Refactorizar queries para retornar dataclasses
- [ ] Agregar type hints a funciones de `db.py`
- [ ] Commit: "refactor: agregar type hints + dataclasses"

### Thursday - Services Layer
- [ ] Crear `db/services/proceso_service.py`
- [ ] Crear `db/services/usuario_service.py`
- [ ] Crear `db/services/planning_service.py`
- [ ] Mover lógica de negocio de endpoints → services
- [ ] Commit: "refactor: crear services para business logic"

### Friday - Validación
- [ ] Deploy a staging
- [ ] Smoke tests
- [ ] Verificar: performance sin cambios
- [ ] Commit: "test: validación repositories + services"

**Resultado esperado:** Queries separadas en repos, business logic en services

---

## SEMANA 3: CACHÉ + ÍNDICES + TESTS

### Monday-Tuesday - Índices DB
- [ ] Crear `db/migrations/001_add_indexes.sql`
- [ ] Ejecutar migraciones
- [ ] Verificar: EXPLAIN ANALYZE de queries críticas
- [ ] Esperar mejora 10-20x en `get_procesos()`
- [ ] Commit: "perf: agregar índices críticos a tablas"

### Wednesday - Caché Redis
- [ ] Crear `cache.py` (CacheManager wrapper)
- [ ] Integrar Redis en endpoints
- [ ] Agregar caché a `get_procesos()`, `get_active_skus()`
- [ ] Verificar: mismos datos, 10x más rápido
- [ ] Commit: "perf: implementar caché Redis"

### Thursday - Unit Tests
- [ ] Crear `tests/unit/test_proceso_repo.py` (15 tests)
- [ ] Crear `tests/unit/test_usuario_repo.py` (10 tests)
- [ ] Crear `tests/unit/test_services.py` (10 tests)
- [ ] Target: 60% coverage
- [ ] Commit: "test: agregar unit tests (60% coverage)"

### Friday - Validación
- [ ] Deploy a staging
- [ ] Load test: simular 50 usuarios concurrent
- [ ] Verificar: tiempo API cae a 150ms (de 400ms)
- [ ] Commit: "perf: validación load testing"

**Resultado esperado:** -60% latencia, 60% test coverage, índices aplicados

---

## SEMANA 4: FRONTEND + DEPLOY

### Monday-Tuesday - Frontend Optimizaciones
- [ ] Lazy-load vistas
- [ ] Minificar JS + CSS
- [ ] Agregar skeleton loaders
- [ ] Commit: "perf: optimizaciones frontend"

### Wednesday - Integration Tests
- [ ] Crear `tests/integration/test_procesos_endpoint.py` (10 tests)
- [ ] Crear `tests/integration/test_planning_endpoint.py` (8 tests)
- [ ] Target: 70% coverage total
- [ ] Commit: "test: agregar integration tests"

### Thursday - Staging Validation
- [ ] Deploy completo a staging
- [ ] Smoke tests: workflow completo operario + maestro
- [ ] Performance tests
- [ ] Security scan
- [ ] Commit: "test: validación staging completa"

### Friday - Production Deploy
- [ ] Backups finales
- [ ] Canary deploy: 10% usuarios
- [ ] Monitor: Prometheus + logs
- [ ] Verificar: 0 errores en 1 hora
- [ ] Full rollout: 100% usuarios
- [ ] Commit: "deploy: v1.1 a producción"

**Resultado esperado:** Sistema refactorizado en producción, -60% latencia, 70% test coverage

---

## VALIDACIÓN FINAL (Post-Deploy)

### Semana 5
- [ ] Monitoreo 24h: alertas de errors
- [ ] Usuarios reportan: "sistema igual o mejor"
- [ ] Performance confirmada: -60% latencia
- [ ] Database logs: no queries lentas
- [ ] Documentación actualizada
- [ ] Reporte final: horas reales vs estimado

---

## MÉTRICAS DE ÉXITO

| Métrica | Antes | Objetivo | Status |
|---------|-------|----------|--------|
| Latencia API | 400ms | <150ms | ✅ |
| Tiempo carga | 4-5s | 2-3s | ✅ |
| Test coverage | 0% | 70% | ✅ |
| Líneas endpoints.py | 1382 | <250 | ✅ |
| Bugs reportados/semana | 3-5 | <1 | ✅ |

---

## EQUIPO REQUERIDO

- **Backend Developer:** 40h/semana
- **QA/Testing:** 20h/semana
- **DevOps:** 10h/semana
- **Frontend Developer:** 10h/semana

**Total:** ~80 horas, 1-2 personas full-time, 4-6 semanas

---

## ROLLBACK PLAN

```bash
git revert HEAD~5
git push origin main
# Sistema vuelve a v1.0 en <5 minutos
```

---

## GO/NO-GO DECISION POINTS

### Fin Semana 2:
- ¿Endpoints modularizados sin errores?
- ¿Validación smoke tests OK?

### Fin Semana 3:
- ¿Índices aplicados, caché funcionando?
- ¿60% test coverage alcanzado?

### Fin Semana 4:
- ¿Staging validation OK?
- ¿Performance confirmada?

---

**Versión:** 1.0
**Timeline:** Mayo 6 - Junio 3, 2026
**Responsable:** Backend Lead + DevOps Lead
