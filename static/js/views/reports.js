/**
 * views/reports.js — Vista de informes para gerencia
 * Depende de: Store, UI, Chart.js
 */

const ViewReports = {
    charts: { opsRect: null, skusPie: null },

    async render() {
        UI.showLoading(true);
        try {
            const data = await API.get('/api/reports/daily');
            
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

        } catch (err) {
            console.error('Error cargando reporte:', err);
            UI.showSnackbar('No se pudo cargar el informe diario', 'error');
        } finally {
            UI.showLoading(false);
        }
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
