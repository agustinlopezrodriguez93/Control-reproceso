/**
 * views/dashboard-maestro.js — Dashboard en Tiempo Real (KPIs de Maestro)
 * Muestra avance de operarias, cumplimiento de plan y métricas de eficiencia.
 * Auto-refresh cada 30 segundos.
 */

const ViewDashboardMaestro = (() => {
    let _refreshInterval = null;
    let _lastUpdate = null;

    async function _loadData() {
        try {
            const data = await API.get('/api/planning/dashboard');
            return data;
        } catch (err) {
            console.error('[DashboardMaestro] Error al cargar:', err);
            return null;
        }
    }

    function _renderKPICard(title, value, unit = '', color = 'var(--success,#16a34a)') {
        return `
            <div class="kpi-card">
                <div class="kpi-value" style="color:${color};font-size:1.75rem;font-weight:700;">${value}</div>
                <div class="kpi-title">${title}</div>
                <div class="kpi-unit" style="font-size:.75rem;color:var(--text-muted);">${unit}</div>
            </div>`;
    }

    function _renderProgressBar(label, percent, color) {
        const clampedPct = Math.min(percent, 100);
        return `
            <div style="margin-bottom:1rem;">
                <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:.3rem;">
                    <span>${label}</span>
                    <span style="font-weight:600;color:${color};">${percent}%</span>
                </div>
                <div style="height:12px;background:var(--border);border-radius:6px;overflow:hidden;">
                    <div style="height:100%;width:${clampedPct}%;background:${color};transition:width .3s;"></div>
                </div>
            </div>`;
    }

    async function _render() {
        const container = document.getElementById('dashboard-maestro-container');
        if (!container) return;

        const data = await _loadData();
        if (!data) {
            container.innerHTML = `<p style="padding:1rem;color:var(--danger)">Error al cargar dashboard</p>`;
            return;
        }

        const { operators, plan_por_sku, pct_cumplimiento_plan, horas_jornada, fecha } = data;
        const jornada_horas = horas_jornada || 6.5;
        const jornada_min = jornada_horas * 60;

        let operadorJornada = 0;
        let operadorPlan = 0;
        if (operators && operators.length > 0) {
            operadorJornada = operators.reduce((s, op) => s + (op.pct_jornada || 0), 0) / operators.length;
            operadorPlan = operators.reduce((s, op) => {
                const usados = op.minutos_usados_hoy || 0;
                const plan = op.minutos_jornada || jornada_min;
                return s + (usados / plan) * 100;
            }, 0) / operators.length;
        }

        // Contar estados
        const estadosPendientes = operators?.reduce((s, op) => s + (op.pendiente || 0), 0) || 0;
        const estadosEnProceso = operators?.reduce((s, op) => s + (op.en_proceso || 0), 0) || 0;
        const estadosCompletados = operators?.reduce((s, op) => s + (op.completado_hoy || 0), 0) || 0;

        const html = `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:2rem;">
                ${_renderKPICard('Pendiente', estadosPendientes, 'ítems', 'var(--warning,#d97706)')}
                ${_renderKPICard('En Proceso', estadosEnProceso, 'ítems', 'var(--info,#3b82f6)')}
                ${_renderKPICard('Completado', estadosCompletados, 'ítems hoy', 'var(--success,#16a34a)')}
                ${_renderKPICard('Cumplimiento', pct_cumplimiento_plan?.toFixed(0) || '0', '%', pct_cumplimiento_plan >= 100 ? 'var(--success,#16a34a)' : 'var(--warning,#d97706)')}
            </div>

            <!-- Barras de progreso globales -->
            <div class="card" style="padding:1.25rem;margin-bottom:2rem;">
                <h4 style="margin-bottom:1rem;">Progreso Diario (${fecha})</h4>
                ${_renderProgressBar('% Jornada Usado', operadorJornada.toFixed(0), operadorJornada >= 100 ? 'var(--danger)' : operadorJornada >= 80 ? 'var(--warning,#d97706)' : 'var(--success,#16a34a)')}
                ${_renderProgressBar('% Plan Completado', Math.min(operadorPlan, 100).toFixed(0), operadorPlan >= 100 ? 'var(--success,#16a34a)' : 'var(--info,#3b82f6)')}
            </div>

            <!-- Grilla de operarias -->
            <div style="margin-bottom:2rem;">
                <h4 style="margin-bottom:1rem;">Operarias</h4>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem;">
                    ${(operators || []).map(op => {
                        const pctJornada = op.pct_jornada || 0;
                        const minJornada = op.minutos_jornada || jornada_min;
                        const minUsados = op.minutos_usados_hoy || 0;
                        const pctUsada = (minUsados / minJornada) * 100;
                        return `
                            <div class="card" style="padding:1rem;">
                                <div style="font-weight:600;margin-bottom:.75rem;">${op.nombre || 'Sin asignar'}</div>
                                <div style="font-size:.75rem;color:var(--text-secondary);margin-bottom:.5rem;">
                                    ${minUsados} de ${minJornada} min (${pctUsada.toFixed(0)}%)
                                </div>
                                <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:.5rem;">
                                    <div style="height:100%;width:${Math.min(pctUsada, 100)}%;background:${pctUsada >= 100 ? 'var(--danger)' : pctUsada >= 80 ? 'var(--warning,#d97706)' : 'var(--success,#16a34a)'}"></div>
                                </div>
                                <div style="font-size:.7rem;color:var(--text-muted);display:grid;grid-template-columns:1fr 1fr;gap:.5rem;">
                                    <span>⏳ ${op.pendiente || 0}</span>
                                    <span>▶️ ${op.en_proceso || 0}</span>
                                    <span>⏸️ ${op.pausado || 0}</span>
                                    <span>✓ ${op.completado_hoy || 0}</span>
                                </div>
                            </div>`;
                    }).join('')}
                </div>
            </div>

            <!-- Tabla de plan por SKU -->
            <div>
                <h4 style="margin-bottom:1rem;">Plan por SKU</h4>
                <div style="overflow-x:auto;">
                    <table style="width:100%;font-size:.8rem;border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:1px solid var(--border);background:var(--bg-secondary);">
                                <th style="text-align:left;padding:.5rem;">SKU</th>
                                <th style="text-align:center;padding:.5rem;">Plan (cajas)</th>
                                <th style="text-align:center;padding:.5rem;">Real</th>
                                <th style="text-align:center;padding:.5rem;">Cerrados</th>
                                <th style="text-align:center;padding:.5rem;">%</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(plan_por_sku || []).map(item => {
                                const pctItem = item.items_total > 0 ? (item.items_cerrados / item.items_total) * 100 : 0;
                                return `
                                    <tr style="border-bottom:1px solid var(--border);">
                                        <td style="padding:.5rem;font-weight:500;">${item.sku}</td>
                                        <td style="padding:.5rem;text-align:center;">${item.cajas_plan || 0}</td>
                                        <td style="padding:.5rem;text-align:center;color:${item.cajas_real && item.cajas_real > 0 ? 'var(--success,#16a34a)' : 'var(--text-muted)'};">${item.cajas_real || 0}</td>
                                        <td style="padding:.5rem;text-align:center;">${item.items_cerrados}/${item.items_total}</td>
                                        <td style="padding:.5rem;text-align:center;font-weight:600;color:${pctItem >= 100 ? 'var(--success,#16a34a)' : pctItem >= 50 ? 'var(--warning,#d97706)' : 'var(--danger)'};">${pctItem.toFixed(0)}%</td>
                                    </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        container.innerHTML = html;
        _lastUpdate = new Date().toLocaleTimeString('es-CL');
    }

    async function load() {
        const container = document.getElementById('dashboard-maestro-container');
        if (!container) return;

        // Limpiar timer anterior si existe
        if (_refreshInterval) clearInterval(_refreshInterval);

        // Render inicial
        await _render();

        // Auto-refresh cada 30 segundos
        _refreshInterval = setInterval(() => {
            _render().catch(err => console.error('[DashboardMaestro] Error en refresh:', err));
        }, 30000);
    }

    function unload() {
        if (_refreshInterval) {
            clearInterval(_refreshInterval);
            _refreshInterval = null;
        }
    }

    return { load, unload };
})();
