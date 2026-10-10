// ==UserScript==
// @name         广东省干部培训网络学院专题学习助手
// @namespace    https://gbpx.gd.gov.cn/
// @version      1.5.36
// @description  用户手动启动后，依次处理“专题学习-在学”课程；支持系统维护检测与开放后恢复、暂停、停止、跳过和正常时长学习。
// @author       User & Codex
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/Linkegee/gdgbpx-workshop-helper/main/gdgbpx-workshop-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/Linkegee/gdgbpx-workshop-helper/main/gdgbpx-workshop-helper.user.js
// @match        https://gbpx.gd.gov.cn/gdceportal/dist/*
// @match        https://wcs1.shawcoder.xyz/gdcecw/*
// @match        https://cs1.gdgbpx.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        window.close
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      raw.githubusercontent.com
// @connect      github.com
// @connect      api.github.com
// @connect      gbpx.gd.gov.cn
// @grant        GM_getTab
// @grant        GM_saveTab
// @match        https://gbpx.gd.gov.cn/gdceportal/index.aspx*
// @run-at       document-start
// ==/UserScript==


(async function(native) {
    'use strict';
    'use strict';

// Explicit scope only. This adapter isolates userscript storage, not website
// cookies, network requests or browser tabs. The bootstrap supplies the scope.
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



'use strict';
const TAB_SLOT = 'gdgbpxScopeV2';
const STATE_NAME = 'gdgbpx_workshop_helper_state_v1';
const validScope = value => value?.version === 2 && /^[a-f0-9-]{36}$/.test(value.id);
const scopeKey = (scope, name) => `gdgbpx_account_v1:${scope.id}:${name}`;

function retireScope(api, scope, now, message) {
    if (!validScope(scope)) return;
    const state = api.GM_getValue(scopeKey(scope, STATE_NAME), null);
    api.GM_setValue(scopeKey(scope, STATE_NAME), {
        ...(state || {}), status: 'stopped', phase: 'account-context-changed',
        stopRequestAt: now, maintenance: null, message
    });
}

async function createAccountRuntime(api, env) {
    const trace = (event, detail = {}) => { try { env.onDiagnostic?.(event, detail); } catch (_) {} };
    trace('runtime-entry', {main:env.isMain,top:env.isTop,player:env.isPlayer});
    // Verification pages may redirect before the asynchronous GM_getTab callback.
    // Save only the opaque ticket and entry path, never the course auth query.
    const entry = new URL(env.href());
    const directLaunch = new URLSearchParams(entry.hash.slice(1)).get('gbpx_launch');
    let relay = null;
    if (env.isPlayer && /^[a-f0-9-]{36}$/.test(directLaunch || '')) {
        relay = {launch:directLaunch,origin:entry.origin,path:entry.pathname,expiresAt:env.now()+120000};
        env.saveLaunch?.(relay);
    } else if(env.isPlayer && !directLaunch) {
        const saved=env.readLaunch?.();
        if(saved?.origin===entry.origin && saved.expiresAt>=env.now()) relay=saved;
    }
    const getTab = () => new Promise((resolve, reject) => {
        const timer = env.setTimeout(() => reject(new Error('读取标签页身份超时')), 5000);
        api.GM_getTab(value => { env.clearTimeout(timer); resolve(value || {}); });
    });
    trace('tab-lookup-start');
    let tab = await getTab();
    trace('tab-lookup-ready', {scopePresent:validScope(tab[TAB_SLOT]), directLaunchPresent:Boolean(directLaunch), relayPresent:Boolean(relay)});
    const url = new URL(env.href());
    const launch = directLaunch || relay?.launch;
    if (env.isPlayer && launch && !validScope(tab[TAB_SLOT])) {
        if (!/^[a-f0-9-]{36}$/.test(launch)) throw new Error('播放器启动标识无效');
        const ticket = api.GM_getValue('gdgbpxLaunchV2:' + launch, null);
        if (!ticket || !validScope(ticket.scope) || ticket.expiresAt < env.now()
            || ticket.origin !== url.origin || ticket.path !== (relay?.path || url.pathname)) {
            trace('launch-ticket-rejected', {ticketPresent:Boolean(ticket),expired:Boolean(ticket && ticket.expiresAt<env.now())});
            throw new Error('播放器启动标识已失效，请从所属账号主页面重新打开');
        }
        trace('launch-ticket-bound', {accountScope:ticket.scope.id});
        tab[TAB_SLOT] = ticket.scope;
        api.GM_saveTab(tab);
    } else if (env.isPlayer && launch && validScope(tab[TAB_SLOT])) {
        const ticket = api.GM_getValue('gdgbpxLaunchV2:' + launch, null);
        if (ticket && ticket.scope?.id !== tab[TAB_SLOT].id) throw new Error('播放器归属冲突');
    }
    let lastUid = '';
    if (env.isMain && env.isTop) {
        const marker = env.sessionMarker();
        const uid = env.routeUid();
        const identity = uid ? await env.digest(marker + ':' + uid) : '';
        const previous = tab[TAB_SLOT];
        const changed = validScope(previous) && (previous.marker !== marker
            || (identity && previous.identity && previous.identity !== identity)
            || previous.retired);
        if (changed) retireScope(api, previous, env.now(), '登录会话已变化，旧任务已停止');
        if (!validScope(previous) || changed) tab[TAB_SLOT] = {version:2,id:env.uuid(),marker,identity};
        else if (identity) tab[TAB_SLOT].identity = identity;
        if (uid) tab[TAB_SLOT].ownerFingerprint = await env.digest('gdgbpx-owner-v1:' + uid);
        trace('main-identity-bound', {uidPresent:Boolean(uid),identityKnown:Boolean(tab[TAB_SLOT].ownerFingerprint),scopeChanged:changed,accountScope:tab[TAB_SLOT].id});
        lastUid = uid;
        api.GM_saveTab(tab);
    }
    // An iframe may arrive while the top-level verification page is binding the tab.
    for(let attempt=0; !validScope(tab[TAB_SLOT]) && attempt<20; attempt++) {
        await new Promise(resolve=>env.setTimeout(resolve,100));
        tab = await getTab();
    }
    if (!validScope(tab[TAB_SLOT])) {
        trace('player-scope-missing', {directLaunchPresent:Boolean(directLaunch),relayPresent:Boolean(relay)});
        throw new Error('无法确认播放器所属账号；请从对应主页面启动');
    }
    const scope = {...tab[TAB_SLOT]};
    let blockedReason = '';
    let blocked = false, pending = false, authPending = false, checkedAuth = '', authClaimKey = '';
    function invalidate(message = '登录会话已变化，已停止旧任务；刷新页面后重新开始') {
        if (blocked) return;
        blocked = true;
        blockedReason = message;
        retireScope(api, scope, env.now(), message);
        tab[TAB_SLOT] = {...scope, retired:true};
        api.GM_saveTab(tab);
        trace('account-invalidated', {reason:message,identityKnown:Boolean(scope.ownerFingerprint)});
        env.onBlocked?.(message);
    }
    function guard() {
        if (blocked) return false;
        if (!env.isMain || !env.isTop) return true;
        try {
            if (authClaimKey) {
                const claim = api.GM_getValue(authClaimKey, null);
                if (claim?.conflict || (claim && claim.owner !== scope.ownerFingerprint)) {
                    invalidate('检测到不同账号共用课程授权，存在会话冲突；已停止，请使用独立浏览器配置');
                    return false;
                }
            }
            if (env.sessionMarker() !== scope.marker) { invalidate(); return false; }
            if (env.isLoginPage?.()) { invalidate('登录已失效，请重新登录并刷新页面'); return false; }
            const uid = env.routeUid();
            if (uid && uid !== lastUid && !pending) {
                pending = true;
                Promise.all([env.digest(scope.marker + ':' + uid),env.digest('gdgbpx-owner-v1:' + uid)]).then(([identity,ownerFingerprint]) => {
                    if (blocked) return;
                    if (scope.identity && scope.identity !== identity) { invalidate(); return; }
                    scope.identity = identity;
                    scope.ownerFingerprint = ownerFingerprint;
                    tab[TAB_SLOT] = {...scope};
                    api.GM_saveTab(tab);
                    lastUid = uid;
                    pending = false;
                    trace('route-identity-confirmed', {identityKnown:true});
                    env.onReady?.();
                }).catch(() => invalidate('无法核验登录会话，已停止任务'));
            }
            return !pending;
        } catch (_) { invalidate('无法读取会话隔离信息，已停止任务'); return false; }
    }
    // A route fingerprint is only a conflict detector, not proof that the website
    // sent requests with that account's cookies. Never treat this as a container.
    function checkCourseAuth(auth) {
        if (!guard()) return false;
        if (!auth) {
            invalidate('无法读取课程授权，已停止；请从学院首页重新进入专题学习');
            return false;
        }
        if (!scope.ownerFingerprint) {
            invalidate('尚未确认账号身份；请从学院首页重新进入专题学习后开始');
            return false;
        }
        if (checkedAuth === auth && authClaimKey) return guard();
        if (authPending) return false;
        authPending = true;
        trace('course-ownership-check-start');
        env.digest('gdgbpx-course-auth-v1:' + auth).then(fingerprint => {
            if (!guard()) return;
            const key = 'gdgbpxCourseOwnerV1:' + fingerprint;
            const previous = api.GM_getValue(key, null);
            const live = previous && previous.expiresAt > env.now();
            api.GM_setValue(key, {
                owner: live ? previous.owner : scope.ownerFingerprint,
                conflict: Boolean(live && (previous.conflict || previous.owner !== scope.ownerFingerprint)),
                expiresAt: env.now() + 3600000
            });
            authClaimKey = key;
            checkedAuth = auth;
            trace('course-ownership-check-result', {allowed:guard()});
        }).catch(() => invalidate('无法核验课程授权归属，已停止任务'))
            .finally(() => { authPending = false; env.onReady?.(); });
        return false;
    }
    function playerUrl(target) {
        if (!guard()) throw new Error('账号会话尚未核验');
        const player = new URL(target);
        if (player.protocol !== 'https:' || !['wcs1.shawcoder.xyz','cs1.gdgbpx.com'].includes(player.hostname)) {
            throw new Error('播放器域名未获支持');
        }
        trace('launch-ticket-created', {targetOrigin:player.origin,targetPath:player.pathname});
        const ticket = env.uuid();
        api.GM_setValue('gdgbpxLaunchV2:' + ticket, {
            scope, origin:player.origin, path:player.pathname, expiresAt:env.now()+120000
        });
        const hash = new URLSearchParams(player.hash.slice(1));
        hash.set('gbpx_launch',ticket); player.hash = hash.toString();
        env.setTimeout(()=>api.GM_deleteValue('gdgbpxLaunchV2:'+ticket),120000);
        return player.href;
    }
    return Object.freeze({id:scope.id,label:scope.id.slice(0,6),guard,invalidate,hasIdentity:()=>Boolean(scope.ownerFingerprint),
        diagnostics:()=>({accountScope:scope.id,identityKnown:Boolean(scope.ownerFingerprint),
            blocked,blockedReason,identityCheckPending:pending,courseCheckPending:authPending,
            courseChecked:Boolean(checkedAuth),directLaunchPresent:Boolean(directLaunch),relayPresent:Boolean(relay)}),checkCourseAuth,playerUrl,bridgeEnabled:false});
}

function migratePreferences(api, storage) {
    // Keep the original snapshot intact. Run state cannot be assigned to an account.
    if (storage.GM_getValue('gdgbpxMigrationV2',false)) return;
    const old = api.GM_getValue(STATE_NAME,null);
    const settings = {};
    for (const name of ['muted','autoResume','closeOnStall']) {
        if (typeof old?.settings?.[name] === 'boolean') settings[name] = old.settings[name];
    }
    if ([2,3,5].includes(old?.settings?.stallMinutes)) settings.stallMinutes = old.settings.stallMinutes;
    if (!storage.GM_getValue(STATE_NAME,null)) storage.GM_setValue(STATE_NAME, {
        status:'idle',phase:'idle',settings,
        message:'会话隔离已就绪；点击开始后读取网站进度'
    });
    for (const name of ['gdgbpx_workshop_helper_panel_position_v1','gdgbpx_workshop_helper_panel_collapsed_v1']) {
        const value=api.GM_getValue(name,null);
        if (value!==null && storage.GM_getValue(name,null)===null) storage.GM_setValue(name,value);
    }
    storage.GM_setValue('gdgbpxMigrationV2',true);
}


'use strict';
function createSessionRequest(native,page,runtime,location,timers) {
    return details => {
        const url=new URL(details.url,location.href);
        if(url.origin!=='https://gbpx.gd.gov.cn') {
            if(url.hostname==='127.0.0.1') { details.onerror?.(); return; }
            return native.GM_xmlhttpRequest(details);
        }
        if(location.hostname!=='gbpx.gd.gov.cn' || !runtime.guard()) { details.onerror?.(); return; }
        const controller=new page.AbortController();
        const timer=timers.setTimeout(()=>controller.abort(),details.timeout||15000);
        Promise.resolve().then(()=>page.fetch(url.href,{method:'GET',credentials:'include',cache:'no-store',signal:controller.signal}))
            .then(async response=>({status:response.status,finalUrl:response.url,responseText:await response.text()}))
            .then(response=>{timers.clearTimeout(timer);if(runtime.guard())details.onload?.(response);},error=>{
                timers.clearTimeout(timer);
                if(!runtime.guard())return;
                if(error.name==='AbortError')details.ontimeout?.();else details.onerror?.();
            });
        return {abort:()=>controller.abort()};
    };
}


    const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    const bootstrapDocumentTag = crypto.randomUUID();
    const bootstrapTrace = [];
    let diagnosticSink = null;
    function recordBootstrap(event, detail = {}) {
        const route = new URL(location.href);
        const record = {time:new Date().toISOString(), event, detail,
            documentTag:bootstrapDocumentTag, origin:route.origin,path:route.pathname,
            topLevel:window.top===window};
        bootstrapTrace.push(record);
        if (bootstrapTrace.length > 80) bootstrapTrace.shift();
        try { diagnosticSink?.(record); } catch (_) {}
    }
    function bindBootstrapDiagnostics(sink) {
        diagnosticSink = sink;
        for (const record of bootstrapTrace) { try { sink(record); } catch (_) {} }
    }
    const isMain = location.hostname === 'gbpx.gd.gov.cn';
    const ready = () => document.readyState === 'loading'
        ? new Promise(resolve => document.addEventListener('DOMContentLoaded',resolve,{once:true})) : Promise.resolve();
    try {
        // MultiLogin must have installed its page storage proxy before we bind a main tab.
        if (isMain) await ready();
        const accountRuntime = await createAccountRuntime(native, {
            onDiagnostic:recordBootstrap,
            href:()=>location.href,isMain,isTop:window.top===window,
            isPlayer:['wcs1.shawcoder.xyz','cs1.gdgbpx.com'].includes(location.hostname),
            now:()=>Date.now(),uuid:()=>crypto.randomUUID(),setTimeout,clearTimeout,
            saveLaunch(value) {
                try {
                    page.sessionStorage.setItem('gdgbpxLaunchRelayV2',JSON.stringify(value));
                    recordBootstrap('launch-relay-saved');
                } catch (_) { recordBootstrap('launch-relay-save-failed'); }
            },
            readLaunch() {
                try {
                    const saved=JSON.parse(page.sessionStorage.getItem('gdgbpxLaunchRelayV2')||'null');
                    recordBootstrap('launch-relay-read',{present:Boolean(saved)});
                    return saved;
                } catch (_) { recordBootstrap('launch-relay-read-failed');return null; }
            },
            sessionMarker() {
                const key='gdgbpxSessionMarkerV2';
                let marker=page.localStorage.getItem(key);
                if (!/^[a-f0-9-]{36}$/.test(marker||'')) {
                    marker=crypto.randomUUID();page.localStorage.setItem(key,marker);
                }
                if(page.localStorage.getItem(key)!==marker) throw new Error('会话存储不可用');
                return marker;
            },
            routeUid() { return new URLSearchParams((location.hash.split('?')[1]||'')).get('uid')||''; },
            async digest(value) {
                const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
                return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
            },
            // The logged-in homepage retains a hidden login form.
            isLoginPage:()=>Array.from(document.querySelectorAll('input[type="password"]'))
                .some(input=>input.getClientRects().length>0),
            onReady:()=>window.dispatchEvent(new Event('gbpx-account-ready')),
            onBlocked:()=>window.dispatchEvent(new Event('gbpx-account-ready'))
        });
        const storage = createAccountStorage(native,accountRuntime.id);
        if(isMain && window.top===window) migratePreferences(native,storage);
        const {GM_getValue,GM_setValue,GM_deleteValue,GM_addValueChangeListener,GM_removeValueChangeListener}=storage;
        const GM_xmlhttpRequest = createSessionRequest(native,page,accountRuntime,location,{setTimeout,clearTimeout});
        if(isMain && window.top===window) {
            setInterval(()=>accountRuntime.guard(),1000);
            document.addEventListener('click',event=>{
                const node=event.target?.closest?.('a,button,[role="menuitem"],li');
                if(node && /^(退出|退出登录|注销)$/.test(node.textContent.trim())) accountRuntime.invalidate('已退出登录；刷新后重新开始');
            },true);
        }
        await ready();
        // BEGIN HELPER CORE
(function () {
    'use strict';

    const VERSION = '1.5.36';
    const PROBE_FALLBACK_KEY = 'gdgbpx_probe_use_main_page_v1';
    const MAINTENANCE_CHECK_MS = 30000;
    const MAINTENANCE_REQUEST_TIMEOUT_MS = 15000;
    const MAINTENANCE_PLAYER_GRACE_MS = 120000;
    const STATE_KEY = 'gdgbpx_workshop_helper_state_v1';
    const EVENT_KEY = 'gdgbpx_workshop_helper_event_v1';
    const PANEL_POSITION_KEY = 'gdgbpx_workshop_helper_panel_position_v1';
    const PANEL_COLLAPSED_KEY = 'gdgbpx_workshop_helper_panel_collapsed_v1';
    const FAILURE_KEY = 'gdgbpx_last_failure_v2';
    const diagnosticDocumentTag = typeof bootstrapDocumentTag === 'string' ? bootstrapDocumentTag : 'unavailable';
    const LOG_KEY = 'gdgbpx_workshop_helper_logs_v1';
    const UPDATE_CHECK_KEY = 'gdgbpx_workshop_helper_update_check_v1';
    const UPDATE_AVAILABLE_KEY = 'gdgbpx_workshop_helper_update_available_v1';
    const PLAYER_MEDIA_HEARTBEAT_KEY = 'gdgbpx_workshop_helper_media_heartbeat_v2';
    const PLAYER_HEARTBEAT_KEY = 'gdgbpx_workshop_helper_player_heartbeat_v1';
    const PLAYER_IDENTITY_SESSION_KEY = 'gdgbpxPlayerIdentityV1:' + accountRuntime.id;
    const UPDATE_URL = 'https://raw.githubusercontent.com/Linkegee/gdgbpx-workshop-helper/main/gdgbpx-workshop-helper.user.js';
    const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
    let updateCheckPending = false;
    let updateCheckMessage = '';
    let lastUpdateAttemptAt = 0;
    const LIST_SECTION_KEY = 'gdgbpx_workshop_helper_list_section_v1';
    const LIST_SECTION_TTL_MS = 30 * 60 * 1000;
    const MAX_LOG_ENTRIES = 600;
    const IMPORTANT_LOG_RESERVE = 180;
    const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
    const HIGH_FREQUENCY_LOG_INTERVAL_MS = 5000;
    const HIGH_FREQUENCY_LOG_EVENTS = new Set([
        'video-paused', 'video-playing', 'video-native-stalled',
        'video-pause-immediate-recovery', 'video-pause-recovery-succeeded',
        'video-started', 'player-start-attempt', 'player-event-received', 'publish-event'
    ]);
    const DEBUG_BRIDGE_URL = 'http://127.0.0.1:17891/ingest';
    const MAIN_HOST = 'gbpx.gd.gov.cn';
    const PLAYER_HOSTS = new Set(['wcs1.shawcoder.xyz', 'cs1.gdgbpx.com']);
    const TICK_MS = 1200;
    // Do not reload the visible Vue detail page while a player is active. The
    // hidden same-origin probe below is used for server-status polling instead.
    const SERVER_STATUS_PROBE_INTERVAL_MS = 6500;
    const SERVER_STATUS_PROBE_TIMEOUT_MS = 20000;
    const COMPLETED_CLOSE_RETRY_MS = 6000;
    const COMPLETED_CLOSE_GRACE_MS = 60000;
    const MAX_COMPLETED_CLOSE_RETRIES = 5;
    const PLAYER_REOPEN_COOLDOWN_MS = 3000;
    const PLAYER_OPEN_START_TIMEOUT_MS = 45000;
    const PLAYER_HEARTBEAT_INTERVAL_MS = 1500;
    const PLAYER_CLOSE_HEARTBEAT_SILENCE_MS = 10000;
    const PLAYER_CLOSE_MIN_CONFIRM_MS = 4000;
    const ACTIVE_LESSON_PHASES = new Set([
        'opening-video', 'watching-video', 'closing-player',
        'checking-progress', 'refresh-delay', 'awaiting-detail-refresh',
        'closing-completed-player'
    ]);

    let mainTickTimer = null;
    let detailRefreshTimer = null;
    let panel = null;
    let playerVideo = null;
    let playerTimer = null;
    let handledCloseRequestAt = 0;
    let playerClosePending = false;
    let lastPlayerProgressAt = Date.now();
    let lastPlayerTime = -1;
    let lastPlayerReportAt = 0;
    let lastHandledEventId = '';
    let playerEndedPublished = false;
    let playerSource = '';
    let playerPlaybackStarted = false;
    let lastPlayAttemptAt = 0;
    let lastPlayerWaitLogAt = 0;
    let lastDomSummary = '';
    let lastAutoScrolledLessonKey = '';
    let lastLessonSelectionSnapshot = '';
    let lastIgnoredDetailProgressSnapshot = '';
    let lastVisibleProbeSyncSnapshot = '';
    let bridgeQueue = [];
    let fallbackPlayerTab = null;
    let managedPlayerCloseRequestedAt = 0;
    let bridgeFlushTimer = null;
    let bridgeSending = false;
    let bridgeConnected = false;
    let menuSectionTrackingInstalled = false;
    let serverStatusFrame = null;
    let serverStatusFrameKey = '';
    let serverStatusFrameReady = false;
    let serverStatusMonitorTimer = null;
    let serverStatusProbeRetryTimer = null;
    let serverStatusProbeStartedAt = 0;
    let lastServerStatusSnapshot = '';
    const logThrottle = new Map();
    let playerLessonKey = '';
    let playerLessonTitle = '';
    let playerSessionId = '';
    let lastPlayerHeartbeatWriteAt = 0;
    let emptyStudyingListSeenAt = 0;
    let playerRecoverySeekApplied = false;
    let playerIdentityVerified = false;
    let playerIdentityMismatchClosing = false;
    let playerStartedEventPublished = false;
    let maintenanceRequest = null;
    let maintenanceNavigationPending = false;

    function defaultState() {
        return {
            version: VERSION,
            status: 'idle',
            phase: 'idle',
            message: '请进入“专题学习 → 在学”，然后点击开始',
            currentWorkshopTitle: '',
            currentWorkshopLessonTitles: [],
            currentClassId: '',
            currentLessonTitle: '',
            currentLessonKey: '',
            currentLessonProgress: 0,
            beforeProgress: 0,
            currentPage: 1,
            lastActionAt: 0,
            refreshAttempts: 0,
            openAttempts: 0,
            fallbackOpenAttempted: false,
            finishedWorkshopTitles: [],
            skippedLessonKeys: [],
            skipRequestAt: 0,
            stopRequestAt: 0,
            completedCloseRequestAt: 0,
            completedCloseAttempts: 0,
            completedCloseStartedAt: 0,
            closingPlayerSessionId: '',
            closingPlayerLastSeenAt: 0,
            closingPlayerUnloadAt: 0,
            serverCompletedLessonKeys: [],
            maintenance: null,
            retiredMaintenanceSessionId: '',
            maintenanceResumeLessonKey: '',
            settings: {
                playbackRate: 1,
                muted: true,
                autoResume: true,
                stallMinutes: 3,
                closeOnStall: false
            }
        };
    }

    function getState() {
        const saved = GM_getValue(STATE_KEY, null);
        const base = defaultState();
        if (!saved || typeof saved !== 'object') return base;
        const merged = {
            ...base,
            ...saved,
            settings: { ...base.settings, ...(saved.settings || {}) },
            finishedWorkshopTitles: Array.isArray(saved.finishedWorkshopTitles)
                ? saved.finishedWorkshopTitles
                : [],
            currentWorkshopLessonTitles: Array.isArray(saved.currentWorkshopLessonTitles)
                ? saved.currentWorkshopLessonTitles
                : [],
            skippedLessonKeys: Array.isArray(saved.skippedLessonKeys)
                ? saved.skippedLessonKeys
                : [],
            serverCompletedLessonKeys: Array.isArray(saved.serverCompletedLessonKeys)
                ? saved.serverCompletedLessonKeys
                : []
        };
        // v1.4.2 could treat a non-100% status label as complete. Convert that
        // one stale recovery state into a safe recheck instead of leaving playback paused.
        if (saved.version === '1.4.2' && merged.phase === 'completed-close-failed') {
            merged.status = 'running';
            merged.phase = 'checking-progress';
            merged.message = '已升级完成判定；正在重新核验服务器进度并恢复播放';
            merged.completedCloseRequestAt = 0;
            merged.completedCloseAttempts = 0;
        }
        // v1.5.9 could accept tail events from an already completed player after
        // clearing the active lesson, leaving an impossible paused state with no
        // lesson to verify. Resume directly from the detail list on upgrade.
        if (merged.phase === 'completion-unverified'
            && !merged.currentLessonKey
            && !merged.currentLessonTitle
            && merged.serverCompletedLessonKeys.length) {
            merged.status = 'running';
            merged.phase = 'detail-ready';
            merged.message = '已修复旧播放器尾随事件，继续选择下一节';
            merged.refreshAttempts = 0;
            merged.completedCloseRequestAt = 0;
            merged.completedCloseAttempts = 0;
            merged.completedCloseStartedAt = 0;
            merged.closingPlayerSessionId = '';
            merged.closingPlayerLastSeenAt = 0;
            merged.closingPlayerUnloadAt = 0;
        }
        // 实测站点按实际学习时长记进度，倍速会导致视频结束但课程仍未完成。
        merged.settings.playbackRate = 1;
        return merged;
    }

    function updateState(change) {
        const current = getState();
        const patch = typeof change === 'function' ? change(current) : change;
        if (!patch) return current;
        const next = {
            ...current,
            ...patch,
            version: VERSION,
            settings: { ...current.settings, ...(patch.settings || {}) }
        };
        next.settings.playbackRate = 1;
        GM_setValue(STATE_KEY, next);
        if (current.status !== next.status || current.phase !== next.phase || current.message !== next.message) {
            debugLog('info', 'state-change', {
                from: { status: current.status, phase: current.phase },
                to: { status: next.status, phase: next.phase },
                message: next.message,
                workshop: next.currentWorkshopTitle,
                lesson: next.currentLessonTitle
            });
        }
        if (location.hostname === MAIN_HOST && window.top === window) renderPanel(next);
        return next;
    }

    function publishEvent(type, detail = {}) {
        if (PLAYER_HOSTS.has(location.hostname)
            && ['video-started', 'video-progress', 'video-ended', 'video-stalled', 'video-stall-warning'].includes(type)
            && !playerIdentityVerified) {
            debugLog('warn', 'player-event-suppressed-unverified-identity', {
                type,
                lessonKey: playerLessonKey,
                lessonTitle: playerLessonTitle
            });
            return null;
        }
        const event = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            type,
            at: Date.now(),
            lessonKey: PLAYER_HOSTS.has(location.hostname) ? playerLessonKey : '',
            lessonTitle: PLAYER_HOSTS.has(location.hostname) ? playerLessonTitle : '',
            playerSessionId: PLAYER_HOSTS.has(location.hostname) ? playerSessionId : '',
            ...detail
        };
        debugLog('info', 'publish-event', { type, detail });
        GM_setValue(EVENT_KEY, event);
        return event;
    }

    function contextName() {
        if (location.hostname === MAIN_HOST) return 'main';
        if (window.top === window) return 'player-top';
        return 'player-frame';
    }

    function sanitizedUrl() {
        return location.href
            .replace(/([?&#](?:t|token|access_token|authorization|course_auth|gbpx_launch|callbackId|uid|session|sid|secret|sign|signature)=)[^&#]*/gi, '$1[redacted]')
            .slice(0, 500);
    }

    function isNewerVersion(candidate, current = VERSION) {
        const candidateParts = String(candidate).split('.').map((part) => Number.parseInt(part, 10));
        const currentParts = String(current).split('.').map((part) => Number.parseInt(part, 10));
        const length = Math.max(candidateParts.length, currentParts.length);
        for (let index = 0; index < length; index += 1) {
            const candidatePart = Number.isFinite(candidateParts[index]) ? candidateParts[index] : 0;
            const currentPart = Number.isFinite(currentParts[index]) ? currentParts[index] : 0;
            if (candidatePart > currentPart) return true;
            if (candidatePart < currentPart) return false;
        }
        return false;
    }

    function getAvailableUpdate() {
        const available = GM_getValue(UPDATE_AVAILABLE_KEY, null);
        if (!available || typeof available !== 'object' || !isNewerVersion(available.version)) {
            if (available) GM_deleteValue(UPDATE_AVAILABLE_KEY);
            return null;
        }
        return available;
    }

    function checkForScriptUpdate(force = false) {
        const now = Date.now();
        if (updateCheckPending) return;
        const lastCheckAt = Number(GM_getValue(UPDATE_CHECK_KEY, 0) || 0);
        if (!force && now >= lastCheckAt && now - lastCheckAt < UPDATE_CHECK_INTERVAL_MS) return;
        if (!force && lastUpdateAttemptAt && now >= lastUpdateAttemptAt && now - lastUpdateAttemptAt < 60000) return;
        lastUpdateAttemptAt = now;
        updateCheckPending = true;
        updateCheckMessage = '正在检查更新…';
        renderPanel(getState());
        debugLog('info', 'script-update-check-started', { force, currentVersion: VERSION });
        const requestText = (url) => new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: { 'Cache-Control': 'no-cache' },
                timeout: 10000,
                anonymous: true,
                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`HTTP ${response.status}`));
                        return;
                    }
                    resolve(response.responseText || '');
                },
                onerror() { reject(new Error('网络请求失败')); },
                ontimeout() { reject(new Error('检查更新超时')); }
            });
        });
        requestText(`https://api.github.com/repos/Linkegee/gdgbpx-workshop-helper/git/ref/heads/main?_gbpx_update_check=${now}`)
        .then((metadata) => {
            const commit = JSON.parse(metadata)?.object?.sha;
            if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('GitHub 返回的提交编号无效');
            return commit;
        }).catch((error) => {
            debugLog('warn', 'script-update-metadata-fallback', { error });
            return requestText(`https://github.com/Linkegee/gdgbpx-workshop-helper/commits/main.atom?_gbpx_update_check=${now}`)
                .then((feed) => {
                    // Only accept the first entry: never select an older commit from later entries.
                    const entry = feed.match(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/);
                    const commit = entry?.[1].match(/<id>\s*tag:github\.com,2008:Grit::Commit\/([a-f0-9]{40})\s*<\/id>/)?.[1];
                    if (!commit) throw new Error('GitHub commit feed has no valid latest commit');
                    return commit;
                });
        }).then((commit) => {
            const verifiedUrl = `https://raw.githubusercontent.com/Linkegee/gdgbpx-workshop-helper/${commit}/gdgbpx-workshop-helper.user.js`;
            return requestText(verifiedUrl).then(source => ({source, verifiedUrl}));
        }).then(({source, verifiedUrl}) => {
            const match = source.match(/^\/\/\s*@version\s+([^\s]+)\s*$/m);
            if (!match) throw new Error('远程脚本缺少 @version');
            const remoteVersion = match[1];
            GM_setValue(UPDATE_CHECK_KEY, Date.now());
            updateCheckPending = false;
            if (isNewerVersion(remoteVersion)) {
                const available = { version: remoteVersion, url: verifiedUrl, checkedAt: Date.now() };
                GM_setValue(UPDATE_AVAILABLE_KEY, available);
                updateCheckMessage = `发现新版 ${remoteVersion}`;
                debugLog('info', 'script-update-available', {
                    currentVersion: VERSION,
                    remoteVersion
                });
                renderPanel(getState());
                return;
            }
            GM_deleteValue(UPDATE_AVAILABLE_KEY);
            updateCheckMessage = `已检查：未发现比 v${VERSION} 更新的版本`;
            debugLog('info', 'script-update-current', {
                currentVersion: VERSION,
                remoteVersion
            });
            renderPanel(getState());
        }).catch((error) => {
            updateCheckPending = false;
            updateCheckMessage = '检查更新失败，稍后自动重试，也可点击“检查更新”';
            debugLog('warn', 'script-update-check-failed', { force, error });
            renderPanel(getState());
        });
    }

    function sanitizeLogValue(value, depth = 0) {
        if (depth > 4) return '[max-depth]';
        if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const scrubbed = value
                .replace(/([?&#](?:t|token|access_token|authorization|course_auth|gbpx_launch|callbackId|uid|session|sid|secret|sign|signature)=)[^&#\s]*/gi, '$1[redacted]')
                .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
                .replace(/(cookie\s*[:=]\s*)[^\r\n,}]+/gi, '$1[redacted]');
            return scrubbed.length > 1000 ? `${scrubbed.slice(0, 1000)}…` : scrubbed;
        }
        if (value instanceof Error) {
            return sanitizeLogValue({ name: value.name, message: value.message, stack: String(value.stack || '').slice(0, 3000) }, depth);
        }
        if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeLogValue(item, depth + 1));
        if (typeof value === 'object') {
            const result = {};
            for (const [key, item] of Object.entries(value).slice(0, 50)) {
                if (/token|cookie|authorization|course_auth|gbpx_launch|password|secret|session|^uid$/i.test(key)) {
                    result[key] = '[redacted]';
                } else {
                    result[key] = sanitizeLogValue(item, depth + 1);
                }
            }
            return result;
        }
        return String(value);
    }

    function getLogs() {
        const logs = GM_getValue(LOG_KEY, []);
        return Array.isArray(logs) ? logs : [];
    }

    function compactStoredLogs(logs, now = Date.now()) {
        const fresh = logs.filter((entry) => {
            const time = Date.parse(entry?.time || '');
            return Number.isFinite(time) && now - time <= LOG_RETENTION_MS;
        });
        if (fresh.length <= MAX_LOG_ENTRIES) return fresh;
        const important = fresh.filter((entry) => ['warn', 'error'].includes(entry.level));
        const normal = fresh.filter((entry) => !['warn', 'error'].includes(entry.level));
        const retainedImportant = important.slice(-Math.min(IMPORTANT_LOG_RESERVE, MAX_LOG_ENTRIES));
        const retainedNormal = normal.slice(-(MAX_LOG_ENTRIES - retainedImportant.length));
        return [...retainedNormal, ...retainedImportant]
            .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
    }

    function throttleLog(level, event) {
        if (level !== 'info' || !HIGH_FREQUENCY_LOG_EVENTS.has(event)) return 0;
        const key = `${contextName()}:${event}`;
        const now = Date.now();
        const previous = logThrottle.get(key);
        if (previous && now - previous.at < HIGH_FREQUENCY_LOG_INTERVAL_MS) {
            previous.suppressed += 1;
            return -1;
        }
        const suppressed = previous?.suppressed || 0;
        logThrottle.set(key, { at: now, suppressed: 0 });
        return suppressed;
    }

    function debugLog(level, event, detail = {}) {
        try {
            const suppressedRepeats = throttleLog(level, event);
            if (suppressedRepeats < 0) return;
            const entry = {
                time: new Date().toISOString(),
                level,
                context: contextName(),
                accountScope: accountRuntime.id,
                documentTag: diagnosticDocumentTag,
                event,
                url: sanitizedUrl(),
                detail: sanitizeLogValue(detail)
            };
            if (suppressedRepeats) entry.detail.suppressedRepeats = suppressedRepeats;
            const logs = compactStoredLogs([...getLogs(), entry]);
            GM_setValue(LOG_KEY, logs);
            if (level === 'error' || event === 'account-invalidated'
                || (event === 'state-change' && detail?.from?.phase !== detail?.to?.phase && ['account-context-changed','player-open-failed','completed-close-failed','login-required','identity-entry-failed'].includes(detail?.to?.phase))) {
                GM_setValue(FAILURE_KEY, {time:entry.time,event,documentTag:diagnosticDocumentTag,
                    snapshot:diagnosticSnapshot(),recentLogs:logs.slice(-30)});
            }
            const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
            console[method]('[GBP助手]', event, entry.detail);
            queueBridgeLog(entry);
            updateLogCount();
        } catch (error) {
            console.error('[GBP助手] 写入日志失败', error);
        }
    }

    function queueBridgeLog(entry) {
        if (!accountRuntime.bridgeEnabled) return;
        bridgeQueue.push(entry);
        if (bridgeQueue.length > 200) bridgeQueue.splice(0, bridgeQueue.length - 200);
        if (!bridgeFlushTimer) bridgeFlushTimer = setTimeout(flushBridgeLogs, 800);
    }

    function flushBridgeLogs() {
        bridgeFlushTimer = null;
        if (bridgeSending || !bridgeQueue.length) return;
        const entries = bridgeQueue.splice(0, 50);
        bridgeSending = true;
        GM_xmlhttpRequest({
            method: 'POST',
            url: DEBUG_BRIDGE_URL,
            headers: {
                'Content-Type': 'application/json',
                'X-GBP-Logger': 'v1'
            },
            data: JSON.stringify({ scriptVersion: VERSION, sentAt: new Date().toISOString(), entries }),
            timeout: 2000,
            onload(response) {
                bridgeSending = false;
                bridgeConnected = response.status >= 200 && response.status < 300;
                if (!bridgeConnected) bridgeQueue.unshift(...entries);
                updateBridgeStatus();
                if (bridgeQueue.length) bridgeFlushTimer = setTimeout(flushBridgeLogs, bridgeConnected ? 250 : 10000);
            },
            onerror() {
                bridgeSending = false;
                bridgeConnected = false;
                bridgeQueue.unshift(...entries);
                if (bridgeQueue.length > 200) bridgeQueue.splice(0, bridgeQueue.length - 200);
                updateBridgeStatus();
                bridgeFlushTimer = setTimeout(flushBridgeLogs, 10000);
            },
            ontimeout() {
                bridgeSending = false;
                bridgeConnected = false;
                bridgeQueue.unshift(...entries);
                if (bridgeQueue.length > 200) bridgeQueue.splice(0, bridgeQueue.length - 200);
                updateBridgeStatus();
                bridgeFlushTimer = setTimeout(flushBridgeLogs, 10000);
            }
        });
    }

    const PAGE_HEALTH_KEY = 'gdgbpx_page_health_v1';
    let lastHealthSampleAt = 0;
    function pageStructureSummary() {
        const summarize = (element) => {
            if (!element) return {present:false};
            const rect = element.getBoundingClientRect?.();
            const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : {};
            return {present:true,children:element.childElementCount || 0,
                width:rect ? Math.round(rect.width) : null,height:rect ? Math.round(rect.height) : null,
                display:style.display,visibility:style.visibility,opacity:style.opacity};
        };
        return {body:summarize(document.body),app:summarize(document.querySelector('#app')),
            bodyOutline:Array.from(document.body?.children || []).filter(node=>!['SCRIPT','STYLE','IFRAME'].includes(node.tagName) && node.id !== 'gbpx-helper-panel').slice(0,8).map(node=>({tag:node.tagName,...summarize(node)})),
            panel:summarize(document.querySelector('#gbpx-helper-panel')),
            readyState:document.readyState,visibility:document.visibilityState,
            wasDiscarded:typeof document.wasDiscarded === 'boolean' ? document.wasDiscarded : null,
            navigationType:typeof performance !== 'undefined' ? performance.getEntriesByType?.('navigation')?.[0]?.type : null};
    }
    function recordPageHealth(reason = 'interval') {
        if (window.top !== window || location.hostname !== 'gbpx.gd.gov.cn') return;
        const now = Date.now(), structure = pageStructureSummary();
        const previous = GM_getValue(PAGE_HEALTH_KEY, {samples:[],lastAnomaly:null});
        const sample = {at:now,documentTag:diagnosticDocumentTag,reason,
            gapMs:lastHealthSampleAt ? now-lastHealthSampleAt : null,structure};
        lastHealthSampleAt = now;
        const samples = [...(Array.isArray(previous.samples)?previous.samples:[]),sample].slice(-40);
        // Compare only within this document; initial loading and other tabs are not disappearance.
        const before = [...samples].reverse().find(item=>item !== sample && item.documentTag===diagnosticDocumentTag);
        const disappeared = before && ['body','app','panel'].some(key=>
            before.structure?.[key]?.present && (!structure[key].present ||
            (before.structure[key].children > 0 && structure[key].children === 0)));
        const anomaly = disappeared ? {at:now,before,after:sample} : previous.lastAnomaly;
        GM_setValue(PAGE_HEALTH_KEY,{samples,lastAnomaly:anomaly || null});
        if (disappeared) debugLog('warn','page-structure-disappeared',{before,after:sample});
    }

    let foregroundHealthGeneration = 0;
    let foregroundHealthTimers = [];
    let foregroundHealthFrame = null;
    function startForegroundHealthCheck() {
        const generation = ++foregroundHealthGeneration;
        foregroundHealthTimers.forEach(clearTimeout);
        foregroundHealthTimers = [];
        if (foregroundHealthFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(foregroundHealthFrame);
        foregroundHealthFrame = null;
        if (window.top !== window || location.hostname !== 'gbpx.gd.gov.cn' || document.visibilityState !== 'visible') return;
        const startedAt = Date.now();
        const active = () => generation === foregroundHealthGeneration && document.visibilityState === 'visible';
        recordPageHealth('foreground-start');
        for (const delay of [1000,3000,5000,10000]) {
            foregroundHealthTimers.push(setTimeout(()=>{
                if (active()) recordPageHealth(`foreground-${delay}ms`);
            },delay));
        }
        if (typeof requestAnimationFrame === 'function') {
            foregroundHealthFrame = requestAnimationFrame(()=>{
                if (!active()) return;
                foregroundHealthFrame = null;
                recordPageHealth('foreground-frame');
                // A callback indicates renderer scheduling, not proof that pixels reached the screen.
                debugLog('info','foreground-frame-callback',{delayMs:Date.now()-startedAt});
            });
        }
    }

    function diagnosticSnapshot() {
        const state = getState(), heartbeat = getPlayerHeartbeat();
        let video = null;
        try {
            const element = playerVideo || document.querySelector('video');
            if (element) video = {paused:element.paused,ended:element.ended,
                currentTime:element.currentTime,duration:Number.isFinite(element.duration)?element.duration:null,
                readyState:element.readyState,networkState:element.networkState,errorCode:element.error?.code || null};
        } catch (_) {}
        return {
            runtime:sanitizeLogValue(accountRuntime.diagnostics?.() || {accountScope:accountRuntime.id}),
            state:sanitizeLogValue(state),
            page:{context:contextName(),url:sanitizedUrl(),topLevel:window.top===window,
                visibility:document.visibilityState || 'unknown',readyState:document.readyState,
                online:typeof navigator==='undefined'?null:navigator.onLine},
            heartbeat:heartbeat?{ageMs:Math.max(0,Date.now()-Number(heartbeat.at || 0)),
                matchesCurrentLesson:heartbeat.lessonKey===state.currentLessonKey,
                mediaFresh:heartbeat.mediaFresh,mediaAgeMs:heartbeat.mediaAgeMs,
                currentTime:heartbeat.currentTime,duration:heartbeat.duration,paused:heartbeat.paused}:null,
            video
        };
    }

    function diagnosticBundle() {
        const state = getState();
        return {
            schemaVersion: 2,
            accountScope: accountRuntime.id,
            documentTag: diagnosticDocumentTag,
            generatedAt: new Date().toISOString(),
            scriptVersion: VERSION,
            userAgent: navigator.userAgent,
            url: sanitizedUrl(),
            context: contextName(),
            state: sanitizeLogValue(state),
            snapshot: diagnosticSnapshot(),
            pageHealth: GM_getValue(PAGE_HEALTH_KEY, null),
            lastFailure: GM_getValue(FAILURE_KEY,null),
            logs: getLogs().map(entry=>sanitizeLogValue(entry))
        };
    }

    function diagnosticText() {
        return JSON.stringify(diagnosticBundle(), null, 2);
    }

    function copyLogs() {
        const text = diagnosticText();
        GM_setClipboard(text, 'text');
        debugLog('info', 'logs-copied', { entries: getLogs().length });
        // Export must not replace the failure message or mutate the task state.
    }

    function downloadLogs() {
        const blob = new Blob([diagnosticText()], { type: 'application/json;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `gdgbpx-helper-log-${accountRuntime.label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        debugLog('info', 'logs-downloaded', { entries: getLogs().length });
    }

    function clearLogs() {
        GM_setValue(LOG_KEY, []);
        GM_deleteValue(FAILURE_KEY);
        GM_deleteValue(PAGE_HEALTH_KEY);
        debugLog('info', 'logs-cleared');
        updateLogCount();
    }

    function updateLogCount() {
        if (!panel || !document.contains(panel)) return;
        const element = panel.querySelector('[data-role="log-count"]');
        if (element) element.textContent = `日志：${getLogs().length}/${MAX_LOG_ENTRIES}`;
    }

    function updateBridgeStatus() {
        if (!panel || !document.contains(panel)) return;
        const element = panel.querySelector('[data-role="bridge-status"]');
        if (!element) return;
        if (!accountRuntime.bridgeEnabled) { element.textContent = '诊断日志：仅保存在当前会话'; return; }
        element.textContent = bridgeConnected
            ? '本机调试桥：已连接，日志自动保存'
            : `本机调试桥：等待连接${bridgeQueue.length ? `（待传 ${bridgeQueue.length}）` : ''}`;
        element.classList.toggle('connected', bridgeConnected);
    }

    function installGlobalErrorLogging() {
        recordPageHealth('boot');
        startForegroundHealthCheck();
        document.addEventListener('visibilitychange',startForegroundHealthCheck);
        window.addEventListener('pageshow',startForegroundHealthCheck);
        setInterval(()=>recordPageHealth(),30000);
        for (const name of ['pageshow','pagehide','online','offline']) {
            window.addEventListener(name,event=>{
                recordPageHealth(name);
                debugLog('info','page-lifecycle',{type:name,persisted:Boolean(event.persisted),structure:pageStructureSummary()});
            });
        }
        for (const name of ['freeze','resume','visibilitychange']) {
            document.addEventListener(name,()=>recordPageHealth(name));
        }
        window.addEventListener('error',event=>{
            const target=event.target;
            if (!target || target===window) return;
            let resource='';
            try { const url=new URL(target.src || target.href,location.href); resource=url.origin+url.pathname; } catch (_) {}
            debugLog('warn','resource-load-failed',{tag:target.tagName,resource,structure:pageStructureSummary()});
        },true);
        document.addEventListener('visibilitychange',()=>debugLog('info','page-visibility-changed',{
            visibility:document.visibilityState,readyState:document.readyState
        }));
        window.addEventListener('pagehide',event=>debugLog('info','page-unloading',{
            persisted:Boolean(event.persisted),phase:getState().phase
        }));
        window.addEventListener('error', (event) => {
            debugLog('error', 'window-error', {
                message: event.message,
                filename: String(event.filename || '').replace(/([?&]token=)[^&]*/gi, '$1[redacted]'),
                line: event.lineno,
                column: event.colno,
                error: event.error
            });
        });
        window.addEventListener('unhandledrejection', (event) => {
            debugLog('error', 'unhandled-rejection', { reason: event.reason });
        });
    }

    function logDomSummary(name, detail) {
        const summary = JSON.stringify(sanitizeLogValue(detail));
        const key = `${name}:${summary}`;
        if (key === lastDomSummary) return;
        lastDomSummary = key;
        debugLog('info', name, detail);
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function isVisible(element) {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }

    function uniqueAppend(list, value) {
        return value && !list.includes(value) ? [...list, value] : list;
    }

    function hasActiveLessonContext(state = getState()) {
        return state.status === 'running'
            && ACTIVE_LESSON_PHASES.has(state.phase)
            && Boolean(state.currentClassId)
            && Boolean(state.currentLessonKey)
            && Boolean(state.currentLessonTitle);
    }

    function restoreActiveDetailRoute(state) {
        if (!hasActiveLessonContext(state) || !isAnyWorkshopListRoute()) return false;
        const detailHash = `#/workshop/workshopindex/mergeClass?classId=${encodeURIComponent(state.currentClassId)}&type=1`;
        debugLog('warn', 'list-route-preserves-active-player-context', {
            phase: state.phase,
            workshop: state.currentWorkshopTitle,
            lesson: state.currentLessonTitle,
            classId: state.currentClassId,
            fromHash: sanitizedHash(),
            toHash: detailHash
        });
        if (location.hash !== detailHash) location.hash = detailHash;
        return true;
    }

    function isListRoute() {
        if (!location.hash.includes('/workshop/workshopindex/classList')) return false;
        const query = location.hash.includes('?') ? location.hash.split('?')[1] : '';
        const classType = new URLSearchParams(query).get('classType');
        if (classType) return ['3', '在学', 'study', 'studying'].includes(classType);

        const activeMenu = document.querySelector([
            '.el-menu-item.is-active',
            '.el-menu-item.active',
            '[role="menuitem"][aria-current="page"]',
            '[role="menuitem"][aria-selected="true"]'
        ].join(','));
        const activeText = normalizeText(activeMenu?.textContent);
        if (activeText) return activeText === '在学';

        const remembered = GM_getValue(LIST_SECTION_KEY, null);
        if (remembered?.section && Date.now() - Number(remembered.at || 0) <= LIST_SECTION_TTL_MS) {
            if (remembered.section === '在学') {
                logDomSummary('studying-list-route-remembered', {
                    section: remembered.section,
                    ageMs: Date.now() - Number(remembered.at || 0),
                    hash: sanitizedHash()
                });
                return true;
            }
        }

        // The maintenance update removed classType and the active class. Once
        // the user has started the assistant on this classList page, the
        // presence of the “进入” cards is the safest available fallback.
        const state = getState();
        const hasWorkshopCards = Boolean(document.querySelector(
            '.content-div .list_box .item_enter_button, .content-div .list_box button#enter_button'
        ));
        if (hasWorkshopCards) {
            logDomSummary('studying-list-route-inferred', {
                reason: 'classType-and-active-class-missing-after-maintenance',
                hash: sanitizedHash(),
                hasWorkshopCards,
                assistantStatus: state.status
            });
            return true;
        }
        return false;
    }

    function sanitizedHash() {
        return String(location.hash || '').replace(/([?&#](?:uid|token|session|sid)=)[^&#]*/gi, '$1[redacted]');
    }

    function installMenuSectionTracking() {
        if (menuSectionTrackingInstalled) return;
        menuSectionTrackingInstalled = true;
        document.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const item = target?.closest('.el-menu-item,[role="menuitem"]');
            if (!item) return;
            const section = normalizeText(item.textContent);
            if (!['进行中', '在学', '已学', '已截止', '检索'].includes(section)) return;
            GM_setValue(LIST_SECTION_KEY, { section, at: Date.now() });
            debugLog('info', 'workshop-menu-section-clicked', { section, hash: sanitizedHash() });
            scheduleMainTick();
        }, true);
    }

    function isAnyWorkshopListRoute() {
        return location.hash.includes('/workshop/workshopindex/classList');
    }

    function currentClassType() {
        const query = location.hash.includes('?') ? location.hash.split('?')[1] : '';
        return new URLSearchParams(query).get('classType') || '';
    }

    function isDetailRoute() {
        return location.hash.includes('/workshop/workshopindex/mergeClass');
    }

    function currentClassId() {
        const query = location.hash.includes('?') ? location.hash.split('?')[1] : '';
        return new URLSearchParams(query).get('classId') || '';
    }

    function getActivePageNumber() {
        const active = document.querySelector('.el-pagination .el-pager .number.active');
        const value = Number.parseInt(normalizeText(active?.textContent), 10);
        return Number.isFinite(value) ? value : 1;
    }

    function initMainPage() {
        if (window.top !== window) return;
        debugLog('info', 'main-init', { hash: location.hash });
        installPanel();
        installMenuSectionTracking();
        GM_registerMenuCommand('显示学习助手面板', () => {
            installPanel(true);
        });
        GM_registerMenuCommand('清除学习助手状态', () => {
            debugLog('warn', 'state-reset-from-menu');
            GM_deleteValue(STATE_KEY);
            location.reload();
        });
        GM_registerMenuCommand('复制诊断日志', copyLogs);
        GM_registerMenuCommand('下载诊断日志', downloadLogs);
        GM_registerMenuCommand('清空诊断日志', clearLogs);
        GM_registerMenuCommand('检查脚本更新', () => checkForScriptUpdate(true));

        GM_addValueChangeListener(EVENT_KEY, (_name, _oldValue, value) => {
            handlePlayerEvent(value);
        });

        window.addEventListener('hashchange', scheduleMainTick);
        window.addEventListener('gbpx-account-ready', scheduleMainTick);
        window.addEventListener('focus', () => {
            checkForScriptUpdate(false);
            const state = getState();
            if (state.status === 'running' && ['opening-video', 'watching-video'].includes(state.phase)) {
                updateState({ message: '主页面已获得焦点；播放器状态仍以对应会话心跳为准' });
            }
            scheduleMainTick();
        });

        const observer = new MutationObserver(scheduleMainTick);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        scheduleMainTick();
        setTimeout(() => {
            checkForScriptUpdate(false);
            setInterval(() => checkForScriptUpdate(false), 60000);
        }, 3000);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) checkForScriptUpdate(false);
        });
        debugLog('info', 'server-progress-monitor-mode', {
            mode: 'hidden-same-origin-iframe',
            intervalMs: SERVER_STATUS_PROBE_INTERVAL_MS,
            completionSignal: 'status=已完成'
        });
    }

    function installPanel(forceShow = false) {
        if (panel && document.contains(panel)) {
            if (forceShow) setPanelCollapsed(false);
            renderPanel(getState());
            return;
        }

        GM_addStyle(`
            #gbpx-helper-panel {
                position: fixed; left: 0; bottom: 12px; z-index: 2147483646;
                width: 330px; box-sizing: border-box; padding: 12px;
                color: #222; background: rgba(255,255,255,.97);
                border: 1px solid #d52b2b; border-radius: 8px;
                box-shadow: 0 5px 24px rgba(0,0,0,.22); font: 14px/1.45 sans-serif;
            }
            #gbpx-helper-panel * { box-sizing: border-box; }
            #gbpx-helper-panel .gbpx-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; cursor:move; touch-action:none; user-select:none; }
            #gbpx-helper-panel .gbpx-title { color:#a40000; font-weight:700; }
            #gbpx-helper-panel .gbpx-close { border:0; background:transparent; cursor:pointer; font-size:18px; }
            #gbpx-helper-panel .gbpx-launcher { display:none; }
            #gbpx-helper-panel.gbpx-collapsed { width:46px; height:46px; padding:0; border-radius:50%; overflow:hidden; }
            #gbpx-helper-panel.gbpx-collapsed > :not(.gbpx-launcher) { display:none; }
            #gbpx-helper-panel.gbpx-collapsed .gbpx-launcher { display:flex; align-items:center; justify-content:center; width:100%; height:100%; margin:0; padding:0; border:0; background:#b30000; color:white; font:bold 20px sans-serif; cursor:pointer; }
            #gbpx-helper-panel .gbpx-launcher:focus-visible { outline:3px solid #f3b94b; outline-offset:-4px; }
            #gbpx-helper-panel .gbpx-status { padding:8px; margin:6px 0; background:#f7f7f7; border-radius:5px; word-break:break-all; }
            #gbpx-helper-panel .gbpx-update-notice { display:block; width:100%; margin:6px 0; padding:7px 8px; border:1px solid #d48b00; border-radius:5px; color:#7a4100; background:#fff5d6; cursor:pointer; font-weight:700; }
            #gbpx-helper-panel .gbpx-update-notice[hidden] { display:none; }
            #gbpx-helper-panel .gbpx-meta { color:#666; font-size:12px; margin:3px 0; word-break:break-all; }
            #gbpx-helper-panel .gbpx-buttons { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin:10px 0; }
            #gbpx-helper-panel button.gbpx-action { border:0; border-radius:4px; padding:7px 4px; color:#fff; cursor:pointer; background:#b30000; }
            #gbpx-helper-panel button.gbpx-action.secondary { background:#666; }
            #gbpx-helper-panel button.gbpx-action.warning { background:#e48300; }
            #gbpx-helper-panel button.gbpx-action:disabled { opacity:.4; cursor:not-allowed; }
            #gbpx-helper-panel .gbpx-settings { display:grid; grid-template-columns:auto 1fr; gap:7px 9px; align-items:center; border-top:1px solid #eee; padding-top:9px; }
            #gbpx-helper-panel .gbpx-log-tools { display:grid; grid-template-columns:1fr repeat(3,auto); gap:5px; align-items:center; margin-top:9px; padding-top:8px; border-top:1px solid #eee; }
            #gbpx-helper-panel .gbpx-log-tools button { border:1px solid #aaa; border-radius:4px; padding:4px 6px; color:#333; background:#fff; cursor:pointer; }
            #gbpx-helper-panel .gbpx-log-tools button:hover { background:#f3f3f3; }
            #gbpx-helper-panel .gbpx-log-count { color:#666; font-size:12px; }
            #gbpx-helper-panel .gbpx-bridge-status { margin-top:5px; color:#9a6700; font-size:11px; }
            #gbpx-helper-panel .gbpx-bridge-status.connected { color:#177245; }
            #gbpx-helper-panel select { width:100%; padding:3px; }
            #gbpx-helper-panel label { user-select:none; }
        `);

        panel = document.createElement('section');
        panel.id = 'gbpx-helper-panel';
        panel.innerHTML = `
            <button class="gbpx-launcher" type="button" title="展开学习助手" aria-label="展开学习助手" aria-expanded="false">学</button>
            <div class="gbpx-head">
                <span class="gbpx-title">专题学习助手 v${VERSION} · ${accountRuntime.label}</span>
                <button class="gbpx-close" type="button" title="收起为小图标" aria-label="收起学习助手" aria-expanded="true">−</button>
            </div>
            <div class="gbpx-status" data-role="status"></div>
            <button class="gbpx-update-notice" type="button" data-action="installupdate" hidden></button>
            <div class="gbpx-meta" data-role="update-status"></div>
            <button type="button" data-action="checkupdate">检查更新</button>
            <div class="gbpx-meta" data-role="workshop"></div>
            <div class="gbpx-meta" data-role="lesson"></div>
            <div class="gbpx-buttons">
                <button class="gbpx-action" data-action="start">开始</button>
                <button class="gbpx-action secondary" data-action="pause">暂停</button>
                <button class="gbpx-action" data-action="continue">继续</button>
                <button class="gbpx-action warning" data-action="skip">跳过当前</button>
                <button class="gbpx-action secondary" data-action="stop">停止</button>
                <button class="gbpx-action secondary" data-action="recheck">重新检查</button>
            </div>
            <div class="gbpx-settings">
                <label for="gbpx-muted">保持静音</label>
                <input id="gbpx-muted" type="checkbox" data-setting="muted">
                <label for="gbpx-resume">自动恢复暂停</label>
                <input id="gbpx-resume" type="checkbox" data-setting="autoResume">
                <span>无进度提醒</span>
                <select data-setting="stallMinutes">
                    <option value="2">2 分钟无进度</option>
                    <option value="3">3 分钟无进度</option>
                    <option value="5">5 分钟无进度</option>
                </select>
                <label for="gbpx-close-stall">卡死后自动重开</label>
                <input id="gbpx-close-stall" type="checkbox" data-setting="closeOnStall">
            </div>
            <div class="gbpx-log-tools">
                <span class="gbpx-log-count" data-role="log-count">日志：0/${MAX_LOG_ENTRIES}</span>
                <button type="button" data-action="copylog">复制</button>
                <button type="button" data-action="downloadlog">下载</button>
                <button type="button" data-action="clearlog">清空</button>
            </div>
            <div class="gbpx-bridge-status" data-role="bridge-status">本机调试桥：等待连接</div>
        `;
        document.body.appendChild(panel);
        restorePanelPosition();
        enablePanelDragging();

        panel.querySelector('.gbpx-close').addEventListener('click', () => {
            setPanelCollapsed(true, true);
        });
        panel.querySelector('.gbpx-launcher').addEventListener('click', () => setPanelCollapsed(false, true));
        panel.addEventListener('click', (event) => {
            const button = event.target.closest('[data-action]');
            if (!button) return;
            handlePanelAction(button.dataset.action);
        });
        panel.addEventListener('change', (event) => {
            const name = event.target.dataset.setting;
            if (!name) return;
            let value = event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value);
            updateState({ settings: { [name]: value }, message: `设置已更新：${name}` });
        });

        renderPanel(getState());
        setPanelCollapsed(!forceShow && GM_getValue(PANEL_COLLAPSED_KEY, false) === true);
    }

    function setPanelCollapsed(collapsed, moveFocus = false) {
        if (!panel) return;
        panel.style.display = 'block';
        const wasCollapsed = panel.classList.contains('gbpx-collapsed');
        if (collapsed && !wasCollapsed) {
            const rect = panel.getBoundingClientRect();
            GM_setValue(PANEL_POSITION_KEY, { left: rect.left, top: rect.top });
            panel.classList.add('gbpx-collapsed');
            panel.style.left = `${Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - 46))}px`;
            panel.style.top = `${Math.min(Math.max(0, rect.bottom - 46), Math.max(0, window.innerHeight - 46))}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        } else if (!collapsed && wasCollapsed) {
            panel.classList.remove('gbpx-collapsed');
            restorePanelPosition();
        }
        GM_setValue(PANEL_COLLAPSED_KEY, collapsed);
        if (moveFocus) panel.querySelector(collapsed ? '.gbpx-launcher' : '.gbpx-close').focus();
    }

    function restorePanelPosition() {
        const saved = GM_getValue(PANEL_POSITION_KEY, null);
        if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return;
        const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
        panel.style.left = `${Math.min(Math.max(0, saved.left), maxLeft)}px`;
        panel.style.top = `${Math.min(Math.max(0, saved.top), maxTop)}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }

    function enablePanelDragging() {
        const handle = panel.querySelector('.gbpx-head');
        let drag = null;

        handle.addEventListener('pointerdown', (event) => {
            if (event.target.closest('button')) return;
            const rect = panel.getBoundingClientRect();
            drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
            panel.style.left = `${rect.left}px`;
            panel.style.top = `${rect.top}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            handle.setPointerCapture(event.pointerId);
            event.preventDefault();
        });

        handle.addEventListener('pointermove', (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
            const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
            const left = Math.min(Math.max(0, event.clientX - drag.offsetX), maxLeft);
            const top = Math.min(Math.max(0, event.clientY - drag.offsetY), maxTop);
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
        });

        const finishDrag = (event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            const rect = panel.getBoundingClientRect();
            const snapLeft = rect.left < 24 ? 0 : rect.left;
            panel.style.left = `${snapLeft}px`;
            GM_setValue(PANEL_POSITION_KEY, { left: snapLeft, top: rect.top });
            drag = null;
        };
        handle.addEventListener('pointerup', finishDrag);
        handle.addEventListener('pointercancel', finishDrag);

        window.addEventListener('resize', () => {
            const rect = panel.getBoundingClientRect();
            const left = Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - panel.offsetWidth));
            const top = Math.min(Math.max(0, rect.top), Math.max(0, window.innerHeight - panel.offsetHeight));
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        });
    }

    function renderPanel(state = getState()) {
        if (!panel || !document.contains(panel)) return;
        const statusNames = {
            idle: '未开始', running: '运行中', paused: '已暂停', stopped: '已停止', complete: '全部完成'
        };
        panel.querySelector('[data-role="status"]').textContent = `${statusNames[state.status] || state.status}：${state.message}`;
        const updateNotice = panel.querySelector('[data-action="installupdate"]');
        const availableUpdate = getAvailableUpdate();
        updateNotice.hidden = !availableUpdate;
        updateNotice.textContent = availableUpdate
            ? `发现新版本 ${availableUpdate.version}，点击安装更新`
            : '';
        panel.querySelector('[data-action="checkupdate"]').disabled = updateCheckPending;
        panel.querySelector('[data-role="update-status"]').textContent = updateCheckMessage;
        const launcher = panel.querySelector('.gbpx-launcher');
        launcher.textContent = availableUpdate ? '新' : '学';
        launcher.title = availableUpdate ? `发现新版 ${availableUpdate.version}，展开后更新` : '展开学习助手';
        panel.querySelector('[data-role="workshop"]').textContent = state.currentWorkshopTitle
            ? `专题：${state.currentWorkshopTitle}`
            : `页面：${isListRoute() ? '在学列表' : isDetailRoute() ? '专题详情' : '其他页面'}`;
        panel.querySelector('[data-role="lesson"]').textContent = state.currentLessonTitle
            ? `课程：${state.currentLessonTitle}（${state.currentLessonProgress || 0}%）`
            : `阶段：${state.phase}`;

        panel.querySelector('[data-setting="muted"]').checked = Boolean(state.settings.muted);
        panel.querySelector('[data-setting="autoResume"]').checked = Boolean(state.settings.autoResume);
        panel.querySelector('[data-setting="stallMinutes"]').value = String(state.settings.stallMinutes);
        panel.querySelector('[data-setting="closeOnStall"]').checked = Boolean(state.settings.closeOnStall);

        panel.querySelector('[data-action="pause"]').disabled = state.status !== 'running';
        panel.querySelector('[data-action="continue"]').disabled = state.status !== 'paused';
        panel.querySelector('[data-action="skip"]').disabled = Boolean(state.maintenance) || !state.currentLessonTitle || !['running', 'paused'].includes(state.status);
        panel.querySelector('[data-action="stop"]').disabled = !['running', 'paused'].includes(state.status);
        updateLogCount();
        updateBridgeStatus();
    }

    function handlePanelAction(action) {
        if (action === 'checkupdate') { checkForScriptUpdate(true); return; }
        if (['start','continue','skip','recheck'].includes(action) && !accountRuntime.guard()) {
            renderPanel(getState());
            return;
        }
        const state = getState();
        debugLog('info', 'panel-action', { action, status: state.status, phase: state.phase });
        if (action === 'copylog') {
            copyLogs();
            return;
        }
        if (action === 'downloadlog') {
            downloadLogs();
            return;
        }
        if (action === 'clearlog') {
            clearLogs();
            return;
        }
        if (action === 'installupdate') {
            const availableUpdate = getAvailableUpdate();
            const updateUrl = availableUpdate?.url || UPDATE_URL;
            debugLog('info', 'script-update-install-opened', {
                currentVersion: VERSION,
                remoteVersion: availableUpdate?.version || 'unknown'
            });
            GM_openInTab(updateUrl, { active: true, insert: true, setParent: true });
            return;
        }
        if (state.maintenance && ['start', 'continue', 'recheck'].includes(action)) {
            updateState({ status: 'running', phase: 'maintenance-wait',
                message: '继续检查系统开放状态，保留原课程',
                maintenance: { ...state.maintenance, nextCheckAt: 0,
                    playerClosed: state.maintenance.playerClosed || state.phase === 'maintenance-player-close' } });
            scheduleMainTick();
            return;
        }
        if (action === 'start') {
            // Start must not retire a player that is still alive or still processing Stop.
            if (state.status === 'running') {
                debugLog('info','start-ignored-already-running',{phase:state.phase});
                return;
            }
            const heartbeat = getPlayerHeartbeat();
            const heartbeatAlive = heartbeat && Date.now()-Number(heartbeat.at || 0) < 30000;
            const managedAlive = fallbackPlayerTab && fallbackPlayerTab.closed !== true;
            const stopPending = state.currentLessonKey && state.stopRequestAt && Date.now()-state.stopRequestAt < 30000;
            if (heartbeatAlive || managedAlive || stopPending) {
                updateState({message:'仍检测到原播放器或正在等待关闭，请先关闭原视频页，再点开始；暂停后恢复请点继续'});
                debugLog('warn','start-blocked-existing-player',{heartbeatAlive:Boolean(heartbeatAlive),
                    managedAlive:Boolean(managedAlive),stopPending:Boolean(stopPending)});
                return;
            }
            if (!accountRuntime.hasIdentity()) {
                updateState({ status: 'running', phase: 'identifying-account',
                    identityEntry: { startedAt: Date.now(), clicked: false },
                    message: '正在通过学院首页确认当前账号，再进入在学专题' });
                debugLog('info','identity-entry-requested',{identityKnown:false});
                location.assign('https://gbpx.gd.gov.cn/gdceportal/index.aspx');
                return;
            }
            if (!isListRoute() && !isDetailRoute()) {
                updateState({ status: 'running', phase: 'list-ready', message: '正在进入专题学习 → 在学' });
                location.assign('https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/classList?classType=3');
                return;
            }
            const freshRun = ['idle', 'stopped', 'complete'].includes(state.status);
            const resetSkipped = freshRun || state.phase === 'all-unfinished-skipped';
            updateState({
                status: 'running',
                maintenance: freshRun ? null : state.maintenance,
                phase: isListRoute() ? 'list-ready' : 'detail-ready',
                message: '已启动，正在读取当前页面',
                lastActionAt: 0,
                refreshAttempts: 0,
                currentLessonTitle: freshRun ? '' : state.currentLessonTitle,
                currentLessonKey: freshRun ? '' : state.currentLessonKey,
                finishedWorkshopTitles: freshRun ? [] : state.finishedWorkshopTitles,
                skippedLessonKeys: resetSkipped ? [] : state.skippedLessonKeys,
                skipRequestAt: 0,
                stopRequestAt: 0,
                completedCloseRequestAt: 0,
                completedCloseAttempts: 0,
                completedCloseStartedAt: 0,
                closingPlayerSessionId: '',
                closingPlayerLastSeenAt: 0,
                closingPlayerUnloadAt: 0,
                serverCompletedLessonKeys: freshRun ? [] : state.serverCompletedLessonKeys,
                openAttempts: 0,
                fallbackOpenAttempted: false
            });
            scheduleMainTick();
            return;
        }

        if (action === 'pause') {
            updateState({ status: 'paused', message: state.maintenance
                ? '已暂停维护检查及自动恢复，点击“继续”恢复'
                : '已暂停；播放器会暂停，点击“继续”恢复' });
            return;
        }
        if (action === 'continue') {
            const retryPlayerOpen = state.phase === 'player-open-failed' && isDetailRoute();
            const continueAfterManualClose = state.phase === 'completed-close-failed' && isDetailRoute();
            const recheckUnverifiedCompletion = state.phase === 'completion-unverified' && isDetailRoute();
            updateState({
                status: 'running',
                phase: retryPlayerOpen || continueAfterManualClose
                    ? 'detail-ready'
                    : recheckUnverifiedCompletion
                        ? 'checking-progress'
                        : state.phase,
                openAttempts: 0,
                fallbackOpenAttempted: false,
                currentLessonTitle: continueAfterManualClose ? '' : state.currentLessonTitle,
                currentLessonKey: continueAfterManualClose ? '' : state.currentLessonKey,
                completedCloseRequestAt: 0,
                completedCloseAttempts: 0,
                completedCloseStartedAt: 0,
                closingPlayerSessionId: '',
                closingPlayerLastSeenAt: 0,
                closingPlayerUnloadAt: 0,
                message: '继续运行'
            });
            // Retry reuses the scoped managed tab rather than opening a second native popup.
            if (recheckUnverifiedCompletion) {
                location.reload();
                return;
            }
            scheduleMainTick();
            return;
        }
        if (action === 'stop') {
            updateState({
                status: 'stopped', phase: 'stopped', message: '已停止', stopRequestAt: Date.now(), maintenance: null
            });
            return;
        }
        if (action === 'skip') {
            if (state.maintenance) return;
            if (!state.currentLessonKey) return;
            updateState({
                status: 'running',
                phase: 'closing-player',
                skippedLessonKeys: uniqueAppend(state.skippedLessonKeys, state.currentLessonKey),
                skipRequestAt: Date.now(),
                completedCloseRequestAt: 0,
                completedCloseAttempts: 0,
                completedCloseStartedAt: 0,
                closingPlayerSessionId: '',
                closingPlayerLastSeenAt: 0,
                closingPlayerUnloadAt: 0,
                message: `本轮跳过：${state.currentLessonTitle}`,
                currentLessonTitle: '',
                currentLessonKey: '',
                refreshAttempts: 0
            });
            setTimeout(scheduleMainTick, 1500);
            return;
        }
        if (action === 'recheck') {
            updateState({
                status: state.status === 'paused' ? 'paused' : 'running',
                phase: isDetailRoute() ? 'checking-progress' : 'list-ready',
                message: '重新加载并检查服务器进度',
                refreshAttempts: 0
            });
            location.reload();
        }
    }

    function scheduleMainTick() {
        clearTimeout(mainTickTimer);
        mainTickTimer = setTimeout(mainTick, 250);
    }

    function handleIdentityEntry(state = getState()) {
        if (state.phase !== 'identifying-account') return false;
        if (state.status !== 'running') return true;
        if (!accountRuntime.guard()) return true;
        if (accountRuntime.hasIdentity()) {
            debugLog('info','identity-entry-confirmed',{elapsedMs:Date.now()-Number(state.identityEntry?.startedAt || Date.now())});
            updateState({ identityEntry: null, status: 'idle', phase: 'idle' });
            if (new URL(location.href).pathname.startsWith('/gdceportal/dist/')) {
                location.hash = '#/workshop/workshopindex/classList?classType=3';
            }
            handlePanelAction('start');
            return true;
        }
        const entry = state.identityEntry;
        if (!entry || Date.now() - entry.startedAt > 30000) {
            updateState({status:'paused', phase:'identity-entry-failed', message:'未能自动确认账号；请在当前容器的学院首页点击“专题学习”，再点击开始'});
            return true;
        }
        if (new URL(location.href).pathname !== '/gdceportal/index.aspx' || entry.clicked) return true;
        // Use the site's own authenticated entry, never synthesize or copy a UID.
        const candidates = [...document.querySelectorAll('a,button,div,li,span')].filter(node =>
            normalizeText(node.textContent) === '专题学习' && node.getClientRects().length > 0);
        const target = candidates.find(node => !candidates.some(other => other !== node && node.contains(other)));
        if (target) {
            updateState({identityEntry:{...entry,clicked:true}, message:'正在通过网站专题入口确认账号'});
            debugLog('info','identity-entry-native-click');
            target.click();
        }
        return true;
    }

    function mainTick() {
        if (!accountRuntime.guard()) { stopServerStatusMonitor('account-changed'); renderPanel(getState()); return; }
        renderPanel(getState());
        if (handleMaintenance()) {
            clearTimeout(mainTickTimer);
            if (getState().status === 'running') mainTickTimer = setTimeout(mainTick, TICK_MS);
            return;
        }
        const state = getState();
        if (handleIdentityEntry(state)) {
            clearTimeout(mainTickTimer);
            if (getState().status === 'running') mainTickTimer = setTimeout(mainTick, TICK_MS);
            return;
        }
        syncServerStatusMonitor(state);
        if (state.status !== 'running') return;

        if (isListRoute()) {
            handleListPage(state);
        } else if (isDetailRoute()) {
            handleDetailPage(state);
        } else if (isAnyWorkshopListRoute()) {
            logDomSummary('non-studying-list-ignored', { classType: currentClassType(), hash: location.hash });
            updateState({
                phase: 'waiting-studying-list',
                message: `当前列表 classType=${currentClassType() || '未知'}，不会按“在学”列表处理`
            });
        } else {
            updateState({ message: '等待用户进入“专题学习 → 在学”' });
        }
        clearTimeout(mainTickTimer);
        mainTickTimer = setTimeout(mainTick, TICK_MS);
    }

    function maintenanceNotice(root = document) {
        // Inspect the site's notice, never our own status panel/logs. A normal
        // course or announcement mentioning maintenance is not a shutdown page.
        const notice = normalizeText(root.querySelector('.notice-main')?.textContent);
        if (notice && /维护公告|系统维护|系统调试/.test(notice)
            && /系统关闭|暂停|维护|调试/.test(notice)) return notice.slice(0, 500);
        if (!/维护公告|系统维护|系统调试/.test(root.title || '')) return '';
        const text = normalizeText([...root.body?.children || []]
            .filter((node) => node.id !== 'gbpx-helper-panel' && !['SCRIPT', 'STYLE', 'IFRAME'].includes(node.tagName))
            .map((node) => node.textContent).join(' '));
        return /系统关闭|暂停服务|暂停开放|维护中|系统维护|系统调试/.test(text) ? text.slice(0, 500) : '';
    }

    function maintenanceTarget(state = getState()) {
        const target = new URL('/gdceportal/dist/', `https://${MAIN_HOST}`);
        target.hash = state.maintenance?.returnHash
            || (state.currentClassId
                ? `#/workshop/workshopindex/mergeClass?classId=${encodeURIComponent(state.currentClassId)}&type=1`
                : '#/workshop/workshopindex/classList?classType=3');
        target.searchParams.set('_gbpx_recovery', String(Date.now()));
        return target.href;
    }

    function enterMaintenance(notice, source) {
        const state = getState();
        if (state.status !== 'running' || state.maintenance) return;
        const now = Date.now();
        const heartbeat = getPlayerHeartbeat();
        const matchingPlayer = heartbeat?.lessonKey === state.currentLessonKey
            && now - Number(heartbeat.at || 0) < MAINTENANCE_PLAYER_GRACE_MS;
        clearTimeout(detailRefreshTimer);
        detailRefreshTimer = null;
        stopServerStatusMonitor('maintenance');
        updateState({
            phase: 'maintenance-wait',
            message: '检测到系统维护；已保存当前课程，每 30 秒检查开放状态，可暂停或停止',
            // Existing v1.5.19 player tabs also understand this close request.
            // It stops playback without marking the interrupted lesson complete.
            stopRequestAt: now,
            maintenance: {
                id: `${now}-${Math.random().toString(36).slice(2)}`, since: now,
                notice, nextCheckAt: 0, attempts: 0, reloadAt: 0,
                returnHash: isDetailRoute() || isListRoute() ? location.hash : '',
                playerSessionId: matchingPlayer ? heartbeat.sessionId : '',
                playerCloseRequired: Boolean(matchingPlayer || fallbackPlayerTab),
                playerUnloadAt: 0, playerClosed: Boolean(fallbackPlayerTab?.closed)
            }
        });
        if (fallbackPlayerTab) {
            const id = getState().maintenance.id;
            fallbackPlayerTab.onclose = () => {
                const latest = getState();
                if (latest.maintenance?.id === id) {
                    updateState({ maintenance: { ...latest.maintenance, playerClosed: true } });
                    scheduleMainTick();
                }
            };
            try { fallbackPlayerTab.close(); }
            catch (error) { debugLog('warn', 'maintenance-player-close-failed', { error }); }
        }
        debugLog('warn', 'maintenance-detected', { source, notice });
        scheduleMainTick();
    }

    function probeMaintenance() {
        const state = getState();
        if (state.status !== 'running' || !state.maintenance || maintenanceRequest
            || Date.now() < state.maintenance.nextCheckAt) return;
        const id = state.maintenance.id;
        maintenanceRequest = id;
        updateState({ maintenance: { ...state.maintenance,
            nextCheckAt: Date.now() + MAINTENANCE_CHECK_MS,
            attempts: state.maintenance.attempts + 1 } });
        const finish = (response, failure = '') => {
            if (maintenanceRequest === id) maintenanceRequest = null;
            const latest = getState();
            // A response arriving after Pause/Stop/new run cannot navigate.
            if (!accountRuntime.guard() || latest.status !== 'running' || latest.maintenance?.id !== id) return;
            let available = false;
            if (!failure && response.status === 200) {
                const finalUrl = new URL(response.finalUrl || maintenanceTarget(latest));
                if (finalUrl.origin === `https://${MAIN_HOST}`) {
                    const root = new DOMParser().parseFromString(response.responseText || '', 'text/html');
                    available = !maintenanceNotice(root)
                        && Boolean((root.querySelector('#app') && root.querySelector('script[src]'))
                            || root.querySelector('input[type="password"]'));
                }
            }
            debugLog('info', 'maintenance-probe-result', {
                attempt: latest.maintenance.attempts, status: response?.status || 0, failure, available
            });
            if (available) {
                updateState({ phase: 'maintenance-recovering',
                    message: '网站已返回正常入口，刷新后核验登录与课程进度',
                    maintenance: { ...latest.maintenance, reloadAt: Date.now() } });
                maintenanceNavigationPending = true;
                location.replace(maintenanceTarget());
            }
        };
        try {
            GM_xmlhttpRequest({ method: 'GET', url: maintenanceTarget(state).split('#')[0],
                timeout: MAINTENANCE_REQUEST_TIMEOUT_MS, nocache: true,
                onload: (response) => finish(response),
                onerror: () => finish(null, 'network-error'),
                ontimeout: () => finish(null, 'timeout'),
                onabort: () => finish(null, 'aborted') });
        } catch (error) {
            finish(null, String(error));
        }
    }

    function handleMaintenance() {
        let state = getState();
        const notice = maintenanceNotice();
        if (notice && !state.maintenance) {
            enterMaintenance(notice, 'visible-page');
            state = getState();
        }
        if (!state.maintenance) return Boolean(notice);
        stopServerStatusMonitor('maintenance');
        if (state.status !== 'running') return true;
        if (maintenanceNavigationPending) return true;
        if (notice) { probeMaintenance(); return true; }

        if (document.querySelector('input[type="password"]')) {
            updateState({ status: 'paused', phase: 'maintenance-login',
                message: '系统已开放，但登录已失效；请登录后点击“继续”恢复原课程' });
            return true;
        }
        if (!state.maintenance.reloadAt) { probeMaintenance(); return true; }
        // A successful HTTP response or disappearance of the notice is not
        // proof that Vue/auth/course data are ready. Require real page content.
        const detailReady = isDetailRoute() && readLessons().length > 0;
        const listReady = isListRoute() && Boolean(document.querySelector('.content-div .list_box'));
        if (!detailReady && !listReady) {
            // Give a newly navigated Vue application time to finish loading.
            if (!state.maintenance.reloadAt || Date.now() - state.maintenance.reloadAt >= MAINTENANCE_CHECK_MS) {
                probeMaintenance();
            }
            return true;
        }
        if (state.currentClassId && currentClassId() !== state.currentClassId) {
            location.hash = `#/workshop/workshopindex/mergeClass?classId=${encodeURIComponent(state.currentClassId)}&type=1`;
            return true;
        }
        const recovery = state.maintenance;
        const heartbeat = getPlayerHeartbeat();
        const playerSilent = heartbeat?.sessionId !== recovery.playerSessionId
            || Date.now() - Number(heartbeat.at || 0) >= PLAYER_CLOSE_HEARTBEAT_SILENCE_MS;
        if (recovery.playerCloseRequired && !recovery.playerClosed
            && !(recovery.playerSessionId && recovery.playerUnloadAt && playerSilent)) {
            if (Date.now() - recovery.since >= MAINTENANCE_PLAYER_GRACE_MS) {
                updateState({ status: 'paused', phase: 'maintenance-player-close',
                    message: '系统已开放，但旧播放器未确认关闭；请关闭旧播放器后点击“继续”' });
            }
            return true;
        }
        fallbackPlayerTab = null;
        managedPlayerCloseRequestedAt = 0;
        updateState({ maintenance: null, retiredMaintenanceSessionId: recovery.playerSessionId || '',
            maintenanceResumeLessonKey: state.currentLessonKey,
            phase: detailReady ? 'detail-ready' : 'list-ready',
            message: '系统维护结束，已重新读取课程，继续未完成的学习',
            stopRequestAt: 0, skipRequestAt: 0, completedCloseRequestAt: 0,
            completedCloseAttempts: 0, completedCloseStartedAt: 0,
            closingPlayerSessionId: '', closingPlayerLastSeenAt: 0, closingPlayerUnloadAt: 0,
            refreshAttempts: 0, openAttempts: 0, fallbackOpenAttempted: false, lastActionAt: 0 });
        debugLog('info', 'maintenance-recovered', { durationMs: Date.now() - recovery.since,
            attempts: recovery.attempts, lessonKey: state.currentLessonKey });
        return false;
    }

    function handleListPage(state) {
        // A stale list navigation can arrive after the managed player has
        // already started. Never let that old task erase the active lesson or
        // click another workshop; restore the matching detail route instead.
        if (restoreActiveDetailRoute(state)) return;

        const list = document.querySelector('.content-div .list_box');
        if (!list) {
            emptyStudyingListSeenAt = 0;
            logDomSummary('list-waiting', { hasContentDiv: Boolean(document.querySelector('.content-div')) });
            updateState({ phase: 'list-loading', message: '等待“在学”课程列表加载' });
            return;
        }

        const page = getActivePageNumber();
        const cards = [...list.querySelectorAll(':scope > .item_box')].map((box) => {
            const item = box.querySelector('.list_item') || box;
            return {
                box,
                title: normalizeText(item.querySelector('.title')?.textContent),
                button: item.querySelector('button.item_enter_button, button#enter_button')
            };
        }).filter((card) => card.title && card.button);

        if (!cards.length) {
            const loading = [...document.querySelectorAll('.el-loading-mask')].some(isVisible);
            if (!emptyStudyingListSeenAt) emptyStudyingListSeenAt = Date.now();
            const emptyForMs = Date.now() - emptyStudyingListSeenAt;
            logDomSummary('studying-list-empty-pending', { page, loading, emptyForMs });
            if (loading || emptyForMs < 8000) {
                updateState({
                    phase: 'list-loading',
                    message: `“在学”列表暂时为空，等待加载确认（${Math.ceil((8000 - emptyForMs) / 1000)} 秒）`
                });
                return;
            }
        } else {
            emptyStudyingListSeenAt = 0;
        }

        logDomSummary('list-read', {
            page,
            cardCount: cards.length,
            titles: cards.map((card) => card.title),
            nextEnabled: Boolean(document.querySelector('.el-pagination .btn-next:not([disabled])'))
        });

        const nextCard = cards.find((card) => !state.finishedWorkshopTitles.includes(card.title));
        if (nextCard) {
            if (state.phase === 'entering-workshop' && Date.now() - state.lastActionAt < 20000) return;
            updateState({
                phase: 'entering-workshop',
                message: `进入第 ${page} 页专题`,
                currentPage: page,
                currentWorkshopTitle: nextCard.title,
                currentWorkshopLessonTitles: [],
                currentClassId: '',
                currentLessonTitle: '',
                currentLessonKey: '',
                currentLessonProgress: 0,
                skippedLessonKeys: [],
                lastActionAt: Date.now()
            });
            debugLog('info', 'workshop-open-click', { page, title: nextCard.title });
            nextCard.button.click();
            return;
        }

        const nextButton = document.querySelector('.el-pagination .btn-next:not([disabled])');
        if (nextButton) {
            if (state.phase === 'changing-page' && Date.now() - state.lastActionAt < 5000) return;
            updateState({ phase: 'changing-page', message: `第 ${page} 页已处理，前往下一页`, lastActionAt: Date.now() });
            debugLog('info', 'pagination-next-click', { fromPage: page });
            nextButton.click();
            return;
        }

        updateState({
            status: 'complete', phase: 'complete', message: '“在学”列表中已没有待处理专题',
            currentWorkshopTitle: '', currentLessonTitle: '', currentLessonKey: ''
        });
        debugLog('info', 'studying-list-processing-complete', {
            page,
            emptyCardList: cards.length === 0,
            stableEmptyMs: cards.length === 0 ? Date.now() - emptyStudyingListSeenAt : 0
        });
    }

    function readLessons(rootDocument = document) {
        return [...rootDocument.querySelectorAll('#pane-required .item_box')].map((box, index) => {
            const titleElement = box.querySelector('.item_title');
            const progressElement = box.querySelector('[role="progressbar"][aria-valuenow]');
            const progress = Number.parseFloat(progressElement?.getAttribute('aria-valuenow') || '0');
            const status = normalizeText(box.querySelector('.item_status')?.textContent);
            const title = normalizeText(titleElement?.textContent);
            return {
                index,
                box,
                titleElement,
                title,
                progress: Number.isFinite(progress) ? progress : 0,
                status,
                // This site marks completion independently of the position bar (for
                // example, 95.68% can already be shown as 已完成). Use the explicit
                // server status only; percentage is diagnostic data, not a gate.
                complete: status.includes('已完成')
            };
        }).filter((lesson) => lesson.title && lesson.titleElement);
    }

    function syncVisibleDetailFromProbe(probeDocument, probeLessons) {
        if (!probeDocument || probeDocument === document || !isDetailRoute()) return;
        const visibleLessons = readLessons(document);
        if (!visibleLessons.length) return;

        const visibleByTitle = new Map(visibleLessons.map((lesson) => [lesson.title, lesson]));
        const changes = [];
        for (const probeLesson of probeLessons) {
            const visibleLesson = visibleByTitle.get(probeLesson.title);
            if (!visibleLesson) continue;

            const beforeProgress = visibleLesson.progress;
            const beforeStatus = visibleLesson.status;
            const sourceProgress = probeLesson.box.querySelector('[role="progressbar"][aria-valuenow]');
            const targetProgress = visibleLesson.box.querySelector('[role="progressbar"][aria-valuenow]');
            if (sourceProgress && targetProgress) {
                for (const attribute of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) {
                    const value = sourceProgress.getAttribute(attribute);
                    if (value !== null) targetProgress.setAttribute(attribute, value);
                }
                const sourceBar = sourceProgress.querySelector('.el-progress-bar__inner');
                const targetBar = targetProgress.querySelector('.el-progress-bar__inner');
                if (sourceBar && targetBar) {
                    targetBar.className = sourceBar.className;
                    targetBar.style.cssText = sourceBar.style.cssText;
                }
                const sourceText = sourceProgress.querySelector('.el-progress__text')
                    || probeLesson.box.querySelector('.el-progress__text');
                const targetText = targetProgress.querySelector('.el-progress__text')
                    || visibleLesson.box.querySelector('.el-progress__text');
                if (sourceText && targetText) {
                    targetText.textContent = sourceText.textContent;
                    targetText.style.cssText = sourceText.style.cssText;
                }
            }

            const sourceStatus = probeLesson.box.querySelector('.item_status');
            const targetStatus = visibleLesson.box.querySelector('.item_status');
            if (sourceStatus && targetStatus) {
                targetStatus.replaceChildren(...[...sourceStatus.childNodes].map((node) => node.cloneNode(true)));
                targetStatus.className = sourceStatus.className;
                targetStatus.style.cssText = sourceStatus.style.cssText;
            }

            if (beforeProgress !== probeLesson.progress || beforeStatus !== probeLesson.status) {
                changes.push({
                    lesson: probeLesson.title,
                    fromProgress: beforeProgress,
                    toProgress: probeLesson.progress,
                    fromStatus: beforeStatus,
                    toStatus: probeLesson.status
                });
            }
        }

        const sourceRequiredTab = probeDocument.querySelector('#tab-required');
        const targetRequiredTab = document.querySelector('#tab-required');
        if (sourceRequiredTab && targetRequiredTab
            && normalizeText(sourceRequiredTab.textContent) !== normalizeText(targetRequiredTab.textContent)) {
            targetRequiredTab.textContent = sourceRequiredTab.textContent;
        }

        if (changes.length) {
            const snapshot = JSON.stringify(changes.map((change) => [
                change.lesson, change.toProgress, change.toStatus
            ]));
            if (snapshot !== lastVisibleProbeSyncSnapshot) {
                lastVisibleProbeSyncSnapshot = snapshot;
                debugLog('info', 'visible-detail-synced-from-live-probe', {
                    changedCount: changes.length,
                    changes
                });
            }
        }
    }

    function serverStatusProbeIsActive(state = getState()) {
        return window.top === window
            && isDetailRoute()
            && state.status === 'running'
            && Boolean(state.currentLessonTitle)
            && ['opening-video', 'watching-video', 'checking-progress', 'refresh-delay'].includes(state.phase);
    }

    function serverStatusProbeUrl() {
        const [base, hash = ''] = String(location.href).split('#');
        const separator = base.includes('?') ? '&' : '?';
        return `${base}${separator}_gbpx_status_probe=${Date.now()}${hash ? `#${hash}` : ''}`;
    }

    function stopServerStatusMonitor(reason = 'inactive') {
        if (serverStatusMonitorTimer) {
            clearInterval(serverStatusMonitorTimer);
            serverStatusMonitorTimer = null;
        }
        if (serverStatusProbeRetryTimer) {
            clearTimeout(serverStatusProbeRetryTimer);
            serverStatusProbeRetryTimer = null;
        }
        if (serverStatusFrame) {
            serverStatusFrame.remove();
            serverStatusFrame = null;
        }
        if (serverStatusFrameKey) {
            debugLog('info', 'server-status-monitor-stopped', { reason });
        }
        serverStatusFrameKey = '';
        serverStatusFrameReady = false;
        serverStatusProbeStartedAt = 0;
        lastServerStatusSnapshot = '';
    }

    function reloadServerStatusFrame(reason = 'interval') {
        if (!serverStatusFrame) return false;
        if (serverStatusProbeRetryTimer) {
            clearTimeout(serverStatusProbeRetryTimer);
            serverStatusProbeRetryTimer = null;
        }
        serverStatusFrameReady = false;
        serverStatusProbeStartedAt = Date.now();
        serverStatusFrame.src = serverStatusProbeUrl();
        debugLog('info', 'server-status-probe-reload', {
            reason,
            lesson: getState().currentLessonTitle
        });
        return true;
    }

    function confirmServerCompletion(lesson, source = 'detail-dom') {
        const state = getState();
        if (!lesson?.complete || state.status !== 'running' || !state.currentLessonTitle) return false;
        if (lesson.title !== state.currentLessonTitle || state.phase === 'closing-completed-player') return false;
        const completedKey = lessonKey(state.currentClassId || currentClassId(), lesson.title);
        const completedLessonKeys = uniqueAppend(state.serverCompletedLessonKeys, completedKey);
        const now = Date.now();
        const heartbeat = getPlayerHeartbeat();
        const matchingHeartbeat = heartbeat?.lessonKey === completedKey ? heartbeat : null;
        updateState({
            phase: 'closing-completed-player',
            message: `服务器已确认完成：${lesson.title}；正在关闭播放器`,
            currentLessonProgress: lesson.progress,
            refreshAttempts: 0,
            lastActionAt: now,
            completedCloseRequestAt: now,
            completedCloseAttempts: 1,
            completedCloseStartedAt: now,
            closingPlayerSessionId: matchingHeartbeat?.sessionId || '',
            closingPlayerLastSeenAt: Number(matchingHeartbeat?.at || 0),
            closingPlayerUnloadAt: 0,
            serverCompletedLessonKeys: completedLessonKeys
        });
        debugLog('info', 'server-completion-confirmed-close-requested', {
            source,
            lessonKey: completedKey,
            lesson: lesson.title,
            status: lesson.status,
            progress: lesson.progress,
            playerSessionId: matchingHeartbeat?.sessionId || '',
            heartbeatAgeMs: matchingHeartbeat ? now - Number(matchingHeartbeat.at || 0) : null,
            serverCompletedLessonKeys: completedLessonKeys
        });
        stopServerStatusMonitor('completion-confirmed');
        requestManagedCompletionClose();
        return true;
    }

    function requestManagedCompletionClose() {
        const state = getState(), tab = fallbackPlayerTab;
        if (!accountRuntime.guard() || state.status !== 'running'
            || state.phase !== 'closing-completed-player' || !tab || typeof tab.close !== 'function') return;
        const closingKey = state.currentLessonKey;
        const confirmed = () => {
            const latest = getState();
            if (fallbackPlayerTab !== tab || !accountRuntime.guard()
                || latest.status !== 'running' || latest.phase !== 'closing-completed-player'
                || latest.currentLessonKey !== closingKey) return;
            fallbackPlayerTab = null;
            confirmCompletedPlayerClosed(latest, 'extension-confirmed-tab-closed', getPlayerHeartbeat());
        };
        tab.onclose = confirmed;
        if (tab.closed === true) { confirmed();return; }
        try {
            managedPlayerCloseRequestedAt = Date.now();
            tab.close();
            debugLog('info','managed-completion-close-requested',{lessonKey:closingKey});
            if (tab.closed === true) confirmed();
        } catch (error) { debugLog('warn','managed-completion-close-error',{error}); }
    }

    function confirmCompletedPlayerClosed(state, reason, heartbeat = null) {
        fallbackPlayerTab = null;
        clearTimeout(detailRefreshTimer);
        managedPlayerCloseRequestedAt = 0;
        updateState({
            phase: 'detail-ready',
            message: '已确认播放器停止响应，准备下一节',
            currentLessonTitle: '',
            currentLessonKey: '',
            currentLessonProgress: 100,
            refreshAttempts: 0,
            completedCloseRequestAt: 0,
            completedCloseAttempts: 0,
            completedCloseStartedAt: 0,
            closingPlayerSessionId: '',
            closingPlayerLastSeenAt: 0,
            closingPlayerUnloadAt: 0,
            lastActionAt: 0
        });
        debugLog('info', 'completed-player-close-confirmed', {
            lessonKey: state.currentLessonKey,
            playerSessionId: state.closingPlayerSessionId || heartbeat?.sessionId || '',
            reason,
            lastHeartbeatAt: heartbeat?.at || state.closingPlayerLastSeenAt || 0,
            heartbeatSilenceMs: heartbeat?.at ? Date.now() - Number(heartbeat.at) : null
        });
        // This function only runs after the completed player has been confirmed
        // gone. Continue in the same event turn so Chrome background timer
        // throttling cannot add another 30-60 second gap before the next lesson.
        queueMicrotask(mainTick);
    }

    function readServerStatusProbeDocument() {
        if (!accountRuntime.guard()) return;
        if (!serverStatusFrame || !serverStatusFrame.contentDocument) return;
        const state = getState();
        if (!serverStatusProbeIsActive(state)) return;
        const notice = maintenanceNotice(serverStatusFrame.contentDocument);
        if (notice) {
            enterMaintenance(notice, 'server-status-probe');
            return;
        }
        const lessons = readLessons(serverStatusFrame.contentDocument);
        if (!lessons.length) {
            if (Date.now() - serverStatusProbeStartedAt > SERVER_STATUS_PROBE_TIMEOUT_MS) {
                debugLog('warn', 'server-status-probe-empty-timeout', {
                    lesson: state.currentLessonTitle,
                    readyState: serverStatusFrame.contentDocument.readyState
                });
                serverStatusProbeStartedAt = Date.now();
                return;
            }
            if (!serverStatusProbeRetryTimer) {
                serverStatusProbeRetryTimer = setTimeout(() => {
                    serverStatusProbeRetryTimer = null;
                    readServerStatusProbeDocument();
                }, 500);
            }
            return;
        }
        const mainDocument = (typeof unsafeWindow === 'undefined' ? window : unsafeWindow).document || document;
        const mainAuth = readCourseAuth(mainDocument);
        const probeAuth = readCourseAuth(serverStatusFrame.contentDocument);
        if (!mainAuth || !probeAuth || mainAuth !== probeAuth) {
            GM_setValue(PROBE_FALLBACK_KEY, true);
            debugLog('warn', 'server-status-probe-session-unverified', {
                mainContextAvailable: Boolean(mainAuth), probeContextAvailable: Boolean(probeAuth),
                sameContext: Boolean(mainAuth && probeAuth && mainAuth === probeAuth)
            });
            stopServerStatusMonitor('session-unverified');
            updateState({ message: '后台页会话无法核验，改在视频结束后刷新本账号页面检查进度' });
            return;
        }
        syncVisibleDetailFromProbe(serverStatusFrame.contentDocument, lessons);
        const lesson = lessons.find((item) => item.title === state.currentLessonTitle);
        if (!lesson) {
            debugLog('warn', 'server-status-probe-current-lesson-missing', {
                lesson: state.currentLessonTitle,
                lessonCount: lessons.length,
                titles: lessons.map((item) => item.title)
            });
            return;
        }
        const snapshot = `${lesson.title}|${lesson.status}|${lesson.progress}`;
        if (snapshot !== lastServerStatusSnapshot) {
            lastServerStatusSnapshot = snapshot;
            debugLog('info', 'server-status-probe-result', {
                lesson: lesson.title,
                status: lesson.status,
                progress: lesson.progress,
                complete: lesson.complete
            });
        }
        if (confirmServerCompletion(lesson, 'live-server-status-probe')) return;
        if (state.currentLessonProgress !== lesson.progress) {
            updateState({ currentLessonProgress: lesson.progress });
            debugLog('info', 'panel-progress-synced-from-live-probe', {
                lesson: lesson.title,
                status: lesson.status,
                progress: lesson.progress
            });
        }
    }

    function syncServerStatusMonitor(state = getState()) {
        if (GM_getValue(PROBE_FALLBACK_KEY, false)) return;
        if (!serverStatusProbeIsActive(state)) {
            stopServerStatusMonitor('state-not-active');
            return;
        }
        const key = lessonKey(state.currentClassId, state.currentLessonTitle);
        if (serverStatusFrame && serverStatusFrameKey !== key) {
            stopServerStatusMonitor('lesson-changed');
        }
        if (!serverStatusFrame) {
            serverStatusFrameKey = key;
            serverStatusFrame = document.createElement('iframe');
            serverStatusFrame.setAttribute('aria-hidden', 'true');
            serverStatusFrame.tabIndex = -1;
            serverStatusFrame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:2px;height:2px;border:0;opacity:0;pointer-events:none;';
            serverStatusFrame.addEventListener('load', () => {
                serverStatusFrameReady = true;
                debugLog('info', 'server-status-probe-loaded', {
                    lesson: getState().currentLessonTitle,
                    readyState: serverStatusFrame?.contentDocument?.readyState || 'unknown'
                });
                readServerStatusProbeDocument();
            });
            serverStatusFrame.addEventListener('error', () => {
                serverStatusFrameReady = false;
                debugLog('warn', 'server-status-probe-load-error', { lesson: getState().currentLessonTitle });
            });
            document.body.appendChild(serverStatusFrame);
            debugLog('info', 'server-status-monitor-started', {
                lesson: state.currentLessonTitle,
                classId: state.currentClassId,
                intervalMs: SERVER_STATUS_PROBE_INTERVAL_MS
            });
            reloadServerStatusFrame('initial');
            serverStatusMonitorTimer = setInterval(() => {
                const latest = getState();
                if (!serverStatusProbeIsActive(latest)) {
                    stopServerStatusMonitor('interval-state-not-active');
                    return;
                }
                reloadServerStatusFrame(serverStatusFrameReady ? 'interval' : 'not-ready-retry');
            }, SERVER_STATUS_PROBE_INTERVAL_MS);
        }
    }

    function lessonKey(classId, title) {
        return `${classId || 'unknown'}::${title}`;
    }

    function readCourseAuth(rootDocument) {
        try {
            let node = rootDocument.querySelectorAll('.item_title')[0];
            while (node && !node.__vue__) node = node.parentElement;
            let component = node?.__vue__;
            while (component && !component.info?.playDomain) component = component.$parent;
            return String(component?.$$Request?.course_auth || '');
        } catch (_) { return ''; }
    }

    function resolveCoursePlayerUrl(title) {
        try {
            const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const pageDocument = pageWindow.document || document;
            const normalizedTitle = normalizeText(title);
            const titleElement = [...pageDocument.querySelectorAll('.item_title')]
                .find((node) => normalizeText(node.textContent) === normalizedTitle);
            let componentNode = titleElement;
            while (componentNode && !componentNode.__vue__) componentNode = componentNode.parentElement;
            let component = componentNode?.__vue__ || null;
            while (component && !component.info?.playDomain) component = component.$parent;
            const lists = [
                component?.listNav?.requiredCourseList?.listInfo,
                component?.listNav?.optionalCourseList?.listInfo,
                component?.info?.requiredCourseList,
                component?.info?.optionalCourseList
            ].filter(Array.isArray);
            const course = lists.flat().find((item) => normalizeText(item?.courseName) === normalizedTitle);
            const token = component?.$$Request?.course_auth;
            const playDomain = component?.info?.playDomain;
            // The workshop template calls jump(item.resourceCode, item.courseId).
            // Despite the query-string name, playverif_pc.html expects the first
            // argument (resourceCode) in its `courseId` parameter.  Supplying the
            // database courseId opens a page that reports “没有找到播放资源”.
            if (!course?.resourceCode || !token || !playDomain) {
                debugLog('warn', 'course-player-url-context-missing', {
                    lesson: title,
                    hasTitleElement: Boolean(titleElement),
                    hasComponent: Boolean(component),
                    hasResourceCode: Boolean(course?.resourceCode),
                    hasDatabaseCourseId: Boolean(course?.courseId),
                    hasToken: Boolean(token),
                    hasPlayDomain: Boolean(playDomain)
                });
                return null;
            }
            const url = new URL(playDomain);
            url.searchParams.set('t', token);
            url.searchParams.set('courseId', course.resourceCode);
            url.searchParams.set('courseLabel', 'wlxy');
            return {
                url: url.href,
                resourceCode: course.resourceCode,
                databaseCourseId: course.courseId || '',
                playDomain: url.origin + url.pathname
            };
        } catch (error) {
            debugLog('error', 'course-player-url-resolution-failed', { lesson: title, error });
            return null;
        }
    }

    function openPlayerFallbackTab(title, trigger = 'fallback') {
        if (!accountRuntime.guard()) return false;
        try {
            if (fallbackPlayerTab && !fallbackPlayerTab.closed && typeof fallbackPlayerTab.close === 'function') {
                debugLog('info', 'player-open-fallback-already-exists');
                return true;
            }
            const target = resolveCoursePlayerUrl(title);
            if (!target) {
                debugLog('warn', 'player-open-fallback-blocked-without-course-context', { lesson: title });
                return false;
            }
            if (!accountRuntime.checkCourseAuth(new URL(target.url).searchParams.get('t'))) return false;
            const tab = GM_openInTab(accountRuntime.playerUrl(target.url), {
                // Automatic lesson handoffs must not select the new player tab.
                active: false,
                insert: true,
                setParent: true
            });
            fallbackPlayerTab = tab || null;
            debugLog(trigger === 'primary' ? 'info' : 'warn',
                trigger === 'primary' ? 'player-open-managed-tab' : 'player-open-fallback-tab', {
                playDomain: target.playDomain,
                resourceCode: target.resourceCode,
                databaseCourseId: target.databaseCourseId,
                trigger,
                active: false,
                hasCourseContext: true,
                hasCloseHandle: Boolean(tab && typeof tab.close === 'function')
            });
            return true;
        } catch (error) {
            debugLog('error', 'player-open-fallback-failed', { error });
            return false;
        }
    }

    function openLessonPlayer(lesson) {
        if (!lesson?.title) return 'none';
        // GM_openInTab is not subject to the site's intermittent window.open
        // failure. The URL is reconstructed from the same Vue course context
        // used by jump(resourceCode, courseId), so use this as the primary path.
        if (openPlayerFallbackTab(lesson.title, 'primary')) {
            debugLog('info', 'lesson-open-managed-tab', {
                title: lesson.title,
                index: lesson.index
            });
            return 'managed-tab';
        }
        // Unbound native popups must not receive another session's commands.
        return 'none';
    }

    function handleDetailPage(state) {
        const lessons = readLessons();
        if (!lessons.length) {
            logDomSummary('detail-waiting', {
                hasRequiredPane: Boolean(document.querySelector('#pane-required')),
                itemBoxes: document.querySelectorAll('#pane-required .item_box').length
            });
            const activePlayerPhase = hasActiveLessonContext(state);
            if (activePlayerPhase) {
                debugLog('info', 'detail-loading-preserves-player-phase', {
                    phase: state.phase,
                    lesson: state.currentLessonTitle,
                    reason: 'vue-course-list-not-rendered-yet'
                });
                return;
            }
            updateState({ phase: 'detail-loading', message: '等待必修课程列表加载' });
            return;
        }

        if (!accountRuntime.checkCourseAuth(readCourseAuth(typeof unsafeWindow !== 'undefined' ? unsafeWindow.document : document))) return;
        const classId = currentClassId();
        if (state.phase === 'detail-ready' && state.lastActionAt && Date.now() - state.lastActionAt < PLAYER_REOPEN_COOLDOWN_MS) {
            return;
        }
        logDomSummary('detail-read', {
            classId,
            lessonCount: lessons.length,
            completeCount: lessons.filter((lesson) => lesson.complete).length,
            lessons: lessons.map((lesson) => ({ title: lesson.title, progress: lesson.progress, status: lesson.status }))
        });
        const lessonTitles = lessons.map((lesson) => lesson.title);
        if (state.currentClassId !== classId) {
            lastLessonSelectionSnapshot = '';
            lastIgnoredDetailProgressSnapshot = '';
            state = updateState({
                currentClassId: classId,
                currentWorkshopLessonTitles: lessonTitles,
                phase: 'detail-ready',
                message: `已读取 ${lessons.length} 个必修课程`,
                serverCompletedLessonKeys: []
            });
        } else if (JSON.stringify(state.currentWorkshopLessonTitles) !== JSON.stringify(lessonTitles)) {
            state = updateState({ currentWorkshopLessonTitles: lessonTitles });
        }

        const currentLesson = lessons.find((lesson) => lesson.title === state.currentLessonTitle);
        if (currentLesson && state.currentLessonTitle && state.currentLessonProgress !== currentLesson.progress) {
            const currentProgress = Number(state.currentLessonProgress || 0);
            const visibleProgress = Number(currentLesson.progress || 0);
            const staleVisibleProgress = serverStatusProbeIsActive(state)
                && !currentLesson.complete
                && visibleProgress < currentProgress;
            if (staleVisibleProgress) {
                const snapshot = `${state.currentLessonKey}|${currentProgress}|${visibleProgress}|${currentLesson.status}`;
                if (snapshot !== lastIgnoredDetailProgressSnapshot) {
                    lastIgnoredDetailProgressSnapshot = snapshot;
                    debugLog('info', 'panel-progress-stale-detail-ignored', {
                        lesson: currentLesson.title,
                        lessonKey: state.currentLessonKey,
                        probeProgress: currentProgress,
                        visibleDetailProgress: visibleProgress,
                        visibleDetailStatus: currentLesson.status,
                        reason: 'live-probe-progress-is-newer'
                    });
                }
            } else {
                lastIgnoredDetailProgressSnapshot = '';
                state = updateState({
                    currentLessonProgress: currentLesson.progress
                });
                debugLog('info', 'panel-progress-synced-from-detail', {
                    lesson: currentLesson.title,
                    progress: currentLesson.progress,
                    status: currentLesson.status
                });
            }
        }
        if (currentLesson && state.currentLessonTitle) {
            const currentKey = lessonKey(classId, currentLesson.title);
            if (currentKey !== lastAutoScrolledLessonKey) {
                lastAutoScrolledLessonKey = currentKey;
                currentLesson.titleElement.scrollIntoView({ block: 'center', behavior: 'auto' });
                debugLog('info', 'current-lesson-auto-scrolled', {
                    lesson: currentLesson.title,
                    progress: currentLesson.progress,
                    status: currentLesson.status
                });
            }
        }
        // The explicit server status text is the source of truth. During playback
        // the hidden same-origin probe supplies a fresh detail DOM without
        // reloading or interrupting the visible page.
        if (state.phase === 'watching-video' && currentLesson?.complete) {
            confirmServerCompletion(currentLesson, 'visible-detail-dom');
            return;
        }
        if (state.phase === 'checking-progress' || state.phase === 'refresh-delay') {
            if (!currentLesson) {
                updateState({
                    status: 'paused',
                    phase: 'completion-unverified',
                    message: '刷新后找不到当前课程，无法确认完成状态；请检查后点“重新检查”',
                    refreshAttempts: 0
                });
                debugLog('warn', 'current-lesson-missing-before-completion-confirmation', {
                    lesson: state.currentLessonTitle,
                    lessonKey: state.currentLessonKey
                });
                return;
            } else if (currentLesson.complete) {
                // A media ended event is not proof of completion. Only the
                // explicit 已完成 status may request a player close.
                confirmServerCompletion(currentLesson, 'visible-detail-dom');
                return;
            } else {
                if (state.phase === 'refresh-delay' && Date.now() - state.lastActionAt < 6500) return;
                const attempt = Math.min(9999, Number(state.refreshAttempts || 0) + 1);
                updateState({
                    phase: 'refresh-delay',
                    message: `等待服务器标记“已完成”（第 ${attempt} 次实时复查）`,
                    currentLessonProgress: currentLesson.progress,
                    refreshAttempts: attempt,
                    lastActionAt: Date.now()
                });
                clearTimeout(detailRefreshTimer);
                debugLog('info', 'server-status-probe-rescheduled', {
                    attempt,
                    delayMs: 6500,
                    progress: currentLesson.progress,
                    status: currentLesson.status
                });
                detailRefreshTimer = setTimeout(() => {
                    detailRefreshTimer = null;
                    if (!accountRuntime.guard()) return;
                    const latest = getState();
                    if (latest.status !== 'running' || !isDetailRoute()) return;
                    if (!['checking-progress', 'refresh-delay'].includes(latest.phase)) {
                        debugLog('info', 'stale-detail-refresh-timer-ignored', {
                            phase: latest.phase,
                            lessonKey: latest.currentLessonKey,
                            reason: 'player-resumed-before-completion-recheck'
                        });
                        return;
                    }
                    updateState({ phase: 'checking-progress', message: '实时复查服务器“已完成”状态', lastActionAt: Date.now() });
                    reloadServerStatusFrame('retry-after-video-close');
                    scheduleMainTick();
                }, 6500);
                return;
            }
        }

        if (['opening-video', 'watching-video', 'closing-player', 'awaiting-detail-refresh', 'closing-completed-player'].includes(state.phase)) {
            const age = Date.now() - state.lastActionAt;
            if (state.phase === 'closing-completed-player') {
                const now = Date.now();
                const heartbeat = getPlayerHeartbeat();
                const heartbeatMatches = Boolean(heartbeat)
                    && (heartbeat.lessonKey === state.currentLessonKey
                        || (state.closingPlayerSessionId && heartbeat.sessionId === state.closingPlayerSessionId));
                if (heartbeatMatches && !state.closingPlayerSessionId && heartbeat.sessionId) {
                    state = updateState({
                        closingPlayerSessionId: heartbeat.sessionId,
                        closingPlayerLastSeenAt: Number(heartbeat.at || 0)
                    });
                }
                const lastSeenAt = Math.max(
                    Number(state.closingPlayerLastSeenAt || 0),
                    heartbeatMatches ? Number(heartbeat.at || 0) : 0
                );
                const unloadAt = Number(state.closingPlayerUnloadAt || 0);
                const closeStartedAt = Number(state.completedCloseStartedAt || state.completedCloseRequestAt || 0);
                const closeAge = closeStartedAt ? now - closeStartedAt : 0;
                const closeEvidenceAt = Math.max(lastSeenAt, unloadAt);
                const silenceAge = closeEvidenceAt ? now - closeEvidenceAt : 0;
                if (unloadAt
                    && closeAge >= PLAYER_CLOSE_MIN_CONFIRM_MS
                    && silenceAge >= PLAYER_CLOSE_HEARTBEAT_SILENCE_MS) {
                    confirmCompletedPlayerClosed(state, 'matching-player-unloaded-and-heartbeat-silent', heartbeatMatches ? heartbeat : null);
                    return;
                }
            }
            if (state.phase === 'closing-completed-player' && age > COMPLETED_CLOSE_RETRY_MS && Number(state.completedCloseAttempts || 1) < MAX_COMPLETED_CLOSE_RETRIES) {
                const attempts = Number(state.completedCloseAttempts || 1) + 1;
                const requestAt = Date.now();
                updateState({
                    lastActionAt: requestAt,
                    completedCloseRequestAt: requestAt,
                    completedCloseAttempts: attempts,
                    message: `服务器已确认完成，正在重试关闭播放器 (${attempts}/${MAX_COMPLETED_CLOSE_RETRIES})`
                });
                requestManagedCompletionClose();
                debugLog('warn', 'completed-player-close-retry', {
                    lessonKey: state.currentLessonKey,
                    lesson: state.currentLessonTitle,
                    attempt: attempts,
                    waitedMs: age,
                    playerSessionId: state.closingPlayerSessionId,
                    playerUnloadAt: state.closingPlayerUnloadAt,
                    heartbeat: getPlayerHeartbeat()
                });
                return;
            }
            if (state.phase === 'closing-completed-player' && age > COMPLETED_CLOSE_GRACE_MS) {
                updateState({
                    status: 'paused',
                    phase: 'completed-close-failed',
                    message: '服务器已确认课程完成，但播放器未确认关闭；请手动关闭播放器后点“继续”',
                    completedCloseRequestAt: 0
                });
                debugLog('warn', 'completed-player-close-not-confirmed', {
                    lessonKey: lessonKey(state.currentClassId, state.currentLessonTitle),
                    lesson: state.currentLessonTitle,
                    waitedMs: age,
                    phase: state.phase,
                    completedCloseAttempts: state.completedCloseAttempts
                });
                return;
            }
            if (state.phase === 'opening-video' && age > PLAYER_OPEN_START_TIMEOUT_MS) {
                const heartbeat = getPlayerHeartbeat();
                if (heartbeat?.lessonKey === state.currentLessonKey
                    && Date.now() - Number(heartbeat.at || 0) < 15000 && age < 300000) {
                    // Background media loading can be delayed well beyond 45 seconds.
                    // Keep the same player, with a bounded five-minute loading window.
                    return;
                }
                const attempts = Number(state.openAttempts || 0) + 1;
                if (!state.fallbackOpenAttempted) {
                    if (openPlayerFallbackTab(state.currentLessonTitle, 'fallback')) {
                        updateState({
                            phase: 'opening-video',
                            openAttempts: attempts,
                            fallbackOpenAttempted: true,
                            lastActionAt: Date.now(),
                            message: '常规弹窗未启动，已使用扩展标签页兜底打开播放器'
                        });
                        debugLog('warn', 'player-open-fallback-started', {
                            lesson: state.currentLessonTitle,
                            attempts
                        });
                    } else {
                        updateState({
                            status: 'paused',
                            phase: 'player-open-failed',
                            openAttempts: attempts,
                            message: '常规弹窗和标签页兜底均未启动；请确认播放器域名允许弹窗后点击“继续”'
                        });
                        debugLog('warn', 'player-open-retries-exhausted', {
                            lesson: state.currentLessonTitle,
                            attempts,
                            fallbackOpenAttempted: Boolean(state.fallbackOpenAttempted)
                        });
                    }
                } else {
                    updateState({
                        status: 'paused',
                        phase: 'player-open-failed',
                        openAttempts: attempts,
                        message: '播放器未在等待时间内启动；请检查播放器标签页后点“继续”'
                    });
                    debugLog('warn', 'managed-player-open-timeout', {
                        lesson: state.currentLessonTitle,
                        attempts,
                        waitedMs: age,
                        fallbackOpenAttempted: true
                    });
                }
            }
            return;
        }

        const serverCompletedLessonKeys = Array.isArray(state.serverCompletedLessonKeys)
            ? state.serverCompletedLessonKeys
            : [];
        const selectionRows = lessons.map((lesson) => {
            const key = lessonKey(classId, lesson.title);
            const isServerCompleted = serverCompletedLessonKeys.includes(key);
            const isSkipped = state.skippedLessonKeys.includes(key);
            const reason = lesson.complete
                ? 'dom-complete'
                : isServerCompleted
                    ? 'server-completed-memory'
                    : isSkipped
                        ? 'skipped-memory'
                        : 'eligible';
            return {
                index: lesson.index,
                lessonKey: key,
                title: lesson.title,
                status: lesson.status,
                progress: lesson.progress,
                complete: lesson.complete,
                isServerCompleted,
                isSkipped,
                reason
            };
        });
        const selectionSnapshot = JSON.stringify({
            classId,
            phase: state.phase,
            currentLessonKey: state.currentLessonKey,
            rows: selectionRows.map((row) => [row.lessonKey, row.status, row.progress, row.reason])
        });
        if (selectionSnapshot !== lastLessonSelectionSnapshot) {
            lastLessonSelectionSnapshot = selectionSnapshot;
            debugLog('info', 'lesson-selection-evaluated', {
                classId,
                phase: state.phase,
                currentLessonKey: state.currentLessonKey,
                currentLessonTitle: state.currentLessonTitle,
                serverCompletedLessonKeys,
                skippedLessonKeys: state.skippedLessonKeys,
                rows: selectionRows
            });
        }
        const unfinished = lessons.filter((lesson) => {
            if (lesson.complete) return false;
            return !serverCompletedLessonKeys.includes(lessonKey(classId, lesson.title));
        });
        if (!unfinished.length) {
            const title = state.currentWorkshopTitle || `classId:${classId}`;
            updateState({
                phase: 'returning-list',
                message: `专题必修课已全部完成，返回“在学”`,
                finishedWorkshopTitles: uniqueAppend(state.finishedWorkshopTitles, title),
                currentLessonTitle: '', currentLessonKey: '', refreshAttempts: 0,
                lastActionAt: Date.now()
            });
            debugLog('info', 'workshop-all-lessons-complete', { classId, lessonCount: lessons.length });
            returnToStudyingList();
            return;
        }

        const eligible = unfinished.filter((lesson) => {
            const key = lessonKey(classId, lesson.title);
            return !state.skippedLessonKeys.includes(key) && !serverCompletedLessonKeys.includes(key);
        });
        const nextLesson = eligible.find((lesson) => lessonKey(classId, lesson.title) === state.maintenanceResumeLessonKey)
            || eligible[0];
        if (!nextLesson) {
            debugLog('warn', 'lesson-selection-no-candidate', {
                classId,
                lessonCount: lessons.length,
                serverCompletedLessonKeys,
                skippedLessonKeys: state.skippedLessonKeys,
                rows: selectionRows
            });
            updateState({
                status: 'paused', phase: 'all-unfinished-skipped',
                message: '当前专题剩余未完成课程均已被本轮跳过；点击“开始”可清除跳过记录重试'
            });
            return;
        }

        const key = lessonKey(classId, nextLesson.title);
        const sameLesson = state.currentLessonKey === key;
        updateState({
            phase: 'opening-video',
            maintenanceResumeLessonKey: '',
            message: `打开必修 ${nextLesson.index + 1}/${lessons.length}`,
            currentLessonTitle: nextLesson.title,
            currentLessonKey: key,
            currentLessonProgress: nextLesson.progress,
            beforeProgress: nextLesson.progress,
            fallbackOpenAttempted: sameLesson ? Boolean(state.fallbackOpenAttempted) : false,
            lastActionAt: Date.now(),
            refreshAttempts: 0,
            openAttempts: sameLesson ? Number(state.openAttempts || 0) : 0
        });
        debugLog('info', 'lesson-open-click', {
            classId,
            index: nextLesson.index,
            lessonKey: key,
            title: nextLesson.title,
            status: nextLesson.status,
            complete: nextLesson.complete,
            progress: nextLesson.progress,
            currentLessonKey: state.currentLessonKey,
            serverCompletedLessonKeys,
            skippedLessonKeys: state.skippedLessonKeys
        });
        const openMethod = openLessonPlayer(nextLesson);
        if (openMethod === 'managed-tab') {
            updateState({
                fallbackOpenAttempted: true,
                lastActionAt: Date.now(),
                message: `已打开必修 ${nextLesson.index + 1}/${lessons.length}，等待播放器开始`
            });
        } else if (openMethod === 'none') {
            updateState({
                status: 'paused',
                phase: 'player-open-failed',
                message: '无法读取当前课程的播放器地址或点击入口；请点“重新检查”后继续'
            });
            debugLog('error', 'lesson-open-no-available-path', {
                title: nextLesson.title,
                index: nextLesson.index
            });
        }
    }

    function returnToStudyingList() {
        const menuItems = [...document.querySelectorAll('.el-menu-item')];
        const studying = menuItems.find((item) => normalizeText(item.textContent) === '在学');
        if (studying) {
            studying.click();
            setTimeout(() => {
                if (!accountRuntime.guard()) return;
                if (isDetailRoute()) location.hash = '#/workshop/workshopindex/classList?classType=3';
            }, 2500);
        } else {
            location.hash = '#/workshop/workshopindex/classList?classType=3';
        }
    }

    function handlePlayerEvent(event) {
        if (!accountRuntime.guard()) return;
        if (!event || !event.id || event.id === lastHandledEventId) return;
        lastHandledEventId = event.id;
        const state = getState();
        if (state.maintenance) {
            if (event.type === 'player-unloading'
                && event.playerSessionId === state.maintenance.playerSessionId
                && event.at >= state.maintenance.since) {
                updateState({ maintenance: { ...state.maintenance, playerUnloadAt: event.at } });
            }
            return;
        }
        if (event.playerSessionId && event.playerSessionId === state.retiredMaintenanceSessionId) return;
        debugLog('info', 'player-event-received', { event, status: state.status, phase: state.phase });

        const completedEventLesson = Boolean(event.lessonKey)
            && state.serverCompletedLessonKeys.includes(event.lessonKey);
        const playerRuntimeEvent = [
            'video-started', 'video-progress', 'video-ended', 'video-closed',
            'player-unloading', 'player-closing', 'video-stalled', 'video-stall-warning',
            'manual-question', 'player-auth-expired'
        ].includes(event.type);
        if (state.phase !== 'closing-completed-player'
            && playerRuntimeEvent
            && (completedEventLesson || !state.currentLessonKey || !state.currentLessonTitle)) {
            debugLog('info', 'completed-player-tail-event-ignored', {
                type: event.type,
                eventLessonKey: event.lessonKey,
                eventPlayerSessionId: event.playerSessionId,
                currentLessonKey: state.currentLessonKey,
                currentLessonTitle: state.currentLessonTitle,
                phase: state.phase,
                reason: completedEventLesson ? 'lesson-already-server-completed' : 'no-active-lesson'
            });
            return;
        }

        if (event.lessonKey && state.currentLessonKey && event.lessonKey !== state.currentLessonKey) {
            debugLog('warn', 'stale-player-event-ignored', {
                type: event.type,
                eventLessonKey: event.lessonKey,
                currentLessonKey: state.currentLessonKey,
                currentLessonTitle: state.currentLessonTitle
            });
            return;
        }

        if (event.type === 'player-auth-expired' && state.status === 'running') {
            updateState({ status: 'paused', phase: 'login-required',
                message: '播放器授权已过期，请在本账号会话重新登录后刷新主页面' });
            stopServerStatusMonitor('player-auth-expired');
            return;
        }
        if (event.type === 'video-started' && state.status === 'running') {
            if (state.phase === 'closing-completed-player') {
                debugLog('info', 'completion-close-ignores-video-start', { lessonKey: event.lessonKey });
                return;
            }
            if (detailRefreshTimer) {
                clearTimeout(detailRefreshTimer);
                detailRefreshTimer = null;
                debugLog('info', 'detail-refresh-timer-cancelled-by-playback', {
                    type: event.type,
                    previousPhase: state.phase,
                    lessonKey: event.lessonKey
                });
            }
            updateState({
                phase: 'watching-video',
                message: `播放器已开始（${event.rate || state.settings.playbackRate}×）`,
                lastActionAt: Date.now(),
                refreshAttempts: 0,
                openAttempts: 0,
                fallbackOpenAttempted: false
            });
            managedPlayerCloseRequestedAt = 0;
            return;
        }

        if (event.type === 'video-progress' && state.status === 'running') {
            if (state.phase === 'closing-completed-player') {
                debugLog('info', 'completion-close-ignores-video-progress', {
                    lessonKey: event.lessonKey,
                    currentTime: event.currentTime,
                    duration: event.duration
                });
                return;
            }
            if (detailRefreshTimer) {
                clearTimeout(detailRefreshTimer);
                detailRefreshTimer = null;
                debugLog('info', 'detail-refresh-timer-cancelled-by-playback', {
                    type: event.type,
                    previousPhase: state.phase,
                    lessonKey: event.lessonKey,
                    currentTime: event.currentTime
                });
            }
            updateState({
                phase: 'watching-video',
                message: `播放中：${formatClock(event.currentTime)} / ${formatClock(event.duration)}，${event.rate || 1}×`,
                lastActionAt: Date.now(),
                refreshAttempts: 0
            });
            return;
        }

        if (event.type === 'manual-question') {
            updateState({ message: '播放器检测到课程提问，请在播放器窗口中手动完成' });
            return;
        }

        if (event.type === 'player-closing' && fallbackPlayerTab && typeof fallbackPlayerTab.close === 'function') {
            try {
                fallbackPlayerTab.close();
                managedPlayerCloseRequestedAt = Date.now();
                debugLog('info', 'player-open-fallback-closed');
            } catch (error) {
                debugLog('warn', 'player-open-fallback-close-failed', { error });
            }
            if (state.phase !== 'closing-completed-player') fallbackPlayerTab = null;
        }

        if (event.type === 'video-stall-warning' && state.status === 'running') {
            if (state.phase === 'closing-completed-player') return;
            updateState({
                phase: 'watching-video',
                message: `播放器已有 ${event.minutes || state.settings.stallMinutes} 分钟无进度，保持窗口并继续尝试恢复`,
                lastActionAt: Date.now()
            });
            return;
        }

        if (['video-closed', 'player-unloading'].includes(event.type)
            && state.status === 'running'
            && state.phase === 'closing-completed-player') {
            const nextState = updateState({
                message: '已收到播放器离开信号，等待对应会话心跳停止后再进入下一节',
                closingPlayerSessionId: state.closingPlayerSessionId || event.playerSessionId || '',
                closingPlayerUnloadAt: Number(event.at || Date.now())
            });
            debugLog('info', 'completed-player-unload-observed', {
                type: event.type,
                lessonKey: event.lessonKey,
                playerSessionId: event.playerSessionId,
                note: 'unload-is-not-proof-of-window-close'
            });
            const managedCloseAge = managedPlayerCloseRequestedAt
                ? Date.now() - managedPlayerCloseRequestedAt
                : Number.POSITIVE_INFINITY;
            if (managedCloseAge >= 0 && managedCloseAge <= 15000) {
                debugLog('info', 'managed-player-close-confirmed-by-unload', {
                    lessonKey: event.lessonKey,
                    playerSessionId: event.playerSessionId,
                    managedCloseAgeMs: managedCloseAge
                });
                confirmCompletedPlayerClosed(
                    nextState,
                    'managed-tab-close-request-and-matching-unload',
                    getPlayerHeartbeat()
                );
            }
            return;
        }

        if (state.phase === 'closing-completed-player' && event.type !== 'video-closed') {
            debugLog('info', 'completion-close-ignores-player-event', {
                type: event.type,
                lessonKey: event.lessonKey
            });
            return;
        }

        const bootstrapUnload = event.type === 'player-unloading'
            && state.status === 'running'
            && state.phase === 'opening-video'
            && Number(event.currentTime || 0) === 0
            && Number(event.duration || 0) === 0
            && normalizeText(event.documentTitle).includes('验证中');
        if (bootstrapUnload) {
            debugLog('info', 'player-bootstrap-unload-ignored', {
                documentTitle: event.documentTitle,
                lessonKey: event.lessonKey,
                playerSessionId: event.playerSessionId,
                reason: 'verification-page-navigating-to-real-player'
            });
            return;
        }

        if (['video-ended', 'video-closed', 'player-unloading', 'video-stalled'].includes(event.type) && state.status === 'running') {
            const reason = event.type === 'video-ended'
                ? '视频已结束'
                : event.type === 'video-stalled'
                    ? '播放器长时间无进度，等待服务器“已完成”状态'
                    : '播放器页面正在离开';
            updateState({
                phase: event.type === 'video-ended' && !GM_getValue(PROBE_FALLBACK_KEY, false) ? 'watching-video' : 'checking-progress',
                message: `${reason}，实时等待服务器标记“已完成”`,
                lastActionAt: Date.now(),
                skipRequestAt: 0
            });
            clearTimeout(detailRefreshTimer);
            if (event.type === 'video-ended' && !GM_getValue(PROBE_FALLBACK_KEY, false)) {
                reloadServerStatusFrame('video-ended');
            } else {
                scheduleMainTick();
            }
        }
    }

    function formatClock(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
        const whole = Math.floor(seconds);
        const minutes = Math.floor(whole / 60);
        const secs = String(whole % 60).padStart(2, '0');
        return `${minutes}:${secs}`;
    }

    function createPlayerSessionId() {
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function readStoredPlayerIdentity() {
        try {
            const stored = JSON.parse(sessionStorage.getItem(PLAYER_IDENTITY_SESSION_KEY) || 'null');
            if (!stored || typeof stored !== 'object' || !stored.lessonKey || !stored.sessionId) return null;
            return stored;
        } catch (_error) {
            return null;
        }
    }

    function storePlayerIdentity(identity) {
        sessionStorage.setItem(PLAYER_IDENTITY_SESSION_KEY, JSON.stringify(identity));
        playerSessionId = identity.sessionId;
        playerLessonKey = identity.lessonKey;
        playerLessonTitle = identity.lessonTitle || '';
    }

    function initializePlayerIdentity(state = getState()) {
        const stored = readStoredPlayerIdentity();
        const identity = stored || {
            sessionId: createPlayerSessionId(),
            lessonKey: state.currentLessonKey || '',
            lessonTitle: state.currentLessonTitle || '',
            createdAt: Date.now()
        };
        storePlayerIdentity(identity);
        return { identity, source: stored ? 'session-storage' : 'state' };
    }

    function detectVisiblePlayerLessonTitle(state = getState()) {
        const visibleText = normalizeText(document.body?.innerText || '');
        if (!visibleText) return '';
        const candidates = uniqueAppend(
            Array.isArray(state.currentWorkshopLessonTitles) ? state.currentWorkshopLessonTitles : [],
            state.currentLessonTitle
        ).filter(Boolean).sort((left, right) => right.length - left.length);
        return candidates.find((title) => visibleText.includes(normalizeText(title))) || '';
    }

    function syncPlayerIdentityFromVisibleTitle(state = getState()) {
        const storedIdentity = readStoredPlayerIdentity();
        if (storedIdentity && storedIdentity.lessonKey !== playerLessonKey) {
            storePlayerIdentity(storedIdentity);
        }
        const detectedTitle = detectVisiblePlayerLessonTitle(state);
        if (!detectedTitle || !state.currentClassId) return false;
        const detectedKey = lessonKey(state.currentClassId, detectedTitle);
        const expectedKey = state.currentLessonKey || '';
        const identityMatches = !expectedKey || detectedKey === expectedKey;
        playerIdentityVerified = identityMatches;
        if (detectedKey === playerLessonKey) {
            if (!identityMatches) closeMismatchedPlayer(state, detectedKey, detectedTitle);
            return identityMatches;
        }
        const previous = {
            sessionId: playerSessionId,
            lessonKey: playerLessonKey,
            lessonTitle: playerLessonTitle
        };
        const next = {
            sessionId: playerSessionId || createPlayerSessionId(),
            lessonKey: detectedKey,
            lessonTitle: detectedTitle,
            createdAt: Date.now()
        };
        storePlayerIdentity(next);
        debugLog('info', 'player-identity-updated-from-visible-title', {
            previous,
            next,
            documentTitle: document.title
        });
        if (!identityMatches) closeMismatchedPlayer(state, detectedKey, detectedTitle);
        return identityMatches;
    }

    function closeMismatchedPlayer(state, detectedKey, detectedTitle) {
        if (playerIdentityMismatchClosing || state.status !== 'running'
            || !['opening-video', 'watching-video'].includes(state.phase)) return;
        playerIdentityMismatchClosing = true;
        debugLog('error', 'player-identity-mismatch-closing', {
            expectedLessonKey: state.currentLessonKey,
            expectedLessonTitle: state.currentLessonTitle,
            detectedLessonKey: detectedKey,
            detectedLessonTitle: detectedTitle,
            phase: state.phase
        });
        publishEvent('player-identity-mismatch', {
            expectedLessonKey: state.currentLessonKey,
            expectedLessonTitle: state.currentLessonTitle,
            detectedLessonKey: detectedKey,
            detectedLessonTitle: detectedTitle
        });
        setTimeout(() => closePlayerWindow('player-identity-mismatch'), 0);
    }

    function maybePublishVerifiedVideoStarted(video) {
        if (!video || playerStartedEventPublished || !playerIdentityVerified
            || video.paused || video.ended) return false;
        playerStartedEventPublished = true;
        publishEvent('video-started', { rate: video.playbackRate, identityVerified: true });
        return true;
    }

    function writePlayerHeartbeat(force = false) {
        if (!playerLessonKey || !playerSessionId) return;
        const now = Date.now();
        if (!force && now - lastPlayerHeartbeatWriteAt < PLAYER_HEARTBEAT_INTERVAL_MS) return;
        lastPlayerHeartbeatWriteAt = now;
        const heartbeat = {
            at: now,
            sessionId: playerSessionId,
            lessonKey: playerLessonKey,
            lessonTitle: playerLessonTitle,
            documentTitle: document.title,
            url: sanitizedUrl(),
            currentTime: Number(playerVideo?.currentTime || 0),
            duration: Number(playerVideo?.duration || 0),
            paused: playerVideo ? Boolean(playerVideo.paused) : null
        };
        // The outer shell has no video; keep its liveness separate from media data.
        if (playerVideo) GM_setValue(PLAYER_MEDIA_HEARTBEAT_KEY, heartbeat);
        GM_setValue(PLAYER_HEARTBEAT_KEY, heartbeat);
    }

    function getPlayerHeartbeat() {
        const heartbeat = GM_getValue(PLAYER_HEARTBEAT_KEY, null);
        if (!heartbeat || typeof heartbeat !== 'object') return null;
        const media = GM_getValue(PLAYER_MEDIA_HEARTBEAT_KEY, null);
        const same = media && media.sessionId === heartbeat.sessionId && media.lessonKey === heartbeat.lessonKey;
        const mediaAgeMs = same ? Math.max(0, Date.now() - Number(media.at || 0)) : null;
        const fresh = same && mediaAgeMs < 15000;
        return {...heartbeat, mediaAgeMs, mediaFresh:Boolean(fresh),
            currentTime:fresh?media.currentTime:null, duration:fresh?media.duration:null,
            paused:fresh?media.paused:null};
    }

    function handlePlayerCloseRequest(state = getState()) {
        if (!state.stopRequestAt && !state.skipRequestAt && !state.completedCloseRequestAt) return false;
        const requestAt = Math.max(
            state.stopRequestAt || 0,
            state.skipRequestAt || 0,
            state.completedCloseRequestAt || 0
        );
        // Each document must process the request, including the media iframe.
        if (requestAt <= handledCloseRequestAt) {
            if (playerClosePending && playerVideo && !playerVideo.paused) playerVideo.pause();
            return playerClosePending;
        }
        handledCloseRequestAt = requestAt;
        playerClosePending = true;
        if (playerVideo && !playerVideo.paused) playerVideo.pause();
        const reason = requestAt === state.completedCloseRequestAt
            ? 'server-completion-confirmed'
            : state.stopRequestAt >= state.skipRequestAt
                ? 'stop-request'
                : 'skip-request';
        debugLog('info', 'player-close-request', {
            source: 'state-change-or-tick',
            requestAt,
            stop: state.stopRequestAt,
            skip: state.skipRequestAt,
            completed: state.completedCloseRequestAt,
            reason
        });
        closePlayerWindow(reason);
        return true;
    }

    function initPlayerPage() {
        const initialState = getState();
        const identityResult = initializePlayerIdentity(initialState);
        syncPlayerIdentityFromVisibleTitle(initialState);
        debugLog('info', 'player-init', {
            topLevel: window.top === window,
            readyState: document.readyState,
            lessonKey: playerLessonKey,
            lessonTitle: playerLessonTitle,
            playerSessionId,
            identitySource: identityResult.source,
            beforeProgress: initialState.beforeProgress,
            currentLessonProgress: initialState.currentLessonProgress
        });
        GM_addValueChangeListener(STATE_KEY, (_name, _oldValue, value) => {
            const nextState = value ? getState() : defaultState();
            if (handlePlayerCloseRequest(nextState)) return;
            applyPlayerState(nextState);
        });

        if (window.top === window) {
            window.addEventListener('beforeunload', () => {
                const state = getState();
                if (['running', 'paused'].includes(state.status)) {
                    publishEvent('player-unloading', {
                        documentTitle: document.title,
                        currentTime: Number(playerVideo?.currentTime || 0),
                        duration: Number(playerVideo?.duration || 0)
                    });
                }
            });
            const layerObserver = new MutationObserver(() => {
                const ending = [...document.querySelectorAll('.layui-layer-content')]
                    .find((node) => normalizeText(node.textContent).includes('视频即将结束'));
                if (ending && !playerEndedPublished) {
                    playerEndedPublished = true;
                    debugLog('info', 'player-ending-dialog-detected', { text: normalizeText(ending.textContent) });
                    publishEvent('video-ended');
                }
            });
            layerObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        }

        playerTimer = setInterval(playerTick, 1000);
        writePlayerHeartbeat(true);
        playerTick();
    }

    function playerTick() {
        const state = getState();
        const authNotice = document.querySelector('.layui-layer-content')?.textContent || '';
        if (state.status === 'running' && /授权码.*过期|请重新登录/.test(authNotice)) {
            publishEvent('player-auth-expired');
            return;
        }
        syncPlayerIdentityFromVisibleTitle(state);
        writePlayerHeartbeat();
        dismissKnownContinuePrompt();
        const video = document.querySelector('video');
        if (video && video !== playerVideo) attachVideo(video);

        if (handlePlayerCloseRequest(state)) return;

        if (state.maintenance) {
            applyPlayerState(state);
            return;
        }

        if (!playerVideo) return;
        applyPlayerState(state);
        recoverIncompleteEndPosition(playerVideo, state);

        const source = playerVideo.currentSrc || playerVideo.getAttribute('src') || '';
        if (source !== playerSource) {
            playerSource = source;
            playerPlaybackStarted = !playerVideo.paused && !playerVideo.ended;
            playerStartedEventPublished = false;
            lastPlayerTime = Number(playerVideo.currentTime || 0);
            lastPlayerProgressAt = Date.now();
            lastPlayAttemptAt = 0;
            debugLog('info', 'player-source-changed', {
                hasSource: Boolean(source),
                source: source.slice(0, 500),
                readyState: playerVideo.readyState,
                networkState: playerVideo.networkState,
                duration: Number(playerVideo.duration || 0)
            });
        }

        if (!playerVideo.paused && !playerVideo.ended) playerPlaybackStarted = true;
        maybePublishVerifiedVideoStarted(playerVideo);

        const current = Number(playerVideo.currentTime || 0);
        if (current > lastPlayerTime + 0.2) {
            lastPlayerTime = current;
            lastPlayerProgressAt = Date.now();
        }

        const hasQuestion = hasBlockingQuestion();
        if (hasQuestion) {
            if (Date.now() - lastPlayerReportAt > 5000) {
                lastPlayerReportAt = Date.now();
                publishEvent('manual-question');
            }
            return;
        }

        if (state.status === 'running' && state.settings.autoResume && playerVideo.paused && !playerVideo.ended) {
            attemptPlayerStart(playerVideo);
        }

        const stallMs = Math.max(2, Number(state.settings.stallMinutes) || 3) * 60 * 1000;
        const shouldWatchForStall = playerPlaybackStarted && (!playerVideo.paused || state.settings.autoResume);
        if (state.status === 'running' && shouldWatchForStall && !playerVideo.ended && Date.now() - lastPlayerProgressAt > stallMs) {
            debugLog('warn', 'player-stall-timeout', {
                currentTime: current,
                duration: Number(playerVideo.duration || 0),
                readyState: playerVideo.readyState,
                networkState: playerVideo.networkState,
                waitedMs: Date.now() - lastPlayerProgressAt,
                closeOnStall: Boolean(state.settings.closeOnStall)
            });
            lastPlayerProgressAt = Date.now();
            if (state.settings.closeOnStall) {
                publishEvent('video-stalled', { currentTime: current, duration: Number(playerVideo.duration || 0) });
                closePlayerWindow('stall-auto-reopen');
            } else {
                publishEvent('video-stall-warning', {
                    currentTime: current,
                    duration: Number(playerVideo.duration || 0),
                    minutes: Math.round(stallMs / 60000)
                });
                lastPlayAttemptAt = 0;
                attemptPlayerStart(playerVideo);
            }
        }
    }

    function attachVideo(video) {
        playerVideo = video;
        if (!playerLessonKey) playerLessonKey = getState().currentLessonKey || '';
        lastPlayerTime = Number(video.currentTime || 0);
        lastPlayerProgressAt = Date.now();
        debugLog('info', 'video-attached', {
            id: video.id,
            readyState: video.readyState,
            networkState: video.networkState,
            hasSource: Boolean(video.currentSrc || video.getAttribute('src'))
        });

        video.addEventListener('play', () => {
            playerPlaybackStarted = true;
            const state = getState();
            applyPlayerState(state);
            syncPlayerIdentityFromVisibleTitle(state);
            maybePublishVerifiedVideoStarted(video);
        });
        video.addEventListener('playing', () => {
            playerPlaybackStarted = true;
            syncPlayerIdentityFromVisibleTitle(getState());
            maybePublishVerifiedVideoStarted(video);
            debugLog('info', 'video-playing', {
                currentTime: Number(video.currentTime || 0),
                duration: Number(video.duration || 0),
                rate: Number(video.playbackRate || 1)
            });
        });
        video.addEventListener('pause', () => {
            debugLog('info', 'video-paused', {
                currentTime: Number(video.currentTime || 0),
                ended: video.ended,
                readyState: video.readyState
            });
            recoverPausedVideoImmediately(video);
        });
        video.addEventListener('waiting', () => {
            debugLog('warn', 'video-waiting', {
                currentTime: Number(video.currentTime || 0),
                readyState: video.readyState,
                networkState: video.networkState
            });
        });
        video.addEventListener('stalled', () => {
            debugLog('warn', 'video-native-stalled', {
                currentTime: Number(video.currentTime || 0),
                readyState: video.readyState,
                networkState: video.networkState
            });
        });
        video.addEventListener('error', () => {
            debugLog('error', 'video-error', {
                code: video.error?.code,
                message: video.error?.message,
                currentSrc: String(video.currentSrc || '').slice(0, 500),
                readyState: video.readyState,
                networkState: video.networkState
            });
        });
        video.addEventListener('timeupdate', () => {
            if (Date.now() - lastPlayerReportAt < 15000) return;
            lastPlayerReportAt = Date.now();
            publishEvent('video-progress', {
                currentTime: Number(video.currentTime || 0),
                duration: Number(video.duration || 0),
                rate: Number(video.playbackRate || 1)
            });
        });
        video.addEventListener('ended', () => {
            const state = getState();
            if (recoverIncompleteEndPosition(video, state)) {
                debugLog('warn', 'ended-recovered-as-incomplete', {
                    lessonKey: playerLessonKey,
                    beforeProgress: state.beforeProgress,
                    currentLessonProgress: state.currentLessonProgress
                });
                setTimeout(() => attemptPlayerStart(video), 100);
                return;
            }
            playerEndedPublished = true;
            publishEvent('video-ended', {
                currentTime: Number(video.currentTime || 0), duration: Number(video.duration || 0)
            });
        });
        video.addEventListener('loadedmetadata', () => {
            debugLog('info', 'video-loadedmetadata', {
                duration: Number(video.duration || 0),
                currentTime: Number(video.currentTime || 0),
                readyState: video.readyState
            });
            recoverIncompleteEndPosition(video, getState());
            attemptPlayerStart(video);
        });
        video.addEventListener('canplay', () => {
            debugLog('info', 'video-canplay', {
                duration: Number(video.duration || 0),
                currentTime: Number(video.currentTime || 0),
                readyState: video.readyState
            });
            recoverIncompleteEndPosition(video, getState());
            attemptPlayerStart(video);
        });
        applyPlayerState(getState());
    }

    function shouldRecoverPausedVideoImmediately(video, state, blockingQuestion = false) {
        if (playerClosePending) return false;
        return Boolean(video
            && state?.status === 'running'
            && state?.settings?.autoResume
            && !state.maintenance
            && !video.ended
            && !blockingQuestion
            && !state.stopRequestAt
            && !state.skipRequestAt
            && !state.completedCloseRequestAt
            && state.phase !== 'closing-completed-player');
    }

    function recoverPausedVideoImmediately(video) {
        const state = getState();
        if (!shouldRecoverPausedVideoImmediately(video, state, hasBlockingQuestion())) return false;

        debugLog('info', 'video-pause-immediate-recovery', {
            currentTime: Number(video.currentTime || 0),
            readyState: video.readyState,
            networkState: video.networkState,
            phase: state.phase
        });
        applyPlayerState(state);
        video.play().then(() => {
            debugLog('info', 'video-pause-recovery-succeeded', {
                currentTime: Number(video.currentTime || 0)
            });
        }).catch((error) => {
            debugLog('warn', 'video-pause-recovery-rejected', {
                currentTime: Number(video.currentTime || 0),
                error
            });
        });
        return true;
    }

    function attemptPlayerStart(video) {
        const state = getState();
        if (playerClosePending || state.status !== 'running' || state.maintenance || !state.settings.autoResume || video.ended || hasBlockingQuestion()) return;
        const source = video.currentSrc || video.getAttribute('src') || '';
        const durationReady = Number.isFinite(video.duration) && video.duration > 0;
        const metadataReady = video.readyState >= 1 && durationReady;
        if (!source || !metadataReady) {
            if (Date.now() - lastPlayerWaitLogAt >= 10000) {
                lastPlayerWaitLogAt = Date.now();
                debugLog('warn', 'player-not-ready', {
                    hasSource: Boolean(source),
                    duration: Number(video.duration || 0),
                    readyState: video.readyState,
                    networkState: video.networkState
                });
            }
            return;
        }
        if (Date.now() - lastPlayAttemptAt < 3000) return;

        lastPlayAttemptAt = Date.now();
        applyPlayerState(state);
        const bigPlayButton = document.querySelector('.vjs-big-play-button');
        debugLog('info', 'player-start-attempt', {
            bigPlayButtonVisible: isVisible(bigPlayButton),
            paused: video.paused,
            duration: Number(video.duration || 0),
            readyState: video.readyState,
            rate: video.playbackRate
        });
        if (bigPlayButton && isVisible(bigPlayButton)) bigPlayButton.click();
        setTimeout(() => {
            if (video.paused && !video.ended && !hasBlockingQuestion()) {
                video.play().catch((error) => {
                    debugLog('warn', 'video-play-rejected', { error });
                });
            }
        }, 250);
    }

    function applyPlayerState(state) {
        if (!playerVideo) return;
        if (state.settings.muted) {
            playerVideo.muted = true;
            playerVideo.volume = 0;
        }
        playerVideo.playbackRate = 1;

        if (playerClosePending || state.maintenance || state.status === 'paused' || ['stopped', 'idle', 'complete'].includes(state.status)) {
            if (!playerVideo.paused) playerVideo.pause();
        }
    }

    function hasBlockingQuestion() {
        const question = document.querySelector('.question');
        if (isVisible(question)) return true;
        const dialogs = [...document.querySelectorAll('.layui-layer-dialog .layui-layer-content')];
        return dialogs.some((dialog) => {
            const text = normalizeText(dialog.textContent);
            return isVisible(dialog) && text && !text.includes('视频即将结束');
        });
    }

    function dismissKnownContinuePrompt() {
        const contents = [...document.querySelectorAll('.layui-layer-content')];
        const prompt = contents.find((node) => {
            const text = normalizeText(node.textContent);
            return isVisible(node) && text.includes('实时在线学习') && text.includes('继续学习');
        });
        if (!prompt) return;
        const layer = prompt.closest('.layui-layer');
        const confirm = layer?.querySelector('.layui-layer-btn0');
        if (confirm) {
            debugLog('info', 'continue-prompt-confirmed', { text: normalizeText(prompt.textContent) });
            confirm.click();
        }
    }

    function recoverIncompleteEndPosition(video, state) {
        if (playerRecoverySeekApplied || !video) return false;
        const duration = Number(video.duration || 0);
        const currentTime = Number(video.currentTime || 0);
        const beforeProgress = Number(state.beforeProgress || 0);
        const currentLessonProgress = Number(state.currentLessonProgress || 0);
        const creditedProgress = Math.max(
            Number.isFinite(beforeProgress) ? beforeProgress : 0,
            Number.isFinite(currentLessonProgress) ? currentLessonProgress : 0
        );
        if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(creditedProgress)) return false;
        if (creditedProgress >= 99.9 || currentTime < duration - 2) return false;

        // 旧版倍速可能把 lesson_location 写到结尾，但服务器只累计了部分真实时长。
        // 回退到服务器已确认进度附近，并留 30 秒重叠，补足剩余正常学习时间。
        const targetTime = Math.max(0, Math.min(duration - 30, duration * Math.max(0, creditedProgress) / 100 - 30));
        playerRecoverySeekApplied = true;
        playerEndedPublished = false;
        video.currentTime = targetTime;
        lastPlayerTime = targetTime;
        lastPlayerProgressAt = Date.now();
        lastPlayAttemptAt = 0;
        debugLog('warn', 'incomplete-end-position-recovered', {
            creditedProgress,
            fromTime: currentTime,
            targetTime,
            duration,
            lessonKey: playerLessonKey
        });
        publishEvent('resume-position-corrected', { creditedProgress, fromTime: currentTime, targetTime, duration });
        return true;
    }

    function closePlayerWindow(reason = 'unspecified') {
        debugLog('info', 'player-close-invoked', {
            reason,
            lessonKey: playerLessonKey,
            currentTime: Number(playerVideo?.currentTime || 0),
            duration: Number(playerVideo?.duration || 0),
            ended: Boolean(playerVideo?.ended)
        });
        publishEvent('player-closing', { reason });
        const closingKey = playerLessonKey;
        const requestAt = handledCloseRequestAt;
        const fallback = () => {
            const latest = getState();
            if (!accountRuntime.guard() || latest.currentLessonKey !== closingKey
                || handledCloseRequestAt !== requestAt
                || (latest.status !== 'running' && reason !== 'stop-request')) return;
            debugLog('warn', 'player-window-close-fallback', {reason});
            // Use Tampermonkey's granted close, not the native top window method.
            try { window.close(); }
            catch (error) { debugLog('error','player-granted-close-failed',{error}); }
        };
        // A visible site button can silently do nothing. Keep a guarded fallback.
        setTimeout(fallback, 1500);
        try {
            const topDocument = window.top.document;
            const closeButton = topDocument.querySelector('#btnexit, button.instructions-close');
            if (closeButton) {
                debugLog('info', 'player-close-button-click', { selector: closeButton.id || closeButton.className });
                closeButton.click();
                return;
            }
        } catch (_error) {
            // 同源播放器通常允许访问；失败时使用 window.close 兜底。
        }
        fallback();
    }

    if (typeof bindBootstrapDiagnostics === 'function') bindBootstrapDiagnostics(record => {
        const level = /invalidated|rejected|missing|failed/.test(record.event) ? 'error' : 'info';
        debugLog(level, record.event, {observedAt:record.time,origin:record.origin,path:record.path,...record.detail});
    });
    installGlobalErrorLogging();
    debugLog('info', 'script-boot', {
        version: VERSION,
        hostname: location.hostname,
        topLevel: window.top === window,
        documentReadyState: document.readyState
    });

    if (location.hostname === MAIN_HOST) {
        initMainPage();
    } else if (PLAYER_HOSTS.has(location.hostname)) {
        initPlayerPage();
    }
})();
// END HELPER CORE
    } catch(error) {
        await ready();
        const node=document.createElement('div');node.setAttribute('role','alert');
        node.style.cssText='position:fixed;left:0;bottom:0;z-index:2147483647;background:white;color:#a40000;padding:12px;border:1px solid red';
        node.textContent='学习助手未启动：'+error.message;
        recordBootstrap('bootstrap-failed', {errorType:error?.name || 'Error'});
        const download=document.createElement('button');
        download.textContent='下载启动诊断';
        download.addEventListener('click',()=>{
            const data={schemaVersion:2,scriptVersion:"1.5.36",generatedAt:new Date().toISOString(),
                context:'bootstrap-failure',documentTag:bootstrapDocumentTag,
                userAgent:navigator.userAgent,trace:bootstrapTrace};
            const href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));
            const link=document.createElement('a');link.href=href;
            link.download='gdgbpx-startup-'+bootstrapDocumentTag.slice(0,8)+'.json';
            document.body.appendChild(link);link.click();link.remove();
            setTimeout(()=>URL.revokeObjectURL(href),1000);
        });
        node.appendChild(download);
        document.body?.appendChild(node);
    }
})({GM_getValue,GM_setValue,GM_deleteValue,GM_addValueChangeListener,GM_removeValueChangeListener,GM_getTab,GM_saveTab,GM_xmlhttpRequest});
