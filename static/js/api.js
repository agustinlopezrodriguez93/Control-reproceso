/**
 * api.js — HTTP client wrapper con autenticación JWT
 * Depende de: (ninguno en carga, pero referencia app.logout en runtime)
 */

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

    async patch(url, data) {
        try {
            const res = await fetch(url, {
                method: 'PATCH',
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
            console.error(`API PATCH ${url}:`, e);
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
