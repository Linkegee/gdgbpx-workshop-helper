const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = require('./load-core.cjs').loadCore();
const STATE = 'gdgbpx_workshop_helper_state_v1';
const HEARTBEAT = 'gdgbpx_workshop_helper_player_heartbeat_v1';
const notice = '9月24日-27日，9月30日-10月7日晚上21:00至次日8:00系统关闭，造成不便敬请谅解';

function page(kind = 'maintenance') {
    const element = (text = '') => ({ textContent: text, innerText: text,
        style: {}, setAttribute() {}, addEventListener() {}, remove() {},
        querySelector() { return null; }, querySelectorAll() { return []; } });
    return {
        title: kind === 'maintenance' ? '维护公告' : '广东省干部培训网络学院',
        readyState: 'complete',
        body: { ...element(), children: kind === 'maintenance' ? [element(`维护公告 ${notice}`)] : [] , appendChild() {} },
        documentElement: element(),
        createElement() { return element(); },
        querySelector(selector) {
            if (kind === 'maintenance' && selector.includes('.notice-main')) return element(`维护公告 ${notice}`);
            if (kind === 'login' && selector.includes('input[type="password"]')) return element();
            if (kind === 'shell' && selector === '#app') return element();
            if (kind === 'shell' && selector.includes('script[src]')) return element();
            if (kind === 'list' && selector === '.content-div .list_box') return element();
            return null;
        },
        querySelectorAll() { return []; },
        addEventListener() {}
    };
}

