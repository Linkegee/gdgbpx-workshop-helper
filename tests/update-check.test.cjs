const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadCore,runtimeStub}=require('./load-core.cjs');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function boot(metadataResponse) {
    let now=1800000000000,nextId=0;
    const tasks=new Map(),values=new Map(),requests=[],metadataRequests=[];
    const context={accountRuntime:runtimeStub,URL,URLSearchParams,
        Date:class extends Date {static now(){return now;}},
        setTimeout(fn,delay){const id=++nextId;tasks.set(id,{fn,at:now+delay});return id;},
        clearTimeout:id=>tasks.delete(id),
        setInterval(fn,delay){const id=++nextId;tasks.set(id,{fn,at:now+delay,repeat:delay});return id;},
        clearInterval:id=>tasks.delete(id),
        document:{contains:()=>true,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},documentElement:{}},
        location:{hostname:'gbpx.gd.gov.cn',href:'https://gbpx.gd.gov.cn/gdceportal/dist/',hash:''},
        MutationObserver:class {observe(){}},addEventListener(){},alert(){},
        GM_getValue:(key,fallback)=>values.get(key)??fallback,GM_setValue:(key,value)=>values.set(key,value),
        GM_deleteValue:key=>values.delete(key),GM_addValueChangeListener(){},GM_registerMenuCommand(){},
        GM_xmlhttpRequest:options=>{
            if(options.url.startsWith('https://api.github.com/')) {
                metadataRequests.push(options);
                options.onload(metadataResponse || {status:200,responseText:JSON.stringify({object:{sha:'a'.repeat(40)}})});
            } else requests.push(options);
        },console:{log(){},warn(){},error(){}}
    };
    context.window=context;context.top=context;
    vm.runInNewContext(loadCore().replace('    installGlobalErrorLogging();',
        `    globalThis.api={checkForScriptUpdate,getAvailableUpdate,handlePanelAction,setPanel(value){panel=value;},
         init(){installPanel=()=>{};installMenuSectionTracking=()=>{};initMainPage();}};return;
         installGlobalErrorLogging();`),context);
    async function advance(ms) {
        const target=now+ms;
        for(let steps=0;steps<10000;steps++) {
            const due=[...tasks].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
            if(!due)break;
            const [id,task]=due;now=task.at;tasks.delete(id);
            if(task.repeat)tasks.set(id,{...task,at:now+task.repeat});
            task.fn();await settle();
        }
        now=target;await settle();
    }
    return {api:context.api,requests,metadataRequests,advance,values};
}
test('an already-open idle page discovers a release within five minutes without reloading',async()=>{
    const h=boot();h.api.init();await h.advance(3000);
    assert.equal(h.requests.length,1);
    h.requests[0].onload({status:200,responseText:'// @version 1.0.0'});await settle();
    await h.advance(5*60*1000);
    assert.equal(h.requests.length,2,'a later release needs another request on an idle open page');
    h.requests[1].onload({status:200,responseText:'// @version 9.0.0'});await settle();
    assert.equal(h.api.getAvailableUpdate().version,'9.0.0');
});
test('a failed check does not suppress retry for a day',async()=>{
    const h=boot();h.api.checkForScriptUpdate();await settle();h.requests[0].onerror();await settle();
    await h.advance(61000);h.api.checkForScriptUpdate();await settle();
    assert.equal(h.requests.length,2);
});
test('manual panel check bypasses cooldown, without overlapping an in-flight request',async()=>{
    const h=boot();h.api.handlePanelAction('checkupdate');await settle();
    assert.equal(h.requests.length,1);
    h.api.handlePanelAction('checkupdate');assert.equal(h.requests.length,1);
    h.requests[0].onload({status:200,responseText:'// @version 1.0.0'});await settle();
    h.api.handlePanelAction('checkupdate');await settle();assert.equal(h.requests.length,2,'manual check bypasses a successful recent check');
});

test('a detected release renders an update button and collapsed new-version badge',async()=>{
    const h=boot(),elements=new Map();
    const panel={querySelector(selector){
        if(!elements.has(selector))elements.set(selector,{textContent:'',hidden:true,classList:{toggle(){}}});
        return elements.get(selector);
    }};
    h.api.setPanel(panel);h.api.handlePanelAction('checkupdate');
    await settle();
    assert.equal(elements.get('[data-action="checkupdate"]').disabled,true);
    h.requests[0].onload({status:200,responseText:'// @version 9.0.0'});await settle();
    assert.equal(elements.get('[data-action="installupdate"]').hidden,false);
    assert.match(elements.get('[data-action="installupdate"]').textContent,/9\.0\.0/);
    assert.equal(elements.get('.gbpx-launcher').textContent,'新');
    assert.equal(elements.get('[data-action="checkupdate"]').disabled,false);
});

test('check and install both use the resolved commit, never the stale raw main alias',async()=>{
    const h=boot();h.api.checkForScriptUpdate(true);await settle();
    assert.equal(h.metadataRequests.length,1,'resolve GitHub branch before reading script');
    assert.ok(h.requests[0].url.includes('/'+'a'.repeat(40)+'/'));
    h.requests[0].onload({status:200,responseText:'// @version 9.0.0'});await settle();
    assert.equal(h.api.getAvailableUpdate().url,h.requests[0].url,'install the exact verified content');
});

test('API rate limit falls back to official commit feed and installs immutable content',async()=>{
    const h=boot({status:403,responseText:'rate limited'});
    h.api.checkForScriptUpdate(true);await settle();
    assert.match(h.requests[0]?.url || '',/github\.com\/Linkegee\/gdgbpx-workshop-helper\/commits\/main\.atom/);
    h.requests[0].onload({status:200,responseText:'<feed><entry><id>tag:github.com,2008:Grit::Commit/'+ 'b'.repeat(40)+'</id></entry></feed>'});await settle();
    assert.ok(h.requests[1].url.includes('/'+'b'.repeat(40)+'/'));
    h.requests[1].onload({status:200,responseText:'// @version 9.0.0'});await settle();
    assert.equal(h.api.getAvailableUpdate().url,h.requests[1].url);
});
test('failed or malformed fallback never claims success and allows manual retry',async()=>{
    for(const fallback of [{status:503,responseText:'unavailable'},
        {status:200,responseText:'<feed><entry><id>unexpected/path</id></entry></feed>'}]) {
        const h=boot({status:403,responseText:'rate limited'});h.api.checkForScriptUpdate(true);await settle();
        assert.equal(h.requests.length,1);
        h.requests[0].onload(fallback);await settle();
        assert.equal(h.values.has('gdgbpx_workshop_helper_update_check_v1'),false);
        assert.equal(h.api.getAvailableUpdate(),null);
        h.api.checkForScriptUpdate(true);await settle();
        assert.equal(h.metadataRequests.length,2);
        assert.equal(h.requests.length,2);
    }
});
