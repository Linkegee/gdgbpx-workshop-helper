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
    const player=open(a.id,'https://cs1.gdgbpx.com/fixture',aid,false);
    assert.equal(pages.get(player).view.webContents.session,aw.session);
    assert.notEqual(pages.get(player).view.webContents.session,bw.session);
    assert.equal(open(a.id,'https://cs1.gdgbpx.com/second',aid,false),null);
    aw.reload();await until(async()=>await aw.executeJavaScript('localStorage.getItem("fixture")==="account-a"'));
    console.log('ENGINE PASS: separate cookies/storage, helper preload, distinct scopes, sandbox, popup inheritance, duplicate limit, reload');
    app.exit(0);
  }catch(error){console.error('ENGINE FAIL:',error);for(const p of pages.values())console.error('fixture DOM:',await p.view.webContents.executeJavaScript('document.body?.innerText'));app.exit(1);}
};
