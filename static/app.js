/**
 * SKU Consolidation - Producción
 * Vanilla JS + FastAPI Backend
 * 
 * CAMBIO PRINCIPAL: Todos los datos se guardan en PostgreSQL
 * via API REST. Ya no se usa localStorage.
 */

// --- Constants & Enums ---
const ProcessState = {
    CREATED: 'CREADO',
    STARTED: 'INICIADO',
    PAUSED: 'PAUSADO',
    FINISHED: 'FINALIZADO'
};

// --- Chart Management ---
const Charts = {
    efficiency: null,
    skuDistro: null,

    destroy(id) {
        if (this[id]) {
            this[id].destroy();
            this[id] = null;
        }
    },

    destroyAll() {
        this.destroy('efficiency');
        this.destroy('skuDistro');
    }
};

// --- API Helper ---
// --- API Helper ---
const API = {
    getToken() {
        return localStorage.getItem('reproceso_token');
    },

    getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const token = this.getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    },

    async get(url) {
        try {
            const res = await fetch(url, { headers: this.getHeaders() });
            if (res.status === 401) { app.logout(); return; }
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: 'Error de servidor' }));
                throw new Error(err.detail || `Error ${res.status}`);
            }
            return await res.json();
        } catch (e) {
            console.error(`API GET ${url}:`, e);
            throw e;
        }
    },

    async post(url, data, isLoginForm = false) {
        try {
            let body, headers;
            
            if (isLoginForm) {
                // OAuth2PasswordRequestForm expects x-www-form-urlencoded
                headers = {};
                const params = new URLSearchParams();
                for (const key in data) params.append(key, data[key]);
                body = params;
            } else {
                headers = this.getHeaders();
                body = JSON.stringify(data);
            }

            const res = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: body
            });
            if (res.status === 401 && !isLoginForm) { app.logout(); return; }
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: 'Error de servidor' }));
                throw new Error(err.detail || `Error ${res.status}`);
            }
            return await res.json();
        } catch (e) {
            console.error(`API POST ${url}:`, e);
            throw e;
        }
    },

    async put(url, data) {
        try {
            const res = await fetch(url, {
                method: 'PUT',
                headers: this.getHeaders(),
                body: JSON.stringify(data)
            });
            if (res.status === 401) { app.logout(); return; }
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: 'Error de servidor' }));
                throw new Error(err.detail || `Error ${res.status}`);
            }
            return await res.json();
        } catch (e) {
            console.error(`API PUT ${url}:`, e);
            throw e;
        }
    },

    async delete(url) {
        try {
            const res = await fetch(url, {
                method: 'DELETE',
                headers: this.getHeaders()
            });
            if (res.status === 401) { app.logout(); return; }
            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: 'Error de servidor' }));
                throw new Error(err.detail || `Error ${res.status}`);
            }
            return await res.json();
        } catch (e) {
            console.error(`API DELETE ${url}:`, e);
            throw e;
        }
    }
};

