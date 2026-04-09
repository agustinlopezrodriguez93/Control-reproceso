/**
 * views/users.js — Vista de gestión de usuarios y configuración de pausas
 * Depende de: Store, UI (core), app
 */

const ViewUsers = {
    async render() {
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

            const deleteBtn = tr.querySelector('[data-delete-user]');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    app.handleDeleteUser(u.id, u.nombre);
                });
            }

            tbody.appendChild(tr);
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
