/**
 * maestro-shell.js — Centro de Mando unificado para el rol Maestro
 *
 * Gestiona la navegación por sidebar, lazy-load de cada panel,
 * y el auto-refresh del panel de Resumen.
 * No toca ninguna lógica de operarios.
 */

const MaestroShell = (() => {
    let _activePanel = 'resumen';
    let _refreshInterval = null;
    let _loadedPanels = new Set();
    let _wired = false;
    let _isMounted = false;

    // ─── Configuración de paneles ─────────────────────────────────────────────
    // Cada entrada define cómo inicializar el panel la primera vez y si se
    // refresca automáticamente.
    const PANELS = {
        resumen:       { load: _loadResumen,      refresh: true  },
        procesos:      { load: _loadProcesos,     refresh: false },
        planificacion: { load: _loadPlanificacion, refresh: false },
        optimizacion:  { load: _loadOptimizacion, refresh: false },
        stock:         { load: _loadStock,        refresh: false },
        proyeccion:    { load: _loadProyeccion,   refresh: false },
        rendimiento:   { load: _loadRendimiento,  refresh: false },
        informes:      { load: _loadInformes,     refresh: false },
        usuarios:      { load: _loadUsuarios,     refresh: false },
        auditoria:     { load: _loadAuditoria,    refresh: false },
    };

    // ─── Entrada principal ────────────────────────────────────────────────────

    async function mount() {
        if (_isMounted) {
            console.log('[MaestroShell] Already mounted, skipping');
            return;
        }
        console.log('[MaestroShell] mount() called');

        // Activar modo Maestro en body (CSS layout)
        document.body.classList.add('maestro-mode');

        // Mostrar shell Maestro, ocultar shell Operario
        const operarioShell = document.getElementById('operario-shell');
        const maestroShell = document.getElementById('maestro-shell');
        console.log('[MaestroShell] operario-shell:', operarioShell, 'maestro-shell:', maestroShell);

        if (operarioShell) operarioShell.style.display = 'none';
        if (maestroShell) maestroShell.style.display = 'flex';

        // Wiring del sidebar (solo una vez)
        if (!_wired) {
            document.querySelectorAll('.maestro-nav-item[data-panel]').forEach(btn => {
                btn.addEventListener('click', () => navigateTo(btn.dataset.panel));
            });
            document.getElementById('stock-projection-calculate')
                ?.addEventListener('click', () => ViewStockProjection.calculate());
            _wired = true;
        }

        // Cargar panel inicial
        await navigateTo('resumen');

        // Auto-refresh Resumen cada 30 s (evitar duplicados)
        if (!_refreshInterval) {
            _refreshInterval = setInterval(() => {
                if (_activePanel === 'resumen') _loadResumen(true);
            }, 30000);
        }

        _isMounted = true;
    }

    function unmount() {
        console.log('[MaestroShell] unmount() called');
        document.body.classList.remove('maestro-mode');
        if (_refreshInterval) { clearInterval(_refreshInterval); _refreshInterval = null; }
        _loadedPanels.clear();
        _activePanel = 'resumen';
        _isMounted = false;
        // _wired stays true — listeners survive DOM persistence; reset only if shell is rebuilt
    }

    // ─── Navegación entre paneles ─────────────────────────────────────────────

    async function navigateTo(panelId) {
        if (!PANELS[panelId]) return;

        // Actualizar sidebar
        document.querySelectorAll('.maestro-nav-item[data-panel]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.panel === panelId);
        });

        // Mostrar/ocultar paneles
        document.querySelectorAll('.maestro-panel').forEach(el => el.classList.remove('active'));
        document.getElementById(`maestro-panel-${panelId}`)?.classList.add('active');

        _activePanel = panelId;

        // Lazy-load: solo cargar la primera vez (salvo resumen que siempre refresca)
        const alreadyLoaded = _loadedPanels.has(panelId);
        if (!alreadyLoaded || panelId === 'resumen') {
            await PANELS[panelId].load(false);
            _loadedPanels.add(panelId);
        }
    }

    // ─── Loaders de cada panel ────────────────────────────────────────────────

    async function _loadResumen(isRefresh = false) {
        const dot = document.getElementById('maestro-refresh-dot');
        if (dot) dot.classList.add('refreshing');

        try {
            const [dashboard, report] = await Promise.all([
                API.get('/api/planning/dashboard').catch(() => null),
                API.get('/api/reports/daily').catch(() => null),
            ]);

            _renderResumen(dashboard, report);
            _updateUrgenciasBadge(report);

            const lbl = document.getElementById('maestro-fecha-label');
            if (lbl) lbl.textContent = dashboard?.fecha || new Date().toLocaleDateString('es-CL');

            const ts = document.getElementById('maestro-last-update');
            if (ts) ts.textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

        } catch (err) {
            console.error('[MaestroShell] Error cargando resumen:', err);
        } finally {
            if (dot) dot.classList.remove('refreshing');
        }
    }

    async function _loadProcesos() {
        const body = document.getElementById('maestro-procesos-body');
        if (!body) return;
        body.innerHTML = '<p style="color:var(--text-muted)">Cargando procesos...</p>';
        try {
            await Store.loadProcesses(null);   // null = todos los procesos
            const list = Store.getSortedProcesses();
            if (list.length === 0) {
                body.innerHTML = '<p style="color:var(--text-muted);padding:1rem">No hay procesos activos en este momento.</p>';
                return;
            }
            // Agrupar por caja_sku
            const grouped = {};
            list.forEach(p => {
                const k = p.caja_sku || '(sin caja)';
                (grouped[k] = grouped[k] || []).push(p);
            });

            let html = '<div style="overflow-x:auto;"><table class="data-table"><thead><tr>'
                + '<th>SKU</th><th>Operaria</th><th>Estado</th><th>Tiempo</th><th>Prioridad</th><th></th>'
                + '</tr></thead><tbody>';

            Object.entries(grouped).forEach(([caja, procs]) => {
                html += `<tr class="group-header"><td colspan="6" style="background:var(--bg-card);padding:.45rem .75rem;font-size:.78rem;font-weight:600;color:var(--text-muted);">📦 ${caja}</td></tr>`;
                procs.forEach(p => {
                    const { cls } = UI.getStatusBadge(p.estado);
                    const urgente = p.es_urgente ? '<span class="badge badge-urgent">URGENTE</span>' : '';
                    const tiempo  = UI.calcEffectiveTime(p);
                    html += `<tr${p.es_urgente ? ' class="tr-urgent"' : ''}>
                        <td>${p.sku_destino}</td>
                        <td>${p.operario_nombre}</td>
                        <td><span class="badge badge-${cls}">${p.estado}</span></td>
                        <td>${tiempo}</td>
                        <td>${urgente}</td>
                        <td><button class="btn btn-ghost btn-sm proc-detail-btn" data-id="${p.id}">Ver</button></td>
                    </tr>`;
                });
            });

            html += '</tbody></table></div>';
            body.innerHTML = html;

            // Wire botones Ver
            body.querySelectorAll('.proc-detail-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const proc = Store.state.processes.find(p => p.id === parseInt(btn.dataset.id));
                    if (proc) app.viewDetailPreloaded(proc);
                });
            });
        } catch (err) {
            body.innerHTML = `<p style="color:var(--danger)">Error: ${err.message}</p>`;
        }
    }

    async function _loadPlanificacion() {
        // ViewPlanning ya usa #planning-container — solo llamarlo
        await ViewPlanning.render();
    }

    async function _loadOptimizacion() {
        // ViewOptimization ya usa #optimization-container
        await ViewOptimization.render();
    }

    async function _loadStock() {
        // view-stock-panel tiene todo el HTML que ViewStockPanel necesita.
        // Lo movemos (reparentamos) dentro del panel del shell para no duplicar IDs.
        const target = document.getElementById('sp-tab-panels');
        const source = document.getElementById('view-stock-panel');
        if (target && source && !target.dataset.adopted) {
            // Mover el interior de view-stock-panel al contenedor del shell
            while (source.firstChild) target.appendChild(source.firstChild);
            target.dataset.adopted = '1';
        }
        await ViewStockPanel.render();
    }

    async function _loadProyeccion() {
        // ViewStockProjection hace load() que registra el botón
        await ViewStockProjection.load();
    }

    async function _loadRendimiento() {
        const container = document.getElementById('performance-container');
        if (!container) return;
        // Inyectar el HTML que ViewPerformance espera encontrar en el DOM
        container.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem;">
                <div class="card" style="margin-bottom:0;text-align:center;padding:1rem;">
                    <div style="font-size:1.6rem;font-weight:700" id="kpi-active">—</div>
                    <div style="font-size:.78rem;color:var(--text-secondary)">En Proceso</div>
                </div>
                <div class="card" style="margin-bottom:0;text-align:center;padding:1rem;">
                    <div style="font-size:1.6rem;font-weight:700" id="kpi-finished-today">—</div>
                    <div style="font-size:.78rem;color:var(--text-secondary)">Completados Hoy</div>
                </div>
                <div class="card" style="margin-bottom:0;text-align:center;padding:1rem;">
                    <div style="font-size:1.6rem;font-weight:700" id="kpi-avg-time">—</div>
                    <div style="font-size:.78rem;color:var(--text-secondary)">Tiempo Promedio</div>
                </div>
                <div class="card" style="margin-bottom:0;text-align:center;padding:1rem;">
                    <div style="font-size:1.6rem;font-weight:700;color:var(--danger)" id="kpi-urgent-count">—</div>
                    <div style="font-size:.78rem;color:var(--text-secondary)">Urgentes</div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:1.5rem;margin-bottom:1.5rem;">
                <div class="card" style="margin-bottom:0;padding:1.25rem;">
                    <h4 style="margin-bottom:1rem;">Distribución por SKU</h4>
                    <div style="height:220px;"><canvas id="chart-sku-distro"></canvas></div>
                </div>
                <div class="card" style="margin-bottom:0;padding:1.25rem;">
                    <h4 style="margin-bottom:1rem;">Eficiencia Global</h4>
                    <div style="height:220px;"><canvas id="chart-efficiency-compare"></canvas></div>
                    <select id="operator-compare-select" class="form-control" style="margin-top:1rem;font-size:.8rem;"></select>
                </div>
            </div>
            <div class="card" style="margin-bottom:1.5rem;">
                <h4 style="margin-bottom:1rem;">Rendimiento por Operaria</h4>
                <div style="overflow-x:auto;">
                    <table class="data-table">
                        <thead><tr>
                            <th>Operaria</th><th>Completados</th>
                            <th>Eficiencia</th><th>Tiempo prom.</th><th>SKU más rápido</th>
                        </tr></thead>
                        <tbody id="performance-table-body"></tbody>
                    </table>
                </div>
            </div>
            <div class="card">
                <h4 style="margin-bottom:1rem;">Horas-Hombre por SKU</h4>
                <div style="overflow-x:auto;">
                    <table class="data-table" id="sku-stats-table">
                        <thead><tr>
                            <th>SKU</th><th>Producto</th><th>Procesos</th>
                            <th>Operarias</th><th>Horas HH</th><th>Prom.</th><th>Mín/Máx</th>
                        </tr></thead>
                        <tbody id="sku-stats-body"></tbody>
                    </table>
                    <p id="sku-stats-empty" class="hidden" style="color:var(--text-muted);padding:1rem;text-align:center">Sin datos</p>
                </div>
                <div style="height:220px;margin-top:1.5rem;"><canvas id="chart-sku-hours"></canvas></div>
            </div>`;
        try {
            await ViewPerformance.render();
        } catch (err) {
            container.innerHTML = `<p style="color:var(--danger)">Error: ${err.message}</p>`;
        }
    }

    async function _loadInformes() {
        const body = document.getElementById('maestro-informes-body');
        if (!body) return;
        body.innerHTML = '<p style="color:var(--text-muted)">Cargando informes...</p>';
        try {
            const [daily, dashboard] = await Promise.all([
                API.get('/api/reports/daily'),
                API.get('/api/planning/dashboard').catch(() => null),
            ]);
            body.innerHTML = _renderInformes(daily, dashboard);
        } catch (err) {
            body.innerHTML = `<p style="color:var(--danger)">Error: ${err.message}</p>`;
        }
    }

    function _adoptSection(sourceId, targetId) {
        const target = document.getElementById(targetId);
        const source = document.getElementById(sourceId);
        if (target && source && !target.dataset.adopted) {
            while (source.firstChild) target.appendChild(source.firstChild);
            target.dataset.adopted = '1';
        }
    }

    async function _loadUsuarios() {
        _adoptSection('view-users', 'users-container');
        await ViewUsers.render();
        app.loadBreakConfig();
    }

    async function _loadAuditoria() {
        _adoptSection('view-audit', 'audit-container');
        await ViewUsers.renderAudit();
    }

    // ─── Renders ──────────────────────────────────────────────────────────────

    function _renderResumen(db, rp) {
        const body = document.getElementById('maestro-resumen-body');
        if (!body) return;

        const ops         = db?.operators || [];
        const jornadaMin  = (db?.horas_jornada || 6.5) * 60;
        const pendientes  = ops.reduce((s, o) => s + (o.pendiente  || 0), 0);
        const enProceso   = ops.reduce((s, o) => s + (o.en_proceso || 0), 0);
        const completados = ops.reduce((s, o) => s + (o.completado_hoy || 0), 0);
        const cumplPct    = db?.pct_cumplimiento_plan ?? null;
        const avgJornada  = ops.length
            ? ops.reduce((s, o) => s + (o.pct_jornada || 0), 0) / ops.length
            : 0;

        const kpiColor = (v, ok = 100, warn = 60) =>
            v >= ok ? 'var(--success)' : v >= warn ? 'var(--warning)' : 'var(--danger)';

        // ── KPI row ──
        let html = `<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:1rem;margin-bottom:1.75rem;">
            ${_kpi('Pendiente',   pendientes,  'ítems',   'var(--warning)')}
            ${_kpi('En Proceso',  enProceso,   'ítems',   '#3b82f6')}
            ${_kpi('Completado',  completados, 'hoy',     'var(--success)')}
            ${_kpi('Cumplimiento', cumplPct !== null ? cumplPct.toFixed(0)+'%' : '—', '', kpiColor(cumplPct ?? 0))}
            ${_kpi('Procesos',    rp?.total_procesos     || 0, 'hoy',     '#a78bfa')}
            ${_kpi('Emergencias', rp?.total_emergencias  || 0, 'activas', rp?.total_emergencias > 0 ? 'var(--danger)' : 'var(--text-muted)')}
        </div>`;

        // ── Barras globales ──
        html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.75rem;">
            <div class="card" style="padding:1.25rem;margin-bottom:0;">
                <div style="font-weight:600;margin-bottom:.75rem;font-size:.9rem;">Uso de jornada (promedio)</div>
                ${_progressBar(avgJornada.toFixed(0)+'%', avgJornada, 'var(--success)', 80, 100)}
            </div>
            <div class="card" style="padding:1.25rem;margin-bottom:0;">
                <div style="font-weight:600;margin-bottom:.75rem;font-size:.9rem;">Cumplimiento del plan</div>
                ${_progressBar((cumplPct ?? 0).toFixed(0)+'%', Math.min(cumplPct ?? 0, 100), 'var(--success)', 60, 90)}
            </div>
        </div>`;

        // ── Grid de operarias ──
        if (ops.length) {
            html += `<div style="margin-bottom:1.75rem;">
                <h3 style="font-size:1rem;font-weight:600;margin-bottom:1rem;">
                    Operarias <span style="color:var(--text-muted);font-weight:400;font-size:.8rem;">(${ops.length})</span>
                </h3>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;">`;
            ops.forEach(op => {
                const pct   = op.pct_jornada || 0;
                const color = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)';
                html += `
                <div class="card" style="padding:1rem;margin-bottom:0;">
                    <div style="font-weight:600;font-size:.9rem;margin-bottom:.4rem;">${op.nombre}</div>
                    <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.4rem;">
                        ${Math.round(op.minutos_usados_hoy||0)} / ${op.minutos_jornada||jornadaMin} min
                    </div>
                    <div style="height:5px;background:var(--border-color);border-radius:3px;overflow:hidden;margin-bottom:.5rem;">
                        <div style="height:100%;width:${Math.min(pct,100)}%;background:${color};"></div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.3rem;font-size:.68rem;color:var(--text-muted);">
                        <span>⏳ ${op.pendiente||0} pend.</span>
                        <span>▶ ${op.en_proceso||0} proc.</span>
                        <span>⏸ ${op.pausado||0} paus.</span>
                        <span>✓ ${op.completado_hoy||0} compl.</span>
                    </div>
                </div>`;
            });
            html += `</div></div>`;
        }

        // ── Plan por SKU ──
        const planSkus = db?.plan_por_sku || [];
        if (planSkus.length) {
            html += `<h3 style="font-size:1rem;font-weight:600;margin-bottom:1rem;">Plan por SKU</h3>
            <div style="overflow-x:auto;"><table class="data-table"><thead><tr>
                <th>SKU</th><th style="text-align:center">Plan (cj)</th>
                <th style="text-align:center">Real</th><th style="text-align:center">Cerrados</th>
                <th style="text-align:center">%</th>
            </tr></thead><tbody>`;
            planSkus.forEach(sk => {
                const pct = sk.items_total > 0 ? (sk.items_cerrados / sk.items_total) * 100 : 0;
                const c   = pct >= 100 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';
                html += `<tr>
                    <td style="font-weight:500">${sk.sku}</td>
                    <td style="text-align:center">${sk.cajas_plan||0}</td>
                    <td style="text-align:center;color:${sk.cajas_real>0?'var(--success)':'var(--text-muted)'}">${sk.cajas_real||0}</td>
                    <td style="text-align:center">${sk.items_cerrados}/${sk.items_total}</td>
                    <td style="text-align:center;font-weight:600;color:${c}">${pct.toFixed(0)}%</td>
                </tr>`;
            });
            html += '</tbody></table></div>';
        }

        body.innerHTML = html;
    }

    function _renderInformes(daily, dashboard) {
        const procesos = daily?.procesos || [];
        const ops      = dashboard?.operators || [];

        // KPIs
        let html = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1rem;margin-bottom:1.5rem;">
            ${_kpi('Procesos hoy',  daily?.total_procesos   || 0, '',        '#3b82f6')}
            ${_kpi('Emergencias',   daily?.total_emergencias|| 0, '',        'var(--danger)')}
            ${_kpi('Operarias',     daily?.operarios?.length|| 0, 'activas', 'var(--success)')}
            ${_kpi('Unidades',      daily?.resumen_sku?.reduce((s,r)=>s+(r.unidades_reprocesadas||0),0)||0, 'reproc.', '#a78bfa')}
        </div>`;

        // Eficiencia por operaria
        if (ops.length) {
            html += `<h3 style="font-size:1rem;font-weight:600;margin-bottom:1rem;">Eficiencia por Operaria</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:1rem;margin-bottom:1.5rem;">`;
            ops.forEach(op => {
                const pct = op.pct_jornada || 0;
                const c   = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)';
                html += `<div class="card" style="padding:.85rem;margin-bottom:0;">
                    <div style="font-weight:600;font-size:.85rem;margin-bottom:.35rem;">${op.nombre}</div>
                    <div style="height:5px;background:var(--border-color);border-radius:3px;overflow:hidden;margin-bottom:.3rem;">
                        <div style="height:100%;width:${Math.min(pct,100)}%;background:${c};"></div>
                    </div>
                    <div style="font-size:.72rem;color:${c};font-weight:600;">${pct.toFixed(0)}% jornada</div>
                </div>`;
            });
            html += '</div>';
        }

        // Tabla procesos
        html += `<h3 style="font-size:1rem;font-weight:600;margin-bottom:1rem;">Detalle de Procesos</h3>
        <div style="overflow-x:auto;"><table class="data-table"><thead><tr>
            <th>SKU</th><th>Operaria</th>
            <th style="text-align:center">Stk Inicial</th><th style="text-align:center">Stk Final</th>
            <th style="text-align:center">Variación</th><th>Duración</th>
        </tr></thead><tbody>`;

        if (!procesos.length) {
            html += '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:2rem">Sin procesos hoy.</td></tr>';
        } else {
            procesos.forEach(p => {
                const dur = p.duracion_min ? Math.round(p.duracion_min)+' min' : 'En curso';
                const v   = p.stock_final !== null && p.stock_inicial !== null ? p.stock_final - p.stock_inicial : '—';
                html += `<tr${p.es_urgente?' style="background:rgba(239,68,68,.04)"':''}>
                    <td style="font-weight:500">${p.sku_destino}</td>
                    <td>${p.operario}</td>
                    <td style="text-align:center">${p.stock_inicial??'—'}</td>
                    <td style="text-align:center">${p.stock_final??'—'}</td>
                    <td style="text-align:center;font-weight:600;color:${v>0?'var(--success)':'inherit'}">${v>0?'+':''}${v}</td>
                    <td>${dur}</td>
                </tr>`;
            });
        }
        html += '</tbody></table></div>';
        return html;
    }

    // ─── Helpers visuales ─────────────────────────────────────────────────────

    function _kpi(label, value, unit, color) {
        return `<div class="card" style="padding:1rem;text-align:center;margin-bottom:0;">
            <div style="font-size:1.6rem;font-weight:700;color:${color};">${value}</div>
            <div style="font-size:.78rem;font-weight:500;color:var(--text-secondary);margin-top:.2rem;">${label}</div>
            ${unit ? `<div style="font-size:.68rem;color:var(--text-muted);">${unit}</div>` : ''}
        </div>`;
    }

    function _progressBar(label, pct, okColor, warnAt, dangerAt) {
        const clampedPct = Math.min(pct, 100);
        const c = pct >= dangerAt ? 'var(--danger)' : pct >= warnAt ? 'var(--warning)' : okColor;
        return `
            <div style="display:flex;justify-content:space-between;font-size:.78rem;color:var(--text-muted);margin-bottom:.4rem;">
                <span>Progreso</span>
                <span style="font-weight:700;color:${c};">${label}</span>
            </div>
            <div style="height:10px;background:var(--border-color);border-radius:5px;overflow:hidden;">
                <div style="height:100%;width:${clampedPct}%;background:${c};transition:width .3s;"></div>
            </div>`;
    }

    function _updateUrgenciasBadge(report) {
        const badge = document.getElementById('badge-urgencias');
        if (!badge) return;
        const n = report?.total_emergencias || 0;
        badge.textContent = n;
        badge.classList.toggle('visible', n > 0);
    }

    // ─── API pública ──────────────────────────────────────────────────────────
    return { mount, unmount, navigateTo };
})();
