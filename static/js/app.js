/**
 * app.js — Controlador principal y manejadores de acciones
 * Depende de: Store, UI, ProcessState
 * Este archivo se carga último.
 */

const app = {
    async init() {
        // Eventos que Store emite para notificar cambios de datos sin depender de UI.
        window.addEventListener('store:skus-updated', () => {
            UI.renderSKUGrid('sku-picker-grid', 'input-sku-dest');
        });
        window.addEventListener('store:public-users-updated', () => {
            UI.renderUserPicker();
        });

        const loggedIn = await Store.init();
        UI.init();
        if (loggedIn) {
            UI.navigateTo('view-dashboard');
            // Iniciar monitor de pausas solo para operarios
            if (Store.state.currentRole === 'Operario') {
                BreakMonitor.init();
            }
        } else {
            UI.navigateTo('view-login');
        }
    },

    // ─── Autenticación ────────────────────────────

    async handleLogin(e) {
        e.preventDefault();
        const user = document.getElementById('login-username').value;
        const pass = document.getElementById('login-password').value;

        try {
            const ok = await Store.login(user, pass);
            if (ok) {
                UI.showSnackbar(`Bienvenido, ${Store.state.currentUser}`);
                UI.navigateTo('view-dashboard');
                if (Store.state.currentRole === 'Operario') {
                    BreakMonitor.init();
                }
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

    // ─── Navegación ───────────────────────────────

    viewDetail(id) {
        UI.navigateTo('view-detail', id);
    },

    viewDetailPreloaded(proc) {
        // Navegar al detalle con datos ya en store — evita fetch extra
        UI.navigateTo('view-detail', proc.id);
    },

    // ─── Creación de Procesos ─────────────────────

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

    // ─── Loading Helper ───────────────────────────

    async withLoading(btnId, fn) {
        const btn = document.getElementById(btnId);
        if (!btn) return await fn();

        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.classList.add('btn-loading');
        try {
            await fn();
        } finally {
            btn.disabled = false;
            btn.classList.remove('btn-loading');
            btn.innerHTML = originalText;
        }
    },

    // ─── Acciones de Proceso ──────────────────────

    async handleStart() {
        const id = UI.currentDetailId;
        await this.withLoading('btn-action-start', async () => {
            try {
                const res = await Store.updateProcessState(id, 'start');
                await UI.renderDetail(id, res.proceso);
                UI.showSnackbar('INICIADO', 'success');
            } catch (err) {
                UI.showSnackbar(err.message, 'error');
            }
        });
    },

    async handlePause() {
        const id = UI.currentDetailId;
        await this.withLoading('btn-action-pause', async () => {
            try {
                const res = await Store.updateProcessState(id, 'pause');
                await UI.renderDetail(id, res.proceso);
                UI.showSnackbar('PAUSADO', 'warning');
            } catch (err) {
                UI.showSnackbar(err.message, 'error');
            }
        });
    },

    async handleResume() {
        const id = UI.currentDetailId;
        await this.withLoading('btn-action-resume', async () => {
            try {
                const res = await Store.updateProcessState(id, 'resume');
                await UI.renderDetail(id, res.proceso);
                UI.showSnackbar('REANUDADO', 'success');
            } catch (err) {
                UI.showSnackbar(err.message, 'error');
            }
        });
    },

    handleFinish() {
        const id = UI.currentDetailId;
        UI.showModal('Finalizar Proceso', '¿Confirma que desea cerrar el proceso? No se podrán realizar más cambios.', async () => {
            await this.withLoading('modal-btn-confirm', async () => {
                try {
                    await Store.updateProcessState(id, 'finish');
                    UI.showSnackbar('FINALIZADO correctamente', 'success');
                    UI.navigateTo('view-dashboard', true);
                    UI.checkGlobalUrgency();
                } catch (err) {
                    UI.showSnackbar(err.message, 'error');
                }
            });
        });
    },

    // ─── Urgencia ─────────────────────────────────

    handleUrgency() {
        const id = UI.currentDetailId;

        // showModal limpia modal-body internamente, por lo que el contenido
        // debe agregarse DESPUÉS de llamar a showModal, no antes.
        UI.showModal('Generar Urgencia', 'Seleccione el SKU para el nuevo proceso urgente:', async () => {
            const selectedSku = document.getElementById('urgency-sku-value').value;

            if (!selectedSku) {
                UI.showSnackbar('Debe seleccionar un SKU', 'error');
                return;
            }

            try {
                const currentProc = await Store.loadProcess(id);
                if (currentProc && currentProc.estado === ProcessState.STARTED) {
                    await Store.updateProcessState(id, 'pause');
                    UI.showSnackbar('Proceso actual PAUSADO', 'warning');
                }

                const result = await Store.createProcess(
                    Store.state.currentUser,
                    selectedSku,
                    true
                );

                UI.navigateTo('view-detail', result.proceso.id);
                UI.showSnackbar('PROCESO URGENTE CREADO', 'error');
                UI.checkGlobalUrgency();
            } catch (err) {
                UI.showSnackbar(err.message, 'error');
            }
        }, 'warning');

        // Poblar el cuerpo del modal DESPUÉS de que showModal lo haya limpiado
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
    },

    // ─── Gestión de Usuarios ──────────────────────

    handleAddUser() {
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
    },

    handleDeleteUser(id, nombre) {
        UI.showModal('Eliminar Usuario', `¿Está seguro de eliminar a ${nombre}?`, async () => {
            try {
                await Store.deleteUser(id);
                UI.showSnackbar('Usuario eliminado');
                UI.renderUsers();
            } catch (err) {
                UI.showSnackbar(err.message, 'error');
            }
        }, 'danger');
    },

    // ─── KPIs de Operador ─────────────────────────

    async loadOperatorKPIs(userId) {
        await UI.loadOperatorKPIs(userId);
    },

    // ─── Break Config (Maestro) ───────────────────

    async loadBreakConfig() {
        try {
            const cfg = await Store.loadBreakConfig();
            const toggle = document.getElementById('break-enabled-toggle');
            const workInput = document.getElementById('break-work-minutes');
            const restInput = document.getElementById('break-rest-minutes');

            if (toggle) toggle.checked = cfg.enabled;
            if (workInput) workInput.value = cfg.work_minutes;
            if (restInput) restInput.value = cfg.rest_minutes;

            UI.updateBreakConfigUI(cfg.enabled);
            UI.updateBreakPreview();
        } catch (err) {
            console.error('Error loading break config:', err);
        }
    },

    async saveBreakConfig() {
        const toggle = document.getElementById('break-enabled-toggle');
        const workInput = document.getElementById('break-work-minutes');
        const restInput = document.getElementById('break-rest-minutes');

        const enabled = toggle?.checked || false;
        const workMin = parseInt(workInput?.value) || 90;
        const restMin = parseInt(restInput?.value) || 10;

        await this.withLoading('btn-save-break-config', async () => {
            try {
                await Store.saveBreakConfig(enabled, workMin, restMin);
                UI.showSnackbar('Configuración guardada', 'success');
                // Recargar la config en el monitor de pausas
                BreakMonitor.reload();
            } catch (err) {
                UI.showSnackbar(err.message || 'Error al guardar', 'error');
            }
        });
    }
};

// ─── Init ─────────────────────────────────────
// .bind(app) asegura que 'this' sea correcto dentro de init() si se usa en el futuro
window.onload = app.init.bind(app);
window.app = app;
