/**
 * store.js — Estado de la aplicación y llamadas a datos
 * Depende de: API, ProcessState
 * No llama directamente a UI — emite eventos DOM para desacoplar capas.
 */

const Store = {
    state: {
        currentUser: null,
        currentRole: null,
        users: [],
        processes: [],
        availableSKUs: [],
        performanceData: [],
        publicUsers: []
    },

    async init() {
        const token = API.getToken();
        if (!token) {
            try {
                const data = await API.get('/api/users-public');
                this.state.publicUsers = data.users || [];
                // Emitir evento en lugar de llamar UI directamente — mantiene desacoplamiento
                window.dispatchEvent(new CustomEvent('store:public-users-updated'));
            } catch (err) {
                console.error("Failed to fetch public users:", err);
            }
            return false;
        }

        try {
            // Peticiones independientes en paralelo — reduce el tiempo de carga inicial
            const [userData, config] = await Promise.all([
                API.get('/api/me'),
                API.get('/api/config')
            ]);

            if (userData) {
                this.state.currentUser = userData.nombre;
                this.state.currentRole = userData.rol;
            }

            if (config?.availableSKUs) {
                this.state.availableSKUs = config.availableSKUs;
                window.dispatchEvent(new CustomEvent('store:skus-updated'));
            }

            return !!userData;
        } catch (err) {
            console.error("Auth check failed:", err);
            localStorage.removeItem('reproceso_token');
            const data = await API.get('/api/users-public');
            this.state.publicUsers = data.users || [];
            window.dispatchEvent(new CustomEvent('store:public-users-updated'));
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

            // Peticiones independientes en paralelo
            const config = await API.get('/api/config');
            this.state.availableSKUs = config.availableSKUs || [];
            window.dispatchEvent(new CustomEvent('store:skus-updated'));

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
            return await API.get(`/api/procesos/${id}`);
        } catch (err) {
            console.error("Error loading process:", err);
            return null;
        }
    },

    async createProcess(operario, skuDestino, esUrgente = false) {
        return await API.post('/api/procesos', {
            operario: operario,
            sku_destino: skuDestino,
            es_urgente: esUrgente
        });
    },

    async updateProcessState(procesoId, accion) {
        return await API.put(`/api/procesos/${procesoId}`, { accion });
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

    async loadSKUStats() {
        const data = await API.get('/api/sku-stats');
        return data.sku_stats || [];
    },

    async loadBreakConfig() {
        return await API.get('/api/break-config');
    },

    async saveBreakConfig(enabled, workMinutes, restMinutes) {
        return await API.put('/api/break-config', {
            enabled,
            work_minutes: workMinutes,
            rest_minutes: restMinutes
        });
    },

    getSortedProcesses() {
        const statusWeight = {
            [ProcessState.STARTED]: 4,
            [ProcessState.PAUSED]: 3,
            [ProcessState.CREATED]: 2,
            [ProcessState.FINISHED]: 1
        };

        return [...this.state.processes].sort((a, b) => {
            const urgA = a.es_urgente ? 1 : 0;
            const urgB = b.es_urgente ? 1 : 0;
            if (urgA !== urgB) return urgB - urgA;

            const wA = statusWeight[a.estado] || 0;
            const wB = statusWeight[b.estado] || 0;
            if (wA !== wB) return wB - wA;

            return new Date(b.created_at) - new Date(a.created_at);
        });
    }
};
