const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
const source=fs.readFileSync(path.join(__dirname,'../gdgbpx-workshop-helper.user.js'),'utf8');
const STATE='gdgbpx_workshop_helper_state_v1';
function tabState() {return {metadata:{},local:new Map()};}
async function boot(values,tab,href='https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/classList?classType=3',documentOverrides={},expectFailure=false) {
    const url=new URL(href),context={URL,URLSearchParams,crypto,TextEncoder,Uint8Array,Event,AbortController,Blob,
        navigator:{userAgent:'test-firefox',onLine:true},
        setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
        location:{href,hostname:url.hostname,hash:url.hash,assign(value){context.assigned=value;}},
        localStorage:{getItem:key=>tab.local.get(key)||null,setItem:(key,value)=>tab.local.set(key,value)},
        document:{readyState:'complete',querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},createElement(){throw new Error('Bundle bootstrap failed');}},
        console:{log(){},warn(){},error(){}},
        GM_getTab:fn=>fn(structuredClone(tab.metadata)),GM_saveTab:obj=>{tab.metadata=structuredClone(obj);},
        GM_getValue:(key,fallback)=>values.has(key)?structuredClone(values.get(key)):fallback,
        GM_setValue:(key,value)=>values.set(key,structuredClone(value)),GM_deleteValue:key=>values.delete(key),
        GM_addValueChangeListener:()=>1,GM_removeValueChangeListener(){},GM_xmlhttpRequest(){},
        GM_setClipboard:value=>{context.clipboard=value;},
        dispatchEvent(){},
    };
    Object.assign(context.document,documentOverrides);
    context.window=context;context.top=context;
    await vm.runInNewContext(source.replace('    installGlobalErrorLogging();',
        '    globalThis.testApi={getState,updateState,handlePanelAction,handleIdentityEntry,accountRuntime,diagnosticBundle,setHeartbeat(value){GM_setValue(PLAYER_HEARTBEAT_KEY,value);},recordPageHealth,startForegroundHealthCheck,debugLog,sanitizeLogValue};return;\n    installGlobalErrorLogging();'),context);
    if (!expectFailure) assert.ok(context.testApi,'full userscript must bootstrap');
    return context;
}
test('published bundle: four main pages and four players retain separate states, stop and reload',async()=>{
    const values=new Map([[STATE,{status:'running',currentLessonKey:'legacy-course'}]]),mains=[];
    for(let i=0;i<4;i++) {
        const tab=tabState(),context=await boot(values,tab),api=context.testApi;
        assert.equal(api.getState().status,'idle');assert.equal(api.getState().currentLessonKey,'');
        api.handlePanelAction('start');assert.equal(api.getState().status,'running');
        api.updateState({currentLessonProgress:i*20,currentLessonKey:'same-course'});
        mains.push({tab,api});
    }
    assert.equal(new Set(mains.map(m=>m.api.accountRuntime.id)).size,4);
    const players=[];
    for(const main of mains) {
        const player=await boot(values,tabState(),main.api.accountRuntime.playerUrl('https://cs1.gdgbpx.com/play'));
        assert.equal(player.testApi.accountRuntime.id,main.api.accountRuntime.id);
        players.push(player.testApi);
    }
    mains[0].api.handlePanelAction('stop');
    assert.equal(players[0].getState().status,'stopped');
    for(let i=1;i<4;i++) {
        assert.equal(players[i].getState().status,'running');
        assert.equal(players[i].getState().currentLessonProgress,i*20);
        assert.equal((await boot(values,mains[i].tab)).testApi.accountRuntime.id,mains[i].api.accountRuntime.id);
    }
    mains[1].tab.local.set('gdgbpxSessionMarkerV2',crypto.randomUUID());
    mains[1].api.handlePanelAction('continue');
    assert.equal(players[1].getState().status,'stopped');
    assert.equal(players[2].getState().status,'running');
});
test('start on homepage uses native identity entry; update identity and version remain intact',async()=>{
    const context=await boot(new Map(),tabState(),'https://gbpx.gd.gov.cn/gdceportal/dist/#/index');
    context.testApi.handlePanelAction('start');
    assert.equal(context.assigned,'https://gbpx.gd.gov.cn/gdceportal/index.aspx');
    assert.match(source,/\/\/ @name\s+广东省干部培训网络学院专题学习助手\r?\n/);
    assert.match(source,/\/\/ @namespace\s+https:\/\/gbpx.gd.gov.cn\/\r?\n/);
    assert.match(source,/@version\s+1\.5\.36/);
    assert.match(source,/@updateURL\s+https:\/\/raw.githubusercontent.com\/Linkegee\/gdgbpx-workshop-helper\/main\/gdgbpx-workshop-helper.user.js/);
    assert.match(source, /@grant\s+window\.close/);
    assert.ok(source.includes('component?.$$Request?.course_auth'),'bundling preserves literal dollar signs');
    assert.equal(require('./load-core.cjs').loadCore().trim(),fs.readFileSync(path.join(__dirname,'../src/helper.js'),'utf8').replace(/\r\n/g,'\n').trim());
});

