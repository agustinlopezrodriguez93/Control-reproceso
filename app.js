/**
 * SKU Consolidation Demo App
 * Vanilla JS Implementation
 */

// --- Constants & Enums ---
const ProcessState = {
    CREATED: 'CREADO',
    STARTED: 'INICIADO',
    PAUSED: 'PAUSADO',
    FINISHED: 'FINALIZADO'
};

const ROLES = {
    OPERATOR: 'Operador',
    Maestro: 'Maestro'
};

// --- Models ---

class Process {
    constructor(data = {}) {
        this.id = data.id || crypto.randomUUID();
        this.operator = data.operator;
        this.skuDest = data.skuDest;
        // this.skuSource = data.skuSource || []; // Removed
        this.status = data.status || ProcessState.CREATED;
        this.isUrgent = data.isUrgent || false;
        this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
        this.lastStateChange = data.lastStateChange ? new Date(data.lastStateChange) : new Date();

        // Time tracking
        this.startTime = data.startTime ? new Date(data.startTime) : null;
        this.endTime = data.endTime ? new Date(data.endTime) : null;
        this.pauses = data.pauses ? data.pauses.map(p => ({
            start: new Date(p.start),
            end: p.end ? new Date(p.end) : null
        })) : [];
    }

    start() {
        if (this.status !== ProcessState.CREATED) throw new Error("Solo procesos CREADOS pueden iniciarse.");
        this.status = ProcessState.STARTED;
        this.startTime = new Date();
        this.lastStateChange = new Date();
    }

    pause() {
        if (this.status !== ProcessState.STARTED) throw new Error("Solo procesos INICIADOS pueden pausarse.");
        this.status = ProcessState.PAUSED;
        this.pauses.push({ start: new Date(), end: null });
        this.lastStateChange = new Date();
    }

    resume() {
        if (this.status !== ProcessState.PAUSED) throw new Error("Solo procesos PAUSADOS pueden reanudarse.");
        this.status = ProcessState.STARTED;
        // Close last pause
        const lastPause = this.pauses[this.pauses.length - 1];
        if (lastPause && !lastPause.end) {
            lastPause.end = new Date();
        }
        this.lastStateChange = new Date();
    }

    finish() {
        if (this.status === ProcessState.FINISHED) return;

        // If paused, close the pause first effectively or just consider pause time until now as done
        // Simplification: Resume then finish instantly to close pause cap, or just set end time.
        // If it was paused, we should close the pause segment.
        if (this.status === ProcessState.PAUSED) {
            const lastPause = this.pauses[this.pauses.length - 1];
            if (lastPause && !lastPause.end) {
                lastPause.end = new Date();
            }
        }

        this.status = ProcessState.FINISHED;
        this.endTime = new Date();
        this.lastStateChange = new Date();
    }

    getEffectiveTimeSeconds() {
        if (!this.startTime) return 0;

        const end = this.endTime || new Date();
        let totalTime = (end - this.startTime); // milliseconds

        // Subtract duration of all finalized pauses
        let totalPause = 0;
        this.pauses.forEach(p => {
            const pEnd = p.end || new Date(); // If currently paused, count up to now (to exclude it from effective time)
            totalPause += (pEnd - p.start);
        });

        // Ensure we don't return negative due to tight loops or clock skew
        const effective = Math.max(0, totalTime - totalPause);
        return Math.floor(effective / 1000);
    }
}

