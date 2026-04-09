/**
 * ViewInventory — Vista de inventario Laudus ERP
 * Llama a GET /api/inventory/stock y renderiza la tabla con pills de stock.
 */
const ViewInventory = (() => {
    let _allProducts = [];
    let _rulesMap = {};   // sku → { stock_minimo, stock_critico }

    function _stockClass(sku, qty) {
        if (qty <= 0) return 'stock-zero';
        const rule = _rulesMap[sku.toUpperCase()];
        if (rule) {
            if (qty <= rule.stock_critico)  return 'stock-low';
            if (qty <= rule.stock_minimo)   return 'stock-med';
            return 'stock-high';
        }
        // Sin regla: umbrales por defecto
        if (qty < 5)  return 'stock-low';
        if (qty < 20) return 'stock-med';
        return 'stock-high';
    }

    function _render(products) {
        const tbody = document.getElementById('inventory-table-body');
        if (!tbody) return;

        if (!products.length) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">Sin resultados</td></tr>';
            return;
        }

        tbody.innerHTML = products.map(p => {
            const qty   = p.stock ?? 0;
            const cls   = _stockClass(p.sku || '', qty);
            const label = cls === 'stock-zero' ? 'Sin stock' : cls === 'stock-low' ? 'Crítico' : cls === 'stock-med' ? 'Bajo' : 'OK';
            return `<tr>
                <td><code>${p.sku || '—'}</code></td>
                <td>${p.description || '—'}</td>
                <td><span class="stock-pill ${cls}">${qty} — ${label}</span></td>
            </tr>`;
        }).join('');
    }

    function _updateStats(products) {
        const total    = products.length;
        const conStock = products.filter(p => (p.stock ?? 0) > 0).length;
        const bajo     = products.filter(p => { const q = p.stock ?? 0; return q > 0 && q < 10; }).length;
        const sinStock = products.filter(p => (p.stock ?? 0) <= 0).length;

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('inv-total',     total);
        set('inv-con-stock', conStock);
        set('inv-bajo',      bajo);
        set('inv-sin-stock', sinStock);
    }

    async function render() {
        // Wire sync button and search on first render
        const btn = document.getElementById('btn-sync-inventory');
        if (btn && !btn._wired) {
            btn._wired = true;
            btn.addEventListener('click', sync);
        }
        const search = document.getElementById('inv-search');
        if (search && !search._wired) {
            search._wired = true;
            search.addEventListener('input', () => {
                const q = search.value.trim().toLowerCase();
                const filtered = q
                    ? _allProducts.filter(p =>
                        (p.sku || '').toLowerCase().includes(q) ||
                        (p.description || '').toLowerCase().includes(q))
                    : _allProducts;
                _render(filtered);
            });
        }
    }

    async function sync() {
        const btn = document.getElementById('btn-sync-inventory');
        if (btn) { btn.disabled = true; btn.textContent = 'Sincronizando...'; }

        try {
            // Traer reglas y stock en paralelo
            const [stockData, rulesData] = await Promise.all([
                API.get('/api/inventory/stock'),
                API.get('/api/stock-rules').catch(() => ({ rules: [] }))
            ]);
            _rulesMap = {};
            (rulesData.rules || []).forEach(r => { _rulesMap[r.sku.toUpperCase()] = r; });
            _allProducts = stockData.products || [];
            _render(_allProducts);
            _updateStats(_allProducts);

            // Clear search
            const search = document.getElementById('inv-search');
            if (search) search.value = '';

            if (typeof UI !== 'undefined') UI.showSnackbar('Inventario actualizado', 'success');
        } catch (err) {
            console.error('[Inventory] Error al sincronizar:', err);
            if (typeof UI !== 'undefined') UI.showSnackbar('Error al sincronizar inventario', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
                    <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
                </svg> Sincronizar`;
            }
        }
    }

    return { render, sync };
})();
