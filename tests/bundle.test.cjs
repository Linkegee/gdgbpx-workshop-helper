const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
const source=fs.readFileSync(path.join(__dirname,'../gdgbpx-workshop-helper.user.js'),'utf8');
const STATE='gdgbpx_workshop_helper_state_v1';
function tabState() {return {metadata:{},local:new Map()};}
async function boot(values,tab,href='https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/classList?classType=3',documentOverrides={}) {
    const url=new URL(href),context={URL,URLSearchParams,crypto,TextEncoder,Uint8Array,Event,AbortController,
        setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
        location:{href,hostname:url.hostname,hash:url.hash,assign(value){context.assigned=value;}},
        localStorage:{getItem:key=>tab.local.get(key)||null,setItem:(key,value)=>tab.local.set(key,value)},
        document:{readyState:'complete',querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},createElement(){throw new Error('Bundle bootstrap failed');}},
        console:{log(){},warn(){},error(){}},
        GM_getTab:fn=>fn(structuredClone(tab.metadata)),GM_saveTab:obj=>{tab.metadata=structuredClone(obj);},
        GM_getValue:(key,fallback)=>values.has(key)?structuredClone(values.get(key)):fallback,
        GM_setValue:(key,value)=>values.set(key,structuredClone(value)),GM_deleteValue:key=>values.delete(key),
        GM_addValueChangeListener:()=>1,GM_removeValueChangeListener(){},GM_xmlhttpRequest(){},
        dispatchEvent(){},
    };
    Object.assign(context.document,documentOverrides);
    context.window=context;context.top=context;
    await vm.runInNewContext(source.replace('    installGlobalErrorLogging();',
        '    globalThis.testApi={getState,updateState,handlePanelAction,handleIdentityEntry,accountRuntime};return;\n    installGlobalErrorLogging();'),context);
    assert.ok(context.testApi,'full userscript must bootstrap');
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
    assert.match(source,/@version\s+1\.5\.28/);
    assert.match(source,/@updateURL\s+https:\/\/raw.githubusercontent.com\/Linkegee\/gdgbpx-workshop-helper\/main\/gdgbpx-workshop-helper.user.js/);
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
