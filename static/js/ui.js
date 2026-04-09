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

            // Adjuntar listener en lugar de inline onclick (evita XSS con IDs no UUID)
            const btn = tr.querySelector('[data-proc-id]');
            if (btn) {
                btn.addEventListener('click', () => app.viewDetail(proc.id));
            }

            tbody.appendChild(tr);
        });
        this.checkGlobalUrgency();
    },

    // ─── Detail View ──────────────────────────────

    async renderDetail(processId, preloadedData = null) {
        const proc = preloadedData || await Store.loadProcess(processId);
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
    }
};
