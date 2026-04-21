/**
 * ui.js — Core de UI: navegación, componentes globales, helpers compartidos
 *
 * Las vistas están separadas en:
 *   views/dashboard.js  → ViewDashboard
 *   views/detail.js     → ViewDetail
 *   views/performance.js → ViewPerformance
 *   views/users.js      → ViewUsers
 *
 * Depende de: Store, ProcessState, app (runtime)
 */

// ─── Helper: badge de estado ──────────────────
// Fuente única de verdad para clases CSS y etiquetas de estado.
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
    currentDetailId: null,

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

        window.addEventListener('beforeunload', () => this._pauseActiveOnUnload());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this._pauseActiveOnUnload();
            }
        });
    },

    _pauseActiveOnUnload() {
        if (this.currentViewId !== 'view-detail') return;
        const processId = this.currentDetailId;
        if (!processId) return;

        const proc = Store.state.processes.find(p => p.id === processId);
        if (!proc || proc.estado !== ProcessState.STARTED) return;

        const token = localStorage.getItem('reproceso_token');
        if (!token) return;

        fetch(`/api/procesos/${processId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ accion: 'pause' }),
            keepalive: true
        }).catch(() => {});
    },

    // ─── Navegación ───────────────────────────────

    navigateTo(viewId, contextId = null) {
        this._autoPauseOnLeaveDetail(viewId, contextId);

        // Si salimos del Centro de Mando, desmontar el shell
        if (this.currentViewId === 'view-dashboard' && viewId !== 'view-dashboard') {
            MaestroShell?.unmount?.();
        }

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
            const isMaestro = Store.state.currentRole === 'Maestro';
            console.log('[UI] navigateTo view-dashboard, isMaestro:', isMaestro, 'role:', Store.state.currentRole);

            // Asegurar que maestro-shell siempre esté en el DOM
            const maestroShell = document.getElementById('maestro-shell');
            const operarioShell = document.getElementById('operario-shell');

            if (isMaestro) {
                console.log('[UI] Calling MaestroShell.mount()');
                // Mostrar maestro-shell, ocultar operario-shell
                if (maestroShell) maestroShell.style.display = 'flex';
                if (operarioShell) operarioShell.style.display = 'none';
                document.body.classList.add('maestro-mode');
                MaestroShell.mount();
            } else {
                // Operario: asegurar shell operario visible y limpio
                console.log('[UI] Setting up operario shell');
                if (operarioShell) operarioShell.style.display = '';
                if (maestroShell) maestroShell.style.display = 'none';
                document.body.classList.remove('maestro-mode');
                ViewDashboard.render(contextId === true);
            }
        } else if (viewId === 'view-create') {
            this.resetForm();
        } else if (viewId === 'view-detail' && contextId) {
            ViewDetail.render(contextId);
        }
    },

    _autoPauseOnLeaveDetail(nextViewId, nextContextId) {
        if (this.currentViewId !== 'view-detail') return;
        if (nextViewId === 'view-detail' && nextContextId === this.currentDetailId) return;

        const processId = this.currentDetailId;
        if (!processId) return;

        const proc = Store.state.processes.find(p => p.id === processId);
        if (!proc || proc.estado !== ProcessState.STARTED) return;

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
            const result = await onConfirm();
            if (result !== false) overlay.classList.add('hidden');
        });

        newCancel.addEventListener('click', () => {
            overlay.classList.add('hidden');
        });
    },

    showPrompt(title, msg, type = 'number', onConfirm) {
        const overlay = document.getElementById('modal-overlay');
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-message').textContent = msg;
        
        const body = document.getElementById('modal-body');
        body.innerHTML = `
            <div class="form-group" style="margin-top:1rem">
                <input type="${type}" id="modal-prompt-input" class="form-control" autofocus required>
            </div>
        `;
        overlay.classList.remove('hidden');

        const btnConfirm = document.getElementById('modal-btn-confirm');
        const btnCancel = document.getElementById('modal-btn-cancel');

        const newConfirm = btnConfirm.cloneNode(true);
        const newCancel = btnCancel.cloneNode(true);
        btnConfirm.parentNode.replaceChild(newConfirm, btnConfirm);
        btnCancel.parentNode.replaceChild(newCancel, btnCancel);

        newConfirm.addEventListener('click', async () => {
            const val = document.getElementById('modal-prompt-input').value;
            if (!val && type === 'number') {
                this.showSnackbar('Debe ingresar un valor', 'error');
                return;
            }
            const result = await onConfirm(val);
            if (result !== false) overlay.classList.add('hidden');
        });

        newCancel.addEventListener('click', () => overlay.classList.add('hidden'));
        
        setTimeout(() => document.getElementById('modal-prompt-input').focus(), 100);
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

    // ─── Proxies a vistas modulares ───────────────
    // Mantener compatibilidad con llamadas existentes desde app.js y break-monitor.js

    async renderDashboard(forceRefresh = false) {
        return ViewDashboard.render(forceRefresh);
    },

    async renderDetail(processId, preloadedData = null) {
        return ViewDetail.render(processId, preloadedData);
    },

    async renderPerformance() {
        return ViewPerformance.render();
    },

    async renderUsers() {
        return ViewUsers.render();
    },

    async renderAudit() {
        return ViewUsers.renderAudit();
    },

    async loadOperatorKPIs(userId) {
        return ViewPerformance.loadOperatorKPIs(userId);
    },

    // ─── Helpers de estado compartidos ───────────

    getStatusBadge(estado) {
        return getStatusBadge(estado);
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

    checkGlobalUrgency() {
        const isUrgentActive = Store.state.processes.some(p =>
            p.es_urgente && p.estado !== ProcessState.FINISHED
        );
        const indicator = document.getElementById('urgent-indicator');
        if (indicator) indicator.classList.toggle('hidden', !isUrgentActive);
    },

    resetForm() {
        document.getElementById('create-process-form').reset();
        document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
        UI.renderSKUGrid('sku-picker-grid', 'input-sku-dest');
    },

    // ─── Break Config UI ──────────────────────────

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

    // ─── Break Modal ──────────────────────────────

    showBreakModal(workMinutes, restMinutes, onDone) {
        const overlay = document.getElementById('break-modal-overlay');
        const display = document.getElementById('break-countdown-display');
        const ring = document.getElementById('break-ring-progress');
        const btn = document.getElementById('break-btn-resume');
        const msg = document.getElementById('break-modal-message');

        const CIRCUMFERENCE = 2 * Math.PI * 44;

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

        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', () => {
            clearInterval(tick);
            overlay.classList.add('hidden');
            onDone();
        });
    },

    // ─── Event Listeners ──────────────────────────

    setupEventListeners() {
        document.getElementById('btn-new-process').onclick = () => UI.navigateTo('view-create');
        document.getElementById('btn-back-dashboard').onclick = () => UI.navigateTo('view-dashboard');
        document.getElementById('btn-cancel-create').onclick = () => UI.navigateTo('view-dashboard');
        document.getElementById('btn-logout').onclick = () => app.logout();

        document.getElementById('login-form').onsubmit = (e) => app.handleLogin(e);

        const btnBackToPicker = document.getElementById('btn-back-to-picker');
        if (btnBackToPicker) btnBackToPicker.onclick = () => UI.goBackToUserPicker();

        const btnPerf = document.getElementById('btn-view-performance');
        if (btnPerf) btnPerf.onclick = () => UI.navigateTo('view-performance');

        const btnUsers = document.getElementById('btn-view-users');
        if (btnUsers) btnUsers.onclick = () => UI.navigateTo('view-users');

        const btnAudit = document.getElementById('btn-view-audit');
        if (btnAudit) btnAudit.onclick = () => UI.navigateTo('view-audit');

        const btnStockPanel = document.getElementById('btn-view-stock-panel');
        if (btnStockPanel) btnStockPanel.onclick = () => UI.navigateTo('view-stock-panel');

        const btnReports = document.getElementById('btn-view-reports');
        if (btnReports) btnReports.onclick = () => UI.navigateTo('view-reports');

        const btnPlanning = document.getElementById('btn-view-planning');
        if (btnPlanning) btnPlanning.onclick = () => UI.navigateTo('view-planning');

        const btnOptimization = document.getElementById('btn-view-optimization');
        if (btnOptimization) btnOptimization.onclick = () => UI.navigateTo('view-optimization');

        const btnDashboardMaestro = document.getElementById('btn-view-dashboard-maestro');
        if (btnDashboardMaestro) btnDashboardMaestro.onclick = () => UI.navigateTo('view-dashboard-maestro');

        const btnStockProjection = document.getElementById('btn-view-stock-projection');
        if (btnStockProjection) btnStockProjection.onclick = () => UI.navigateTo('view-stock-projection');

        document.getElementById('create-process-form').onsubmit = (e) => app.createProcess(e);

        document.getElementById('btn-action-start').onclick = () => app.handleStart();
        document.getElementById('btn-action-pause').onclick = () => app.handlePause();
        document.getElementById('btn-action-resume').onclick = () => app.handleResume();
        document.getElementById('btn-action-finish').onclick = () => app.handleFinish();
        document.getElementById('btn-urgent').onclick = () => app.handleUrgency();

        const btnAddUser = document.getElementById('btn-add-user');
        if (btnAddUser) btnAddUser.onclick = () => app.handleAddUser();

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
