'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAccountStorage } = require('../../src/account-storage.cjs');
const source = require('../../tests/load-core.cjs').loadCore();
const STATE = 'gdgbpx_workshop_helper_state_v1';
const EVENT = 'gdgbpx_workshop_helper_event_v1';
const HEARTBEAT = 'gdgbpx_workshop_helper_player_heartbeat_v1';
function backend() {
    const values = new Map(), listeners = new Map();
    let id = 0;
    return {
        GM_getValue(k, fallback) { return values.has(k) ? structuredClone(values.get(k)) : fallback; },
        GM_setValue(k, value) {
            const old = values.has(k) ? structuredClone(values.get(k)) : undefined;
            values.set(k, structuredClone(value));
            for (const [name, fn] of listeners.values()) if (name === k) fn(k, old, structuredClone(value), true);
        },
        GM_deleteValue(k) { values.delete(k); },
        GM_addValueChangeListener(k, fn) { listeners.set(++id, [k, fn]); return id; },
        GM_removeValueChangeListener(id) { listeners.delete(id); }
    };
}
function script(storage) {
    const context = { ...storage, URL, URLSearchParams,
        accountRuntime: require('../../tests/load-core.cjs').runtimeStub,
        location: { hostname: 'gbpx.gd.gov.cn', href: 'https://gbpx.gd.gov.cn/gdceportal/dist/' },
        console: { log() {}, warn() {}, error(error) { throw error; } },
        setTimeout() { return 1; }, clearTimeout() {},
        document: { querySelector() { return null; } }
    };
    context.window = context;
    context.top = context;
    vm.runInNewContext(source.replace('    installGlobalErrorLogging();',
        '    globalThis.api = {getState, updateState, getLogs}; return;\n    installGlobalErrorLogging();'), context);
    return context.api;
}

test('baseline: two production instances currently overwrite one another in shared GM storage', () => {
    const shared = backend();
    const a = script(shared), b = script(shared);
    a.updateState({ status: 'running', currentLessonKey: 'same-course', currentLessonProgress: 25 });
    b.updateState({ status: 'paused', currentLessonProgress: 70 });
    assert.equal(a.getState().status, 'paused');
    assert.equal(a.getState().currentLessonProgress, 70);
});

test('isolated production instances preserve independent progress, stop and maintenance state', () => {
    const shared = backend();
    const a = script(createAccountStorage(shared, 'account_A'));
    const b = script(createAccountStorage(shared, 'account_B'));
    a.updateState({ status: 'running', currentLessonKey: 'same-course', currentLessonProgress: 25 });
    b.updateState({ status: 'running', currentLessonKey: 'same-course', currentLessonProgress: 70 });
    a.updateState({ phase: 'maintenance-wait', maintenance: { id: 'maintenance-A' } });
    assert.equal(b.getState().maintenance, null);
    b.updateState({ status: 'stopped', stopRequestAt: 100 });
    assert.equal(a.getState().status, 'running');
    assert.equal(a.getState().stopRequestAt, 0);
    assert.equal(a.getState().currentLessonProgress, 25);
    assert.equal(b.getState().currentLessonProgress, 70);
    assert.ok(a.getLogs().every(log => log.detail.to?.status !== 'stopped'));
});

test('same-scope player events and heartbeat reach parent; other account receives none', () => {
    const shared = backend();
    const a = createAccountStorage(shared, 'account_A');
    const player = createAccountStorage(shared, 'account_A');
    const b = createAccountStorage(shared, 'account_B');
    const received = [];
    const id = a.GM_addValueChangeListener(EVENT, (...args) => received.push(args));
    b.GM_addValueChangeListener(EVENT, () => assert.fail('cross-account event'));
    player.GM_setValue(EVENT, { type: 'player-unloading' });
    player.GM_setValue(HEARTBEAT, { sessionId: 'player-A' });
    assert.equal(received.length, 1);
    assert.equal(received[0][0], EVENT);
    assert.equal(received[0][3], true);
    assert.equal(a.GM_getValue(HEARTBEAT).sessionId, 'player-A');
    assert.equal(b.GM_getValue(HEARTBEAT, null), null);
    b.GM_removeValueChangeListener(id);
    player.GM_setValue(EVENT, { type: 'video-playing' });
    assert.equal(received.length, 2, 'another scope cannot remove this listener');
    a.dispose();
    player.GM_setValue(EVENT, {});
    assert.equal(received.length, 2);
    assert.throws(() => a.GM_setValue(STATE, {}), /disposed/);
});

test('reload preserves scope; legacy state is never silently assigned to a new account', () => {
    const shared = backend();
    shared.GM_setValue(STATE, { status: 'running', currentLessonProgress: 99 });
    const a = createAccountStorage(shared, 'account_A');
    assert.equal(script(a).getState().status, 'idle');
    script(a).updateState({ status: 'paused', currentLessonProgress: 12 });
    assert.equal(script(createAccountStorage(shared, 'account_A')).getState().currentLessonProgress, 12);
    a.GM_deleteValue(STATE);
    assert.equal(script(a).getState().status, 'idle');
    assert.equal(shared.GM_getValue(STATE).currentLessonProgress, 99);
});

test('missing or malformed account scope fails closed instead of using shared state', () => {
    for (const invalid of [undefined, null, '', 'short', 'a:b:c:d:', '中文账号名称', 'a'.repeat(81)]) {
        assert.throws(() => createAccountStorage(backend(), invalid), /scope/);
    }
});