// --- Store (now backed by API) ---
const Store = {
    state: {
        currentUser: null,
        currentRole: null,
        users: [],
        processes: [],
        availableSKUs: [],
        performanceData: []
    },

    async init() {
        const token = API.getToken();
        if (!token) return false;

        try {
            // Check if token is valid and get user info
            const userData = await API.get('/api/me');
            if (userData) {
                this.state.currentUser = userData.nombre;
                this.state.currentRole = userData.rol;
                
                // Load global config (SKUs)
                const config = await API.get('/api/config');
                if (config.availableSKUs) {
                    this.state.availableSKUs = config.availableSKUs;
                    UI.renderSKUGrid('sku-picker-grid', 'input-sku-dest');
                }
                return true;
            }
        } catch (err) {
            console.error("Auth check failed:", err);
            localStorage.removeItem('reproceso_token');
        }
        return false;
    },

    async login(username, password) {
        const data = await API.post('/api/login', {
            username: username,
            password: password
        }, true);

        if (data.access_token) {
            localStorage.setItem('reproceso_token', data.access_token);
            this.state.currentUser = data.user.nombre;
            this.state.currentRole = data.user.rol;
            
            // Post-login config load
            const config = await API.get('/api/config');
            this.state.availableSKUs = config.availableSKUs || [];
            UI.renderSKUGrid('sku-picker-grid', 'input-sku-dest');
            
            return true;
        }
        return false;
    },

    async loadProcesses(operario = null) {
        try {
            const url = operario ? `/api/procesos?operario=${encodeURIComponent(operario)}` : '/api/procesos';
            const data = await API.get(url);
            this.state.processes = data.procesos || [];
            return this.state.processes;
        } catch (err) {
            console.error("Error loading processes:", err);
            UI.showSnackbar('Error cargando procesos', 'error');
            return [];
        }
    },

    async loadProcess(id) {
        try {
            const proc = await API.get(`/api/procesos/${id}`);
            return proc;
        } catch (err) {
            console.error("Error loading process:", err);
            return null;
        }
    },

    async createProcess(operario, skuDestino, esUrgente = false) {
        const data = await API.post('/api/procesos', {
            operario: operario,
            sku_destino: skuDestino,
            es_urgente: esUrgente
        });
        return data;
    },

    async updateProcessState(procesoId, accion) {
        const data = await API.put(`/api/procesos/${procesoId}`, {
            accion: accion
        });
        return data;
    },

    async loadPerformance() {
        try {
            const data = await API.get('/api/performance');
            this.state.performanceData = data.performance || [];
            return this.state.performanceData;
        } catch (err) {
            console.error("Error loading performance:", err);
            return [];
        }
    },

    async loadUsers() {
        const data = await API.get('/api/users');
        this.state.users = data.users || [];
        return this.state.users;
    },

    async addUser(userData) {
        return await API.post('/api/users', userData);
    },

    async deleteUser(userId) {
        return await API.delete(`/api/users/${userId}`);
    },

    async loadAudit() {
        const data = await API.get('/api/audit');
        return data.logs || [];
    },

    async loadDashboardStats() {
        return await API.get('/api/dashboard/kpis');
    },

    async loadOperatorKPIs(userId) {
        return await API.get(`/api/dashboard/operator/${userId}`);
    },

    // Helper to sort processes for display (same logic as before)
    getSortedProcesses() {
        const statusWeight = {
            [ProcessState.STARTED]: 4,
            [ProcessState.PAUSED]: 3,
            [ProcessState.CREATED]: 2,
            [ProcessState.FINISHED]: 1
        };

        return [...this.state.processes].sort((a, b) => {
            // 1. Urgency
            const urgA = a.es_urgente ? 1 : 0;
            const urgB = b.es_urgente ? 1 : 0;
            if (urgA !== urgB) return urgB - urgA;

            // 2. Status
            const wA = statusWeight[a.estado] || 0;
            const wB = statusWeight[b.estado] || 0;
            if (wA !== wB) return wB - wA;

            // 3. Date
            return new Date(b.created_at) - new Date(a.created_at);
        });
    }
};

// --- UI Logic ---

