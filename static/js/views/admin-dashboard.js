/**
 * views/admin-dashboard.js — Admin Control Dashboard Unificado
 * Consolida: KPIs en tiempo real, operarias, stock, planificación, reportes en un solo lugar
 * Auto-refresh cada 30 segundos
 */

const ViewAdminDashboard = (() => {
    let _refreshInterval = null;
    let _dashboardData = null;
    let _reportData = null;
    let _planningData = null;
    let _stockData = null;
    let _activeTab = 'overview';
    let _charts = { ops: null, skus: null };

    async function _loadAllData() {
        try {
            const [dashboard, report, planning, stock] = await Promise.all([
                API.get('/api/planning/dashboard').catch(() => null),
                API.get('/api/reports/daily').catch(() => null),
                API.get('/api/planning/semana').catch(() => null),
                API.get('/api/planning/stock-projection?dias=7').catch(() => null)
            ]);
            return { dashboard, report, planning, stock };
        } catch (err) {
            console.error('[AdminDashboard] Error:', err);
            return null;
        }
    }

    function _renderKPICard(title, value, unit = '', color = 'var(--success,#16a34a)') {
        return `
            <div class="admin-kpi-card">
                <div class="admin-kpi-value" style="color:${color};">${value}</div>
                <div class="admin-kpi-label">${title}</div>
                <div style="font-size:.7rem;color:var(--text-muted);">${unit}</div>
            </div>`;
    }

    function _renderProgressBar(label, percent, color) {
        const clampedPct = Math.min(percent, 100);
        return `
            <div class="admin-progress-item">
                <div class="admin-progress-label">
                    <span>${label}</span>
                    <span style="font-weight:600;color:${color};">${percent}%</span>
                </div>
                <div class="admin-progress-bar">
                    <div class="admin-progress-fill" style="width:${clampedPct}%;background:${color};"></div>
                </div>
            </div>`;
    }

    function _renderOverviewTab() {
        if (!_dashboardData) return '<p style="color:var(--text-muted)">Cargando datos...</p>';

        const { dashboard, report } = _dashboardData;
        const dbData = dashboard || {};
        const rpData = report || {};

        const operators = dbData.operators || [];
        const jornada_horas = dbData.horas_jornada || 6.5;
        const jornada_min = jornada_horas * 60;

        let avgJornada = 0;
        let avgPlan = 0;
        if (operators.length > 0) {
            avgJornada = operators.reduce((s, op) => s + (op.pct_jornada || 0), 0) / operators.length;
            avgPlan = operators.reduce((s, op) => {
                const usados = op.minutos_usados_hoy || 0;
                const plan = op.minutos_jornada || jornada_min;
                return s + (usados / plan) * 100;
            }, 0) / operators.length;
        }

        const pendientes = operators.reduce((s, op) => s + (op.pendiente || 0), 0);
        const enProceso = operators.reduce((s, op) => s + (op.en_proceso || 0), 0);
        const completados = operators.reduce((s, op) => s + (op.completado_hoy || 0), 0);
        const cumplimiento = dbData.pct_cumplimiento_plan || 0;

        return `
            <!-- KPIs -->
            <div class="admin-kpi-row">
                ${_renderKPICard('Pendiente', pendientes, 'ítems', 'var(--warning,#d97706)')}
                ${_renderKPICard('En Proceso', enProceso, 'ítems', 'var(--info,#3b82f6)')}
                ${_renderKPICard('Completado', completados, 'hoy', 'var(--success,#16a34a)')}
                ${_renderKPICard('Cumplimiento', cumplimiento.toFixed(0), '%', cumplimiento >= 100 ? 'var(--success,#16a34a)' : 'var(--warning,#d97706)')}
                ${_renderKPICard('Procesos', rpData.total_procesos || 0, 'hoy', 'var(--primary,#3b82f6)')}
                ${_renderKPICard('Emergencias', rpData.total_emergencias || 0, 'activas', 'var(--danger,#dc2626)')}
            </div>

            <!-- Progress Bars -->
            <div class="admin-progress-section">
                <div class="admin-progress-card">
                    <div class="admin-progress-title">Promedio Jornada</div>
                    ${_renderProgressBar('% Tiempo Usado', avgJornada.toFixed(0), avgJornada >= 100 ? 'var(--danger)' : avgJornada >= 80 ? 'var(--warning,#d97706)' : 'var(--success,#16a34a)')}
                </div>
                <div class="admin-progress-card">
                    <div class="admin-progress-title">Plan del Día</div>
                    ${_renderProgressBar('% Completado', Math.min(avgPlan, 100).toFixed(0), avgPlan >= 100 ? 'var(--success,#16a34a)' : 'var(--info,#3b82f6)')}
                </div>
            </div>

            <!-- Operarias Grid -->
            <div style="margin-bottom:1.5rem;">
                <h3 style="margin-bottom:1rem;">Estado de Operarias (${operators.length})</h3>
                <div class="admin-operators-grid">
                    ${operators.map(op => {
                        const pctUsada = op.pct_jornada || 0;
                        const color = pctUsada >= 100 ? 'var(--danger)' : pctUsada >= 80 ? 'var(--warning,#d97706)' : 'var(--success,#16a34a)';
                        return `
                            <div class="admin-operator-card">
                                <div class="admin-operator-name">${op.nombre}</div>
                                <div style="font-size:.75rem;color:var(--text-secondary);margin-bottom:.3rem;">
                                    ${(op.minutos_usados_hoy || 0).toFixed(0)} / ${op.minutos_jornada || 390} min
                                </div>
                                <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:.3rem;">
                                    <div style="height:100%;width:${Math.min(pctUsada, 100)}%;background:${color};"></div>
                                </div>
                                <div style="font-size:.7rem;font-weight:600;color:${color};margin-bottom:.4rem;">${pctUsada.toFixed(0)}%</div>
                                <div class="admin-operator-stats">
                                    <div class="admin-operator-stat" title="Pendiente">⏳ ${op.pendiente || 0}</div>
                                    <div class="admin-operator-stat" title="En Proceso">▶️ ${op.en_proceso || 0}</div>
                                    <div class="admin-operator-stat" title="Pausado">⏸️ ${op.pausado || 0}</div>
                                    <div class="admin-operator-stat" title="Completado">✓ ${op.completado_hoy || 0}</div>
                                </div>
                            </div>`;
                    }).join('')}
                </div>
            </div>`;
    }

    function _renderStockTab() {
        if (!_dashboardData || !_dashboardData.dashboard) {
            return '<p style="color:var(--text-muted)">Cargando datos de stock...</p>';
        }

        const plan_por_sku = _dashboardData.dashboard.plan_por_sku || [];

        return `
            <h3 style="margin-bottom:1rem;">Plan por SKU - Estado de Completitud</h3>
            <div style="overflow-x:auto;">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>SKU</th>
                            <th style="text-align:center;">Plan</th>
                            <th style="text-align:center;">Real</th>
                            <th style="text-align:center;">Cerrados</th>
                            <th style="text-align:center;">%</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${plan_por_sku.map(item => {
                            const pct = item.items_total > 0 ? (item.items_cerrados / item.items_total) * 100 : 0;
                            const color = pct >= 100 ? 'var(--success,#16a34a)' : pct >= 50 ? 'var(--warning,#d97706)' : 'var(--danger)';
                            return `
                                <tr>
                                    <td style="font-weight:500;">${item.sku}</td>
                                    <td style="text-align:center;">${item.cajas_plan || 0}</td>
                                    <td style="text-align:center;color:${item.cajas_real && item.cajas_real > 0 ? 'var(--success,#16a34a)' : 'var(--text-muted)'};">
                                        ${item.cajas_real || 0}
                                    </td>
                                    <td style="text-align:center;">${item.items_cerrados}/${item.items_total}</td>
                                    <td style="text-align:center;font-weight:600;color:${color};">${pct.toFixed(0)}%</td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    function _renderPlanningTab() {
        if (!_dashboardData || !_dashboardData.dashboard) {
            return '<p style="color:var(--text-muted)">Cargando planificación...</p>';
        }

        const plan_por_sku = _dashboardData.dashboard.plan_por_sku || [];
        const fecha = _dashboardData.dashboard.fecha || new Date().toISOString().slice(0, 10);

        return `
            <h3 style="margin-bottom:1rem;">Planificación del Día (${fecha})</h3>
            <div class="admin-planning-grid">
                ${plan_por_sku.map(item => `
                    <div class="admin-plan-card">
                        <div class="admin-plan-sku">${item.sku}</div>
                        <div class="admin-plan-detail">📦 Plan: <strong>${item.cajas_plan}</strong> cajas</div>
                        <div class="admin-plan-detail">✓ Real: <strong style="color:var(--success,#16a34a);">${item.cajas_real || '—'}</strong></div>
                        <div class="admin-plan-detail">📋 Items: ${item.items_cerrados}/${item.items_total}</div>
                    </div>`).join('')}
            </div>`;
    }

    function _renderProjectionTab() {
        if (!_stockData) {
            return '<p style="color:var(--text-muted)">Cargando proyección de stock...</p>';
        }

        const proyeccion = _stockData.proyeccion || [];
        if (proyeccion.length === 0) {
            return '<p style="color:var(--text-muted)">Sin datos de proyección.</p>';
        }

        // Extraer todos los SKUs únicos
        const allSkus = new Set();
        proyeccion.forEach(dia => {
            (dia.skus || []).forEach(sk => allSkus.add(sk.sku));
        });
        const skus = Array.from(allSkus).sort();

        let html = `
            <h3 style="margin-bottom:1rem;">Proyección de Stock (7 días)</h3>
            <div class="admin-projection-table">
                <table>
                    <thead>
                        <tr>
                            <th class="admin-projection-sku">SKU</th>`;

        proyeccion.forEach(dia => {
            const fecha = new Date(dia.fecha + 'T00:00:00');
            const label = fecha.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric' });
            html += `<th>${label}</th>`;
        });
        html += `</tr></thead><tbody>`;

        skus.forEach(sku => {
            html += `<tr>`;
            html += `<td class="admin-projection-sku">${sku}</td>`;

            proyeccion.forEach(dia => {
                const skuData = (dia.skus || []).find(s => s.sku === sku);
                if (!skuData) {
                    html += `<td style="color:var(--text-muted);">—</td>`;
                } else {
                    const proj = skuData.stock_proyectado || 0;
                    const minimo = skuData.stock_minimo || 0;
                    let className = 'admin-projection-ok';
                    if (skuData.alerta) className = 'admin-projection-alert';
                    else if (proj < minimo) className = 'admin-projection-warning';
                    html += `
                        <td class="${className} admin-projection-value">
                            ${proj}<div style="font-size:.65rem;color:var(--text-muted);">m:${minimo}</div>
                        </td>`;
                }
            });

            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        return html;
    }

    function _renderReportsTab() {
        if (!_dashboardData || !_dashboardData.report) {
            return '<p style="color:var(--text-muted)">Cargando reportes...</p>';
        }

        const report = _dashboardData.report;
        const procesos = report.procesos || [];

        return `
            <h3 style="margin-bottom:1rem;">Procesos Completados Hoy (${procesos.length})</h3>
            <div style="overflow-x:auto;">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>SKU</th>
                            <th>Operaria</th>
                            <th style="text-align:center;">Stock Inicial</th>
                            <th style="text-align:center;">Stock Final</th>
                            <th style="text-align:center;">Variación</th>
                            <th>Duración</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${procesos.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:2rem">Sin procesos completados</td></tr>' : procesos.map(p => {
                            const duracion = p.duracion_min ? Math.round(p.duracion_min) + ' min' : 'En curso';
                            const variacion = (p.stock_final !== null && p.stock_inicial !== null) ? (p.stock_final - p.stock_inicial) : '—';
                            return `
                                <tr>
                                    <td style="font-weight:500;">${p.sku_destino}</td>
                                    <td>${p.operario}</td>
                                    <td style="text-align:center;">${p.stock_inicial ?? '—'}</td>
                                    <td style="text-align:center;">${p.stock_final ?? '—'}</td>
                                    <td style="text-align:center;font-weight:600;color:${variacion > 0 ? 'var(--success)' : 'inherit'}">${variacion > 0 ? '+' : ''}${variacion}</td>
                                    <td>${duracion}</td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    function _switchTab(tabName) {
        _activeTab = tabName;
        document.querySelectorAll('.admin-tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.remove('active'));

        document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
        document.getElementById(`admin-tab-${tabName}`)?.classList.add('active');
    }

    async function _render() {
        const container = document.getElementById('admin-dashboard-container');
        if (!container) return;

        const data = await _loadAllData();
        if (!data) {
            container.innerHTML = `<p style="padding:1rem;color:var(--danger)">Error al cargar dashboard</p>`;
            return;
        }

        _dashboardData = { dashboard: data.dashboard, report: data.report };
        _planningData = data.planning;
        _stockData = data.stock;

        const overviewHtml = _renderOverviewTab();
        const stockHtml = _renderStockTab();
        const planningHtml = _renderPlanningTab();
        const projectionHtml = _renderProjectionTab();
        const reportsHtml = _renderReportsTab();

        const html = `
            <div class="admin-dashboard">
                <!-- Tabs -->
                <div class="admin-tabs">
                    <button class="admin-tab-btn active" data-tab="overview">📊 Resumen</button>
                    <button class="admin-tab-btn" data-tab="stock">📦 Stock</button>
                    <button class="admin-tab-btn" data-tab="planning">📋 Planificación</button>
                    <button class="admin-tab-btn" data-tab="projection">📈 Proyección</button>
                    <button class="admin-tab-btn" data-tab="reports">📄 Reportes</button>
                </div>

                <!-- Tab Content -->
                <div id="admin-tab-overview" class="admin-tab-content active">
                    ${overviewHtml}
                </div>
                <div id="admin-tab-stock" class="admin-tab-content">
                    ${stockHtml}
                </div>
                <div id="admin-tab-planning" class="admin-tab-content">
                    ${planningHtml}
                </div>
                <div id="admin-tab-projection" class="admin-tab-content">
                    ${projectionHtml}
                </div>
                <div id="admin-tab-reports" class="admin-tab-content">
                    ${reportsHtml}
                </div>

                <div class="admin-refresh-time">Actualizado: ${new Date().toLocaleTimeString('es-CL')}</div>
            </div>`;

        container.innerHTML = html;

        // Wire tab buttons
        container.querySelectorAll('.admin-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => _switchTab(btn.dataset.tab));
        });
    }

    async function load() {
        const container = document.getElementById('admin-dashboard-container');
        if (!container) return;

        // Limpiar timer anterior si existe
        unload();

        // Render inicial
        await _render();

        // Auto-refresh cada 30 segundos
        _refreshInterval = setInterval(() => {
            _render().catch(err => console.error('[AdminDashboard] Error en refresh:', err));
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
