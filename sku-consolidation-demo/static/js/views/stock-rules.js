/**
 * ViewStockRules — Gestión de reglas de stock mínimo por SKU
 * Solo accesible para Maestro.
 */
const ViewStockRules = (() => {
    let _rules = [];
    let _editingId = null;

    // ── Render principal ─────────────────────────
    async function render() {
        _wireForm();
        await _load();
    }

    async function _load() {
        try {
            const data = await API.get('/api/stock-rules');
            _rules = data.rules || [];
            _renderTable();
        } catch (err) {
            console.error('[StockRules] Error al cargar:', err);
            UI.showSnackbar('Error al cargar reglas', 'error');
        }
    }

    function _renderTable() {
        const tbody = document.getElementById('rules-table-body');
        if (!tbody) return;

        if (!_rules.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Sin reglas definidas</td></tr>';
            return;
        }

        tbody.innerHTML = _rules.map(r => `
            <tr>
                <td><code>${r.sku}</code></td>
                <td><span class="stock-pill stock-med">${r.stock_minimo}</span></td>
                <td><span class="stock-pill stock-low">${r.stock_critico}</span></td>
                <td>
                    <button class="btn btn-ghost btn-sm" onclick="ViewStockRules.startEdit(${r.id})">Editar</button>
                    <button class="btn btn-ghost btn-sm btn-danger-text" onclick="ViewStockRules.deleteRule(${r.id}, '${r.sku}')">Eliminar</button>
                </td>
            </tr>
        `).join('');
    }

    // ── Formulario ───────────────────────────────
    function _wireForm() {
        const form = document.getElementById('stock-rule-form');
        if (!form || form._wired) return;
        form._wired = true;
        form.addEventListener('submit', _handleSubmit);

        const btnCancel = document.getElementById('btn-rule-cancel');
        if (btnCancel) btnCancel.addEventListener('click', _resetForm);
    }

    async function _handleSubmit(e) {
        e.preventDefault();
        const sku      = document.getElementById('rule-sku').value.trim().toUpperCase();
        const minimo   = parseInt(document.getElementById('rule-minimo').value, 10);
        const critico  = parseInt(document.getElementById('rule-critico').value, 10);

        if (!sku || isNaN(minimo) || isNaN(critico)) {
            UI.showSnackbar('Completa todos los campos', 'error');
            return;
        }
        if (critico >= minimo) {
            UI.showSnackbar('Stock crítico debe ser menor que stock mínimo', 'error');
            return;
        }

        const body = { sku, stock_minimo: minimo, stock_critico: critico };
        try {
            if (_editingId) {
                await API.put(`/api/stock-rules/${_editingId}`, body);
                UI.showSnackbar('Regla actualizada', 'success');
            } else {
                await API.post('/api/stock-rules', body);
                UI.showSnackbar('Regla creada', 'success');
            }
            _resetForm();
            await _load();
        } catch (err) {
            const msg = err.detail || err.message || 'Error al guardar';
            UI.showSnackbar(msg, 'error');
        }
    }

    function startEdit(id) {
        const rule = _rules.find(r => r.id === id);
        if (!rule) return;
        _editingId = id;

        document.getElementById('rule-sku').value     = rule.sku;
        document.getElementById('rule-minimo').value  = rule.stock_minimo;
        document.getElementById('rule-critico').value = rule.stock_critico;
        document.getElementById('rule-form-title').textContent = `Editando regla: ${rule.sku}`;
        document.getElementById('btn-rule-cancel').classList.remove('hidden');
        document.getElementById('rule-sku').focus();
    }

    function _resetForm() {
        _editingId = null;
        const form = document.getElementById('stock-rule-form');
        if (form) form.reset();
        const title = document.getElementById('rule-form-title');
        if (title) title.textContent = 'Nueva regla';
        const btnCancel = document.getElementById('btn-rule-cancel');
        if (btnCancel) btnCancel.classList.add('hidden');
    }

    async function deleteRule(id, sku) {
        UI.showModal(
            'Eliminar regla',
            `¿Eliminar la regla para ${sku}?`,
            async () => {
                try {
                    await API.delete(`/api/stock-rules/${id}`);
                    UI.showSnackbar('Regla eliminada', 'success');
                    await _load();
                } catch (err) {
                    UI.showSnackbar('Error al eliminar', 'error');
                }
            },
            'danger'
        );
    }

    return { render, startEdit, deleteRule };
})();
