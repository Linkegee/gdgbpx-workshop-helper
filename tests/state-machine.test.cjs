const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const scriptPath = require('node:path').join(__dirname, '..', 'gdgbpx-workshop-helper.user.js');
let source = fs.readFileSync(scriptPath, 'utf8');
source = source.replace(
    '    installGlobalErrorLogging();',
    `    globalThis.__helperTest = {
        defaultState,
        getState,
        updateState,
        handlePlayerEvent,
        shouldRecoverPausedVideoImmediately,
        setDetailRefreshTimer(value) { detailRefreshTimer = value; },
        getDetailRefreshTimer() { return detailRefreshTimer; }
    };
    return;

    installGlobalErrorLogging();`
);

const values = new Map();
const documentStub = {
    readyState: 'complete',
    title: '',
    body: {},
    documentElement: {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
};
const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    Blob,
    Date,
    Math,
    JSON,
    Map,
    Set,
    document: documentStub,
    location: { hostname: 'test.invalid', href: 'https://test.invalid/', hash: '' },
    navigator: {},
    sessionStorage: { getItem() { return null; }, setItem() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    GM_getValue(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    GM_setValue(key, value) { values.set(key, value); },
    GM_deleteValue(key) { values.delete(key); },
    GM_addValueChangeListener() { return 1; },
    GM_removeValueChangeListener() {},
    GM_addStyle() {},
    GM_registerMenuCommand() {},
    GM_setClipboard() {},
    GM_xmlhttpRequest() {},
    GM_openInTab() {}
};
context.window = context;
context.window.top = context.window;
context.globalThis = context;

vm.runInNewContext(source, context, { filename: scriptPath });
const helper = context.__helperTest;
assert.ok(helper, 'test hooks should be installed');

function runningState(phase) {
    return {
        ...helper.defaultState(),
        status: 'running',
        phase,
        currentWorkshopTitle: '测试专题',
        currentClassId: 'class-1',
        currentLessonTitle: '测试课程',
        currentLessonKey: 'class-1::测试课程'
    };
}

values.set('gdgbpx_workshop_helper_state_v1', runningState('opening-video'));
helper.handlePlayerEvent({
    id: 'bootstrap-unload',
    type: 'player-unloading',
    at: Date.now(),
    lessonKey: 'class-1::测试课程',
    documentTitle: '验证中...',
    currentTime: 0,
    duration: 0,
    playerSessionId: 'player-1'
});
assert.equal(helper.getState().phase, 'opening-video', 'verification-page unload must not become a close/check event');

values.set('gdgbpx_workshop_helper_state_v1', {
    ...runningState('refresh-delay'),
    refreshAttempts: 3
});
const pendingTimer = setTimeout(() => {}, 60_000);
helper.setDetailRefreshTimer(pendingTimer);
helper.handlePlayerEvent({
    id: 'video-started',
    type: 'video-started',
    at: Date.now(),
    lessonKey: 'class-1::测试课程',
    rate: 1,
    playerSessionId: 'player-1'
});
assert.equal(helper.getState().phase, 'watching-video');
assert.equal(helper.getState().refreshAttempts, 0);
assert.equal(helper.getDetailRefreshTimer(), null, 'playback must cancel an old completion-recheck timer');

assert.match(source, /if \(!\['checking-progress', 'refresh-delay'\]\.includes\(latest\.phase\)\)/,
    'completion recheck callback must verify that its phase is still current');

const resumableVideo = { ended: false };
assert.equal(helper.shouldRecoverPausedVideoImmediately(
    resumableVideo,
    runningState('watching-video'),
    false
), true, 'a transient site pause must be recoverable immediately while running');
assert.equal(helper.shouldRecoverPausedVideoImmediately(
    resumableVideo,
    { ...runningState('watching-video'), status: 'paused' },
    false
), false, 'the helper pause button must suppress immediate recovery');
assert.equal(helper.shouldRecoverPausedVideoImmediately(
    resumableVideo,
    runningState('watching-video'),
    true
), false, 'a visible course question must suppress immediate recovery');
assert.equal(helper.shouldRecoverPausedVideoImmediately(
    resumableVideo,
    { ...runningState('closing-completed-player'), completedCloseRequestAt: Date.now() },
    false
), false, 'a server-confirmed close request must suppress immediate recovery');

console.log('state-machine regression tests passed');
