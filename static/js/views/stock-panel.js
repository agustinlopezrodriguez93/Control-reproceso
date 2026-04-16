/**
 * ViewStockPanel — Panel unificado de Stock (Maestro)
 * Combina: Estado de Stock (inventario + reglas), Reglas de Stock, Productos Activos.
 * Se muestra como primera vista al iniciar sesión como Maestro.
 */
const ViewStockPanel = (() => {
    // ─── Estado interno ──────────────────────────
    let _products    = [];        // [{sku, description, stock}] — SKUs activos
    let _rulesMap    = {};        // sku.upper → {id, stock_minimo, stock_critico}
    let _activeSet   = new Set(); // skus activos (upper)
    let _laudusList  = [];        // todos los productos de Laudus (para tab Productos)
    let _editRuleId  = null;
    let _filterEstado = '';
    let _filterProds  = '';
    let _hasInventory = false;

    // ─── Tab switching ───────────────────────────
    function _switchTab(tab) {
        document.querySelectorAll('.sp-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        document.querySelectorAll('.sp-tab-panel').forEach(panel => {
            panel.classList.toggle('hidden', panel.id !== `sp-tab-${tab}`);
        });
    }

    // ─── KPIs ─────────────────────────────────────
    function _updateKPIs() {
        let ok = 0, bajo = 0, critico = 0, zero = 0, sinDatos = 0;

        _products.forEach(p => {
            const qty  = p.stock;
            if (qty === null || qty === undefined) { sinDatos++; return; }
            if (qty <= 0) { zero++; return; }
            const rule = _rulesMap[p.sku];
            if (rule) {
                if (qty <= rule.stock_critico) { critico++; return; }
                if (qty <= rule.stock_minimo)  { bajo++;    return; }
            }
            ok++;
        });

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('sp-kpi-activos',   _activeSet.size);
        set('sp-kpi-ok',        ok);
        set('sp-kpi-bajo',      bajo);
        set('sp-kpi-critico',   critico);
        set('sp-kpi-zero',      zero + sinDatos);

        // Resaltar tarjeta crítico si hay alertas
        const critCard = document.getElementById('sp-card-critico');
        if (critCard) critCard.classList.toggle('sp-card-alert', critico > 0 || zero > 0);
        const bajoCard = document.getElementById('sp-card-bajo');
        if (bajoCard) bajoCard.classList.toggle('sp-card-warn', bajo > 0);
    }

    // ─── Tab Estado ──────────────────────────────
    function _stockStatus(sku, qty) {
        if (qty === null || qty === undefined) return { cls: 'stock-zero',  label: 'Sin datos', order: 0 };
        if (qty <= 0)                          return { cls: 'stock-zero',  label: 'Sin stock', order: 1 };
        const rule = _rulesMap[sku];
        if (rule) {
            if (qty <= rule.stock_critico) return { cls: 'stock-low',  label: 'CRÍTICO', order: 2 };
            if (qty <= rule.stock_minimo)  return { cls: 'stock-med',  label: 'Bajo',    order: 3 };
        }
        return { cls: 'stock-high', label: 'OK', order: 4 };
    }

    function _renderEstado() {
        const tbody = document.getElementById('sp-estado-body');
        const noData = document.getElementById('sp-estado-nodata');
        if (!tbody) return;

        const q = _filterEstado.toLowerCase();
        let list = q
            ? _products.filter(p =>
                p.sku.toLowerCase().includes(q) ||
                (p.description || '').toLowerCase().includes(q))
            : [..._products];

        // Ordenar: sin datos → sin stock → crítico → bajo → ok
        list.sort((a, b) => {
            const sa = _stockStatus(a.sku, a.stock).order;
            const sb = _stockStatus(b.sku, b.stock).order;
            return sa - sb;
        });

        if (!list.length && !_hasInventory) {
            tbody.innerHTML = '';
            if (noData) noData.classList.remove('hidden');
            return;
        }
        if (noData) noData.classList.add('hidden');

        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Sin resultados</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(p => {
            const { cls, label } = _stockStatus(p.sku, p.stock);
            const rule     = _rulesMap[p.sku];
            const minStr   = rule ? rule.stock_minimo  : '—';
            const critStr  = rule ? rule.stock_critico : '—';
            const stockStr = (p.stock === null || p.stock === undefined)
                ? '<span style="color:var(--text-muted);font-size:.8rem">Sin datos</span>'
                : `<span class="stock-pill ${cls}">${p.stock}</span>`;
            return `<tr class="sp-row-${cls}">
                <td><code class="sp-sku-code">${p.sku}</code></td>
                <td style="color:var(--text-secondary);font-size:.85rem">${p.description || '—'}</td>
                <td>${stockStr}</td>
                <td style="color:var(--text-secondary);font-size:.82rem;text-align:center">${minStr} / ${critStr}</td>
                <td><span class="sp-status-pill sp-status-${cls}">${label}</span></td>
            </tr>`;
        }).join('');
    }

    // ─── Sincronización ──────────────────────────
    async function sync(showSnack = true) {
        const btn = document.getElementById('btn-panel-sync');
        const origHTML = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.innerHTML = '<span style="opacity:.6">Sincronizando...</span>'; }

        try {
            const [stockData, rulesData, activeData] = await Promise.all([
                API.get('/api/inventory/stock'),
                API.get('/api/stock-rules').catch(() => ({ rules: [] })),
                API.get('/api/active-skus').catch(() => ({ skus: [] }))
            ]);

            _rulesMap = {};
            (rulesData.rules || []).forEach(r => {
                _rulesMap[r.sku.toUpperCase()] = { ...r, sku: r.sku.toUpperCase() };
            });

            const activeSkus = (activeData.skus || []);
            _activeSet = new Set(activeSkus.map(s => s.sku.toUpperCase()));

            // Mapa de descripciones: priorizar DB (active_skus), completar con Laudus
            const descMap = {};
            activeSkus.forEach(s => { descMap[s.sku.toUpperCase()] = s.descripcion || ''; });

            const allLaudus = stockData.products || [];
            const stockMap = {};
            allLaudus.forEach(p => {
                const sku = (p.sku || '').toUpperCase();
                stockMap[sku] = p.stock ?? 0;
                if (!descMap[sku]) descMap[sku] = p.description || '';
            });

            _hasInventory = true;
            _products = [..._activeSet].map(sku => ({
                sku,
                description: descMap[sku] || '',
                stock: stockMap[sku] ?? null
            }));

            _renderEstado();
            _updateKPIs();
            _renderRulesTable();
            if (showSnack) UI.showSnackbar('Inventario sincronizado', 'success');
        } catch (err) {
            console.error('[StockPanel] Error al sincronizar:', err);
            if (showSnack) UI.showSnackbar('Error al sincronizar inventario', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
        }
    }

    // ─── Carga inicial (sin llamar a Laudus) ─────
    async function _loadInitial() {
        try {
            const [rulesData, activeData, statusData] = await Promise.all([
                API.get('/api/stock-rules').catch(() => ({ rules: [] })),
                API.get('/api/active-skus').catch(() => ({ skus: [] })),
                API.get('/api/stock-status').catch(() => null)
            ]);

            _rulesMap = {};
            (rulesData.rules || []).forEach(r => {
                _rulesMap[r.sku.toUpperCase()] = { ...r, sku: r.sku.toUpperCase() };
            });

            const activeSkus = (activeData.skus || []);
            _activeSet = new Set(activeSkus.map(s => s.sku.toUpperCase()));

            // Construir mapa de stock desde caché (sin llamar a Laudus)
            const stockMap = {};
            _hasInventory = !!(statusData?.has_inventory);
            if (_hasInventory) {
                const all = [
                    ...(statusData.criticos || []),
                    ...(statusData.bajos    || []),
                    ...(statusData.ok       || [])
                ];
                all.forEach(i => { stockMap[i.sku.toUpperCase()] = i.stock; });
            }

            _products = activeSkus.map(s => ({
                sku: s.sku.toUpperCase(),
                description: s.descripcion || '',
                stock: _hasInventory ? (stockMap[s.sku.toUpperCase()] ?? null) : null
            }));

            _renderEstado();
            _updateKPIs();
            _renderRulesTable();
        } catch (err) {
            console.error('[StockPanel] Error al cargar datos iniciales:', err);
        }
    }

    // ─── Tab Reglas ──────────────────────────────
    function _renderRulesTable() {
        const tbody = document.getElementById('sp-rules-body');
        if (!tbody) return;
        const rules = Object.values(_rulesMap);

        if (!rules.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Sin reglas definidas</td></tr>';
            return;
        }

        tbody.innerHTML = [...rules].sort((a, b) => a.sku.localeCompare(b.sku)).map(r => `
            <tr>
                <td><code>${r.sku}</code></td>
                <td><span class="stock-pill stock-med">${r.stock_minimo}</span></td>
                <td><span class="stock-pill stock-low">${r.stock_critico}</span></td>
                <td>
                    <button class="btn btn-ghost btn-sm" onclick="ViewStockPanel.startEdit(${r.id})">Editar</button>
                    <button class="btn btn-ghost btn-sm btn-danger-text" onclick="ViewStockPanel.deleteRule(${r.id},'${r.sku}')">Eliminar</button>
                </td>
            </tr>`).join('');
    }

    function _wireRuleForm() {
        const form = document.getElementById('sp-rule-form');
        if (!form || form._wired) return;
        form._wired = true;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const sku     = (document.getElementById('sp-rule-sku').value || '').trim().toUpperCase();
            const minimo  = parseInt(document.getElementById('sp-rule-minimo').value, 10);
            const critico = parseInt(document.getElementById('sp-rule-critico').value, 10);

            if (!sku || isNaN(minimo) || isNaN(critico)) {
                UI.showSnackbar('Completa todos los campos', 'error'); return;
            }
            if (critico >= minimo) {
                UI.showSnackbar('Stock crítico debe ser menor que el mínimo', 'error'); return;
            }

            const body = { sku, stock_minimo: minimo, stock_critico: critico };
            try {
                let saved;
                if (_editRuleId) {
                    saved = await API.put(`/api/stock-rules/${_editRuleId}`, body);
                    UI.showSnackbar('Regla actualizada', 'success');
                } else {
                    saved = await API.post('/api/stock-rules', body);
                    UI.showSnackbar('Regla creada', 'success');
                }
                _rulesMap[sku] = { ...saved, sku };
                _resetRuleForm();
                _renderRulesTable();
                _renderEstado();
                _updateKPIs();
            } catch (err) {
                UI.showSnackbar(err.detail || err.message || 'Error al guardar', 'error');
            }
        });

        document.getElementById('sp-rule-cancel')?.addEventListener('click', _resetRuleForm);
    }

    function _resetRuleForm() {
        _editRuleId = null;
        document.getElementById('sp-rule-form')?.reset();
        const title = document.getElementById('sp-rule-form-title');
        if (title) title.textContent = 'Nueva regla';
        document.getElementById('sp-rule-cancel')?.classList.add('hidden');
    }

    function startEdit(id) {
        const rule = Object.values(_rulesMap).find(r => r.id === id);
        if (!rule) return;
        _editRuleId = id;
        document.getElementById('sp-rule-sku').value     = rule.sku;
        document.getElementById('sp-rule-minimo').value  = rule.stock_minimo;
        document.getElementById('sp-rule-critico').value = rule.stock_critico;
        const title = document.getElementById('sp-rule-form-title');
        if (title) title.textContent = `Editando: ${rule.sku}`;
        document.getElementById('sp-rule-cancel')?.classList.remove('hidden');
        document.getElementById('sp-rule-sku').focus();
        // Ir al tab de reglas
        _switchTab('reglas');
    }

    function deleteRule(id, sku) {
        UI.showModal('Eliminar regla', `¿Eliminar la regla para ${sku}?`, async () => {
            try {
                await API.delete(`/api/stock-rules/${id}`);
                delete _rulesMap[sku.toUpperCase()];
                _renderRulesTable();
                _renderEstado();
                _updateKPIs();
                UI.showSnackbar('Regla eliminada', 'success');
            } catch (err) {
                UI.showSnackbar('Error al eliminar', 'error');
            }
        }, 'danger');
    }

    // ─── Tab Productos Activos ───────────────────
    async function _loadProducts() {
        const container = document.getElementById('sp-products-list');
        if (!container) return;
        container.innerHTML = '<p style="color:var(--text-muted);padding:1rem">Cargando productos de Laudus...</p>';

        try {
            const [laudusData, activeData] = await Promise.all([
                API.get('/api/laudus/products'),
                API.get('/api/active-skus')
            ]);
            _laudusList = laudusData.products || [];
            _activeSet  = new Set((activeData.skus || []).map(s => s.sku.toUpperCase()));
            _renderProductsList();
        } catch (err) {
            console.error('[StockPanel] Error al cargar productos:', err);
            if (container) container.innerHTML = '<p style="color:var(--danger);padding:1rem">Error al cargar productos de Laudus</p>';
        }
    }

    function _renderProductsList() {
        const container = document.getElementById('sp-products-list');
        if (!container) return;

        const q = _filterProds.toLowerCase();
        const filtered = q
            ? _laudusList.filter(p =>
                p.sku.toLowerCase().includes(q) ||
                (p.descripcion || '').toLowerCase().includes(q))
            : _laudusList;

        if (!filtered.length) {
            container.innerHTML = '<p style="color:var(--text-muted);padding:1rem">Sin resultados</p>';
            return;
        }

        container.innerHTML = filtered.map(p => {
            const sku     = p.sku.toUpperCase();
            const checked = _activeSet.has(sku) ? 'checked' : '';
            return `<label class="sku-selector-row ${checked ? 'active' : ''}" data-sku="${sku}">
                <input type="checkbox" class="sku-checkbox" value="${sku}" data-desc="${p.descripcion || ''}" ${checked}>
                <span class="sku-selector-code">${sku}</span>
                <span class="sku-selector-desc">${p.descripcion || '—'}</span>
            </label>`;
        }).join('');

        container.querySelectorAll('.sku-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                const sku = cb.value.toUpperCase();
                if (cb.checked) { _activeSet.add(sku); cb.closest('label').classList.add('active'); }
                else            { _activeSet.delete(sku); cb.closest('label').classList.remove('active'); }
                _updateProductsCount();
            });
        });
        _updateProductsCount();
    }

    function _updateProductsCount() {
        const el = document.getElementById('sp-products-count');
        if (el) el.textContent = `${_activeSet.size} seleccionados`;
    }

    async function _saveProducts() {
        const btn = document.getElementById('sp-save-products');
        if (btn) btn.disabled = true;

        const skuMap = {};
        _laudusList.forEach(p => { skuMap[p.sku.toUpperCase()] = p.descripcion || ''; });

        const skus = [..._activeSet].map(sku => ({ sku, descripcion: skuMap[sku] || '' }));
        try {
            await API.post('/api/active-skus', { skus });
            UI.showSnackbar(`${skus.length} SKUs activos guardados`, 'success');
            // Recargar el panel de estado con los nuevos SKUs activos
            await _loadInitial();
        } catch (err) {
            UI.showSnackbar('Error al guardar', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ─── Render principal ─────────────────────────
    async function render() {
        // Fecha
        const dateEl = document.getElementById('stock-panel-date');
        if (dateEl) {
            dateEl.textContent = new Date().toLocaleDateString('es-CL', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
        }

        // Tabs
        document.querySelectorAll('.sp-tab').forEach(btn => {
            if (!btn._wired) {
                btn._wired = true;
                btn.addEventListener('click', () => {
                    _switchTab(btn.dataset.tab);
                    // Lazy-load productos al entrar al tab por primera vez
                    if (btn.dataset.tab === 'productos' && !_laudusList.length) {
                        _loadProducts();
                    }
                });
            }
        });

        // Botón sync
        const syncBtn = document.getElementById('btn-panel-sync');
        if (syncBtn && !syncBtn._wired) {
            syncBtn._wired = true;
            syncBtn.addEventListener('click', () => sync(true));
        }

        // Search estado
        const searchEstado = document.getElementById('sp-estado-search');
        if (searchEstado && !searchEstado._wired) {
            searchEstado._wired = true;
            searchEstado.addEventListener('input', () => {
                _filterEstado = searchEstado.value.trim();
                _renderEstado();
            });
        }

        // Search productos
        const searchProds = document.getElementById('sp-products-search');
        if (searchProds && !searchProds._wired) {
            searchProds._wired = true;
            searchProds.addEventListener('input', () => {
                _filterProds = searchProds.value.trim();
                _renderProductsList();
            });
        }

        // Guardar productos
        const saveBtn = document.getElementById('sp-save-products');
        if (saveBtn && !saveBtn._wired) {
            saveBtn._wired = true;
            saveBtn.addEventListener('click', _saveProducts);
        }

        // Formulario de reglas
        _wireRuleForm();

        // Activar tab Estado por defecto
        _switchTab('estado');

        // Cargar datos
        await _loadInitial();
    }

    return { render, sync, startEdit, deleteRule };
})();
