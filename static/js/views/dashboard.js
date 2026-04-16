/**
 * views/dashboard.js — Vista del dashboard principal
 * Depende de: Store, UI (core), ProcessState, app
 */

const ViewDashboard = {
    async render(forceRefresh = false) {
        const tbody = document.getElementById('process-list-body');
        const currentUser = Store.state.currentUser;
        const currentRole = Store.state.currentRole;
        const isMaestro = currentRole === 'Maestro';

        ['btn-view-performance', 'btn-view-users', 'btn-view-audit', 'btn-view-stock-panel'].forEach(id => {
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

            const { cls: statusCls } = UI.getStatusBadge(proc.estado);
            const urgentBadge = proc.es_urgente ? '<span class="badge badge-urgent">URGENTE</span>' : '';
            const timeStr = UI.calcEffectiveTime(proc);

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

            const btn = tr.querySelector('[data-proc-id]');
            if (btn) {
                btn.addEventListener('click', () => app.viewDetailPreloaded(proc));
            }

            tbody.appendChild(tr);
        });
        UI.checkGlobalUrgency();
    }
};