test('hidden homepage password field does not invalidate a logged-in tab; visible login still blocks',async()=>{
    let visible=false;
    const password={getClientRects:()=>visible?[{}]:[]};
    const context=await boot(new Map(),tabState(),'https://gbpx.gd.gov.cn/gdceportal/index.aspx',{
        querySelector:selector=>selector==='input[type="password"]'?password:null,
        querySelectorAll:selector=>selector==='input[type="password"]'?[password]:[]
    });
    assert.equal(context.testApi.accountRuntime.guard(),true,'hidden login form must not retire the current session');
    visible=true;
    assert.equal(context.testApi.accountRuntime.guard(),false,'visible login form must still retire the session');
});

test('second account started from a uid-less studying list recovers identity without stopping first account',async()=>{
    const values=new Map(),first=await boot(values,tabState(),
        'https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/classList?classType=3&uid=synthetic-first');
    first.testApi.handlePanelAction('start');
    const second=await boot(values,tabState());
    second.testApi.handlePanelAction('start');
    assert.equal(second.assigned,'https://gbpx.gd.gov.cn/gdceportal/index.aspx',
        'unknown identity must return through native homepage entry before processing courses');
    assert.equal(second.testApi.getState().phase,'identifying-account');
    assert.equal(first.testApi.getState().status,'running');
});

test('native identity entry survives same-tab navigation and records UID before entering studying list',async()=>{
    const values=new Map(),tab=tabState();
    const list=await boot(values,tab);list.testApi.handlePanelAction('start');
    let clicks=0;
    const entry={textContent:'专题学习',getClientRects:()=>[{}],contains:()=>false,click:()=>clicks++};
    const home=await boot(values,tab,list.assigned,{
        querySelectorAll:selector=>selector==='a,button,div,li,span'?[entry]:[]
    });
    home.testApi.handleIdentityEntry();home.testApi.handleIdentityEntry();assert.equal(clicks,1);
    const routed=await boot(values,tab,
        'https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/classList?uid=synthetic-second');
    routed.testApi.handleIdentityEntry();
    assert.equal(routed.location.hash,'#/workshop/workshopindex/classList?classType=3');
    assert.equal(routed.testApi.getState().status,'running');
    assert.equal(routed.testApi.getState().phase,'list-ready');
    const detail=await boot(values,tab,'https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/mergeClass?classId=fixture');
    const r=detail.testApi.accountRuntime;
    assert.equal(r.hasIdentity(),true);
    r.checkCourseAuth('synthetic-second-auth');
    for(let i=0;i<50 && !r.checkCourseAuth('synthetic-second-auth');i++) await new Promise(resolve=>setTimeout(resolve,2));
    assert.equal(r.checkCourseAuth('synthetic-second-auth'),true);
});