const UI = {
    currentViewId: 'view-login',

    init() {
        this.setupEventListeners();
        this.navigateTo('view-login');
    },

    navigateTo(viewId, contextId = null) {
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
            this.renderDashboard();
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
        const overlay = document.getElementById('modal-overlay');
        const card = overlay.querySelector('.modal-card');
        card.className = 'modal-card' + (theme ? ` ${theme}` : '');

        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-message').innerText = msg;
        document.getElementById('modal-body').innerHTML = '';
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
            const imgPath = `/static/Imagenes/${sku}.jpg`;

            item.innerHTML = `
                <img src="${imgPath}" alt="${sku}" 
                    onerror="if(this.src.indexOf('.jpg') !== -1) { this.src=this.src.replace('.jpg', '.png'); } else { this.src='https://placehold.co/100x100/1e293b/FFFFFF?text=${sku}'; }">
                <div class="sku-name">${sku}</div>
            `;

            item.onclick = () => {
                grid.querySelectorAll('.sku-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                hiddenInput.value = sku;
                if (onSelect) onSelect(sku);
            };

            grid.appendChild(item);
        });
    },

    async renderDashboard() {
        const tbody = document.getElementById('process-list-body');
        const currentUser = Store.state.currentUser;
        const currentRole = Store.state.currentRole;

        // Show/Hide Performance/Users/Audit buttons for Maestro
        const isMaestro = currentRole === 'Maestro';
        
        ['btn-view-performance', 'btn-view-users', 'btn-view-audit'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                if (isMaestro) btn.classList.remove('hidden');
                else btn.classList.add('hidden');
            }
        });

        // Hide "New Process" button for Maestro
        const btnCreate = document.getElementById('btn-new-process');
        if (isMaestro) {
            btnCreate.classList.add('hidden');
        } else {
            btnCreate.classList.remove('hidden');
        }

        // Load processes from API
        // Maestro sees all, operators see only their own
        if (currentRole === 'Maestro') {
            await Store.loadProcesses();
        } else {
            await Store.loadProcesses(currentUser);
        }

        let list = Store.getSortedProcesses();

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

            // Generate Badges
            let statusClass = 'badge-created';
            if (proc.estado === ProcessState.STARTED) statusClass = 'badge-started';
            if (proc.estado === ProcessState.PAUSED) statusClass = 'badge-paused';
            if (proc.estado === ProcessState.FINISHED) statusClass = 'badge-finished';

            const urgentBadge = proc.es_urgente ? '<span class="badge badge-urgent">URGENTE</span>' : '';

            // Calculate effective time from server data
            const timeStr = this.calcEffectiveTime(proc);

            tr.innerHTML = `
                <td>${proc.sku_destino}</td>
                <td>${proc.operario_nombre}</td>
                <td><span class="badge ${statusClass}">${proc.estado}</span></td>
                <td>${timeStr}</td>
                <td>${urgentBadge}</td>
                <td>
                    ${(proc.estado !== ProcessState.FINISHED && currentRole !== 'Maestro') ? `
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

    async renderPerformance() {
        const tbody = document.getElementById('performance-table-body');
        if (!tbody) return;

        try {
            // 1. Fetch Global KPIs
            const globalKpis = await Store.loadDashboardStats();
            
            // 2. Update KPI Cards
            document.getElementById('kpi-active').innerText = globalKpis.active_tasks || 0;
            document.getElementById('kpi-finished-today').innerText = globalKpis.finished_today || 0;
            document.getElementById('kpi-avg-time').innerText = `${Math.round(globalKpis.global_avg_minutes)} min`;
            document.getElementById('kpi-urgent-count').innerText = globalKpis.pending_urgent || 0;

            // 3. Render SKU Distribution Chart
            this.renderSKUDistroChart(globalKpis.sku_distribution);

            // 4. Initial Efficiency Chart (General)
            this.renderEfficiencyChart({
                label: 'Promedio General',
                value: globalKpis.global_avg_minutes
            });

            // 5. Populate Ranking and Dropdown
            const perfData = await Store.loadPerformance();
            tbody.innerHTML = '';
            
            const select = document.getElementById('operator-compare-select');
            select.innerHTML = '<option value="">Comparar Operario...</option>';

            perfData.forEach(item => {
                const efficiency = item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0;
                const avgMin = item.avg_minutes ? Math.round(item.avg_minutes) : '-';

                // Table Row
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
                        <button class="btn btn-secondary btn-sm" onclick="app.loadOperatorKPIs(${item.id})">Ver KPIs</button>
                    </td>
                `;
                tbody.appendChild(tr);

                // Dropdown Option
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

    renderEfficiencyChart(operatorData = null, globalAvgMinutes = null) {
        // Use explicitly passed global average; fall back to DOM only if not provided
        const globalAvg = globalAvgMinutes !== null
            ? Math.round(globalAvgMinutes)
            : Math.round(parseFloat(document.getElementById('kpi-avg-time').innerText) || 0);

        Charts.destroy('efficiency');
        const ctx = document.getElementById('chart-efficiency-compare').getContext('2d');

        const labels = ['Promedio General'];
        const data = [globalAvg];
        const colors = ['rgba(99, 102, 241, 0.5)'];

        // operatorData from loadOperatorKPIs has .id; the initial call uses {label, value}
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

    async renderDetail(processId) {
        // Load fresh data from API
        const proc = await Store.loadProcess(processId);
        if (!proc) {
            UI.showSnackbar('Proceso no encontrado', 'error');
            return;
        }

        // Store current detail ID for action handlers
        this.currentDetailId = processId;

        // Apply urgent theme
        const detailCards = document.querySelectorAll('#view-detail .card');
        detailCards.forEach(card => {
            if (proc.es_urgente) card.classList.add('card-urgent');
            else card.classList.remove('card-urgent');
        });

        // Header
        const currentStatus = proc.estado || ProcessState.CREATED;

        document.getElementById('detail-sku-dest').innerText = proc.sku_destino;
        const statusBadge = document.getElementById('detail-status-badge');

        let classSuffix = 'created';
        const currentStatusLower = String(currentStatus).toLowerCase();

        if (currentStatusLower === 'iniciado') classSuffix = 'started';
        else if (currentStatusLower === 'pausado') classSuffix = 'paused';
        else if (currentStatusLower === 'finalizado') classSuffix = 'finished';

        statusBadge.innerText = currentStatus;
        statusBadge.className = `badge badge-${classSuffix}`;

        // Urgent button
        const btnUrgent = document.getElementById('btn-urgent');
        if (proc.estado === ProcessState.STARTED || proc.estado === ProcessState.PAUSED) {
            btnUrgent.classList.remove('hidden');
        } else {
            btnUrgent.classList.add('hidden');
        }

        // Info
        document.getElementById('detail-operator').innerText = proc.operario_nombre;
        document.getElementById('detail-start-time').innerText = proc.started_at
            ? new Date(proc.started_at).toLocaleTimeString() : '-';
        document.getElementById('detail-end-time').innerText = proc.finished_at
            ? new Date(proc.finished_at).toLocaleTimeString() : '-';

        // Status Panel
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
        document.getElementById('status-start-time').innerText = proc.started_at
            ? new Date(proc.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
        document.getElementById('status-operator').innerText = proc.operario_nombre;

        // Controls
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

    checkGlobalUrgency() {
        const isUrgentActive = Store.state.processes.some(p =>
            p.es_urgente && p.estado !== ProcessState.FINISHED
        );
        const indicator = document.getElementById('urgent-indicator');
        if (isUrgentActive) indicator.classList.remove('hidden');
        else indicator.classList.add('hidden');
    },

    calcEffectiveTime(proc) {
        if (!proc.started_at) return '00:00:00';

        const start = new Date(proc.started_at);
        const end = proc.finished_at ? new Date(proc.finished_at) : new Date();
        let totalTime = end - start;

        // Subtract pause durations
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
        // Re-render SKU grid to clear selection
        UI.renderSKUGrid('sku-picker-grid', 'input-sku-dest');
    },
};

// --- Main App Controller ---

const app = {
    async init() {
        const loggedIn = await Store.init();
        UI.init();
        if (loggedIn) {
            UI.navigateTo('view-dashboard');
        } else {
            UI.navigateTo('view-login');
        }
    },

    // Navigation
    async handleLogin(e) {
        e.preventDefault();
        const user = document.getElementById('login-username').value;
        const pass = document.getElementById('login-password').value;

        try {
            const ok = await Store.login(user, pass);
            if (ok) {
                UI.showSnackbar(`Bienvenido, ${Store.state.currentUser}`);
                UI.navigateTo('view-dashboard');
            }
        } catch (err) {
            UI.showSnackbar(err.message || 'Error al iniciar sesión', 'error');
        }
    },

    logout() {
        localStorage.removeItem('reproceso_token');
        Store.state.currentUser = null;
        Store.state.currentRole = null;
        UI.navigateTo('view-login');
    },

    viewDetail(id) {
        UI.navigateTo('view-detail', id);
    },

    // Create Process
    async createProcess(e) {
        e.preventDefault();

        const skuDest = document.getElementById('input-sku-dest').value.trim();
        const operator = Store.state.currentUser;

        if (!skuDest) {
            document.getElementById('input-sku-dest').classList.add('input-error');
            UI.showSnackbar('Seleccione un SKU destino', 'error');
            return;
        }

        try {
            const result = await Store.createProcess(operator, skuDest);
            UI.showSnackbar('Proceso creado exitosamente');
            UI.navigateTo('view-detail', result.proceso.id);
        } catch (err) {
            UI.showSnackbar(err.message, 'error');
        }
    },
};

// --- Action Handlers (mapped to buttons) ---

app.handleStart = async () => {
    const id = UI.currentDetailId;
    try {
        await Store.updateProcessState(id, 'start');
        await UI.renderDetail(id);
        UI.showSnackbar('INICIADO', 'success');
    } catch (err) {
        UI.showSnackbar(err.message, 'error');
    }
};

app.handlePause = async () => {
    const id = UI.currentDetailId;
    try {
        await Store.updateProcessState(id, 'pause');
        await UI.renderDetail(id);
        UI.showSnackbar('PAUSADO', 'warning');
    } catch (err) {
        UI.showSnackbar(err.message, 'error');
    }
};

app.handleResume = async () => {
    const id = UI.currentDetailId;
    try {
        await Store.updateProcessState(id, 'resume');
        await UI.renderDetail(id);
        UI.showSnackbar('REANUDADO', 'success');
    } catch (err) {
        UI.showSnackbar(err.message, 'error');
    }
};

app.handleFinish = () => {
    const id = UI.currentDetailId;
    UI.showModal('Finalizar', '¿Confirma que desea cerrar el proceso? No se podrán realizar más cambios.', async () => {
        try {
            await Store.updateProcessState(id, 'finish');
            await UI.renderDetail(id);
            UI.showSnackbar('FINALIZADO correctamente', 'success');
            UI.checkGlobalUrgency();
        } catch (err) {
            UI.showSnackbar(err.message, 'error');
        }
    });
};

app.handleUrgency = () => {
    const id = UI.currentDetailId;

    UI.showModal('Generar Urgencia', 'Seleccione el SKU para el nuevo proceso urgente:', async () => {
        const selectedSku = document.getElementById('urgency-sku-value').value;

        if (!selectedSku) {
            UI.showSnackbar('Debe seleccionar un SKU', 'error');
            return;
        }

        try {
            // 1. Pause current process if started
            const currentProc = await Store.loadProcess(id);
            if (currentProc && currentProc.estado === ProcessState.STARTED) {
                await Store.updateProcessState(id, 'pause');
                UI.showSnackbar('Proceso actual PAUSADO', 'warning');
            }

            // 2. Create new urgent process
            const result = await Store.createProcess(
                Store.state.currentUser,
                selectedSku,
                true // es_urgente
            );

            // 3. Navigate to the new urgent process
            UI.navigateTo('view-detail', result.proceso.id);
            UI.showSnackbar('⚠️ PROCESO URGENTE CREADO', 'error');
            UI.checkGlobalUrgency();
        } catch (err) {
            UI.showSnackbar(err.message, 'error');
        }
    }, 'warning');

    // Add SKU picker to modal
    const modalBody = document.getElementById('modal-body');
    const input = document.createElement('input');
    input.type = 'hidden';
    input.id = 'urgency-sku-value';
    modalBody.appendChild(input);

    const gridDiv = document.createElement('div');
    gridDiv.id = 'modal-sku-grid';
    gridDiv.className = 'sku-grid';
    gridDiv.style.gridTemplateColumns = 'repeat(2, 1fr)';
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

    // Login Form
    document.getElementById('login-form').onsubmit = app.handleLogin;

    const btnPerf = document.getElementById('btn-view-performance');
    if (btnPerf) btnPerf.onclick = () => UI.navigateTo('view-performance');

    const btnUsers = document.getElementById('btn-view-users');
    if (btnUsers) btnUsers.onclick = () => UI.navigateTo('view-users');

    const btnAudit = document.getElementById('btn-view-audit');
    if (btnAudit) btnAudit.onclick = () => UI.navigateTo('view-audit');

    // Create Form
    document.getElementById('create-process-form').onsubmit = app.createProcess;

    // Process Actions
    document.getElementById('btn-action-start').onclick = app.handleStart;
    document.getElementById('btn-action-pause').onclick = app.handlePause;
    document.getElementById('btn-action-resume').onclick = app.handleResume;
    document.getElementById('btn-action-finish').onclick = app.handleFinish;
    document.getElementById('btn-urgent').onclick = app.handleUrgency;

    // User Management Actions
    const btnAddUser = document.getElementById('btn-add-user');
    if (btnAddUser) btnAddUser.onclick = () => app.handleAddUser();
};

app.handleAddUser = () => {
    UI.showModal('Nuevo Operario', 'Ingrese los datos del nuevo usuario:', async () => {
        const nombre = document.getElementById('new-user-name').value;
        const pass = document.getElementById('new-user-pass').value;
        const avatar = document.getElementById('new-user-avatar').value;

        if (!nombre || !pass) {
            UI.showSnackbar('Nombre y contraseña son requeridos', 'error');
            return;
        }

        try {
            await Store.addUser({ nombre, password: pass, avatar, rol: 'Operario' });
            UI.showSnackbar('Usuario creado');
            UI.renderUsers();
        } catch (err) {
            UI.showSnackbar(err.message, 'error');
        }
    });

    const body = document.getElementById('modal-body');
    body.innerHTML = `
        <div class="form-group">
            <label>Nombre de usuario</label>
            <input type="text" id="new-user-name" class="form-control">
        </div>
        <div class="form-group">
            <label>Contraseña</label>
            <input type="password" id="new-user-pass" class="form-control">
        </div>
        <div class="form-group">
            <label>Avatar (Iniciales)</label>
            <input type="text" id="new-user-avatar" class="form-control" maxlength="2" placeholder="OP">
        </div>
    `;
};

UI.renderUsers = async function() {
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
                <button class="btn btn-ghost btn-sm text-danger" onclick="app.handleDeleteUser(${u.id}, '${u.nombre}')">
                    Eliminar
                </button>
                ` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
};

app.handleDeleteUser = (id, nombre) => {
    UI.showModal('Eliminar Usuario', `¿Está seguro de eliminar a ${nombre}?`, async () => {
        try {
            await Store.deleteUser(id);
            UI.showSnackbar('Usuario eliminado');
            UI.renderUsers();
        } catch (err) {
            UI.showSnackbar(err.message, 'error');
        }
    }, 'danger');
};

UI.renderAudit = async function() {
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
};

app.loadOperatorKPIs = async (userId) => {
    await UI.loadOperatorKPIs(userId);
};

// Init APP
window.onload = app.init;
window.app = app;
