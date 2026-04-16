/**
 * views/performance.js — Vista de rendimiento y KPIs
 * Depende de: Store, UI (core), Charts, SKU_NAMES, app
 */

const ViewPerformance = {
    async render() {
        const tbody = document.getElementById('performance-table-body');
        if (!tbody) return;

        try {
            const globalKpis = await Store.loadDashboardStats();

            document.getElementById('kpi-active').textContent = globalKpis.active_tasks || 0;
            document.getElementById('kpi-finished-today').textContent = globalKpis.finished_today || 0;
            document.getElementById('kpi-avg-time').textContent = `${Math.round(globalKpis.global_avg_minutes)} min`;
            document.getElementById('kpi-urgent-count').textContent = globalKpis.pending_urgent || 0;

            this.renderSKUDistroChart(globalKpis.sku_distribution);
            this.renderEfficiencyChart(null, globalKpis.global_avg_minutes);

            const perfData = await Store.loadPerformance();
            tbody.innerHTML = '';

            const select = document.getElementById('operator-compare-select');
            select.innerHTML = '<option value="">Comparar Operario...</option>';

            perfData.forEach(item => {
                const efficiency = item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0;
                const avgMin = item.avg_minutes ? Math.round(item.avg_minutes) : '-';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>
                        <div style="display:flex; align-items:center; gap:0.5rem">
                            <div class="avatar-sm" style="width:24px;height:24px;border-radius:50%;background:#3b82f6;display:flex;align-items:center;justify-content:center;font-size:10px;color:white;">
                                ${item.user.charAt(0)}
                            </div>
                            ${item.user}
                        </div>
                    </td>
                    <td>${item.completed}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:0.5rem">
                            <div class="progress-bar-container" style="flex:1; height:6px;">
                                <div class="progress-bar" style="width: ${efficiency}%"></div>
                            </div>
                            <span style="font-size:0.8rem">${efficiency}%</span>
                        </div>
                    </td>
                    <td>${avgMin} min</td>
                    <td>
                        <button class="btn btn-secondary btn-sm" data-op-id="${item.id}">Ver KPIs</button>
                    </td>
                `;

                const kpiBtn = tr.querySelector('[data-op-id]');
                if (kpiBtn) {
                    kpiBtn.addEventListener('click', () => app.loadOperatorKPIs(item.id));
                }

                tbody.appendChild(tr);

                const opt = document.createElement('option');
                opt.value = item.id;
                opt.textContent = item.user;
                select.appendChild(opt);
            });

        } catch (err) {
            console.error("Dashboard error:", err);
            UI.showSnackbar('Error cargando indicadores', 'error');
            return;
        }

        try {
            await this.renderSKUHumanResources();
        } catch (err) {
            console.warn('SKU stats no disponibles:', err);
        }
    },

    renderSKUDistroChart(data) {
        Charts.destroy('skuDistro');
        const ctx = document.getElementById('chart-sku-distro').getContext('2d');

        Charts.skuDistro = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: data.map(d => d.sku_destino),
                datasets: [{
                    data: data.map(d => d.count),
                    backgroundColor: ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#10b981'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } }
                },
                cutout: '70%'
            }
        });
    },

    renderEfficiencyChart(operatorData = null, globalAvgMinutes = 0) {
        const globalAvg = Math.round(globalAvgMinutes || 0);

        Charts.destroy('efficiency');
        const ctx = document.getElementById('chart-efficiency-compare').getContext('2d');

        const labels = ['Promedio General'];
        const data = [globalAvg];
        const colors = ['rgba(99, 102, 241, 0.5)'];

        if (operatorData && operatorData.id) {
            labels.push(operatorData.user);
            data.push(Math.round(operatorData.avg_minutes));
            colors.push('#a855f7');
        }

        Charts.efficiency = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Minutos por Tarea (Menos es mejor)',
                    data: data,
                    backgroundColor: colors,
                    borderRadius: 8,
                    barThickness: 40
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#94a3b8' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#f8fafc' }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    },

    async loadOperatorKPIs(userId) {
        if (!userId) {
            // Restore default chart if "Comparar Operario..." is selected
            try {
                const globalKpis = await Store.loadDashboardStats();
                this.renderEfficiencyChart(null, globalKpis.global_avg_minutes);
            } catch (err) {
                console.error("Error loading global KPIs:", err);
            }
            return;
        }

        try {
            const userIdNum = parseInt(userId, 10);
            const kpis = await Store.loadOperatorKPIs(userIdNum);

            const perfItem = Store.state.performanceData.find(p => p.id === userIdNum);
            const operatorName = perfItem ? perfItem.user : `Operario #${userIdNum}`;

            this.renderEfficiencyChart(
                { id: userIdNum, user: operatorName, avg_minutes: kpis.avg_minutes || 0 },
                kpis.global_avg_minutes
            );

            const select = document.getElementById('operator-compare-select');
            if (select) select.value = userId;

            UI.showSnackbar(`KPIs cargados: ${operatorName}`, 'success');
        } catch (err) {
            console.error("Error loading operator KPIs:", err);
            UI.showSnackbar('Error cargando KPIs del operario', 'error');
        }
    },

    async renderSKUHumanResources() {
        const tbody = document.getElementById('sku-stats-body');
        const emptyState = document.getElementById('sku-stats-empty');
        const table = document.getElementById('sku-stats-table');
        if (!tbody) return;

        let stats;
        try {
            stats = await Store.loadSKUStats();
        } catch (err) {
            console.error('Error loading SKU stats:', err);
            return;
        }

        tbody.innerHTML = '';

        if (!stats || stats.length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            if (table) table.classList.add('hidden');
            Charts.destroy('skuHours');
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');
        if (table) table.classList.remove('hidden');

        const maxHoras = Math.max(...stats.map(s => parseFloat(s.total_horas_hombre) || 0));

        stats.forEach(s => {
            const tr = document.createElement('tr');
            const sku = s.sku_destino;
            const nombre = SKU_NAMES[sku] || sku;
            const horas = parseFloat(s.total_horas_hombre) || 0;
            const pct = maxHoras > 0 ? Math.round((horas / maxHoras) * 100) : 0;
            const promedio = s.promedio_minutos != null ? `${s.promedio_minutos} min` : '-';
            const minMax = (s.minimo_minutos != null && s.maximo_minutos != null)
                ? `${s.minimo_minutos} / ${s.maximo_minutos} min`
                : '-';

            tr.innerHTML = `
                <td><span class="sku-code-badge">${sku}</span></td>
                <td>${nombre}</td>
                <td>${s.total_procesos}</td>
                <td>${s.total_operarios}</td>
                <td>
                    <div class="sku-hr-bar-cell">
                        <div class="sku-hr-bar-wrap">
                            <div class="sku-hr-bar" style="width:${pct}%"></div>
                        </div>
                        <span class="sku-hr-value">${horas} h</span>
                    </div>
                </td>
                <td>${promedio}</td>
                <td class="text-secondary">${minMax}</td>
            `;
            tbody.appendChild(tr);
        });

        Charts.destroy('skuHours');
        const ctx = document.getElementById('chart-sku-hours').getContext('2d');
        Charts.skuHours = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: stats.map(s => s.sku_destino),
                datasets: [
                    {
                        label: 'Horas-Hombre Totales',
                        data: stats.map(s => parseFloat(s.total_horas_hombre) || 0),
                        backgroundColor: 'rgba(99, 102, 241, 0.7)',
                        borderRadius: 6,
                    },
                    {
                        label: 'Promedio por Proceso (min)',
                        data: stats.map(s => parseFloat(s.promedio_minutos) || 0),
                        backgroundColor: 'rgba(168, 85, 247, 0.5)',
                        borderRadius: 6,
                        yAxisID: 'y2',
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#f8fafc', font: { size: 11 } }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Horas-Hombre', color: '#94a3b8' },
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#94a3b8' }
                    },
                    y2: {
                        beginAtZero: true,
                        position: 'right',
                        title: { display: true, text: 'Minutos/Proceso', color: '#94a3b8' },
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                },
                plugins: {
                    legend: {
                        labels: { color: '#94a3b8', font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            afterBody(items) {
                                const idx = items[0]?.dataIndex;
                                if (idx == null) return '';
                                const s = stats[idx];
                                return [
                                    `Procesos: ${s.total_procesos}`,
                                    `Operarios: ${s.total_operarios}`,
                                    `Mín: ${s.minimo_minutos} min  Máx: ${s.maximo_minutos} min`
                                ];
                            }
                        }
                    }
                }
            }
        });
    }
};
