const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {createAccountRuntime,migratePreferences}=require('../src/account-context.cjs');
const {createAccountStorage}=require('../src/account-storage.cjs');
const {createSessionRequest}=require('../src/session-request.cjs');
const STATE='gdgbpx_workshop_helper_state_v1';
function fixture(values=new Map()) {
    let tab={},marker=randomUUID(),uid='';
    const api={
        GM_getTab:fn=>fn(structuredClone(tab)),GM_saveTab:value=>{tab=structuredClone(value);},
        GM_getValue:(key,fallback)=>values.has(key)?structuredClone(values.get(key)):fallback,
        GM_setValue:(key,value)=>values.set(key,structuredClone(value)),GM_deleteValue:key=>values.delete(key)
    };
    const env={href:()=> 'https://gbpx.gd.gov.cn/gdceportal/dist/',isMain:true,isTop:true,isPlayer:false,
        uuid:randomUUID,now:()=>1000,sessionMarker:()=>marker,routeUid:()=>uid,
        digest:async value=>createHash('sha256').update(value).digest('hex'),
        setTimeout(fn,ms){if(ms===100)queueMicrotask(fn);return 1;},clearTimeout(){}};
    return {api,env,values,setMarker:value=>{marker=value;},setUid:value=>{uid=value;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('different account routes sharing course authorization stop both scopes before further work',async()=>{
    const values=new Map(),a=fixture(values),b=fixture(values);
    a.setUid('synthetic-owner-A');b.setUid('synthetic-owner-B');
    const ar=await createAccountRuntime(a.api,a.env),br=await createAccountRuntime(b.api,b.env);
    assert.equal(ar.checkCourseAuth('synthetic-shared-auth'),false);
    await settle();assert.equal(ar.checkCourseAuth('synthetic-shared-auth'),true);
    assert.equal(br.checkCourseAuth('synthetic-shared-auth'),false);
    await settle();assert.equal(br.guard(),false);assert.equal(ar.guard(),false);
    assert.match(createAccountStorage(a.api,ar.id).GM_getValue(STATE).message,/授权.*冲突/);
    const dump=JSON.stringify([...values]);
    assert.ok(!dump.includes('synthetic-shared-auth'));assert.ok(!dump.includes('synthetic-owner'));
});

test('same account authorization is allowed; unknown identity and late checks cannot authorize opening',async()=>{
    const values=new Map(),a=fixture(values),b=fixture(values);
    a.setUid('same-user');b.setUid('same-user');
    const ar=await createAccountRuntime(a.api,a.env),br=await createAccountRuntime(b.api,b.env);
    ar.checkCourseAuth('same-auth');await settle();br.checkCourseAuth('same-auth');await settle();
    assert.equal(ar.checkCourseAuth('same-auth'),true);assert.equal(br.checkCourseAuth('same-auth'),true);
    const orphan=fixture(values),r=await createAccountRuntime(orphan.api,orphan.env);
    assert.equal(r.checkCourseAuth('auth'),false);assert.equal(r.guard(),false);
    const late=fixture(values);late.setUid('late-user');const lr=await createAccountRuntime(late.api,late.env);
    lr.checkCourseAuth('late-auth');lr.invalidate();await settle();assert.equal(lr.guard(),false);
});
test('four scopes preserve reloads and retire only the switched session',async()=>{
    const values=new Map(),tabs=Array.from({length:4},()=>fixture(values));
    const runtimes=await Promise.all(tabs.map(t=>createAccountRuntime(t.api,t.env)));
    assert.equal(new Set(runtimes.map(r=>r.id)).size,4);
    for(let i=0;i<4;i++) {
        createAccountStorage(tabs[i].api,runtimes[i].id).GM_setValue(STATE,{status:'running',currentLessonProgress:i*20});
        assert.equal((await createAccountRuntime(tabs[i].api,tabs[i].env)).id,runtimes[i].id);
    }
    tabs[0].setMarker(randomUUID());
    assert.equal(runtimes[0].guard(),false);
    const a=createAccountStorage(tabs[0].api,runtimes[0].id);
    assert.equal(a.GM_getValue(STATE).status,'stopped');
    assert.equal(a.GM_getValue(STATE).stopRequestAt,1000);
    for(let i=1;i<4;i++)assert.equal(createAccountStorage(tabs[i].api,runtimes[i].id).GM_getValue(STATE).status,'running');
    assert.notEqual((await createAccountRuntime(tabs[0].api,tabs[0].env)).id,runtimes[0].id);
});
test('route identity changes stop the old account, including changes across reloads',async()=>{
    const f=fixture();f.setUid('synthetic-user-A');
    const a=await createAccountRuntime(f.api,f.env);
    f.setUid('synthetic-user-B');assert.equal(a.guard(),false);await settle();
    assert.equal(a.guard(),false);
    const b=await createAccountRuntime(f.api,f.env);assert.notEqual(a.id,b.id);
    f.setUid('synthetic-user-C');
    const c=await createAccountRuntime(f.api,f.env);assert.notEqual(b.id,c.id);
    assert.equal(createAccountStorage(f.api,b.id).GM_getValue(STATE).status,'stopped');
    assert.ok(!JSON.stringify([...f.values]).includes('synthetic-user'), 'raw account identity must not enter GM storage');
});
test('identity may first appear after bootstrap; logout and unavailable storage fail closed',async()=>{
    const f=fixture(),r=await createAccountRuntime(f.api,f.env);
    f.setUid('synthetic-A');assert.equal(r.guard(),false);await settle();assert.equal(r.guard(),true);
    f.env.isLoginPage=()=>true;assert.equal(r.guard(),false);
    const b=fixture(),s=await createAccountRuntime(b.api,b.env);
    b.env.sessionMarker=()=>{throw new Error('storage unavailable');};assert.equal(s.guard(),false);
});
test('launch tickets bind a player and its iframe, survive expiry on reload, reject conflicting or orphan tabs',async()=>{
    const values=new Map(),main=fixture(values),p=fixture(values);
    const m=await createAccountRuntime(main.api,main.env);
    let href=m.playerUrl('https://cs1.gdgbpx.com/play?courseId=synthetic');
    const pe={...p.env,href:()=>href,isMain:false,isPlayer:true};
    const player=await createAccountRuntime(p.api,pe);assert.equal(player.id,m.id);
    assert.equal((await createAccountRuntime(p.api,{...pe,now:()=>999999})).id,m.id);
    href='https://cs1.gdgbpx.com/frame';assert.equal((await createAccountRuntime(p.api,{...pe,isTop:false})).id,m.id);
    const other=fixture(values),r=await createAccountRuntime(other.api,other.env);
    href=r.playerUrl('https://cs1.gdgbpx.com/play');
    await assert.rejects(createAccountRuntime(p.api,pe),/归属冲突/);
    const orphan=fixture(values);
    await assert.rejects(createAccountRuntime(orphan.api,{...pe,href:()=> 'https://cs1.gdgbpx.com/frame'}),/无法确认/);
    await assert.rejects(createAccountRuntime(orphan.api,{...pe,now:()=>999999}),/失效/);
    assert.throws(()=>r.playerUrl('http://cs1.gdgbpx.com/play'),/域名/);
});
test('upgrade migrates only preferences; never starts or copies old course progress into any account',()=>{
    const f=fixture(),old={status:'running',phase:'watching-video',currentLessonProgress:80,currentLessonKey:'old-course',
        maintenance:{id:'old-maintenance'},settings:{muted:false,playbackRate:2,autoResume:false,stallMinutes:2}};
    f.api.GM_setValue(STATE,old);
    for(let i=0;i<4;i++) {
        const storage=createAccountStorage(f.api,randomUUID());migratePreferences(f.api,storage);
        const state=storage.GM_getValue(STATE);
        assert.equal(state.status,'idle');assert.equal(state.currentLessonKey,undefined);
        assert.equal(state.maintenance,undefined);assert.equal(state.settings.muted,false);
        assert.equal(state.settings.stallMinutes,2);
        assert.equal(state.settings.playbackRate,undefined);
        storage.GM_setValue(STATE,{status:'paused'});migratePreferences(f.api,storage);
        assert.equal(storage.GM_getValue(STATE).status,'paused');
    }
    assert.deepEqual(f.api.GM_getValue(STATE),old);
});
test('maintenance uses the current page fetch; late responses cannot navigate a switched account',async()=>{
    const pending=[];let allowed=true,result=0,extensionRequests=0;
    const page={AbortController,fetch:(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))};
    const request=createSessionRequest({GM_xmlhttpRequest(){extensionRequests++;}},page,{guard:()=>allowed},
        {href:'https://gbpx.gd.gov.cn/gdceportal/dist/',hostname:'gbpx.gd.gov.cn'}, {setTimeout:()=>1,clearTimeout(){}});
    request({url:'https://gbpx.gd.gov.cn/gdceportal/dist/',onload:()=>result++});
    await settle();
    assert.equal(pending[0].options.credentials,'include');assert.equal(extensionRequests,0);
    allowed=false;pending[0].resolve({status:200,url:pending[0].url,text:async()=>'<div id="app"></div>'});
    await settle();assert.equal(result,0);
    request({url:'https://raw.githubusercontent.com/example/version'});assert.equal(extensionRequests,1);
});

test('verification redirects relay only the opaque launch ticket before GM_getTab returns',async()=>{
    const values=new Map(),main=fixture(values),player=fixture(values);
    const runtime=await createAccountRuntime(main.api,main.env);
    const href=runtime.playerUrl('https://cs1.gdgbpx.com/verify?t=synthetic-secret');
    let relay;
    // Simulate a document that unloads before its tab lookup completes.
    createAccountRuntime({...player.api,GM_getTab(){}},{...player.env,isMain:false,isPlayer:true,
        href:()=>href,saveLaunch:value=>{relay=value;}});
    assert.ok(relay?.launch);assert.ok(!JSON.stringify(relay).includes('synthetic-secret'));
    const next=await createAccountRuntime(player.api,{...player.env,isMain:false,isPlayer:true,
        href:()=> 'https://cs1.gdgbpx.com/player',readLaunch:()=>relay});
    assert.equal(next.id,runtime.id);
});
