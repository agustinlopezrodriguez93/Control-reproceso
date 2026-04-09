/**
 * ui.js — Toda la lógica de renderizado, navegación y componentes UI
 * Depende de: Store, ProcessState, Charts, app (runtime)
 */

// ─── Helper: badge de estado ──────────────────
// Fuente única de verdad para clases CSS y etiquetas de estado.
// Usado en renderDashboard y renderDetail.
function getStatusBadge(estado) {
    const map = {
        [ProcessState.CREATED]:  { cls: 'created',  label: 'CREADO'     },
        [ProcessState.STARTED]:  { cls: 'started',  label: 'INICIADO'   },
        [ProcessState.PAUSED]:   { cls: 'paused',   label: 'PAUSADO'    },
        [ProcessState.FINISHED]: { cls: 'finished', label: 'FINALIZADO' },
    };
    return map[estado] ?? { cls: 'created', label: estado };
}

const UI = {
    currentViewId: 'view-login',

    init() {
        this.setupEventListeners();
        this.navigateTo('view-login');

        const searchInput = document.getElementById('user-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.renderUserPicker(e.target.value.toLowerCase());
            });
        }

        if (Store.state.publicUsers.length > 0) {
            this.renderUserPicker();
        }

        // Auto-pausar proceso activo al cerrar pestaña/navegador
        window.addEventListener('beforeunload', () => this._pauseActiveOnUnload());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this._pauseActiveOnUnload();
            }
        });
    },

    /**
     * Pausa el proceso activo del operario al cerrar la pestaña.
     * Usa navigator.sendBeacon para garantizar que la petición se envíe
     * incluso durante el cierre del navegador (fetch no es confiable en unload).
     */
    _pauseActiveOnUnload() {
        if (this.currentViewId !== 'view-detail') return;

        const processId = this.currentDetailId;
        if (!processId) return;

        const proc = Store.state.processes.find(p => p.id === processId);
        if (!proc || proc.estado !== ProcessState.STARTED) return;

        const token = localStorage.getItem('reproceso_token');
        if (!token) return;

        const url = `/api/procesos/${processId}`;
        const body = JSON.stringify({ accion: 'pause' });

        // sendBeacon garantiza entrega en beforeunload (fetch no lo garantiza)
        if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: 'application/json' });
            // sendBeacon no soporta headers de Auth, usaremos fetch con keepalive como alternativa
            fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: body,
                keepalive: true  // Garantiza que se envíe durante unload
            }).catch(() => {});
        }
    },

    // ─── Navegación ───────────────────────────────

    navigateTo(viewId, contextId = null) {
        // Auto-pausar proceso activo al salir de la vista de detalle
        this._autoPauseOnLeaveDetail(viewId, contextId);

        document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
        document.getElementById(viewId).classList.remove('hidden');
        this.currentViewId = viewId;

        if (viewId === 'view-login') {
            document.getElementById('header-user-profile').classList.add('hidden');
            document.getElementById('main-header').classList.add('hidden');
        } else {
            document.getElementById('header-user-profile').classList.remove('hidden');
            document.getElementById('main-header').classList.remove('hidden');
            this.updateHeader();
        }

        if (viewId === 'view-dashboard') {
            this.renderDashboard(contextId === true);
        } else if (viewId === 'view-create') {
            this.resetForm();
        } else if (viewId === 'view-detail' && contextId) {
            this.renderDetail(contextId);
        } else if (viewId === 'view-users') {
            this.renderUsers();
            app.loadBreakConfig();
        } else if (viewId === 'view-audit') {
            this.renderAudit();
        } else if (viewId === 'view-performance') {
            this.renderPerformance();
        }
    },

    /**
     * Auto-pausa el proceso en ejecución cuando el operario navega fuera de la vista de detalle.
     * Esto evita que el cronómetro siga corriendo si el operario abandona la pantalla.
     * No bloquea la navegación — el request se hace en background (fire & forget).
     */
    _autoPauseOnLeaveDetail(nextViewId, nextContextId) {
        // Solo actuar al salir de view-detail
        if (this.currentViewId !== 'view-detail') return;
        // Si navega al mismo detalle (misma ID), no pausar
        if (nextViewId === 'view-detail' && nextContextId === this.currentDetailId) return;

        const processId = this.currentDetailId;
        if (!processId) return;

        // Buscar el proceso en el store para verificar su estado actual
        const proc = Store.state.processes.find(p => p.id === processId);
        if (!proc || proc.estado !== ProcessState.STARTED) return;

        // Fire & forget — no bloquea la navegación
        Store.updateProcessState(processId, 'pause').then(() => {
            console.info(`[Auto-Pausa] Proceso ${proc.sku_destino} pausado automáticamente al salir de detalle`);
        }).catch(err => {
            console.warn(`[Auto-Pausa] No se pudo pausar el proceso: ${err.message}`);
        });
    },

    updateHeader() {
        const user = Store.state.currentUser;
        const role = Store.state.currentRole;
        if (user) {
            document.getElementById('current-user-name').textContent = user;
            document.getElementById('current-user-role').textContent = role;
            document.getElementById('header-avatar').textContent = user.substring(0, 2).toUpperCase();
        }
    },

    // ─── Componentes Globales ─────────────────────

    showSnackbar(msg, type = 'success') {
        const container = document.getElementById('snackbar-container');
        const el = document.createElement('div');
        el.className = `snackbar ${type}`;
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    },

    showModal(title, msg, onConfirm, theme = null) {
        const overlay = document.getElementById('modal-overlay');
        const card = overlay.querySelector('.modal-card');
        card.className = 'modal-card' + (theme ? ` ${theme}` : '');

        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-message').textContent = msg;
        document.getElementById('modal-body').innerHTML = '';
        overlay.classList.remove('hidden');

        const btnConfirm = document.getElementById('modal-btn-confirm');
        const btnCancel = document.getElementById('modal-btn-cancel');

        const newConfirm = btnConfirm.cloneNode(true);
        const newCancel = btnCancel.cloneNode(true);
        btnConfirm.parentNode.replaceChild(newConfirm, btnConfirm);
        btnCancel.parentNode.replaceChild(newCancel, btnCancel);

        newConfirm.addEventListener('click', async () => {
            await onConfirm();
            overlay.classList.add('hidden');
        });

        newCancel.addEventListener('click', () => {
            overlay.classList.add('hidden');
        });
    },

    // ─── SKU Grid ─────────────────────────────────

    renderSKUGrid(containerId, inputId, onSelect = null) {
        const grid = document.getElementById(containerId);
        const hiddenInput = document.getElementById(inputId);
        if (!grid) return;

        grid.innerHTML = '';
        Store.state.availableSKUs.forEach(sku => {
            const item = document.createElement('div');
            item.className = 'sku-item';

            const img = document.createElement('img');
            img.alt = sku;
            img.src = `/static/Imagenes/${sku}.jpg`;
            // Fallback encadenado: .jpg → .png → placeholder local (sin peticiones externas)
            img.addEventListener('error', function onErr() {
                if (this.src.includes('.jpg')) {
                    this.src = this.src.replace('.jpg', '.png');
                } else {
                    this.src = '/static/img/sku-placeholder.svg';
                    this.removeEventListener('error', onErr);
                }
            });

            const label = document.createElement('div');
            label.className = 'sku-name';
            label.textContent = sku;

            item.appendChild(img);
            item.appendChild(label);

            item.onclick = () => {
                grid.querySelectorAll('.sku-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                hiddenInput.value = sku;
                if (onSelect) onSelect(sku);
            };

            grid.appendChild(item);
        });
    },

    // ─── User Picker (Login) ──────────────────────

    renderUserPicker(filter = '') {
        const sectionsContainer = document.getElementById('user-picker-sections');
        const noResults = document.getElementById('no-results');
        if (!sectionsContainer) return;

        sectionsContainer.innerHTML = '';

        const filteredUsers = Store.state.publicUsers.filter(u =>
            u.nombre.toLowerCase().includes(filter)
        );

        if (filteredUsers.length === 0) {
            if (noResults) noResults.classList.remove('hidden');
            return;
        }
        if (noResults) noResults.classList.add('hidden');

        const groups = {};
        filteredUsers.forEach(user => {
            const role = user.rol || 'Operador';
            if (!groups[role]) groups[role] = [];
            groups[role].push(user);
        });

        const roleOrder = ['Maestro', 'Operador'];
        const existingRoles = Object.keys(groups).sort((a, b) => {
            const indexA = roleOrder.indexOf(a);
            const indexB = roleOrder.indexOf(b);
            if (indexA === -1 && indexB === -1) return a.localeCompare(b);
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        });

        existingRoles.forEach(role => {
            const section = document.createElement('div');
            section.className = 'user-picker-section';

            const title = document.createElement('div');
            title.className = 'user-picker-section-title';
            const icon = role === 'Maestro' ? '👑' : '👤';
            title.innerHTML = `<span>${icon}</span> ${role}s`;
            section.appendChild(title);

            const gridEl = document.createElement('div');
            gridEl.className = 'user-picker-grid';

            groups[role].forEach(user => {
                const card = document.createElement('div');
                card.className = 'user-card-picker';

                const initials = user.nombre.substring(0, 2).toUpperCase();
                const avatarColor = this.getAvatarColor(user.nombre);

                const avatar = document.createElement('div');
                avatar.className = 'avatar-lg';
                avatar.style.background = avatarColor;
                avatar.textContent = user.avatar || initials;

                const nameEl = document.createElement('div');
                nameEl.className = 'user-name';
                nameEl.title = user.nombre;
                nameEl.textContent = user.nombre;

                card.appendChild(avatar);
                card.appendChild(nameEl);
                card.addEventListener('click', () => this.selectUser(user));
                gridEl.appendChild(card);
            });

            section.appendChild(gridEl);
            sectionsContainer.appendChild(section);
        });
    },

    getAvatarColor(name) {
        const colors = [
            'linear-gradient(135deg, #6366f1, #a855f7)',
            'linear-gradient(135deg, #3b82f6, #2dd4bf)',
            'linear-gradient(135deg, #f59e0b, #ef4444)',
            'linear-gradient(135deg, #10b981, #3b82f6)',
            'linear-gradient(135deg, #ec4899, #8b5cf6)',
            'linear-gradient(135deg, #f97316, #f59e0b)'
        ];

        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }

        return colors[Math.abs(hash) % colors.length];
    },

    selectUser(user) {
        document.getElementById('user-picker-container').classList.add('hidden');
        document.getElementById('password-entry-container').classList.remove('hidden');

        document.getElementById('selected-user-name').textContent = user.nombre;
        const initials = user.nombre.substring(0, 2).toUpperCase();
        document.getElementById('selected-user-avatar').textContent = user.avatar || initials;
        document.getElementById('login-username').value = user.nombre;

        setTimeout(() => {
            document.getElementById('login-password').focus();
        }, 100);
    },

    goBackToUserPicker() {
        document.getElementById('password-entry-container').classList.add('hidden');
        document.getElementById('user-picker-container').classList.remove('hidden');
        document.getElementById('login-password').value = '';
    },

    // ─── Dashboard ────────────────────────────────

    async renderDashboard(forceRefresh = false) {
        const tbody = document.getElementById('process-list-body');
        const currentUser = Store.state.currentUser;
        const currentRole = Store.state.currentRole;
        const isMaestro = currentRole === 'Maestro';

        ['btn-view-performance', 'btn-view-users', 'btn-view-audit'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.toggle('hidden', !isMaestro);
        });

        const btnCreate = document.getElementById('btn-new-process');
        if (btnCreate) btnCreate.classList.toggle('hidden', isMaestro);

        if (forceRefresh || Store.state.processes.length === 0) {
            await Store.loadProcesses(isMaestro ? null : currentUser);
        }

        const list = Store.getSortedProcesses();
        const emptyState = document.getElementById('empty-state');

        tbody.innerHTML = '';
        if (list.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }
        emptyState.classList.add('hidden');

        list.forEach(proc => {
            const tr = document.createElement('tr');
            if (proc.es_urgente) tr.classList.add('tr-urgent');

            const { cls: statusCls } = getStatusBadge(proc.estado);
            const urgentBadge = proc.es_urgente ? '<span class="badge badge-urgent">URGENTE</span>' : '';
            const timeStr = this.calcEffectiveTime(proc);

            tr.innerHTML = `
                <td>${proc.sku_destino}</td>
                <td>${proc.operario_nombre}</td>
                <td><span class="badge badge-${statusCls}">${proc.estado}</span></td>
                <td>${timeStr}</td>
                <td>${urgentBadge}</td>
                <td>
                    ${(proc.estado !== ProcessState.FINISHED && !isMaestro) ? `
                    <button class="btn btn-warning btn-sm" data-proc-id="${proc.id}">
                        Continuar
                    </button>
                    ` : ''}
                </td>
            `;

            // Pasar el proceso preloaded del store — evita fetch extra al abrir detalle
            const btn = tr.querySelector('[data-proc-id]');
            if (btn) {
                btn.addEventListener('click', () => app.viewDetailPreloaded(proc));
            }

            tbody.appendChild(tr);
        });
        this.checkGlobalUrgency();
    },

    // ─── Detail View ──────────────────────────────

    async renderDetail(processId, preloadedData = null) {
        // Buscar primero en el store local para evitar fetch cuando ya tenemos el dato
        const cached = Store.state.processes.find(p => p.id === processId);
        const proc = preloadedData || cached || await Store.loadProcess(processId);
        if (!proc) {
            UI.showSnackbar('Proceso no encontrado', 'error');
            return;
        }

        const idx = Store.state.processes.findIndex(p => p.id === processId);
        if (idx !== -1) {
            Store.state.processes[idx] = proc;
        } else {
            Store.state.processes.push(proc);
        }

        this.currentDetailId = processId;

        const skuCode = proc.sku_destino;
        const productName = SKU_NAMES[skuCode] || skuCode;

        document.getElementById('detail-product-image').src = `/static/Imagenes/${skuCode}.jpg`;
        document.getElementById('detail-product-code').textContent = skuCode;
        document.getElementById('detail-product-name').textContent = productName;

        const detailCards = document.querySelectorAll('#view-detail .card');
        detailCards.forEach(card => {
            card.classList.toggle('card-urgent', !!proc.es_urgente);
        });

        const currentStatus = proc.estado || ProcessState.CREATED;
        const { cls: statusCls } = getStatusBadge(currentStatus);

        document.getElementById('detail-sku-dest').textContent = proc.sku_destino;

        const statusBadge = document.getElementById('detail-status-badge');
        statusBadge.textContent = currentStatus;
        statusBadge.className = `badge badge-${statusCls}`;

        const btnUrgent = document.getElementById('btn-urgent');
        btnUrgent.classList.toggle(
            'hidden',
            proc.estado !== ProcessState.STARTED && proc.estado !== ProcessState.PAUSED
        );

        document.getElementById('detail-operator').textContent = proc.operario_nombre;
        document.getElementById('detail-start-time').textContent = proc.started_at
            ? new Date(proc.started_at).toLocaleTimeString() : '-';
        document.getElementById('detail-end-time').textContent = proc.finished_at
            ? new Date(proc.finished_at).toLocaleTimeString() : '-';

        const largeStatusBadge = document.getElementById('large-status-badge');
        const labels = {
            [ProcessState.CREATED]: 'En Preparación',
            [ProcessState.STARTED]: 'En Curso',
            [ProcessState.PAUSED]: 'PAUSADO',
            [ProcessState.FINISHED]: 'Finalizado'
        };
        const classes = {
            [ProcessState.CREATED]: 'status-created',
            [ProcessState.STARTED]: 'status-started',
            [ProcessState.PAUSED]: 'status-paused',
            [ProcessState.FINISHED]: 'status-finished'
        };

        largeStatusBadge.textContent = labels[currentStatus] || currentStatus;
        largeStatusBadge.className = `large-badge ${classes[currentStatus] || classes[ProcessState.CREATED]}`;

        document.getElementById('status-start-time').textContent = proc.started_at
            ? new Date(proc.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
        document.getElementById('status-operator').textContent = proc.operario_nombre;

        const btnStart = document.getElementById('btn-action-start');
        const btnPause = document.getElementById('btn-action-pause');
        const btnResume = document.getElementById('btn-action-resume');
        const btnFinish = document.getElementById('btn-action-finish');

        [btnStart, btnPause, btnResume, btnFinish].forEach(b => b.classList.add('hidden'));

        if (proc.estado === ProcessState.CREATED) {
            btnStart.classList.remove('hidden');
        } else if (proc.estado === ProcessState.STARTED) {
            btnPause.classList.remove('hidden');
            btnFinish.classList.remove('hidden');
        } else if (proc.estado === ProcessState.PAUSED) {
            btnResume.classList.remove('hidden');
            btnFinish.classList.remove('hidden');
        }
    },

    // ─── Performance / KPIs ───────────────────────

    async renderPerformance() {
        const tbody = document.getElementById('performance-table-body');
        if (!tbody) return;

        try {
            const globalKpis = await Store.loadDashboardStats();

            document.getElementById('kpi-active').textContent = globalKpis.active_tasks || 0;
            document.getElementById('kpi-finished-today').textContent = globalKpis.finished_today || 0;
            document.getElementById('kpi-avg-time').textContent = `${Math.round(globalKpis.global_avg_minutes)} min`;
            document.getElementById('kpi-urgent-count').textContent = globalKpis.pending_urgent || 0;

            this.renderSKUDistroChart(globalKpis.sku_distribution);
            // Pasar globalAvgMinutes directamente — sin leer el DOM
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
            this.showSnackbar('Error cargando indicadores', 'error');
            return;
        }

        // Sección SKU separada del try/catch principal para no bloquear los KPIs globales
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
        try {
            const kpis = await Store.loadOperatorKPIs(userId);

            const perfItem = Store.state.performanceData.find(p => p.id === userId);
            const operatorName = perfItem ? perfItem.user : `Operario #${userId}`;

            this.renderEfficiencyChart(
                { id: userId, user: operatorName, avg_minutes: kpis.avg_minutes || 0 },
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

    // ─── SKU Human Resources ─────────────────────

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

        // Hallar el máximo de horas para la barra de proporción
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

        // Gráfico de barras horizontales
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
    },

    // ─── Break Config UI (Maestro) ────────────────

    updateBreakConfigUI(enabled) {
        const fields = document.getElementById('break-config-fields');
        if (fields) fields.classList.toggle('disabled', !enabled);
    },

    updateBreakPreview() {
        const workInput = document.getElementById('break-work-minutes');
        const restInput = document.getElementById('break-rest-minutes');
        const preview = document.getElementById('break-config-preview-text');
        if (!preview || !workInput || !restInput) return;
        const w = parseInt(workInput.value) || 90;
        const r = parseInt(restInput.value) || 10;
        preview.textContent = `Cada ${w} min de trabajo → ${r} min de descanso obligatorio`;
    },

    // ─── Break Modal (Operario) ───────────────────

    /**
     * Muestra el modal de pausa obligatoria con un countdown regresivo.
     * Bloquea la pantalla hasta que pasen restMinutes.
     * Llama onDone() cuando el tiempo se cumple (para reanudar el proceso).
     */
    showBreakModal(workMinutes, restMinutes, onDone) {
        const overlay = document.getElementById('break-modal-overlay');
        const display = document.getElementById('break-countdown-display');
        const ring = document.getElementById('break-ring-progress');
        const btn = document.getElementById('break-btn-resume');
        const msg = document.getElementById('break-modal-message');

        const CIRCUMFERENCE = 2 * Math.PI * 44; // 276.46

        msg.textContent = `Llevás ${workMinutes} minutos trabajando. Tomá un descanso de ${restMinutes} minutos.`;
        btn.disabled = true;
        btn.textContent = 'Reanudar Trabajo';
        ring.classList.remove('done');
        ring.style.strokeDashoffset = '0';
        overlay.classList.remove('hidden');

        let totalSeconds = restMinutes * 60;
        let remaining = totalSeconds;

        const fmt = (s) => {
            const m = Math.floor(s / 60).toString().padStart(2, '0');
            const sec = (s % 60).toString().padStart(2, '0');
            return `${m}:${sec}`;
        };

        display.textContent = fmt(remaining);

        const tick = setInterval(() => {
            remaining--;
            display.textContent = fmt(remaining);

            // Anillo: va de lleno (0) a vacío (CIRCUMFERENCE) a medida que pasa el tiempo
            const progress = (totalSeconds - remaining) / totalSeconds;
            ring.style.strokeDashoffset = (CIRCUMFERENCE * progress).toFixed(2);

            if (remaining <= 0) {
                clearInterval(tick);
                ring.classList.add('done');
                display.textContent = '00:00';
                btn.disabled = false;
                this.showSnackbar('Descanso completado — podés reanudar', 'success');
            }
        }, 1000);

        // Limpiar el listener anterior antes de asignar uno nuevo
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', () => {
            clearInterval(tick);
            overlay.classList.add('hidden');
            onDone();
        });
    },

    // ─── Users Management ─────────────────────────

    async renderUsers() {
        const tbody = document.getElementById('users-table-body');
        if (!tbody) return;
        const users = await Store.loadUsers();
        tbody.innerHTML = '';
        users.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${u.nombre}</td>
                <td>${u.rol}</td>
                <td><div class="avatar-sm">${u.avatar}</div></td>
                <td>
                    ${u.rol !== 'Maestro' ? `
                    <button class="btn btn-ghost btn-sm text-danger" data-delete-user="${u.id}" data-user-name="${u.nombre}">
                        Eliminar
                    </button>
                    ` : ''}
                </td>
            `;

            // Listener seguro — sin inline onclick con datos de usuario no escapados
            const deleteBtn = tr.querySelector('[data-delete-user]');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    app.handleDeleteUser(u.id, u.nombre);
                });
            }

            tbody.appendChild(tr);
        });
    },

    // ─── Audit ────────────────────────────────────

    async renderAudit() {
        const tbody = document.getElementById('audit-table-body');
        if (!tbody) return;
        const logs = await Store.loadAudit();
        tbody.innerHTML = '';
        logs.forEach(l => {
            const tr = document.createElement('tr');
            const date = new Date(l.timestamp).toLocaleString();
            tr.innerHTML = `
                <td>${date}</td>
                <td>${l.username || 'Sistema'}</td>
                <td><span class="badge badge-neutral">${l.accion}</span></td>
                <td style="font-size: 0.85em">${l.detalles || '-'}</td>
            `;
            tbody.appendChild(tr);
        });
    },

    // ─── Utilidades ───────────────────────────────

    checkGlobalUrgency() {
        const isUrgentActive = Store.state.processes.some(p =>
            p.es_urgente && p.estado !== ProcessState.FINISHED
        );
        const indicator = document.getElementById('urgent-indicator');
        if (indicator) indicator.classList.toggle('hidden', !isUrgentActive);
    },

    calcEffectiveTime(proc) {
        if (!proc.started_at) return '00:00:00';

        const start = new Date(proc.started_at);
        const end = proc.finished_at ? new Date(proc.finished_at) : new Date();
        let totalTime = end - start;

        let totalPause = 0;
        if (proc.pausas) {
            proc.pausas.forEach(p => {
                const pStart = new Date(p.inicio);
                const pEnd = p.fin ? new Date(p.fin) : new Date();
                totalPause += (pEnd - pStart);
            });
        }

        const effective = Math.max(0, totalTime - totalPause);
        const totalSeconds = Math.floor(effective / 1000);

        const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    },

    resetForm() {
        document.getElementById('create-process-form').reset();
        document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
        UI.renderSKUGrid('sku-picker-grid', 'input-sku-dest');
    },

    // ─── Event Listeners ──────────────────────────

    setupEventListeners() {
        // Navigation
        document.getElementById('btn-new-process').onclick = () => UI.navigateTo('view-create');
        document.getElementById('btn-back-dashboard').onclick = () => UI.navigateTo('view-dashboard');
        document.getElementById('btn-cancel-create').onclick = () => UI.navigateTo('view-dashboard');
        document.getElementById('btn-logout').onclick = () => app.logout();

        // Login Form
        document.getElementById('login-form').onsubmit = app.handleLogin;

        const btnBackToPicker = document.getElementById('btn-back-to-picker');
        if (btnBackToPicker) btnBackToPicker.onclick = () => UI.goBackToUserPicker();

        const btnPerf = document.getElementById('btn-view-performance');
        if (btnPerf) btnPerf.onclick = () => UI.navigateTo('view-performance');

        const btnUsers = document.getElementById('btn-view-users');
        if (btnUsers) btnUsers.onclick = () => UI.navigateTo('view-users');

        const btnAudit = document.getElementById('btn-view-audit');
        if (btnAudit) btnAudit.onclick = () => UI.navigateTo('view-audit');

        // Create Form
        document.getElementById('create-process-form').onsubmit = app.createProcess;

        // Process Actions
        document.getElementById('btn-action-start').onclick = () => app.handleStart();
        document.getElementById('btn-action-pause').onclick = () => app.handlePause();
        document.getElementById('btn-action-resume').onclick = () => app.handleResume();
        document.getElementById('btn-action-finish').onclick = () => app.handleFinish();
        document.getElementById('btn-urgent').onclick = () => app.handleUrgency();

        // User Management Actions
        const btnAddUser = document.getElementById('btn-add-user');
        if (btnAddUser) btnAddUser.onclick = () => app.handleAddUser();

        // Break Config
        const breakToggle = document.getElementById('break-enabled-toggle');
        if (breakToggle) breakToggle.addEventListener('change', (e) => {
            UI.updateBreakConfigUI(e.target.checked);
        });

        const breakWorkInput = document.getElementById('break-work-minutes');
        const breakRestInput = document.getElementById('break-rest-minutes');
        if (breakWorkInput) breakWorkInput.addEventListener('input', () => UI.updateBreakPreview());
        if (breakRestInput) breakRestInput.addEventListener('input', () => UI.updateBreakPreview());

        const btnSaveBreak = document.getElementById('btn-save-break-config');
        if (btnSaveBreak) btnSaveBreak.onclick = () => app.saveBreakConfig();
    }
};
