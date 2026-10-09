'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { resolveTabScope, prepareScopedPlayerUrl } = require('./tab-context.cjs');
function fixture(values = new Map()) {
    let tab = {};
    const api = {
        GM_getTab(fn) { fn(structuredClone(tab)); },
        GM_saveTab(value) { tab = structuredClone(value); },
        GM_getValue(key, fallback) { return values.get(key) ?? fallback; },
        GM_setValue(key, value) { values.set(key, structuredClone(value)); },
        GM_deleteValue(key) { values.delete(key); }
    };
    const env = { href: 'https://gbpx.gd.gov.cn/gdceportal/dist/',
        isMain: true, isTop: true, isPlayer: false, now: () => 1000,
        uuid: randomUUID, setTimeout(fn, ms) { if (ms === 100) queueMicrotask(fn); return 1; }, clearTimeout() {} };
    return {api, env};
}
test('four main tabs get distinct scopes and preserve each across reloads', async () => {
    const values = new Map();
    const tabs = Array.from({length:4}, () => fixture(values));
    const scopes = await Promise.all(tabs.map(t => resolveTabScope(t.api, t.env)));
    assert.equal(new Set(scopes.map(s => s.id)).size, 4);
    for (let i=0;i<4;i++) assert.deepEqual(await resolveTabScope(tabs[i].api,tabs[i].env),scopes[i]);
});
test('managed player inherits only its launching main tab; iframe and reload preserve it', async () => {
    const values = new Map();
    for(let i=0;i<4;i++) {
        const main=fixture(values), player=fixture(values);
        const scope=await resolveTabScope(main.api,main.env);
        player.env={...player.env,isMain:false,isPlayer:true,
            href:prepareScopedPlayerUrl(main.api,scope,'https://cs1.gdgbpx.com/course?courseId=synthetic',main.env)};
        assert.deepEqual(await resolveTabScope(player.api,player.env),scope);
        assert.deepEqual(await resolveTabScope(player.api,{...player.env,now:()=>999999}),scope);
        assert.deepEqual(await resolveTabScope(player.api,{...player.env,isTop:false,href:'https://cs1.gdgbpx.com/frame'}),scope);
    }
});
test('orphan player, expired ticket and mismatched entry fail closed', async () => {
    const values=new Map(), f=fixture(values), fresh=fixture(values);
    await assert.rejects(resolveTabScope(f.api,{...f.env,isMain:false,isPlayer:true}),/归属/);
    const scope=await resolveTabScope(f.api,f.env);
    const href=prepareScopedPlayerUrl(f.api,scope,'https://cs1.gdgbpx.com/course',f.env);
    await assert.rejects(resolveTabScope(fresh.api,{...f.env,isMain:false,isPlayer:true,href,now:()=>122000}),/过期/);
    await assert.rejects(resolveTabScope(fresh.api,{...f.env,isMain:false,isPlayer:true,href:href.replace('/course#','/wrong#')}),/不匹配/);
    assert.throws(()=>prepareScopedPlayerUrl(f.api,scope,'https://example.com/',f.env),/域名/);
});
test('existing player cannot be rebound to a different main tab', async () => {
    const values=new Map(), a=fixture(values), b=fixture(values);
    const sa=await resolveTabScope(a.api,a.env);
    await resolveTabScope(b.api,b.env);
    const href=prepareScopedPlayerUrl(a.api,sa,'https://cs1.gdgbpx.com/course',a.env);
    await assert.rejects(resolveTabScope(b.api,{...b.env,isMain:false,isPlayer:true,href}),/冲突/);
});
