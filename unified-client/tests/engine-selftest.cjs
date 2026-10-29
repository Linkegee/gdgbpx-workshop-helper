'use strict';
// Synthetic pages only: HTTPS is intercepted inside throwaway test sessions.
// No user browser, credentials, profile or academy server is accessed.
const assert=require('node:assert/strict');const {account}=require('../policy.cjs');
module.exports=async({accounts,configure,open,pages,store,app})=>{
  try{
    const a=account('synthetic A'),b=account('synthetic B');accounts.push(a,b);
    for(const item of [a,b]){
      const ses=configure(item.id);
      ses.protocol.handle('https',()=>new Response('<!doctype html><title>Synthetic test</title><body>Fixture</body>',{headers:{'Content-Type':'text/html'}}));
      await ses.cookies.set({url:'https://gbpx.gd.gov.cn',name:'fixture_identity',value:item.name,secure:true});
    }
    const aid=open(a.id,'https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/classList?uid=synthetic-a');
    const bid=open(b.id,'https://gbpx.gd.gov.cn/gdceportal/dist/#/workshop/workshopindex/classList?uid=synthetic-b');
    const aw=pages.get(aid).view.webContents,bw=pages.get(bid).view.webContents;
    async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Test condition timed out');}
    await until(async()=>await aw.executeJavaScript('Boolean(document.getElementById("gbpx-helper-panel"))'));
    await until(async()=>await bw.executeJavaScript('Boolean(document.getElementById("gbpx-helper-panel"))'));
    assert.equal(await aw.executeJavaScript('typeof window.require'), 'undefined');
    assert.equal(await aw.executeJavaScript('typeof window.client'),'undefined');
    await aw.executeJavaScript('localStorage.setItem("fixture","account-a")');
    await bw.executeJavaScript('localStorage.setItem("fixture","account-b")');
    assert.equal(await aw.executeJavaScript('localStorage.getItem("fixture")'),'account-a');
    assert.equal(await bw.executeJavaScript('localStorage.getItem("fixture")'),'account-b');
    assert.equal((await aw.session.cookies.get({name:'fixture_identity'}))[0].value,'synthetic A');
    assert.equal((await bw.session.cookies.get({name:'fixture_identity'}))[0].value,'synthetic B');
    const ascope=pages.get(aid).metadata.gdgbpxScopeV2,bscope=pages.get(bid).metadata.gdgbpxScopeV2;
    assert.ok(ascope);assert.ok(bscope);assert.notEqual(ascope.id,bscope.id);
    assert.ok(Object.keys(store(a.id)).some(k=>k.includes(ascope.id)));
    assert.ok(!JSON.stringify(store(b.id)).includes(ascope.id));
    // Reproduce the real failure: Vue puts course authorization on a page-world
    // DOM expando; an isolated preload cannot see that __vue__ property.
    for(const [wc,item] of [[aw,a],[bw,b]]){
      await wc.executeJavaScript(`(()=>{
        const fixture=document.createElement('div');fixture.id='pane-required';
        fixture.innerHTML='<div class="item_box"><span class="item_title">Synthetic course</span><span class="item_status">未完成</span><div role="progressbar" aria-valuenow="0"></div></div>';
        document.body.append(fixture);
        fixture.__vue__={info:{playDomain:'https://cs1.gdgbpx.com/verify'},$$Request:{course_auth:${JSON.stringify('synthetic-auth-'+item.id)}},listNav:{requiredCourseList:{listInfo:[{courseName:'Synthetic course',resourceCode:'synthetic-resource',courseId:'synthetic-course'}]}}};
        location.hash='#/workshop/workshopindex/mergeClass?classId=synthetic';
        document.querySelector('[data-action="start"]').click();
      })()`);
      await until(()=>Object.keys(store(item.id)).some(k=>k.startsWith('gdgbpxCourseOwnerV1:'))||Object.values(store(item.id)).some(v=>v?.phase==='account-context-changed'));
      assert.ok(Object.keys(store(item.id)).some(k=>k.startsWith('gdgbpxCourseOwnerV1:')),'page-world Vue authorization must reach helper without stopping the account');
    }
    await until(()=>[...pages.values()].some(p=>p.parent===aid)&&[...pages.values()].some(p=>p.parent===bid));
    const player=[...pages.entries()].find(([,p])=>p.parent===aid)[0];
    await until(()=>pages.get(player).metadata.gdgbpxStageBoundAt);
    assert.equal(pages.get(player).metadata.gdgbpxScopeV2.id,ascope.id);
    await until(()=>pages.get(player).view.webContents.getURL().startsWith('https://cs1.gdgbpx.com/verify?'));
    assert.equal(new URL(pages.get(player).view.webContents.getURL()).searchParams.get('t'),'synthetic-auth-'+a.id);
    assert.equal(new URL(pages.get(player).view.webContents.getURL()).searchParams.get('courseId'),'synthetic-resource');
    assert.equal(pages.get(player).view.webContents.session,aw.session);
    assert.notEqual(pages.get(player).view.webContents.session,bw.session);
    assert.equal(open(a.id,'https://cs1.gdgbpx.com/second',aid,false),null);
    aw.reload();await until(async()=>await aw.executeJavaScript('localStorage.getItem("fixture")==="account-a"'));
    console.log('ENGINE PASS: separate cookies/storage, helper preload, distinct scopes, sandbox, page-world Vue authorization, managed launch, popup inheritance, duplicate limit, reload');
    app.exit(0);
  }catch(error){console.error('ENGINE FAIL:',error);for(const p of pages.values())console.error('fixture DOM:',await p.view.webContents.executeJavaScript('document.body?.innerText'));app.exit(1);}
};
