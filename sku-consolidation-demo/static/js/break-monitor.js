/**
 * break-monitor.js — Monitor de pausas obligatorias
 *
 * Corre en background mientras un operario tiene un proceso INICIADO.
 * Cada CHECK_INTERVAL ms evalúa si el tiempo de trabajo efectivo desde la
 * última pausa superó work_minutes. Si es así, pausa el proceso y muestra
 * el modal de descanso.
 *
 * Depende de: Store, UI, app, ProcessState
 */

const BreakMonitor = (() => {
    const CHECK_INTERVAL_MS = 30_000; // revisar cada 30 segundos

    let _config = { enabled: false, work_minutes: 90, rest_minutes: 10 };
    let _intervalId = null;
    let _breakActive = false;   // true mientras el modal de pausa está visible
    let _lastNotifiedProcessId = null; // evitar disparar 2 veces para el mismo proceso

    // ── Inicialización ────────────────────────────

    async function init() {
        await _loadConfig();
        _startPolling();
    }

    async function reload() {
        await _loadConfig();
    }

    async function _loadConfig() {
        try {
            const cfg = await Store.loadBreakConfig();
            _config = cfg;
        } catch (err) {
            console.warn('[BreakMonitor] No se pudo cargar la config de pausas:', err);
        }
    }

    function _startPolling() {
        if (_intervalId) clearInterval(_intervalId);
        _intervalId = setInterval(_check, CHECK_INTERVAL_MS);
        // También verificar inmediatamente al iniciar
        _check();
    }

    // ── Verificación principal ────────────────────

    async function _check() {
        // Solo aplica a operarios con sesión activa
        if (!Store.state.currentUser || Store.state.currentRole !== 'Operario') return;
        if (!_config.enabled) return;
        if (_breakActive) return;

        // Buscar proceso activo INICIADO en el store
        const proc = Store.state.processes.find(p => p.estado === ProcessState.STARTED);
        if (!proc || !proc.started_at) return;

        // Calcular minutos de trabajo efectivo desde la última pausa (o desde started_at)
        const effectiveMinutes = _calcMinutesSinceLastPause(proc);
        if (effectiveMinutes < _config.work_minutes) return;

        // Evitar disparar varias veces para el mismo proceso sin que el operario reanude
        if (_lastNotifiedProcessId === proc.id) return;
        _lastNotifiedProcessId = proc.id;

        await _triggerBreak(proc);
    }

    /**
     * Calcula los minutos de trabajo efectivo desde la última pausa finalizada
     * (o desde started_at si no hay pausas previas).
     */
    function _calcMinutesSinceLastPause(proc) {
        const now = Date.now();

        // Buscar la pausa más reciente que ya finalizó
        let referenceTime = new Date(proc.started_at).getTime();

        if (proc.pausas && proc.pausas.length > 0) {
            const finishedPausas = proc.pausas.filter(p => p.fin);
            if (finishedPausas.length > 0) {
                const lastPauseEnd = Math.max(
                    ...finishedPausas.map(p => new Date(p.fin).getTime())
                );
                referenceTime = lastPauseEnd;
            }
        }

        return (now - referenceTime) / 60_000;
    }

    // ── Disparo de pausa ──────────────────────────

    async function _triggerBreak(proc) {
        _breakActive = true;

        // 1. Pausar el proceso en el servidor
        try {
            await Store.updateProcessState(proc.id, 'pause');
            // Actualizar el store local para que _autoPauseOnLeaveDetail no lo intente de nuevo
            const idx = Store.state.processes.findIndex(p => p.id === proc.id);
            if (idx !== -1) Store.state.processes[idx].estado = ProcessState.PAUSED;
        } catch (err) {
            console.warn('[BreakMonitor] No se pudo pausar el proceso:', err);
            _breakActive = false;
            _lastNotifiedProcessId = null;
            return;
        }

        // 2. Mostrar el modal bloqueante con el countdown
        UI.showBreakModal(_config.work_minutes, _config.rest_minutes, async () => {
            _breakActive = false;
            _lastNotifiedProcessId = null;
            await _onBreakDone(proc.id);
        });
    }

    /**
     * Cuando el operario hace clic en "Reanudar", se reanuda el proceso
     * y se refresca la vista de detalle si está activa.
     */
    async function _onBreakDone(processId) {
        try {
            const res = await Store.updateProcessState(processId, 'resume');
            UI.showSnackbar('Proceso reanudado', 'success');

            // Refrescar la vista de detalle si estamos en ella
            if (UI.currentViewId === 'view-detail' && UI.currentDetailId === processId) {
                await UI.renderDetail(processId, res.proceso);
            } else {
                // Actualizar el store local
                const idx = Store.state.processes.findIndex(p => p.id === processId);
                if (idx !== -1 && res?.proceso) Store.state.processes[idx] = res.proceso;
            }
        } catch (err) {
            UI.showSnackbar('No se pudo reanudar el proceso: ' + (err.message || ''), 'error');
        }
    }

    function stop() {
        if (_intervalId) {
            clearInterval(_intervalId);
            _intervalId = null;
        }
        _breakActive = false;
        _lastNotifiedProcessId = null;
    }

    return { init, reload, stop };
})();
