'use strict';

// Explicit scope only. This adapter isolates userscript storage, not website
// cookies, network requests or browser tabs. It is not wired into production.
function createAccountStorage(api, scopeId) {
    if (typeof scopeId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(scopeId)) {
        throw new TypeError('An explicit opaque account scope (8–80 characters) is required');
    }
    const prefix = `gdgbpx_account_v1:${scopeId}:`;
    const listeners = new Set();
    let disposed = false;
    function key(name) {
        if (disposed) throw new Error('Account storage has been disposed');
        if (typeof name !== 'string' || !name) throw new TypeError('A storage key is required');
        return prefix + name;
    }
    return Object.freeze({
        GM_getValue(name, fallback) { return api.GM_getValue(key(name), fallback); },
        GM_setValue(name, value) { return api.GM_setValue(key(name), value); },
        GM_deleteValue(name) { return api.GM_deleteValue(key(name)); },
        GM_addValueChangeListener(name, callback) {
            const id = api.GM_addValueChangeListener(key(name), (_key, oldValue, newValue, remote) => {
                if (!disposed) callback(name, oldValue, newValue, remote);
            });
            listeners.add(id);
            return id;
        },
        GM_removeValueChangeListener(id) {
            if (!listeners.has(id)) return;
            api.GM_removeValueChangeListener(id);
            listeners.delete(id);
        },
        dispose() {
            disposed = true;
            for (const id of listeners) api.GM_removeValueChangeListener(id);
            listeners.clear();
        }
    });
}

module.exports = { createAccountStorage };