test('identity entry respects pause/stop, times out without looping, and does not release unknown identity',async()=>{
    const values=new Map(),tab=tabState();let clicks=0;
    const context=await boot(values,tab,'https://gbpx.gd.gov.cn/gdceportal/index.aspx',{
        querySelectorAll:selector=>selector==='a,button,div,li,span'?
            [{textContent:'专题学习',getClientRects:()=>[{}],contains:()=>false,click:()=>clicks++}]:[]
    });
    context.testApi.handlePanelAction('start');context.testApi.handlePanelAction('pause');
    context.testApi.handleIdentityEntry();assert.equal(clicks,0);
    context.testApi.handlePanelAction('stop');context.testApi.handleIdentityEntry();assert.equal(clicks,0);
    context.testApi.handlePanelAction('start');
    context.testApi.updateState({identityEntry:{startedAt:Date.now()-60000,clicked:false}});
    context.testApi.handleIdentityEntry();assert.equal(clicks,0);
    assert.equal(context.testApi.getState().status,'paused');
    assert.equal(context.testApi.accountRuntime.hasIdentity(),false);
});

test('diagnostic export correlates same-account documents, excludes other accounts and preserves failure across log rollover',async()=>{
    const values=new Map(),main=await boot(values,tabState()),other=await boot(values,tabState());
    other.testApi.debugLog('info','OTHER_ACCOUNT_ONLY');
    const player=await boot(values,tabState(),main.testApi.accountRuntime.playerUrl('https://cs1.gdgbpx.com/play?t=private-auth'));
    player.testApi.debugLog('info','player-observed');
    main.testApi.accountRuntime.checkCourseAuth('private-auth');
    const before=JSON.stringify(main.testApi.getState());
    main.testApi.handlePanelAction('copylog');
    assert.equal(JSON.stringify(main.testApi.getState()),before,'copy must retain original failure status/message');
    let bundle=JSON.parse(main.clipboard);
    assert.equal(bundle.schemaVersion,2);
    assert.equal(bundle.snapshot.runtime.blocked,true);
    assert.equal(bundle.lastFailure.event,'account-invalidated');
    assert.ok(bundle.logs.some(e=>e.event==='main-identity-bound'));
    assert.ok(bundle.logs.some(e=>e.event==='launch-ticket-bound'));
    assert.ok(new Set(bundle.logs.map(e=>e.documentTag)).size>=2);
    assert.ok(!JSON.stringify(bundle).includes('OTHER_ACCOUNT_ONLY'));
    assert.ok(!JSON.stringify(bundle).includes('private-auth'));
    for(let i=0;i<610;i++)main.testApi.debugLog('info','normal-event',{index:i});
    bundle=main.testApi.diagnosticBundle();
    assert.ok(bundle.logs.length<=600);
    assert.equal(bundle.lastFailure.event,'account-invalidated');
    main.testApi.handlePanelAction('clearlog');
    assert.equal(main.testApi.diagnosticBundle().lastFailure,null);
});

test('diagnostic redaction covers course authorization, launch fragments and Error message/stack',async()=>{
    const context=await boot(new Map(),tabState());
    const result=vm.runInNewContext(`testApi.sanitizeLogValue({
        course_auth:'secret-one',uid:'secret-two',
        url:'https://cs1.gdgbpx.com/play?t=secret-three#gbpx_launch=secret-four',
        error:new Error('request https://example.test/?token=secret-five')})`,context);
    assert.ok(!JSON.stringify(result).includes('secret-'));
});

test('unbound player exposes downloadable bootstrap trace without raw launch credentials',async()=>{
    const elements=[];
    const document={body:{appendChild(){}},createElement(tag){
        const node={tag,children:[],setAttribute(){},style:{},appendChild(n){this.children.push(n);},
            addEventListener(name,fn){this[name]=fn;},click(){},remove(){}};
        elements.push(node);return node;
    }};
    const context=await boot(new Map(),tabState(),
        'https://cs1.gdgbpx.com/play?t=secret-course#gbpx_launch=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',document,true);
    assert.equal(context.testApi,undefined);
    const button=elements.find(e=>e.tag==='button');assert.equal(button.textContent,'下载启动诊断');
    let downloaded;
    context.URL=class extends URL {static createObjectURL(blob){downloaded=blob;return 'blob:test';}static revokeObjectURL(){}};
    button.click();
    const data=JSON.parse(await downloaded.text());
    assert.equal(data.context,'bootstrap-failure');
    assert.ok(data.trace.some(e=>e.event==='launch-ticket-rejected'));
    assert.ok(data.trace.some(e=>e.event==='bootstrap-failed'));
    assert.ok(!JSON.stringify(data).includes('secret-course'));
    assert.ok(!JSON.stringify(data).includes('aaaaaaaa-aaaa'));
});


