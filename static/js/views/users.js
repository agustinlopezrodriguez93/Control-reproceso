/**
 * views/users.js — Vista de gestión de usuarios y configuración de pausas
 * Depende de: Store, UI (core), app
 */

const ViewUsers = {
    async render() {
        const grid = document.getElementById('users-grid');
        if (!grid) return;
        const users = await Store.loadUsers();
        grid.innerHTML = '';
        
        users.forEach(u => {
            const card = document.createElement('div');
            card.className = 'user-card';
            card.innerHTML = `
                <div class="user-card-badge">${u.rol}</div>
                <div class="user-card-header">
                    <div class="user-card-avatar">${u.avatar}</div>
                </div>
                <div class="user-card-info">
                    <h3 class="user-card-name">${u.nombre}</h3>
                    <div class="user-card-meta">
                        <span class="status-indicator active"></span>
                        <span class="status-text">Conectado</span>
                    </div>
                </div>
                ${u.rol !== 'Maestro' ? `
                <div class="user-card-actions">
                    <button class="btn btn-ghost btn-sm text-danger" data-delete-user="${u.id}" data-user-name="${u.nombre}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        Eliminar
                    </button>
                </div>
                ` : '<div class="user-card-actions"><span class="badge badge-neutral">Administrador</span></div>'}
            `;

            const deleteBtn = card.querySelector('[data-delete-user]');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    app.handleDeleteUser(u.id, u.nombre);
                });
            }

            grid.appendChild(card);
        });
    },

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
    }
};
