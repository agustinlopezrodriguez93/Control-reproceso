/**
 * views/optimization.js — Módulo de Optimización de Asignación
 * Solo visible para rol Maestro.
 * Sugiere qué operaria asignar a cada SKU del plan del día basándose en el historial.
 */
const ViewOptimization = (() => {

    async function render(fecha = null) {
        const container = document.getElementById('optimization-container');
        if (!container) return;
        container.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">Cargando análisis de asignación...</p>';

        try {
            const params = fecha ? `?fecha=${fecha}` : '';
            const data = await API.get(`/api/planning/optimize${params}`);
            _render(container, data);
        } catch (err) {
            container.innerHTML = `<p style="padding:1rem;color:var(--danger)">Error: ${err.message}</p>`;
        }
    }

    function _render(container, data) {
        const hoy = data.fecha;

        container.innerHTML = `
            <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem;flex-wrap:wrap;">
                <span style="font-weight:600;">Análisis para: ${hoy}</span>
                <input type="date" id="opt-fecha-input" value="${hoy}"
                    style="padding:.3rem .6rem;border:1px solid var(--border);border-radius:6px;font-size:.9rem;">
                <button class="btn btn-ghost btn-sm" onclick="ViewOptimization.reload()">Actualizar</button>
            </div>

            <!-- Capacidad por operaria -->
            <h3 style="margin-bottom:.75rem;">Carga vs. Capacidad por operaria</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem;margin-bottom:1.5rem;">
                ${data.capacidad_operarias.length
                    ? data.capacidad_operarias.map(o => _renderCapacidad(o, data.horas_jornada)).join('')
                    : '<p style="color:var(--text-muted)">Sin operarias registradas.</p>'
                }
            </div>

            <!-- Sugerencias de asignación -->
            <h3 style="margin-bottom:.75rem;">Sugerencias de asignación por SKU</h3>
            ${data.sugerencias.length === 0
                ? `<div class="card" style="padding:1.5rem;text-align:center;">
                    <p style="color:var(--text-muted)">Sin plan cargado para este día. Cargá un plan en la vista de Planificación primero.</p>
                   </div>`
                : `<div class="card">
                    <div class="table-container">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>SKU</th>
                                    <th style="text-align:center">Cajas plan</th>
                                    <th style="text-align:center">Min estimados</th>
                                    <th>Asignada actualmente</th>
                                    <th>Sugerida (más rápida)</th>
                                    <th>Top 3 ranking</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.sugerencias.map(s => _renderSugerencia(s)).join('')}
                            </tbody>
                        </table>
                    </div>
                   </div>`
            }

            ${data.sin_historial.length ? `
            <div class="card" style="padding:1rem;margin-top:1rem;border-left:3px solid var(--warning,#d97706);">
                <p style="font-size:.85rem;color:var(--text-secondary);">
                    <strong>Sin historial suficiente para:</strong> ${data.sin_historial.join(', ')}.
                    A medida que las operarias completen procesos, el sistema aprenderá sus velocidades.
                </p>
            </div>` : ''}
        `;
    }

    function _renderCapacidad(o, horasJornada) {
        const pct = Math.min(o.pct_carga, 100);
        const pctColor = pct >= 100 ? 'var(--danger,#dc2626)'
            : pct >= 80 ? 'var(--warning,#d97706)'
            : 'var(--success,#16a34a)';

        return `<div class="card" style="padding:1rem;">
            <div style="font-weight:600;margin-bottom:.5rem;">${o.nombre}</div>
            <div style="display:flex;justify-content:space-between;font-size:.78rem;color:var(--text-muted);margin-bottom:3px;">
                <span>${Math.round(o.minutos_asignados)} min asignados</span>
                <span style="color:${pctColor};font-weight:600">${o.pct_carga}%</span>
            </div>
            <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:${pctColor};"></div>
            </div>
            <div style="font-size:.75rem;color:var(--text-muted);margin-top:.3rem;">
                Disponible: <strong>${Math.round(o.disponible)} min</strong>
                (jornada ${horasJornada}h)
            </div>
        </div>`;
    }

    function _renderSugerencia(s) {
        const minsEst = Math.round(s.minutos_por_caja * s.cajas_plan);
        const sugerida = s.sugerencia
            ? `<span style="color:var(--success,#16a34a);font-weight:600">${s.sugerencia.operario}</span>
               <span style="font-size:.75rem;color:var(--text-muted)"> (${s.sugerencia.avg_min} min avg, ${s.sugerencia.muestras} muestras)</span>`
            : '<span style="color:var(--text-muted);font-size:.82rem">Sin datos históricos</span>';

        const ranking = s.ranking.length
            ? s.ranking.map((r, i) => `${i + 1}. ${r.operario} (${r.avg_min} min)`).join('<br>')
            : '—';

        return `<tr>
            <td><strong>${s.sku}</strong></td>
            <td style="text-align:center">${s.cajas_plan}</td>
            <td style="text-align:center">${minsEst || '—'}</td>
            <td style="color:var(--text-secondary)">${s.operario_asignado || '—'}</td>
            <td>${sugerida}</td>
            <td style="font-size:.78rem;color:var(--text-secondary);line-height:1.6">${ranking}</td>
        </tr>`;
    }

    async function reload() {
        const fechaInput = document.getElementById('opt-fecha-input');
        const fecha = fechaInput?.value || null;
        await render(fecha);
    }

    return { render, reload };
})();
