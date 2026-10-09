'use strict';
// Userscript tab metadata is private to each browser tab; no website credentials
// or real account identifiers are used as the scope.
async function resolveTabScope(api, env) {
    const slot = 'gbpxAccountScopeV1';
    const valid = value => value && /^[a-f0-9-]{36}$/.test(value.id) && value.version === 1;
    const getTab = () => new Promise((resolve, reject) => {
        const timer = env.setTimeout(() => reject(new Error('读取标签页身份超时')), 5000);
        api.GM_getTab(tab => { env.clearTimeout(timer); resolve(tab || {}); });
    });
    let tab = await getTab();
    const url = new URL(env.href);
    const launch = new URLSearchParams(url.hash.slice(1)).get('gbpx_launch');
    if (env.isPlayer && launch) {
        if (!/^[a-f0-9-]{36}$/.test(launch)) throw new Error('播放器启动标识无效');
        const ticket = api.GM_getValue('gbpx_launch_v1:' + launch, null);
        if (valid(tab[slot]) && ticket && valid(ticket.scope) && tab[slot].id !== ticket.scope.id) {
            throw new Error('播放器标签页归属冲突');
        }
        if (!valid(tab[slot]) && (!ticket || !valid(ticket.scope) || ticket.expiresAt < env.now()
            || ticket.origin !== url.origin || ticket.path !== url.pathname)) {
            throw new Error('播放器启动标识不存在、已过期或入口不匹配');
        }
        if (!valid(tab[slot])) {
            tab[slot] = ticket.scope;
            api.GM_saveTab(tab);
        }
        // Keep ticket briefly for a verification-page reload; tab metadata carries
        // the scope across subsequent redirects and same-tab iframe navigation.
    }
    if (!valid(tab[slot]) && env.isMain && env.isTop) {
        tab[slot] = { version: 1, id: env.uuid() };
        api.GM_saveTab(tab);
    }
    // The top-level verification script may still be assigning the tab metadata.
    for (let attempt = 0; !valid(tab[slot]) && attempt < 20; attempt++) {
        await new Promise(resolve => env.setTimeout(resolve, 100));
        tab = await getTab();
    }
    if (!valid(tab[slot])) throw new Error('没有可确认的账号标签页归属，请从对应主页面打开播放器');
    return Object.freeze({ ...tab[slot] });
}

function prepareScopedPlayerUrl(api, scope, targetUrl, env) {
    const url = new URL(targetUrl);
    if (url.protocol !== 'https:' || !['wcs1.shawcoder.xyz', 'cs1.gdgbpx.com'].includes(url.hostname)) {
        throw new Error('播放器域名不在已验证范围');
    }
    const launch = env.uuid();
    api.GM_setValue('gbpx_launch_v1:' + launch, {
        scope, origin: url.origin, path: url.pathname, expiresAt: env.now() + 120000
    });
    const fragment = new URLSearchParams(url.hash.slice(1));
    fragment.set('gbpx_launch', launch);
    url.hash = fragment.toString();
    env.setTimeout(() => api.GM_deleteValue('gbpx_launch_v1:' + launch), 120000);
    return url.href;
}
module.exports = { resolveTabScope, prepareScopedPlayerUrl };
