const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
const source=fs.readFileSync(path.join(__dirname,'../gdgbpx-workshop-helper.user.js'),'utf8');
const STATE='gdgbpx_workshop_helper_state_v1';
function tabState() {return {metadata:{},local:new Map()};}
async function boot(values,tab,href='https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/classList?classType=3') {
    const url=new URL(href),context={URL,URLSearchParams,crypto,TextEncoder,Uint8Array,Event,AbortController,
        setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
        location:{href,hostname:url.hostname,hash:url.hash,assign(value){context.assigned=value;}},
        localStorage:{getItem:key=>tab.local.get(key)||null,setItem:(key,value)=>tab.local.set(key,value)},
        document:{readyState:'complete',querySelector:()=>null,addEventListener(){},createElement(){throw new Error('Bundle bootstrap failed');}},
        console:{log(){},warn(){},error(){}},
        GM_getTab:fn=>fn(structuredClone(tab.metadata)),GM_saveTab:obj=>{tab.metadata=structuredClone(obj);},
        GM_getValue:(key,fallback)=>values.has(key)?structuredClone(values.get(key)):fallback,
        GM_setValue:(key,value)=>values.set(key,structuredClone(value)),GM_deleteValue:key=>values.delete(key),
        GM_addValueChangeListener:()=>1,GM_removeValueChangeListener(){},GM_xmlhttpRequest(){},
        dispatchEvent(){},
    };
    context.window=context;context.top=context;
    await vm.runInNewContext(source.replace('    installGlobalErrorLogging();',
        '    globalThis.testApi={getState,updateState,handlePanelAction,accountRuntime};return;\n    installGlobalErrorLogging();'),context);
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
test('start on homepage navigates to studying list; update identity and version remain intact',async()=>{
    const context=await boot(new Map(),tabState(),'https://gbpx.gd.gov.cn/gdceportal/dist/#/index');
    context.testApi.handlePanelAction('start');
    assert.match(context.assigned,/classList\?classType=3$/);
    assert.match(source,/\/\/ @name\s+广东省干部培训网络学院专题学习助手\r?\n/);
    assert.match(source,/\/\/ @namespace\s+https:\/\/gbpx.gd.gov.cn\/\r?\n/);
    assert.match(source,/@version\s+1\.5\.25/);
    assert.match(source,/@updateURL\s+https:\/\/raw.githubusercontent.com\/Linkegee\/gdgbpx-workshop-helper\/main\/gdgbpx-workshop-helper.user.js/);
    assert.ok(source.includes('component?.$$Request?.course_auth'),'bundling preserves literal dollar signs');
    assert.equal(require('./load-core.cjs').loadCore().trim(),fs.readFileSync(path.join(__dirname,'../src/helper.js'),'utf8').replace(/\r\n/g,'\n').trim());
});