// --- Store (Persistence) ---
const Store = {
    KEY: 'sku_demo_data',
    state: {
        currentUser: null, // Start null
        currentRole: null,
        users: [], // Loaded from config
        processes: [], // All processes
        availableSKUs: [], // For selectors
        performanceData: [] // For Maestro view
    },

    init() {
        // ALWAYS load from config.json to ensure mock data integrity
        // Clear local storage to avoid mixing old data
        localStorage.removeItem(this.KEY);

        fetch('config.json')
            .then(response => response.json())
            .then(config => {
                if (config.mockData) {
                    // Processes
                    if (config.mockData.processes) {
                        this.state.processes = config.mockData.processes.map(p => new Process(p));
                    }
                    // Users - save to state for UI to render
                    if (config.mockData.users) {
                        this.state.users = config.mockData.users;
                        // Dynamically Render Users Here
                        const grid = document.querySelector('#view-login .user-grid');
                        if (grid) {
                            grid.innerHTML = '';
                            this.state.users.forEach(u => {
                                const isMaestro = u.role === 'Maestro';
                                const roleClass = isMaestro ? 'role-Maestro' : '';
                                const sub = isMaestro ? 'Control Total' : 'Operario';

                                const btn = document.createElement('button');
                                btn.className = `user-card ${roleClass}`;
                                btn.onclick = () => app.login(u.name, u.role);

                                btn.innerHTML = `
                                    <div class="avatar-lg">${u.avatar}</div>
                                    <div class="name">${u.name}</div>
                                    <div class="role">${sub}</div>
                                `;
                                grid.appendChild(btn);
                            });
                        }
                    }

                    // Populate available SKUs in the main create form
                    if (config.mockData.availableSKUs) {
                        this.state.availableSKUs = config.mockData.availableSKUs;
                        UI.renderSKUGrid('sku-picker-grid', 'input-sku-dest');
                    }

                    // Populate performance data if any
                    if (config.mockData.performanceData) {
                        this.state.performanceData = config.mockData.performanceData;
                    }

                    // If dashboard active, re-render
                    if (UI.currentViewId === 'view-dashboard') {
                        UI.renderDashboard();
                    }
                }
            })
            .catch(err => console.error("Error loading mock data:", err));
    },

    save() {
        // Don't save currentUser to localStorage to force login on refresh?
        // Or save it but separated? For this demo, we save state but ignoring currentUser load is fine.
        localStorage.setItem(this.KEY, JSON.stringify({
            processes: this.state.processes
        }));
    },

    addProcess(process) {
        this.state.processes.push(process);
        this.save();
    },

    updateProcess(process) {
        const idx = this.state.processes.findIndex(p => p.id === process.id);
        if (idx !== -1) {
            this.state.processes[idx] = process;
            this.save();
        }
    },

    getProcess(id) {
        return this.state.processes.find(p => p.id === id);
    },

    getActiveProcess(operator) {
        return this.state.processes.find(p =>
            p.operator === operator &&
            p.status === ProcessState.STARTED
        );
    },

    // Sort: Urgent DESC, Status (STARTED>PAUSED>CREATED>FINISHED), Date DESC
    getSortedProcesses() {
        const statusWeight = {
            [ProcessState.STARTED]: 4,
            [ProcessState.PAUSED]: 3,
            [ProcessState.CREATED]: 2,
            [ProcessState.FINISHED]: 1
        };

        return [...this.state.processes].sort((a, b) => {
            // 1. Urgency
            if (a.isUrgent !== b.isUrgent) return b.isUrgent - a.isUrgent;

            // 2. Status
            const wA = statusWeight[a.status];
            const wB = statusWeight[b.status];
            if (wA !== wB) return wB - wA;

            // 3. Date
            return b.createdAt - a.createdAt;
        });
    }
};

// --- UI Logic ---

