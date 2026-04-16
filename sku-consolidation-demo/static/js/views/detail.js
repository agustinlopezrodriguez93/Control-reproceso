/**
 * views/detail.js — Vista de detalle de un proceso
 * Depende de: Store, UI (core), ProcessState, SKU_NAMES
 */

const ViewDetail = {
    async render(processId, preloadedData = null) {
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

        UI.currentDetailId = processId;

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
        const { cls: statusCls } = UI.getStatusBadge(currentStatus);

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
    }
};