test('page health retains disappearance evidence after reload and bounds history',async()=>{
    const values=new Map(),tab=tabState();let present=true;
    const element={childElementCount:2,getBoundingClientRect:()=>({width:100,height:100})};
    const first=await boot(values,tab,undefined,{body:element,querySelector:selector=>present && ['#app','#gbpx-helper-panel'].includes(selector)?element:null});
    first.testApi.recordPageHealth('boot');present=false;
    first.testApi.recordPageHealth('interval');
    assert.ok(first.testApi.diagnosticBundle().pageHealth.lastAnomaly);
    const next=await boot(values,tab);next.testApi.recordPageHealth('boot');
    for(let i=0;i<50;i++)next.testApi.recordPageHealth();
    const health=next.testApi.diagnosticBundle().pageHealth;
    assert.equal(health.samples.length,40);
    assert.equal(health.lastAnomaly.after.structure.panel.present,false);
    assert.equal((await boot(values,tabState())).testApi.diagnosticBundle().pageHealth,null);
});


test('foreground checks capture brief disappearance and cancel stale callbacks after hiding',async()=>{
    const element={childElementCount:2,getBoundingClientRect:()=>({width:100,height:100})};let present=true;
    const c=await boot(new Map(),tabState(),undefined,{visibilityState:'visible',body:element,
        querySelector:selector=>present && selector==='#gbpx-helper-panel'?element:null});
    const timers=[],frames=[];
    c.setTimeout=(fn,delay)=>{timers.push({fn,delay});return timers.length;};
    c.clearTimeout=()=>{};c.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};c.cancelAnimationFrame=()=>{};
    c.testApi.startForegroundHealthCheck();
    assert.deepEqual(timers.map(t=>t.delay),[1000,3000,5000,10000]);
    present=false;timers[0].fn();present=true;timers[1].fn();frames[0]();
    const health=c.testApi.diagnosticBundle().pageHealth;
    assert.equal(health.lastAnomaly.after.structure.panel.present,false);
    assert.ok(health.samples.some(s=>s.reason==='foreground-frame'));
    c.document.visibilityState='hidden';c.testApi.startForegroundHealthCheck();
    const count=c.testApi.diagnosticBundle().pageHealth.samples.length;
    timers[2].fn();assert.equal(c.testApi.diagnosticBundle().pageHealth.samples.length,count);
});


test('stop then immediate start preserves old lesson and close request until old player is gone',async()=>{
    const c=await boot(new Map(),tabState());
    c.testApi.updateState({status:'running',phase:'watching-video',currentLessonKey:'class::lesson',currentLessonTitle:'lesson'});
    c.testApi.handlePanelAction('stop');
    const stopped=c.testApi.getState();
    c.testApi.handlePanelAction('start');
    assert.equal(c.testApi.getState().status,'stopped');
    assert.equal(c.testApi.getState().currentLessonKey,'class::lesson');
    assert.equal(c.testApi.getState().stopRequestAt,stopped.stopRequestAt);
    c.testApi.updateState({stopRequestAt:Date.now()-60000});
    c.testApi.handlePanelAction('start');
    assert.equal(c.testApi.getState().status,'running');
});


test('fresh scoped heartbeat blocks restart even after stop grace elapsed',async()=>{
    const c=await boot(new Map(),tabState());
    c.testApi.updateState({status:'stopped',phase:'stopped',stopRequestAt:Date.now()-60000,currentLessonKey:'old'});
    c.testApi.setHeartbeat({at:Date.now(),lessonKey:'old',sessionId:'old-player'});
    c.testApi.handlePanelAction('start');
    assert.equal(c.testApi.getState().status,'stopped');
    assert.equal(c.testApi.getState().currentLessonKey,'old');
    c.testApi.updateState({status:'running',phase:'watching-video'});
    c.testApi.handlePanelAction('start');
    assert.equal(c.testApi.getState().phase,'watching-video');
});
