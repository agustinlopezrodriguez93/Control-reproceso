/**
 * views/planning.js — Módulo de Planificación Semanal de Producción
 * Solo visible para rol Maestro.
 */
const ViewPlanning = (() => {
    let _semana = [];           // [{fecha, items, minutos_plan, minutos_disponibles, pct_uso}]
    let _operarios = [];
    let _productTimes = {};     // {sku: minutos_por_caja, minutos_por_unidad, factor_empaque}
    let _horasJornada = 6.5;
    let _fechaInicio = null;    // lunes de la semana mostrada
    let _activeSkus = [];       // [{sku, descripcion, caja}]
    let _planPorUnidades = false; // modo planificación: false=cajas, true=unidades

    const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    // ─── Carga de datos ──────────────────────────
    async function load(fechaInicio = null) {
        const container = document.getElementById('planning-container');
        if (!container) return;
        container.innerHTML = '<p style="padding:1rem;color:var(--text-muted)">Cargando planificación...</p>';

        try {
            const params = fechaInicio ? `?fecha_inicio=${fechaInicio}` : '';
            const [planData, skuData] = await Promise.all([
                API.get(`/api/planning/semana${params}`),
                API.get('/api/active-skus').catch(() => ({ skus: [] }))
            ]);

            _semana        = planData.semana || [];
            _operarios     = planData.operarios || [];
            _productTimes  = planData.product_times || {};
            _horasJornada  = planData.horas_jornada || 6.5;
            _activeSkus    = skuData.skus || [];

            if (_semana.length > 0) {
                _fechaInicio = _semana[0].fecha;
            }

            _render(container);
        } catch (err) {
            console.error('[Planning] Error al cargar:', err);
            container.innerHTML = `<p style="padding:1rem;color:var(--danger)">Error al cargar planificación: ${err.message}</p>`;
        }
    }

    // ─── Render principal ─────────────────────────
    function _render(container) {
        const lunes = _fechaInicio ? new Date(_fechaInicio + 'T00:00:00') : new Date();
        const semanaLabel = lunes.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });

        container.innerHTML = `
            <!-- Navegación semanal -->
            <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem;flex-wrap:wrap;">
                <button class="btn btn-ghost btn-sm" id="plan-prev-week">← Semana anterior</button>
                <span style="font-weight:600;font-size:1rem;">Semana del ${semanaLabel}</span>
                <button class="btn btn-ghost btn-sm" id="plan-next-week">Semana siguiente →</button>
                <button class="btn btn-secondary btn-sm" id="plan-today">Hoy</button>
                <button class="btn btn-ghost btn-sm" id="plan-print" style="margin-left:auto;" onclick="window.print()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                        <rect x="6" y="14" width="12" height="8"/>
                    </svg>
                    Imprimir
                </button>
            </div>

            <!-- Config jornada -->
            <div class="card" style="padding:.75rem 1rem;margin-bottom:1rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
                <span style="font-size:.85rem;color:var(--text-secondary);">Horas por operaria/día:</span>
                <input type="number" id="plan-horas-jornada" value="${_horasJornada}" min="1" max="12" step="0.5"
                    style="width:70px;padding:.25rem .5rem;border:1px solid var(--border);border-radius:6px;font-size:.9rem;">
                <button class="btn btn-ghost btn-sm" onclick="ViewPlanning.saveHorasJornada()">Guardar</button>
                <span style="font-size:.82rem;color:var(--text-muted);">
                    ${_operarios.length} operaria${_operarios.length !== 1 ? 's' : ''} →
                    <strong>${(_horasJornada * _operarios.length).toFixed(1)}h</strong> disponibles/día
                </span>
            </div>

            <!-- Grid semanal -->
            <div class="planning-grid" id="planning-week-grid">
                ${_semana.map((dia, i) => _renderDia(dia, i)).join('')}
            </div>

            <!-- Formulario agregar ítem -->
            ${_renderFormAdd()}
        `;

        _wireEvents(container);
    }

    function _renderDia(dia, idx) {
        const fecha = new Date(dia.fecha + 'T00:00:00');
        const esHoy = dia.fecha === new Date().toISOString().slice(0, 10);
        const pct   = Math.min(dia.pct_uso, 100);
        const pctColor = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning,#d97706)' : 'var(--success,#16a34a)';

        const emergencias = dia.items.filter(it => it.es_emergencia);
        const normales    = dia.items.filter(it => !it.es_emergencia);

        return `
        <div class="planning-day-card card ${esHoy ? 'planning-today' : ''}" data-fecha="${dia.fecha}">
            <div class="planning-day-header">
                <span class="planning-day-name">${DIAS[idx]}</span>
                <span class="planning-day-date">${fecha.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}</span>
                ${esHoy ? '<span class="planning-badge-hoy">HOY</span>' : ''}
            </div>

            <!-- Barra de capacidad -->
            <div style="margin:.5rem 0;">
                <div style="display:flex;justify-content:space-between;font-size:.75rem;color:var(--text-muted);margin-bottom:3px;">
                    <span>${Math.round(dia.minutos_plan)} min plan</span>
                    <span style="color:${pctColor};font-weight:600">${dia.pct_uso}%</span>
                </div>
                <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:${pctColor};transition:width .3s;"></div>
                </div>
                <div style="font-size:.72rem;color:var(--text-muted);margin-top:2px;">
                    Cap: ${Math.round(dia.minutos_disponibles)} min
                </div>
            </div>

            <!-- Ítems planificados -->
            <div class="planning-items">
                ${normales.map(it => _renderItem(it)).join('')}
                ${emergencias.length ? `
                    <div style="font-size:.7rem;color:var(--danger);font-weight:600;margin:.35rem 0 .2rem;text-transform:uppercase;letter-spacing:.05em">
                        + Emergencias
                    </div>
                    ${emergencias.map(it => _renderItem(it)).join('')}
                ` : ''}
                ${!dia.items.length ? '<p style="font-size:.8rem;color:var(--text-muted);text-align:center;padding:.5rem 0">Sin planificar</p>' : ''}
            </div>

            <!-- Botón agregar -->
            <button class="btn btn-ghost btn-sm plan-add-btn" data-fecha="${dia.fecha}"
                style="width:100%;margin-top:.5rem;font-size:.8rem;border-style:dashed;">
                + Agregar
            </button>
        </div>`;
    }

    function _renderItem(it) {
        const mins = (it.minutos_por_caja || 0) * it.cajas_plan;
        const hoy = new Date().toISOString().slice(0, 10);
        const esHoy = it.fecha === hoy;

        let cierreHTML;
        if (esHoy) {
            const isChecked = it.cajas_real !== null && it.cajas_real !== undefined;
            cierreHTML = `
                <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-size:.7rem;">
                    <input type="checkbox" class="plan-done-checkbox" data-id="${it.id}"
                        ${isChecked ? 'checked' : ''} style="cursor:pointer;">
                    <span>${isChecked ? `Completado (${it.cajas_real} cj)` : 'Marcar completado'}</span>
                </label>`;
        } else {
            cierreHTML = it.cajas_real === null || it.cajas_real === undefined
                ? `<button class="btn btn-ghost btn-sm plan-cierre-btn" data-id="${it.id}"
                    style="font-size:.7rem;padding:.15rem .4rem;">Cerrar</button>`
                : `<span style="font-size:.7rem;color:var(--success,#16a34a);font-weight:600">
                    ✓ Real: ${it.cajas_real} cajas</span>`;
        }

        return `<div class="planning-item ${it.es_emergencia ? 'planning-item-emergencia' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:.25rem;">
                <span style="font-weight:600;font-size:.8rem;">${it.sku}</span>
                <button class="btn btn-ghost plan-del-btn" data-id="${it.id}"
                    style="padding:0 .2rem;font-size:.75rem;color:var(--text-muted);line-height:1">×</button>
            </div>
            <div style="font-size:.75rem;color:var(--text-secondary);">
                ${it.operario_nombre || 'Sin asignar'} · ${it.cajas_plan} cajas
                ${mins ? `· ${Math.round(mins)} min` : ''}
            </div>
            <div style="margin-top:.3rem;">${cierreHTML}</div>
        </div>`;
    }

    function _renderFormAdd() {
        const skuOptions = _activeSkus.map(s =>
            `<option value="${s.sku}">${s.sku} — ${s.descripcion || ''} (${s.caja || ''})</option>`
        ).join('');
        const opOptions = _operarios.map(o =>
            `<option value="${o.id}">${o.nombre}</option>`
        ).join('');

        return `
        <div class="card" id="plan-add-form-card" style="padding:1.25rem;margin-top:1.25rem;display:none;">
            <h4 style="margin-bottom:1rem;">Agregar ítem al plan</h4>

            <!-- Toggle Cajas/Unidades -->
            <div style="margin-bottom:1rem;display:flex;align-items:center;gap:1rem;font-size:.85rem;">
                <span>Planificar por:</span>
                <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;">
                    <input type="radio" name="plan-mode" value="cajas" ${!_planPorUnidades ? 'checked' : ''} class="plan-mode-radio">
                    <span>Cajas</span>
                </label>
                <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;">
                    <input type="radio" name="plan-mode" value="unidades" ${_planPorUnidades ? 'checked' : ''} class="plan-mode-radio">
                    <span>Unidades</span>
                </label>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1rem;">
                <div class="form-group">
                    <label>Fecha</label>
                    <input type="date" id="plan-form-fecha" class="form-control">
                </div>
                <div class="form-group">
                    <label>SKU / Producto</label>
                    <select id="plan-form-sku" class="form-control">
                        <option value="">Seleccionar...</option>
                        ${skuOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label id="plan-form-qty-label">Cajas a producir</label>
                    <input type="number" id="plan-form-qty" class="form-control" min="1" value="1">
                </div>
                <div class="form-group">
                    <label>Operaria asignada</label>
                    <select id="plan-form-operario" class="form-control">
                        <option value="">Sin asignar</option>
                        ${opOptions}
                    </select>
                </div>
                <div class="form-group" style="align-self:end;">
                    <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;">
                        <input type="checkbox" id="plan-form-emergencia">
                        <span>¿Es emergencia?</span>
                    </label>
                </div>
            </div>
            <div id="plan-form-tiempo-est" style="font-size:.85rem;color:var(--text-secondary);margin:.5rem 0;min-height:1.2em;"></div>
            <div style="display:flex;gap:.5rem;margin-top:.5rem;">
                <button class="btn btn-primary" id="plan-form-submit">Guardar</button>
                <button class="btn btn-ghost" id="plan-form-cancel">Cancelar</button>
            </div>
        </div>`;
    }

    // ─── Eventos ──────────────────────────────────
    function _wireEvents(container) {
        // Navegación semanal
        container.querySelector('#plan-prev-week')?.addEventListener('click', () => {
            const d = new Date(_fechaInicio + 'T00:00:00');
            d.setDate(d.getDate() - 7);
            load(d.toISOString().slice(0, 10));
        });
        container.querySelector('#plan-next-week')?.addEventListener('click', () => {
            const d = new Date(_fechaInicio + 'T00:00:00');
            d.setDate(d.getDate() + 7);
            load(d.toISOString().slice(0, 10));
        });
        container.querySelector('#plan-today')?.addEventListener('click', () => load(null));

        // Botones "Agregar" por día
        container.querySelectorAll('.plan-add-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const fecha = btn.dataset.fecha;
                const formCard = document.getElementById('plan-add-form-card');
                if (formCard) {
                    formCard.style.display = 'block';
                    const fechaInput = document.getElementById('plan-form-fecha');
                    if (fechaInput) fechaInput.value = fecha;
                    formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
        });

        // Botones eliminar
        container.querySelectorAll('.plan-del-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('¿Eliminar este ítem del plan?')) return;
                try {
                    await API.delete(`/api/planning/${btn.dataset.id}`);
                    UI.showSnackbar('Ítem eliminado', 'success');
                    load(_fechaInicio);
                } catch (err) {
                    UI.showSnackbar('Error al eliminar', 'error');
                }
            });
        });

        // Botones cierre (para días no-hoy)
        container.querySelectorAll('.plan-cierre-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const cajasReal = prompt('¿Cuántas cajas se produjeron realmente?');
                if (cajasReal === null) return;
                const n = parseInt(cajasReal, 10);
                if (isNaN(n) || n < 0) { UI.showSnackbar('Valor inválido', 'error'); return; }
                try {
                    await API.patch(`/api/planning/${btn.dataset.id}/cierre`, { cajas_real: n });
                    UI.showSnackbar('Cierre registrado', 'success');
                    load(_fechaInicio);
                } catch (err) {
                    UI.showSnackbar('Error al registrar cierre', 'error');
                }
            });
        });

        // Checkboxes completado (para hoy)
        container.querySelectorAll('.plan-done-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', async () => {
                const itemId = checkbox.dataset.id;
                if (checkbox.checked) {
                    UI.showPrompt('Registrar cajas producidas', 'Ingresa la cantidad de cajas reales:', 'number', async (cajasReal) => {
                        const n = parseInt(cajasReal, 10);
                        if (isNaN(n) || n < 0) { UI.showSnackbar('Valor inválido', 'error'); return false; }
                        try {
                            await API.patch(`/api/planning/${itemId}/cierre`, { cajas_real: n });
                            UI.showSnackbar('Cierre registrado', 'success');
                            load(_fechaInicio);
                        } catch (err) {
                            UI.showSnackbar('Error al registrar cierre', 'error');
                            return false;
                        }
                    });
                } else {
                    try {
                        await API.patch(`/api/planning/${itemId}/cierre`, { cajas_real: null });
                        UI.showSnackbar('Cierre cancelado', 'success');
                        load(_fechaInicio);
                    } catch (err) {
                        UI.showSnackbar('Error al cancelar cierre', 'error');
                    }
                }
            });
        });

        // Formulario agregar
        const skuSel = document.getElementById('plan-form-sku');
        const qtyInput = document.getElementById('plan-form-qty');
        const qtyLabel = document.getElementById('plan-form-qty-label');
        const tiempoEst = document.getElementById('plan-form-tiempo-est');

        function _updateTiempoEst() {
            const sku = skuSel?.value;
            const qty = parseInt(qtyInput?.value, 10) || 0;
            const prodTimes = _productTimes[sku];
            if (!prodTimes) { if (tiempoEst) tiempoEst.textContent = ''; return; }

            let mins;
            if (_planPorUnidades) {
                const mpu = prodTimes.minutos_por_unidad || (prodTimes.minutos_por_caja / (prodTimes.factor_empaque || 1));
                mins = mpu * qty;
                if (tiempoEst) {
                    tiempoEst.textContent = mins
                        ? `Tiempo estimado: ${Math.round(mins)} min (${(mins/60).toFixed(1)}h) · ${Math.round(mpu*100)/100} min/unidad`
                        : '';
                }
            } else {
                mins = (prodTimes.minutos_por_caja || 0) * qty;
                if (tiempoEst) {
                    tiempoEst.textContent = mins
                        ? `Tiempo estimado: ${Math.round(mins)} min (${(mins/60).toFixed(1)}h) · ${prodTimes.minutos_por_caja || '?'} min/caja`
                        : '';
                }
            }
        }

        // Manejar toggle cajas/unidades
        container.querySelectorAll('.plan-mode-radio').forEach(radio => {
            radio.addEventListener('change', (e) => {
                _planPorUnidades = e.target.value === 'unidades';
                if (qtyLabel) {
                    qtyLabel.textContent = _planPorUnidades ? 'Unidades a producir' : 'Cajas a producir';
                }
                _updateTiempoEst();
            });
        });

        skuSel?.addEventListener('change', _updateTiempoEst);
        qtyInput?.addEventListener('input', _updateTiempoEst);

        document.getElementById('plan-form-cancel')?.addEventListener('click', () => {
            const formCard = document.getElementById('plan-add-form-card');
            if (formCard) formCard.style.display = 'none';
        });

        document.getElementById('plan-form-submit')?.addEventListener('click', async () => {
            const fecha     = document.getElementById('plan-form-fecha')?.value;
            const sku       = document.getElementById('plan-form-sku')?.value;
            const qty       = parseInt(document.getElementById('plan-form-qty')?.value, 10);
            const opId      = document.getElementById('plan-form-operario')?.value || null;
            const emergencia = document.getElementById('plan-form-emergencia')?.checked || false;

            if (!fecha || !sku || !qty) {
                UI.showSnackbar('Completa fecha, SKU y cantidad', 'error'); return;
            }
            try {
                const payload = {
                    fecha, sku,
                    operario_id: opId ? parseInt(opId, 10) : null,
                    es_emergencia: emergencia
                };
                if (_planPorUnidades) {
                    payload.unidades_plan = qty;
                } else {
                    payload.cajas_plan = qty;
                }
                await API.post('/api/planning', payload);
                UI.showSnackbar('Ítem agregado al plan', 'success');
                const formCard = document.getElementById('plan-add-form-card');
                if (formCard) formCard.style.display = 'none';
                load(_fechaInicio);
            } catch (err) {
                UI.showSnackbar(err.detail || err.message || 'Error al guardar', 'error');
            }
        });
    }

    async function saveHorasJornada() {
        const horas = parseFloat(document.getElementById('plan-horas-jornada')?.value);
        if (isNaN(horas) || horas <= 0) { UI.showSnackbar('Valor inválido', 'error'); return; }
        try {
            await API.post('/api/config/horas-jornada', { horas });
            _horasJornada = horas;
            UI.showSnackbar(`Jornada actualizada: ${horas}h`, 'success');
            load(_fechaInicio);
        } catch (err) {
            UI.showSnackbar('Error al guardar', 'error');
        }
    }

    async function render() {
        await load(null);
    }

    return { render, load, saveHorasJornada };
})();
