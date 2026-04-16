/**
 * ViewActiveSkus — Selector de productos activos del sistema.
 * El maestro elige cuáles de los ~600 SKUs de Laudus usará el sistema.
 * Los seleccionados se guardan en PostgreSQL y son la fuente de verdad
 * para procesos, inventario y reglas de stock.
 */
const ViewActiveSkus = (() => {
    let _allProducts = [];   // todos los de Laudus
    let _activeSet   = new Set(); // skus activos actualmente
    let _filter      = '';

    async function render() {
        _wireSearch();
        _renderSkeleton();
        try {
            const [laudusData, activeData] = await Promise.all([
                API.get('/api/laudus/products'),
                API.get('/api/active-skus')
            ]);
            _allProducts = laudusData.products || [];
            _activeSet   = new Set((activeData.skus || []).map(s => s.sku.toUpperCase()));
            _renderList();
        } catch (err) {
            console.error('[ActiveSkus] Error al cargar:', err);
            UI.showSnackbar('Error al cargar productos de Laudus', 'error');
        }
    }

    function _renderSkeleton() {
        const container = document.getElementById('active-skus-list');
        if (container) container.innerHTML = '<p style="color:var(--text-muted);padding:1rem">Cargando productos de Laudus...</p>';
    }

    function _renderList() {
        const container = document.getElementById('active-skus-list');
        if (!container) return;

        const q = _filter.toLowerCase();
        const filtered = q
            ? _allProducts.filter(p =>
                p.sku.toLowerCase().includes(q) ||
                p.descripcion.toLowerCase().includes(q))
            : _allProducts;

        if (!filtered.length) {
            container.innerHTML = '<p style="color:var(--text-muted);padding:1rem">Sin resultados</p>';
            return;
        }

        container.innerHTML = filtered.map(p => {
            const sku     = p.sku.toUpperCase();
            const checked = _activeSet.has(sku) ? 'checked' : '';
            return `<label class="sku-selector-row ${checked ? 'active' : ''}" data-sku="${sku}">
                <input type="checkbox" class="sku-checkbox" value="${sku}" data-desc="${p.descripcion}" ${checked}>
                <span class="sku-selector-code">${sku}</span>
                <span class="sku-selector-desc">${p.descripcion || '—'}</span>
            </label>`;
        }).join('');

        // Eventos
        container.querySelectorAll('.sku-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                const sku = cb.value.toUpperCase();
                if (cb.checked) {
                    _activeSet.add(sku);
                    cb.closest('label').classList.add('active');
                } else {
                    _activeSet.delete(sku);
                    cb.closest('label').classList.remove('active');
                }
                _updateCounter();
            });
        });

        _updateCounter();
    }

    function _updateCounter() {
        const el = document.getElementById('active-skus-count');
        if (el) el.textContent = `${_activeSet.size} seleccionados`;
    }

    function _wireSearch() {
        const input = document.getElementById('active-skus-search');
        if (!input || input._wired) return;
        input._wired = true;
        input.addEventListener('input', () => {
            _filter = input.value.trim();
            _renderList();
        });

        const btnSave = document.getElementById('btn-save-active-skus');
        if (btnSave && !btnSave._wired) {
            btnSave._wired = true;
            btnSave.addEventListener('click', _save);
        }
    }

    async function _save() {
        const btn = document.getElementById('btn-save-active-skus');
        if (btn) btn.disabled = true;

        // Construir lista con descripción
        const skuMap = {};
        _allProducts.forEach(p => { skuMap[p.sku.toUpperCase()] = p.descripcion; });

        const skus = [..._activeSet].map(sku => ({
            sku,
            descripcion: skuMap[sku] || ''
        }));

        try {
            await API.post('/api/active-skus', { skus });
            UI.showSnackbar(`${skus.length} SKUs activos guardados`, 'success');
        } catch (err) {
            UI.showSnackbar('Error al guardar', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    return { render };
})();
