/**
 * constants.js — Enums y gestión de gráficos
 */

const ProcessState = {
    CREATED: 'CREADO',
    STARTED: 'INICIADO',
    PAUSED: 'PAUSADO',
    FINISHED: 'FINALIZADO'
};

const SKU_NAMES = {
    'GCMD':    'Guante Cuero Medio Dedo',
    'GGAL070': 'Guante Gala 070',
    'IMOCA':   'Impresora Monocromática A',
    'IMOCP':   'Impresora Monocromática P',
    'MCCE':    'Monitor Curvo CE',
    'SCCA':    'Scanner Compacto A',
    'SECC090': 'Sensor CC 090',
    'SECPI':   'Sensor CPI',
    'SEKOF':   'Sensor KOF',
    'SEKQB':   'Sensor KQB',
    'SEKRN':   'Sensor KRN',
    'SEPASP':  'Sensor PASP',
    'SEPC':    'Sensor PC',
    'SEPEIC':  'Sensor PEIC',
    'SEPOD':   'Sensor POD',
    'SEPOF':   'Sensor POF',
    'SESCD':   'Sensor SCD',
    'SGEP':    'Switch GEP',
    'SKPXL':   'Switch KP XL'
};

const Charts = {
    efficiency: null,
    skuDistro: null,
    skuHours: null,

    destroy(id) {
        if (this[id]) {
            this[id].destroy();
            this[id] = null;
        }
    },

    destroyAll() {
        this.destroy('efficiency');
        this.destroy('skuDistro');
        this.destroy('skuHours');
    }
};
