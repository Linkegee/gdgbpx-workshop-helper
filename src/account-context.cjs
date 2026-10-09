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
    let tab = await getTab();
    const url = new URL(env.href());
    const launch = directLaunch || relay?.launch;
    if (env.isPlayer && launch && !validScope(tab[TAB_SLOT])) {
        if (!/^[a-f0-9-]{36}$/.test(launch)) throw new Error('播放器启动标识无效');
        const ticket = api.GM_getValue('gdgbpxLaunchV2:' + launch, null);
        if (!ticket || !validScope(ticket.scope) || ticket.expiresAt < env.now()
            || ticket.origin !== url.origin || ticket.path !== (relay?.path || url.pathname)) {
            throw new Error('播放器启动标识已失效，请从所属账号主页面重新打开');
        }
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
        lastUid = uid;
        api.GM_saveTab(tab);
    }
    // An iframe may arrive while the top-level verification page is binding the tab.
    for(let attempt=0; !validScope(tab[TAB_SLOT]) && attempt<20; attempt++) {
        await new Promise(resolve=>env.setTimeout(resolve,100));
        tab = await getTab();
    }
    if (!validScope(tab[TAB_SLOT])) throw new Error('无法确认播放器所属账号；请从对应主页面启动');
    const scope = {...tab[TAB_SLOT]};
    let blocked = false, pending = false, authPending = false, checkedAuth = '', authClaimKey = '';
    function invalidate(message = '登录会话已变化，已停止旧任务；刷新页面后重新开始') {
        if (blocked) return;
        blocked = true;
        retireScope(api, scope, env.now(), message);
        tab[TAB_SLOT] = {...scope, retired:true};
        api.GM_saveTab(tab);
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
            guard();
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
        const ticket = env.uuid();
        api.GM_setValue('gdgbpxLaunchV2:' + ticket, {
            scope, origin:player.origin, path:player.pathname, expiresAt:env.now()+120000
        });
        const hash = new URLSearchParams(player.hash.slice(1));
        hash.set('gbpx_launch',ticket); player.hash = hash.toString();
        env.setTimeout(()=>api.GM_deleteValue('gdgbpxLaunchV2:'+ticket),120000);
        return player.href;
    }
    return Object.freeze({id:scope.id,label:scope.id.slice(0,6),guard,invalidate,hasIdentity:()=>Boolean(scope.ownerFingerprint),checkCourseAuth,playerUrl,bridgeEnabled:false});
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
module.exports = {createAccountRuntime,migratePreferences,retireScope};
