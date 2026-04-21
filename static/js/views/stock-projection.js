/**
 * views/stock-projection.js — Proyección de Stock
 * Muestra disponibilidad proyectada de productos en los próximos días.
 */

const ViewStockProjection = (() => {
    let _lastProyeccion = null;

    async function _loadProyeccion(dias = 7) {
        try {
            const data = await API.get(`/api/planning/stock-projection?dias=${dias}`);
            return data;
        } catch (err) {
            console.error('[StockProjection] Error:', err);
            return null;
        }
    }

    function _renderTable(proyeccion) {
        if (!proyeccion || proyeccion.length === 0) {
            return '<p style="padding:1rem;color:var(--text-muted)">No hay datos de proyección.</p>';
        }

        // Extraer todos los SKUs únicos
        const allSkus = new Set();
        proyeccion.forEach(dia => {
            (dia.skus || []).forEach(sk => allSkus.add(sk.sku));
        });
        const skus = Array.from(allSkus).sort();

        // Construir tabla
        let html = `
            <table style="width:100%;font-size:.8rem;border-collapse:collapse;margin-top:1rem;">
                <thead>
                    <tr style="border-bottom:2px solid var(--border);background:var(--bg-secondary);">
                        <th style="text-align:left;padding:.5rem;min-width:80px;font-weight:600;">SKU</th>`;

        proyeccion.forEach(dia => {
            const fecha = new Date(dia.fecha + 'T00:00:00');
            const label = fecha.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });
            html += `<th style="text-align:center;padding:.5rem;min-width:100px;font-weight:600;">${label}</th>`;
        });
        html += `</tr></thead><tbody>`;

        // Filas por SKU
        skus.forEach(sku => {
            html += `<tr style="border-bottom:1px solid var(--border);">`;
            html += `<td style="padding:.5rem;font-weight:500;">${sku}</td>`;

            proyeccion.forEach(dia => {
                const skuData = (dia.skus || []).find(s => s.sku === sku);
                if (!skuData) {
                    html += `<td style="padding:.5rem;text-align:center;color:var(--text-muted);">—</td>`;
                } else {
                    const proj = skuData.stock_proyectado || 0;
                    const minimo = skuData.stock_minimo || 0;
                    const color = skuData.alerta
                        ? 'var(--danger)'
                        : proj < minimo
                            ? 'var(--warning,#d97706)'
                            : 'var(--success,#16a34a)';
                    html += `
                        <td style="padding:.5rem;text-align:center;">
                            <div style="color:${color};font-weight:600;">${proj}</div>
                            <div style="font-size:.7rem;color:var(--text-muted);">min: ${minimo}</div>
                        </td>`;
                }
            });

            html += `</tr>`;
        });

        html += `</tbody></table>`;
        return html;
    }

    function _render() {
        const container = document.getElementById('stock-projection-table');
        if (!container) return;

        if (!_lastProyeccion) {
            container.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">Presioná "Calcular" para generar proyección.</p>';
            return;
        }

        container.innerHTML = _renderTable(_lastProyeccion);
    }

    async function calculate() {
        const daysInput = document.getElementById('stock-projection-days');
        const dias = parseInt(daysInput?.value, 10) || 7;

        const container = document.getElementById('stock-projection-table');
        if (container) container.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">Calculando proyección...</p>';

        const data = await _loadProyeccion(dias);
        if (!data) {
            if (container) container.innerHTML = '<p style="padding:1rem;color:var(--danger)">Error al calcular proyección.</p>';
            return;
        }

        _lastProyeccion = data;
        _render();
        UI.showSnackbar('Proyección calculada', 'success');
    }

    async function load() {
        const btnCalculate = document.getElementById('stock-projection-calculate');
        if (btnCalculate) {
            btnCalculate.addEventListener('click', calculate);
        }
        _render();
    }

    return { load, calculate };
})();
