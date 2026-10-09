const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname,'gdgbpx-multi-account-preview.user.js'),'utf8');
test('four generated preview instances keep progress and stop commands independent', async () => {
    const values=new Map();
    const instances=[];
    for(let i=0;i<4;i++) {
        let metadata={};
        const context={URL,URLSearchParams,crypto:{randomUUID},
            GM_getValue:(key, fallback)=>values.get(key)??fallback,
            GM_setValue:(key,value)=>values.set(key,structuredClone(value)),
            GM_deleteValue:key=>values.delete(key),
            GM_addValueChangeListener:()=>1,GM_removeValueChangeListener:()=>{},
            GM_getTab:fn=>fn(metadata),GM_saveTab:tab=>{metadata=tab;},GM_xmlhttpRequest:()=>{},
            location:{hostname:'gbpx.gd.gov.cn',href:'https://gbpx.gd.gov.cn/gdceportal/dist/'},
            setTimeout:()=>1,clearTimeout:()=>{},console:{log(){},warn(){},error(){}},
            document:{readyState:'complete',querySelector:()=>null,createElement(){throw new Error('Bootstrap failed');}}
        };
        context.window=context;context.top=context;
        await vm.runInNewContext(source.replace('    installGlobalErrorLogging();',
            '    globalThis.testApi={getState,updateState}; return;\n    installGlobalErrorLogging();'),context);
        assert.ok(context.testApi,'generated bundle must bootstrap');
        context.testApi.updateState({status:'running',currentLessonProgress:i*20});
        instances.push(context.testApi);
    }
    instances[0].updateState({status:'stopped',stopRequestAt:100});
    for(let i=1;i<4;i++) {
        assert.equal(instances[i].getState().status,'running');
        assert.equal(instances[i].getState().currentLessonProgress,i*20);
        assert.equal(instances[i].getState().stopRequestAt,0);
    }
});