function boot(saved, values = new Map()) {
    let now = 1_800_000_000_000;
    let timerId = 0;
    const timers = new Map();
    const requests = [];
    const navigations = [];
    const context = {
        accountRuntime: require('./load-core.cjs').runtimeStub,
        console: process.env.DEBUG_TESTS ? console : { log() {}, warn() {}, error() {} }, URL, URLSearchParams, Blob, Map, Set,
        Date: class extends Date { static now() { return now; } },
        setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        setInterval(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
        clearInterval(id) { timers.delete(id); }, queueMicrotask() {},
        document: page(),
        location: { hostname: 'gbpx.gd.gov.cn', origin: 'https://gbpx.gd.gov.cn',
            href: 'https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/mergeClass?classId=class-1&type=1',
            hash: '#/workshop/workshopindex/mergeClass?classId=class-1&type=1',
            reload() { navigations.push('reload'); }, replace(url) { navigations.push(url); } },
        navigator: {}, sessionStorage: { getItem() { return null; }, setItem() {} },
        DOMParser: class { parseFromString(text) { return page(text); } },
        GM_getValue(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
        GM_setValue(key, value) { values.set(key, value); }, GM_deleteValue(key) { values.delete(key); },
        GM_xmlhttpRequest(request) { requests.push(request); },
        GM_openInTab() { throw new Error('must not open a player during maintenance'); },
    };
    context.window = context;
    context.top = context;
    const opened = [];
    context.GM_openInTab = (url) => { opened.push(url); return { close() {} }; };
    const instrumented = source.replace('    installGlobalErrorLogging();', `
        globalThis.api = {defaultState, getState, mainTick, handlePanelAction, handlePlayerEvent,
            shouldRecoverPausedVideoImmediately, readServerStatusProbeDocument,
            setProbe(doc) { serverStatusFrame = {contentDocument: doc, remove() {}}; },
            setPlayer(video) { playerVideo = video; }, applyPlayerState,
            handleDetailPage, setManagedTab(tab) { fallbackPlayerTab = tab; }
        }; return;
        installGlobalErrorLogging();`);
    vm.runInNewContext(instrumented, context);
    if (saved) values.set(STATE, { ...context.api.defaultState(), ...saved });
    return { api: context.api, context, values, requests, navigations, timers, opened,
        advance(ms) { now += ms; }, now: () => now };
}

const active = { status: 'running', phase: 'watching-video', currentClassId: 'class-1',
    currentLessonTitle: '测试课程', currentLessonKey: 'class-1::测试课程', currentLessonProgress: 83.13 };

test('background player with a matching live heartbeat gets a bounded loading grace, without duplicate tabs', () => {
    const h=boot({...active,phase:'opening-video',fallbackOpenAttempted:true,lastActionAt:1_800_000_000_000});
    readyDetail(h);
    h.advance(52000);
    h.values.set(HEARTBEAT,{lessonKey:active.currentLessonKey,sessionId:'loading-player',at:h.now()});
    h.api.handleDetailPage(h.api.getState());
    assert.equal(h.api.getState().status,'running');assert.equal(h.opened.length,0);
    h.advance(249000);
    h.values.set(HEARTBEAT,{lessonKey:active.currentLessonKey,sessionId:'loading-player',at:h.now()});
    h.api.handleDetailPage(h.api.getState());
    assert.equal(h.api.getState().phase,'player-open-failed');assert.equal(h.api.getState().status,'paused');
    assert.equal(h.opened.length,0);
});

test('another course heartbeat cannot extend loading or resume a manually paused account', () => {
    const h=boot({...active,phase:'opening-video',fallbackOpenAttempted:true,lastActionAt:1_800_000_000_000});
    readyDetail(h);h.advance(52000);
    h.values.set(HEARTBEAT,{lessonKey:'other-course',at:h.now()});
    h.api.handleDetailPage(h.api.getState());
    assert.equal(h.api.getState().status,'paused');
    h.api.mainTick();assert.equal(h.api.getState().status,'paused');
});

test('real maintenance page must leave watching-video and retain the interrupted lesson', () => {
    const h = boot(active);
    h.api.mainTick();
    assert.equal(h.api.getState().phase, 'maintenance-wait');
    assert.equal(h.api.getState().currentLessonProgress, 83.13);
    assert.equal(h.api.getState().currentLessonKey, active.currentLessonKey);
    assert.ok(h.api.getState().maintenance);
});

function readyDetail(h, courses = [{ title: '测试课程', progress: 84, status: '未完成' }]) {
    const root = page('detail');
    const component = { info: { playDomain: 'https://player.example/playverif_pc.html' },
        $$Request: { course_auth: 'test-only' }, listNav: { requiredCourseList: {
            listInfo: courses.map((course, index) => ({ courseName: course.title, courseId: `db-${index}`, resourceCode: `resource-${index}` }))
        } } };
    const titles = courses.map((course) => ({ textContent: course.title, scrollIntoView() {},
        parentElement: { __vue__: component, parentElement: null } }));
    const rows = courses.map((course, index) => ({ querySelector(selector) {
        if (selector === '.item_title') return titles[index];
        if (selector === '.item_status') return { textContent: course.status };
        if (selector.startsWith('[role="progressbar"]')) return { getAttribute() { return String(course.progress); } };
        return null;
    } }));
    root.querySelectorAll = (selector) => selector === '#pane-required .item_box' ? rows
        : selector === '.item_title' ? titles : [];
    h.context.document = root;
    h.context.unsafeWindow = { document: root };
}

function reopened(h) {
    h.requests.at(-1).onload({ status: 200, responseText: 'shell' });
    assert.equal(h.navigations.length, 1);
    const next = boot(null, h.values);
    readyDetail(next);
    return next;
}

test('maintenance polling is immediate, single-flight and at most once per 30 seconds', () => {
    const h = boot(active);
    h.api.mainTick();
    assert.equal(h.requests.length, 1);
    h.advance(60_000);
    h.api.mainTick();
    assert.equal(h.requests.length, 1, 'do not overlap an in-flight request');
    h.requests[0].onload({ status: 200, responseText: 'maintenance' });
    h.api.mainTick();
    assert.equal(h.requests.length, 2);
    h.requests[1].ontimeout();
    h.advance(29_999);
    h.api.mainTick();
    assert.equal(h.requests.length, 2);
    h.advance(1);
    h.api.mainTick();
    assert.equal(h.requests.length, 3);
    assert.equal(h.navigations.length, 0);
});

test('network errors, 503, blank HTML and foreign redirects never count as reopening', () => {
    for (const response of [{status:503,responseText:'shell'}, {status:200,responseText:'empty'},
        {status:200,responseText:'shell',finalUrl:'https://other.invalid/'}]) {
        const h = boot(active);
        h.api.mainTick();
        h.requests[0].onload(response);
        assert.equal(h.navigations.length, 0);
        assert.equal(h.api.getState().phase, 'maintenance-wait');
    }
    const h = boot(active);
    h.api.mainTick();
    h.requests[0].onerror();
    h.advance(30_000);
    h.api.mainTick();
    assert.equal(h.requests.length, 2, 'network failure remains retryable');
});

test('reopening reloads original route and resumes same course from server progress only once', () => {
    const h = boot(active);
    h.api.mainTick();
    const next = reopened(h);
    assert.match(h.navigations[0], /mergeClass\?classId=class-1/);
    next.api.mainTick();
    assert.equal(next.api.getState().maintenance, null);
    assert.equal(next.api.getState().phase, 'opening-video');
    assert.equal(next.api.getState().currentLessonProgress, 84);
    assert.equal(next.api.getState().currentLessonKey, active.currentLessonKey);
    assert.equal(next.opened.length, 1);
    next.api.mainTick();
    assert.equal(next.opened.length, 1);
});

test('current interrupted lesson is preferred even if an earlier course is still incomplete', () => {
    const h = boot(active);
    h.api.mainTick();
    const next = reopened(h);
    readyDetail(next, [{title:'较早课程',progress:10,status:'未完成'},
        {title:'测试课程',progress:84,status:'未完成'}]);
    next.api.mainTick();
    assert.equal(next.api.getState().currentLessonKey, active.currentLessonKey);
    assert.match(next.opened[0], /resource-1/);
});

test('server-confirmed completion during maintenance advances to the next course', () => {
    const h = boot(active);
    h.api.mainTick();
    const next = reopened(h);
    readyDetail(next, [{title:'测试课程',progress:99,status:'已完成'},
        {title:'下一课程',progress:0,status:'未完成'}]);
    next.api.mainTick();
    assert.equal(next.api.getState().currentLessonTitle, '下一课程');
    assert.equal(next.opened.length, 1);
});

test('pause and stop invalidate pending success responses and prevent background navigation', () => {
    for (const action of ['pause','stop']) {
        const h = boot(active);
        h.api.mainTick();
        h.api.handlePanelAction(action);
        h.requests[0].onload({status:200,responseText:'shell'});
        h.advance(60_000);
        h.api.mainTick();
        assert.equal(h.navigations.length, 0);
        assert.equal(h.requests.length, 1);
        assert.equal(h.opened.length, 0);
        assert.equal(h.api.getState().status, action === 'pause' ? 'paused' : 'stopped');
    }
});

test('manual continue rearms maintenance without clearing course or close request', () => {
    const h = boot(active);
    h.api.mainTick();
    h.requests[0].onerror();
    h.api.handlePanelAction('pause');
    h.api.handlePanelAction('continue');
    h.api.mainTick();
    assert.equal(h.requests.length, 2);
    assert.equal(h.api.getState().currentLessonKey, active.currentLessonKey);
    assert.ok(h.api.getState().stopRequestAt);
});

test('refresh/restart during maintenance preserves the persisted retry deadline', () => {
    const h = boot(active);
    h.api.mainTick();
    const next = boot(null, h.values);
    next.api.mainTick();
    assert.equal(next.requests.length, 0);
    next.advance(30_000);
    next.api.mainTick();
    assert.equal(next.requests.length, 1);
    assert.equal(next.api.getState().currentLessonProgress, 83.13);
});

test('idle, stopped, complete and manually paused users are never auto-started', () => {
    for (const status of ['idle','stopped','complete','paused']) {
        const h = boot({...active,status});
        h.api.mainTick();
        assert.equal(h.api.getState().status, status);
        assert.equal(h.requests.length, 0);
        assert.equal(h.opened.length, 0);
    }
});

test('late player events cannot overwrite maintenance and player auto-resume is disabled', () => {
    const h = boot(active);
    h.api.mainTick();
    for (const type of ['video-started','video-progress','video-ended','video-stalled','manual-question','player-unloading']) {
        h.api.handlePlayerEvent({id:type,type,at:h.now(),lessonKey:active.currentLessonKey,playerSessionId:'old'});
        assert.equal(h.api.getState().phase, 'maintenance-wait');
    }
    assert.equal(h.api.shouldRecoverPausedVideoImmediately({ended:false},h.api.getState()), false);
    let pauses = 0;
    h.api.setPlayer({paused:false,pause(){pauses++;}});
    h.api.applyPlayerState(h.api.getState());
    assert.equal(pauses, 1);
});

test('hidden probe maintenance cannot recover from stale visible course DOM', () => {
    const h = boot(active);
    readyDetail(h);
    h.api.setProbe(page());
    h.api.readServerStatusProbeDocument();
    assert.equal(h.api.getState().phase, 'maintenance-wait');
    h.api.mainTick();
    assert.equal(h.api.getState().phase, 'maintenance-wait');
    assert.equal(h.opened.length, 0);
    assert.equal(h.requests.length, 1);
    h.requests[0].onload({status:200,responseText:'shell'});
    h.api.mainTick();
    assert.equal(h.opened.length, 0, 'wait for the actual navigation before trusting visible DOM');
});

test('login expiration pauses recovery; a normal empty Vue shell is not a ready course page', () => {
    const h = boot(active);
    h.api.mainTick();
    const next = reopened(h);
    next.context.document = page('shell');
    next.api.mainTick();
    assert.ok(next.api.getState().maintenance);
    assert.equal(next.opened.length, 0);
    next.context.document = page('login');
    next.api.mainTick();
    assert.equal(next.api.getState().status, 'paused');
    assert.equal(next.api.getState().phase, 'maintenance-login');
    readyDetail(next);
    next.api.handlePanelAction('continue');
    next.api.mainTick();
    assert.equal(next.opened.length, 1);
});

test('a recently live old player must unload and go silent before opening another one', () => {
    const h = boot(active);
    h.values.set(HEARTBEAT,{lessonKey:active.currentLessonKey,sessionId:'old',at:h.now()});
    h.api.mainTick();
    const next = reopened(h);
    next.api.mainTick();
    assert.equal(next.opened.length, 0);
    next.api.handlePlayerEvent({id:'unload',type:'player-unloading',at:next.now(),playerSessionId:'old'});
    next.api.mainTick();
    assert.equal(next.opened.length, 0);
    next.advance(10_001);
    next.api.mainTick();
    assert.equal(next.opened.length, 1);
    next.api.handlePlayerEvent({id:'tail',type:'video-started',at:next.now(),playerSessionId:'old',lessonKey:active.currentLessonKey});
    assert.equal(next.api.getState().phase, 'opening-video', 'old player tail cannot impersonate the resumed player');
});

test('unconfirmed old player closure pauses rather than opening duplicate players', () => {
    const h = boot(active);
    h.values.set(HEARTBEAT,{lessonKey:active.currentLessonKey,sessionId:'old',at:h.now()});
    h.api.mainTick();
    const next = reopened(h);
    next.advance(120_001);
    next.api.mainTick();
    assert.equal(next.api.getState().phase, 'maintenance-player-close');
    assert.equal(next.api.getState().status, 'paused');
    assert.equal(next.opened.length, 0);
});

test('managed tabs must confirm closure even when no player heartbeat was ever received', () => {
    const h = boot(active);
    const tab = { close() {} };
    h.api.setManagedTab(tab);
    h.api.mainTick();
    const next = reopened(h);
    next.api.mainTick();
    assert.equal(next.opened.length, 0);
    tab.onclose();
    next.api.mainTick();
    assert.equal(next.opened.length, 1);
});