const UI = {
    activeInterval: null,
    currentViewId: 'view-login', // Start at login

    init() {
        this.setupEventListeners();
        // Check if we want to retain session, but requirement says "Homepage is for choosing user"
        this.navigateTo('view-login');
    },

    navigateTo(viewId, contextId = null) {
        document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
        document.getElementById(viewId).classList.remove('hidden');
        this.currentViewId = viewId;

        if (viewId === 'view-login') {
            document.getElementById('header-user-profile').classList.add('hidden');
        } else {
            document.getElementById('header-user-profile').classList.remove('hidden');
        }

        if (viewId === 'view-dashboard') {
            this.renderDashboard();
            this.stopTimer();
        } else if (viewId === 'view-create') {
            this.resetForm();
        } else if (viewId === 'view-detail' && contextId) {
            this.renderDetail(contextId);
            this.startTimer(contextId);
        }
    },

    updateHeader() {
        const user = Store.state.currentUser;
        const role = Store.state.currentRole;
        if (user) {
            document.getElementById('current-user-name').innerText = user;
            document.getElementById('current-user-role').innerText = role;
            document.getElementById('header-avatar').innerText = user.substring(0, 2).toUpperCase();
        }
    },

    showSnackbar(msg, type = 'success') {
        const container = document.getElementById('snackbar-container');
        const el = document.createElement('div');
        el.className = `snackbar ${type}`;
        el.textContent = msg;
        container.appendChild(el);

        const btn = document.getElementById('btn-new-process');
        if (btn) btn.classList.add('faded-out');

        setTimeout(() => {
            el.remove();
            if (container.children.length === 0 && btn) {
                btn.classList.remove('faded-out');
            }
        }, 3000);
    },

    showModal(title, msg, onConfirm, theme = null) {
        // ... (existing code remains SAME, but ensure clear of modal-body)
        const overlay = document.getElementById('modal-overlay');
        const card = overlay.querySelector('.modal-card');
        card.className = 'modal-card' + (theme ? ` ${theme}` : '');

        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-message').innerText = msg;
        document.getElementById('modal-body').innerHTML = ''; // Clear custom content
        overlay.classList.remove('hidden');

        const btnConfirm = document.getElementById('modal-btn-confirm');
        const btnCancel = document.getElementById('modal-btn-cancel');

        const newConfirm = btnConfirm.cloneNode(true);
        const newCancel = btnCancel.cloneNode(true);
        btnConfirm.parentNode.replaceChild(newConfirm, btnConfirm);
        btnCancel.parentNode.replaceChild(newCancel, btnCancel);

        newConfirm.addEventListener('click', () => {
            overlay.classList.add('hidden');
            onConfirm();
        });

        newCancel.addEventListener('click', () => {
            overlay.classList.add('hidden');
        });
    },

    renderSKUGrid(containerId, inputId, onSelect = null) {
        const grid = document.getElementById(containerId);
        const hiddenInput = document.getElementById(inputId);
        if (!grid) return;

        grid.innerHTML = '';
        Store.state.availableSKUs.forEach(sku => {
            const item = document.createElement('div');
            item.className = 'sku-item';
            const imgPath = `./Imagenes/${sku}.jpg`;

            item.innerHTML = `
                <img src="${imgPath}" alt="${sku}" 
                    onerror="if(this.src.indexOf('.jpg') !== -1) { this.src=this.src.replace('.jpg', '.png'); } else { this.src='https://placehold.co/100x100/1e293b/FFFFFF?text=${sku}'; }">
                <div class="sku-name">${sku}</div>
            `;

            item.onclick = () => {
                // Deselect others
                grid.querySelectorAll('.sku-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                hiddenInput.value = sku;
                if (onSelect) onSelect(sku);
            };

            grid.appendChild(item);
        });
    },

    renderDashboard() {
        const tbody = document.getElementById('process-list-body');
        let list = Store.getSortedProcesses();

        // Filter by user permission
        const currentUser = Store.state.currentUser;
        const currentRole = Store.state.currentRole;

        // Show/Hide Performance button for Maestro
        const btnPerf = document.getElementById('btn-view-performance');
        if (btnPerf) {
            if (currentRole === 'Maestro') {
                btnPerf.classList.remove('hidden');
            } else {
                btnPerf.classList.add('hidden');
            }
        }

        // Hide "New Process" button for Maestro
        const btnCreate = document.getElementById('btn-new-process');
        if (currentRole === 'Maestro') {
            btnCreate.classList.add('hidden');
        } else {
            btnCreate.classList.remove('hidden');
        }

        if (currentRole !== 'Maestro') {
            list = list.filter(p => p.operator === currentUser);
        }

        const emptyState = document.getElementById('empty-state');

        tbody.innerHTML = '';
        if (list.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }
        emptyState.classList.add('hidden');

        list.forEach(proc => {
            const tr = document.createElement('tr');
            if (proc.isUrgent) tr.classList.add('tr-urgent');

            // Generate Badges
            let statusClass = 'badge-created';
            if (proc.status === ProcessState.STARTED) statusClass = 'badge-started';
            if (proc.status === ProcessState.PAUSED) statusClass = 'badge-paused';
            if (proc.status === ProcessState.FINISHED) statusClass = 'badge-finished';

            const urgentBadge = proc.isUrgent ? '<span class="badge badge-urgent">URGENTE</span>' : '';

            // Calc static time for list
            const duration = proc.getEffectiveTimeSeconds();
            const timeStr = this.formatTime(duration);

            tr.innerHTML = `
                <td>${proc.skuDest}</td>
                <td>${proc.operator}</td>
                <td><span class="badge ${statusClass}">${proc.status}</span></td>
                <td>${timeStr}</td>
                <td>${urgentBadge}</td>
                <td>
                    ${(proc.status !== ProcessState.FINISHED && currentRole !== 'Maestro') ? `
                    <button class="btn btn-warning btn-sm" onclick="app.viewDetail('${proc.id}')">
                        Continuar
                    </button>
                    ` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });
        this.checkGlobalUrgency();
    },

    renderPerformance() {
        const container = document.getElementById('performance-cards-container');
        const tbody = document.getElementById('performance-table-body');
        const data = Store.state.performanceData;

        if (!container || !tbody) return;

        container.innerHTML = '';
        tbody.innerHTML = '';

        data.forEach(item => {
            // Render Cards (Summary)
            const card = document.createElement('div');
            card.className = 'perf-card';
            card.innerHTML = `
                <div class="user-name">
                    <div class="avatar-sm" style="width:24px;height:24px;border-radius:50%;background:#3b82f6;display:flex;align-items:center;justify-content:center;font-size:10px;color:white;">
                        ${item.user.charAt(0)}
                    </div>
                    ${item.user}
                </div>
                <div class="perf-metric">
                    <span class="label">Eficiencia Operativa</span>
                    <span class="value">${item.efficiency}%</span>
                    <div class="progress-bar-container">
                        <div class="progress-bar" style="width: ${item.efficiency}%"></div>
                    </div>
                </div>
                <div class="perf-metric" style="margin-bottom:0">
                    <span class="label">Procesos Totales</span>
                    <span class="value">${item.completed}</span>
                </div>
            `;
            container.appendChild(card);

            // Render Table Row
            const tr = document.createElement('tr');
            const trendIcon = item.trend === 'up' ? '↗️' : item.trend === 'down' ? '↘️' : '↔️';
            const trendClass = item.trend === 'up' ? 'trend-up' : item.trend === 'down' ? 'trend-down' : 'trend-stable';

            tr.innerHTML = `
                <td>${item.user}</td>
                <td>${item.completed}</td>
                <td>${item.avgTime}</td>
                <td>
                    <span style="font-weight:700; color: ${item.efficiency > 90 ? '#10b981' : item.efficiency > 80 ? '#f59e0b' : '#ef4444'}">
                        ${item.efficiency}%
                    </span>
                </td>
                <td><span class="trend-icon ${trendClass}">${trendIcon} ${item.trend.toUpperCase()}</span></td>
            `;
            tbody.appendChild(tr);
        });
    },

    renderDetail(processId) {
        const proc = Store.getProcess(processId);
        if (!proc) return;

        // Apply urgent theme to cards
        const detailCards = document.querySelectorAll('#view-detail .card');
        detailCards.forEach(card => {
            if (proc.isUrgent) card.classList.add('card-urgent');
            else card.classList.remove('card-urgent');
        });

        // Header
        // Ensure status is valid to prevent crashes
        const currentStatus = proc.status || ProcessState.CREATED;

        // Header
        document.getElementById('detail-sku-dest').innerText = proc.skuDest;
        const statusBadge = document.getElementById('detail-status-badge');

        let classSuffix = 'created';
        const currentStatusLower = String(currentStatus).toLowerCase();

        if (currentStatusLower === 'iniciado') classSuffix = 'started';
        else if (currentStatusLower === 'pausado') classSuffix = 'paused';
        else if (currentStatusLower === 'finalizado') classSuffix = 'finished';

        statusBadge.innerText = currentStatus;
        statusBadge.className = `badge badge-${classSuffix}`;

        // Actions
        const btnUrgent = document.getElementById('btn-urgent');
        // Urgency available if started or paused
        if (proc.status === ProcessState.STARTED || proc.status === ProcessState.PAUSED) {
            btnUrgent.classList.remove('hidden');
        } else {
            btnUrgent.classList.add('hidden');
        }

        // Info
        document.getElementById('detail-operator').innerText = proc.operator;
        document.getElementById('detail-start-time').innerText = proc.startTime ? proc.startTime.toLocaleTimeString() : '-';
        document.getElementById('detail-end-time').innerText = proc.endTime ? proc.endTime.toLocaleTimeString() : '-';

        /*
        // SKUs Removed
        const ul = document.getElementById('detail-sku-list');
        ul.innerHTML = '';
        proc.skuSource.forEach(sku => {
            const li = document.createElement('li');
            li.innerText = sku;
            ul.appendChild(li);
        });
        */

        // Status Panel Update
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

        largeStatusBadge.innerText = labels[currentStatus] || currentStatus;
        largeStatusBadge.className = `large-badge ${classes[currentStatus] || classes[ProcessState.CREATED]}`;

        // Secondary Info
        document.getElementById('status-start-time').innerText = proc.startTime ? proc.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
        document.getElementById('status-operator').innerText = proc.operator;

        // Controls
        const btnStart = document.getElementById('btn-action-start');
        const btnPause = document.getElementById('btn-action-pause');
        const btnResume = document.getElementById('btn-action-resume');
        const btnFinish = document.getElementById('btn-action-finish');

        [btnStart, btnPause, btnResume, btnFinish].forEach(b => b.classList.add('hidden'));

        if (proc.status === ProcessState.CREATED) {
            btnStart.classList.remove('hidden');
        } else if (proc.status === ProcessState.STARTED) {
            btnPause.classList.remove('hidden');
            btnFinish.classList.remove('hidden');
        } else if (proc.status === ProcessState.PAUSED) {
            btnResume.classList.remove('hidden');
            btnFinish.classList.remove('hidden');
        }
    },

    startTimer(processId) {
        // UI Timer removed as per request.
        // We might want to refresh the view occasionally to start time, but since it's "hh:mm", it doesn't need second-level updates.
    },

    stopTimer() {
        // No-op
    },

    checkGlobalUrgency() {
        // Show header indicator if ANY process is urgent and active (Started/Paused)
        const isUrgentActive = Store.state.processes.some(p => p.isUrgent && p.status !== ProcessState.FINISHED);
        const indicator = document.getElementById('urgent-indicator');
        if (isUrgentActive) indicator.classList.remove('hidden');
        else indicator.classList.add('hidden');
    },

    formatTime(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    },

    // Form Handling - Simplified

    resetForm() {
        document.getElementById('create-process-form').reset();
        // Remove error classes
        document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    },

    // Source SKU logic removed
};

// --- Main App Controller ---

const app = {
    init() {
        Store.init();
        UI.init();
    },

    // Navigation
    login(user, role) {
        Store.state.currentUser = user;
        Store.state.currentRole = role;
        UI.updateHeader();
        UI.showSnackbar(`Bienvenido, ${user}`);
        UI.navigateTo('view-dashboard');
        UI.renderDashboard(); // Force render
        UI.checkGlobalUrgency();
    },

    logout() {
        Store.state.currentUser = null;
        Store.state.currentRole = null;
        UI.navigateTo('view-login');
    },

    viewDetail(id) {
        UI.navigateTo('view-detail', id);
    },

    // Actions
    createProcess(e) {
        e.preventDefault();

        const skuDest = document.getElementById('input-sku-dest').value.trim();
        const operator = Store.state.currentUser;

        // Validations
        let valid = true;
        if (!skuDest) {
            document.getElementById('input-sku-dest').classList.add('input-error');
            valid = false;
        }

        if (!valid) return;

        // Check if operator has another active process
        // NOTE: The PRD says "1 proceso INICIADO máximo" per operator.
        // It does NOT prevent CREATING a process, only STARTING it.
        // However, for simplicity in UI, we often assume we create and maybe auto-start? 
        // The flow says: Create -> Click Iniciar. So we can create safely.

        const newProc = new Process({
            operator,
            skuDest,
            // skuSource: [] // Removed
        });

        Store.addProcess(newProc);
        UI.showSnackbar('Proceso creado exitosamente');

        // Go to detail
        UI.navigateTo('view-detail', newProc.id);
    },


};

// Patching UI navigate to store ID
const originalNavigate = UI.navigateTo.bind(UI);
UI.navigateTo = function (viewId, contextId) {
    this.currentDetailId = contextId; // Store it
    originalNavigate(viewId, contextId);
}

// Controller Actions mapped to UI buttons
app.handleStart = () => {
    const id = UI.currentDetailId;
    const proc = Store.getProcess(id);

    // Check constraint: Operator cannot have another STARTED process
    const active = Store.getActiveProcess(proc.operator);
    if (active && active.id !== id) {
        UI.showSnackbar(`El operario ya tiene el proceso ${active.skuDest} INICIADO. Paúselo antes de iniciar otro.`, 'error');
        return;
    }

    try {
        proc.start();
    } catch (e) {
        UI.showSnackbar(e.message, 'error');
        return;
    }
    Store.updateProcess(proc);
    UI.renderDetail(id);
    UI.showSnackbar('INICIADO', 'success');
};

app.handlePause = () => {
    const id = UI.currentDetailId;
    const proc = Store.getProcess(id);
    try {
        proc.pause();
    } catch (e) {
        UI.showSnackbar(e.message, 'error');
        return;
    }
    Store.updateProcess(proc);
    UI.renderDetail(id);
    UI.showSnackbar('PAUSADO', 'warning');
};

app.handleResume = () => {
    const id = UI.currentDetailId;
    const proc = Store.getProcess(id);

    // Check constraint again (just in case)
    const active = Store.getActiveProcess(proc.operator);
    if (active && active.id !== id) {
        UI.showSnackbar('Imposible reanudar. Ya existe otro activo.', 'error');
        return;
    }

    try {
        proc.resume();
    } catch (e) {
        UI.showSnackbar(e.message, 'error');
        return;
    }
    Store.updateProcess(proc);
    UI.renderDetail(id);
    UI.showSnackbar('REANUDADO', 'success');
};

app.handleFinish = () => {
    const id = UI.currentDetailId;
    UI.showModal('Finalizar ', '¿Confirma que desea cerrar el ? No se podrán realizar más cambios.', () => {
        const proc = Store.getProcess(id);
        proc.finish();
        Store.updateProcess(proc);
        UI.renderDetail(id);
        // UI.stopTimer(); // Removed
        UI.showSnackbar(' FINALIZADO correctamente', 'success');
        UI.checkGlobalUrgency();
    });
};

app.handleUrgency = () => {
    const id = UI.currentDetailId;
    const currentProc = Store.getProcess(id);

    UI.showModal('Generar Urgencia', 'Seleccione el SKU para el nuevo  urgente:', () => {
        const selectedSku = document.getElementById('urgency-sku-value').value;

        if (!selectedSku) {
            UI.showSnackbar('Debe seleccionar un SKU', 'error');
            return;
        }

        // 1. Pause current if started
        if (currentProc.status === ProcessState.STARTED) {
            currentProc.pause();
            Store.updateProcess(currentProc);
            UI.showSnackbar(`Proceso actual PAUSADO`, 'warning');
        }

        // 2. Create new Urgent process
        const urgentProc = new Process({
            operator: currentProc.operator,
            skuDest: selectedSku,
            isUrgent: true,
            status: ProcessState.CREATED
        });

        Store.addProcess(urgentProc);

        // 3. Navigate to it
        UI.navigateTo('view-detail', urgentProc.id);
        UI.showSnackbar('⚠️ PROCESO URGENTE CREADO', 'error');
        UI.checkGlobalUrgency();
    }, 'warning');

    // Add visual grid to modal
    const modalBody = document.getElementById('modal-body');
    const input = document.createElement('input');
    input.type = 'hidden';
    input.id = 'urgency-sku-value';
    modalBody.appendChild(input);

    const gridDiv = document.createElement('div');
    gridDiv.id = 'modal-sku-grid';
    gridDiv.className = 'sku-grid';
    gridDiv.style.gridTemplateColumns = 'repeat(2, 1fr)'; // 2 columns for modal space
    modalBody.appendChild(gridDiv);

    UI.renderSKUGrid('modal-sku-grid', 'urgency-sku-value');
};

// Event Listeners Registration
UI.setupEventListeners = function () {
    // Navigation
    document.getElementById('btn-new-process').onclick = () => UI.navigateTo('view-create');
    document.getElementById('btn-back-dashboard').onclick = () => UI.navigateTo('view-dashboard');
    document.getElementById('btn-cancel-create').onclick = () => UI.navigateTo('view-dashboard');
    document.getElementById('btn-logout').onclick = () => app.logout();

    const btnPerf = document.getElementById('btn-view-performance');
    if (btnPerf) {
        btnPerf.onclick = () => {
            UI.navigateTo('view-performance');
            UI.renderPerformance();
        };
    }

    // Create Form
    document.getElementById('create-process-form').onsubmit = app.createProcess;

    // SKU Input Removed

    // Process Actions
    document.getElementById('btn-action-start').onclick = app.handleStart;
    document.getElementById('btn-action-pause').onclick = app.handlePause;
    document.getElementById('btn-action-resume').onclick = app.handleResume;
    document.getElementById('btn-action-finish').onclick = app.handleFinish;
    document.getElementById('btn-urgent').onclick = app.handleUrgency;
};

// Init APP
window.onload = app.init;
// Expose for debugging
window.app = app;
