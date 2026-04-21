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
        let ok = 0, bajo = 0, zero = 0, sinDatos = 0;

        _products.forEach(p => {
            const qty  = p.stock;
            if (qty === null || qty === undefined) { sinDatos++; return; }
            if (qty <= 0) { zero++; return; }
            const rule = _rulesMap[p.sku];
            if (rule) {
                if (qty <= rule.stock_minimo) { bajo++; return; }
            }
            ok++;
        });

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('sp-kpi-activos', _activeSet.size);
        set('sp-kpi-ok',      ok);
        set('sp-kpi-bajo',    bajo);
        set('sp-kpi-zero',    zero + sinDatos);

        const bajoCard = document.getElementById('sp-card-bajo');
        if (bajoCard) bajoCard.classList.toggle('sp-card-alert', bajo > 0 || zero > 0);
    }

    // ─── Tab Estado ──────────────────────────────
    function _stockStatus(sku, qty) {
        if (qty === null || qty === undefined) return { cls: 'stock-zero', label: 'Sin datos', order: 0 };
        if (qty <= 0)                          return { cls: 'stock-zero', label: 'Sin stock',  order: 1 };
        const rule = _rulesMap[sku];
        if (rule) {
            if (qty <= rule.stock_minimo) return { cls: 'stock-med', label: 'Bajo mínimo', order: 2 };
        }
        return { cls: 'stock-high', label: 'OK', order: 3 };
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
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Sin resultados</td></tr>';
            return;
        }

        // Agrupar por caja
        const groups = {};
        list.forEach(p => {
            const caja = p.caja || 'Sin caja';
            if (!groups[caja]) groups[caja] = [];
            groups[caja].push(p);
        });

        const rows = [];
        Object.keys(groups).sort().forEach(caja => {
            rows.push(`<tr class="sp-caja-header">
                <td colspan="6" style="background:var(--surface-alt,#f3f4f6);font-weight:600;font-size:.8rem;color:var(--text-secondary);padding:.4rem .75rem;letter-spacing:.05em">
                    ${caja}
                </td>
            </tr>`);
            groups[caja].forEach(p => {
                const { cls, label } = _stockStatus(p.sku, p.stock);
                const rule   = _rulesMap[p.sku];
                const minStr = rule ? rule.stock_minimo : '—';
                const stockStr = (p.stock === null || p.stock === undefined)
                    ? '<span style="color:var(--text-muted);font-size:.8rem">Sin datos</span>'
                    : `<span class="stock-pill ${cls}">${p.stock}</span>`;
                let difStr = '—';
                if (rule && p.stock !== null && p.stock !== undefined) {
                    const dif = p.stock - rule.stock_minimo;
                    const color = dif >= 0 ? 'var(--success,#16a34a)' : 'var(--danger,#dc2626)';
                    difStr = `<span style="font-weight:600;color:${color}">${dif >= 0 ? '+' : ''}${dif}</span>`;
                }
                rows.push(`<tr class="sp-row-${cls}">
                    <td><code class="sp-sku-code">${p.sku}</code></td>
                    <td style="color:var(--text-secondary);font-size:.85rem">${p.description || '—'}</td>
                    <td>${stockStr}</td>
                    <td style="text-align:center;color:var(--text-secondary);font-size:.82rem">${minStr}</td>
                    <td style="text-align:center">${difStr}</td>
                    <td><span class="sp-status-pill sp-status-${cls}">${label}</span></td>
                </tr>`);
            });
        });
        tbody.innerHTML = rows.join('');
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
                stock: stockMap[sku] ?? null,
                caja: (activeSkus.find(s => s.sku.toUpperCase() === sku) || {}).caja || ''
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
                stock: _hasInventory ? (stockMap[s.sku.toUpperCase()] ?? null) : null,
                caja: s.caja || ''
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
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">Sin reglas definidas</td></tr>';
            return;
        }

        tbody.innerHTML = [...rules].sort((a, b) => a.sku.localeCompare(b.sku)).map(r => `
            <tr>
                <td><code>${r.sku}</code></td>
                <td><span class="stock-pill stock-med">${r.stock_minimo}</span></td>
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
            const sku    = (document.getElementById('sp-rule-sku').value || '').trim().toUpperCase();
            const minimo = parseInt(document.getElementById('sp-rule-minimo').value, 10);

            if (!sku || isNaN(minimo)) {
                UI.showSnackbar('Completa todos los campos', 'error'); return;
            }
            if (minimo < 0) {
                UI.showSnackbar('El stock mínimo debe ser >= 0', 'error'); return;
            }

            const body = { sku, stock_minimo: minimo };
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
        document.getElementById('sp-rule-sku').value    = rule.sku;
        document.getElementById('sp-rule-minimo').value = rule.stock_minimo;
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
                    // Lazy-load tiempos al entrar al tab por primera vez
                    if (btn.dataset.tab === 'tiempos' && !_timesList.length) {
                        _loadTimes();
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

        // Formulario de tiempos
        _wireTimesForm();

        // Activar tab Estado por defecto
        _switchTab('estado');

        // Cargar datos
        await _loadInitial();
    }

    // ─── CSV Upload ───────────────────────────────
    async function uploadCSV(tipo) {
        const fileInput = document.getElementById(`sp-csv-${tipo}-file`);
        const feedback  = document.getElementById(`sp-csv-${tipo}-feedback`);
        const file = fileInput?.files?.[0];

        if (!file) {
            if (feedback) feedback.innerHTML = '<span style="color:var(--danger)">Selecciona un archivo CSV primero.</span>';
            return;
        }

        if (feedback) feedback.innerHTML = '<span style="color:var(--text-muted)">Subiendo...</span>';

        const formData = new FormData();
        formData.append('file', file);

        try {
            const token = localStorage.getItem('reproceso_token');
            const url = tipo === 'productos' ? '/api/upload/productos-csv' : '/api/upload/tiempos-csv';
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Error al subir');
            if (feedback) feedback.innerHTML = `<span style="color:var(--success)">✓ ${data.upserted} registros cargados correctamente.</span>`;
            if (fileInput) fileInput.value = '';
            UI.showSnackbar(`CSV de ${tipo} cargado: ${data.upserted} registros`, 'success');
            // Recargar datos si fue de productos
            if (tipo === 'productos') await _loadInitial();
        } catch (err) {
            if (feedback) feedback.innerHTML = `<span style="color:var(--danger)">${err.message}</span>`;
            UI.showSnackbar(`Error: ${err.message}`, 'error');
        }
    }

    function downloadTemplate(tipo) {
        let csv, filename;
        if (tipo === 'productos') {
            csv = 'sku,descripcion,caja\nGGAL070,Galleta Galletita 70g,Caja 1\nIMOCA,Imperial Moca,Caja 2\n';
            filename = 'plantilla_productos.csv';
        } else if (tipo === 'tiempos') {
            csv = 'sku,minutos_por_caja,minutos_por_unidad,factor_empaque,categoria\nGGAL070,28,2.3,12,Galletas\nIMOCA,42,7,6,Imperiales\n';
            filename = 'plantilla_tiempos.csv';
        } else {
            csv = 'sku,minutos_por_caja\nGGAL070,28\nIMOCA,42\n';
            filename = 'plantilla_tiempos.csv';
        }
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    }

    // ─── Tab Tiempos ─────────────────────────────
    let _timesList = [];
    let _editTimeId = null;

    async function _loadTimes() {
        try {
            const data = await API.get('/api/product-times');
            _timesList = data.times || [];
            _renderTimesTable();
        } catch (err) {
            console.error('[StockPanel] Error al cargar tiempos:', err);
            UI.showSnackbar('Error al cargar tiempos de producción', 'error');
        }
    }

    function _renderTimesTable() {
        const tbody = document.getElementById('sp-times-body');
        if (!tbody) return;

        if (!_timesList.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Sin tiempos definidos</td></tr>';
            return;
        }

        tbody.innerHTML = _timesList.sort((a, b) => a.sku.localeCompare(b.sku)).map(t => `
            <tr>
                <td><code>${t.sku}</code></td>
                <td>${t.categoria || '—'}</td>
                <td>${t.minutos_por_caja ? parseFloat(t.minutos_por_caja).toFixed(1) : '—'}</td>
                <td>${t.minutos_por_unidad ? parseFloat(t.minutos_por_unidad).toFixed(2) : '—'}</td>
                <td style="text-align:center">${t.factor_empaque || 1}</td>
                <td>
                    <button class="btn btn-ghost btn-sm" onclick="ViewStockPanel.editTime('${t.sku}')">Editar</button>
                    <button class="btn btn-ghost btn-sm btn-danger-text" onclick="ViewStockPanel.deleteTime('${t.sku}')">Eliminar</button>
                </td>
            </tr>`).join('');
    }

    function _wireTimesForm() {
        const form = document.getElementById('sp-times-form');
        if (!form || form._wired) return;
        form._wired = true;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const sku = (document.getElementById('sp-times-sku').value || '').trim().toUpperCase();
            const mpc = parseFloat(document.getElementById('sp-times-mpc').value || '0');
            const mpu = document.getElementById('sp-times-mpu').value ? parseFloat(document.getElementById('sp-times-mpu').value) : null;
            const factor = parseInt(document.getElementById('sp-times-factor').value || '1', 10);
            const categoria = (document.getElementById('sp-times-categoria').value || '').trim();

            if (!sku || mpc < 0) {
                UI.showSnackbar('Completa SKU y Minutos/Caja', 'error'); return;
            }

            const body = { minutos_por_caja: mpc, minutos_por_unidad: mpu, factor_empaque: factor, categoria };
            try {
                await API.put(`/api/product-times/${sku}`, body);
                UI.showSnackbar(`Tiempos guardados: ${sku}`, 'success');
                form.reset();
                _editTimeId = null;
                document.getElementById('sp-times-cancel').classList.add('hidden');
                document.getElementById('sp-times-form-title').textContent = 'Nuevo tiempo';
                await _loadTimes();
            } catch (err) {
                UI.showSnackbar(`Error: ${err.message || 'No se pudo guardar'}`, 'error');
            }
        });

        const cancelBtn = document.getElementById('sp-times-cancel');
        if (cancelBtn && !cancelBtn._wired) {
            cancelBtn._wired = true;
            cancelBtn.addEventListener('click', () => {
                _editTimeId = null;
                document.getElementById('sp-times-form').reset();
                cancelBtn.classList.add('hidden');
                document.getElementById('sp-times-form-title').textContent = 'Nuevo tiempo';
            });
        }
    }

    function editTime(sku) {
        const t = _timesList.find(x => x.sku === sku.toUpperCase());
        if (!t) return;

        _editTimeId = sku;
        document.getElementById('sp-times-sku').value = t.sku;
        document.getElementById('sp-times-mpc').value = t.minutos_por_caja || '';
        document.getElementById('sp-times-mpu').value = t.minutos_por_unidad || '';
        document.getElementById('sp-times-factor').value = t.factor_empaque || 1;
        document.getElementById('sp-times-categoria').value = t.categoria || '';
        document.getElementById('sp-times-form-title').textContent = `Editar: ${t.sku}`;
        document.getElementById('sp-times-cancel').classList.remove('hidden');
        document.getElementById('sp-times-sku').disabled = true;
    }

    function deleteTime(sku) {
        if (confirm(`¿Eliminar tiempos de ${sku}?`)) {
            // Para eliminar, hacer un PUT con valores vacíos o un DELETE si lo soporta
            // Por ahora, mostrar mensaje
            UI.showSnackbar(`Función de eliminar no implementada aún para ${sku}`, 'info');
        }
    }

    return { render, sync, startEdit, deleteRule, uploadCSV, downloadTemplate, editTime, deleteTime };

})();
