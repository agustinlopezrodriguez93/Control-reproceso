/**
 * views/reports.js — Vista de informes para gerencia
 * Depende de: Store, UI, Chart.js
 */

const ViewReports = {
    charts: { opsRect: null, skusPie: null },

    async render() {
        UI.showLoading(true);
        try {
            // Cargar datos en paralelo
            const [dailyData, dashboardData] = await Promise.all([
                API.get('/api/reports/daily'),
                API.get('/api/planning/dashboard').catch(() => null)
            ]);

            const data = dailyData;

            // 1. KPIs
            document.getElementById('report-kpi-total').textContent = data.total_procesos;
            document.getElementById('report-kpi-emergencias').textContent = data.total_emergencias;
            document.getElementById('report-kpi-operarios').textContent = data.operarios.length;

            const totalUnits = data.resumen_sku.reduce((acc, curr) => acc + (curr.unidades_reprocesadas || 0), 0);
            document.getElementById('report-kpi-unidades').textContent = totalUnits;

            // 2. Tabla de procesos
            const tbody = document.getElementById('report-table-body');
            tbody.innerHTML = '';

            if (data.procesos.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted)">Hoy no se han iniciado procesos.</td></tr>';
            } else {
                data.procesos.forEach(p => {
                    const duracion = p.duracion_min ? `${Math.round(p.duracion_min)} min` : 'En curso';
                    const variacion = (p.stock_final !== null && p.stock_inicial !== null)
                        ? (p.stock_final - p.stock_inicial)
                        : '-';

                    const row = document.createElement('tr');
                    if (p.es_urgente) row.style.background = 'rgba(239, 68, 68, 0.05)';

                    row.innerHTML = `
                        <td><strong>${p.sku_destino}</strong></td>
                        <td>${p.operario}</td>
                        <td style="text-align:center">${p.stock_inicial ?? '-'}</td>
                        <td style="text-align:center">${p.stock_final ?? '-'}</td>
                        <td style="text-align:center; font-weight:600; color:${variacion > 0 ? 'var(--success)' : 'inherit'}">
                            ${variacion > 0 ? '+' : ''}${variacion}
                        </td>
                        <td>${duracion}</td>
                        <td>${p.es_urgente ? '⚠️ URG' : '-'}</td>
                    `;
                    tbody.appendChild(row);
                });
            }

            // 3. Gráficos
            this.renderCharts(data);

            // 4. Eficiencia por operaria (desde dashboard si disponible)
            if (dashboardData && dashboardData.operators) {
                this.renderOperatorEfficiency(dashboardData.operators);
            }

        } catch (err) {
            console.error('Error cargando reporte:', err);
            UI.showSnackbar('No se pudo cargar el informe diario', 'error');
        } finally {
            UI.showLoading(false);
        }

        // Cargar informe de planificación en paralelo
        this.renderPlanningReport();
    },

    async renderPlanningReport(fecha = null) {
        const container = document.getElementById('report-planning-section');
        if (!container) return;

        container.innerHTML = '<p style="color:var(--text-muted);padding:.5rem 0">Cargando informe de planificación...</p>';

        try {
            const params = fecha ? `?fecha=${fecha}` : '';
            const data = await API.get(`/api/planning/daily-report${params}`);

            const pct = data.pct_uso_tiempo ?? 0;
            const pctCumpl = data.pct_cumplimiento_plan;
            const pctColor = pct >= 90 ? 'var(--success,#16a34a)' : pct >= 60 ? 'var(--warning,#d97706)' : 'var(--danger,#dc2626)';
            const cumplColor = !pctCumpl ? 'var(--text-muted)' :
                pctCumpl >= 90 ? 'var(--success,#16a34a)' : pctCumpl >= 60 ? 'var(--warning,#d97706)' : 'var(--danger,#dc2626)';

            const personas = Math.abs(data.personas_equivalente_diferencia);
            const personasLabel = data.personas_equivalente_diferencia >= 0
                ? `${personas} persona${personas !== 1 ? 's' : ''} sin usar`
                : `${personas} persona${personas !== 1 ? 's' : ''} extra necesarias`;

            container.innerHTML = `
                <h3 style="margin-bottom:1rem;">Informe del día — ${data.fecha}</h3>

                <div class="daily-report-grid">
                    <div class="daily-kpi-card">
                        <div class="daily-kpi-value" style="color:${pctColor}">${pct}%</div>
                        <div class="daily-kpi-label">% Uso del tiempo disponible</div>
                    </div>
                    <div class="daily-kpi-card">
                        <div class="daily-kpi-value" style="color:${cumplColor}">${pctCumpl !== null ? pctCumpl + '%' : 'Sin plan'}</div>
                        <div class="daily-kpi-label">Cumplimiento del plan</div>
                    </div>
                    <div class="daily-kpi-card">
                        <div class="daily-kpi-value">${Math.round(data.minutos_trabajados / 60 * 10) / 10}h</div>
                        <div class="daily-kpi-label">Horas trabajadas</div>
                    </div>
                    <div class="daily-kpi-card">
                        <div class="daily-kpi-value">${data.n_operarios}</div>
                        <div class="daily-kpi-label">Operarias activas</div>
                    </div>
                    <div class="daily-kpi-card">
                        <div class="daily-kpi-value" style="font-size:1.2rem;color:var(--primary)">${personasLabel}</div>
                        <div class="daily-kpi-label">Capacidad (en personas)</div>
                    </div>
                    <div class="daily-kpi-card">
                        <div class="daily-kpi-value" style="font-size:1.2rem">$${data.costo_jornada_pesos.toLocaleString('es-CL')}</div>
                        <div class="daily-kpi-label">Costo jornada completa</div>
                    </div>
                </div>

                <!-- Barra visual uso del tiempo -->
                <div class="card" style="padding:1rem;margin-bottom:1rem;">
                    <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:.4rem;">
                        <span style="color:var(--text-secondary)">Tiempo trabajado: <strong>${Math.round(data.minutos_trabajados)} min</strong></span>
                        <span style="color:var(--text-secondary)">Disponible: <strong>${Math.round(data.minutos_disponibles)} min</strong></span>
                    </div>
                    <div style="height:12px;background:var(--border);border-radius:6px;overflow:hidden;">
                        <div style="height:100%;width:${Math.min(pct, 100)}%;background:${pctColor};transition:width .4s;border-radius:6px;"></div>
                    </div>
                    ${data.minutos_plan > 0 ? `
                    <div style="display:flex;justify-content:space-between;font-size:.8rem;margin-top:.5rem;color:var(--text-muted)">
                        <span>Plan del día: ${Math.round(data.minutos_plan)} min</span>
                        <span>Diferencia vs. plan: ${Math.round(data.minutos_trabajados - data.minutos_plan) >= 0 ? '+' : ''}${Math.round(data.minutos_trabajados - data.minutos_plan)} min</span>
                    </div>` : '<p style="font-size:.8rem;color:var(--text-muted);margin-top:.4rem">Sin planificación cargada para este día.</p>'}
                </div>
            `;
        } catch (err) {
            container.innerHTML = `<p style="color:var(--danger)">No se pudo cargar el informe de planificación: ${err.message}</p>`;
        }
    },

    renderOperatorEfficiency(operators) {
        const container = document.getElementById('report-operator-efficiency');
        if (!container) return;

        const html = `
            <h3 style="margin-bottom:1rem;">Eficiencia por Operaria</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;">
                ${(operators || []).map(op => {
                    const pctJornada = op.pct_jornada || 0;
                    const color = pctJornada >= 100 ? 'var(--danger)' : pctJornada >= 80 ? 'var(--warning,#d97706)' : 'var(--success,#16a34a)';
                    const minUsados = op.minutos_usados_hoy || 0;
                    const minJornada = op.minutos_jornada || 390;
                    return `
                        <div class="card" style="padding:.75rem;">
                            <div style="font-weight:600;font-size:.9rem;margin-bottom:.5rem;">${op.nombre}</div>
                            <div style="font-size:.75rem;color:var(--text-secondary);margin-bottom:.4rem;">
                                ${minUsados} de ${minJornada} min
                            </div>
                            <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:.4rem;">
                                <div style="height:100%;width:${Math.min(pctJornada, 100)}%;background:${color};transition:width .3s;"></div>
                            </div>
                            <div style="font-size:.7rem;color:${color};font-weight:600;">${pctJornada.toFixed(0)}%</div>
                        </div>`;
                }).join('')}
            </div>`;

        container.innerHTML = html;
    },

    renderCharts(data) {
        // Limpiamos previos si existen
        if (this.charts.opsRect) this.charts.opsRect.destroy();
        if (this.charts.skusPie) this.charts.skusPie.destroy();

        // Datos para Operarios
        const opsLabels = data.operarios.map(o => o.nombre);
        const opsData = data.operarios.map(o => {
            return data.procesos.filter(p => p.operario === o.nombre).length;
        });

        const ctxOps = document.getElementById('chart-report-ops').getContext('2d');
        this.charts.opsRect = new Chart(ctxOps, {
            type: 'bar',
            data: {
                labels: opsLabels,
                datasets: [{
                    label: 'Procesos hoy',
                    data: opsData,
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });

        // Datos para SKUs (Top 5)
        const topSkus = [...data.resumen_sku].sort((a,b) => b.cantidad_procesos - a.cantidad_procesos).slice(0, 5);
        const skuLabels = topSkus.map(s => s.sku_destino);
        const skuData = topSkus.map(s => s.cantidad_procesos);

        const ctxSkus = document.getElementById('chart-report-skus').getContext('2d');
        this.charts.skusPie = new Chart(ctxSkus, {
            type: 'doughnut',
            data: {
                labels: skuLabels,
                datasets: [{
                    data: skuData,
                    backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    }
};
