'use strict';
// Synthetic pages only: HTTPS is intercepted inside throwaway test sessions.
// No user browser, credentials, profile or academy server is accessed.
const assert=require('node:assert/strict');const {account}=require('../policy.cjs');const {spawn}=require('node:child_process');const fs=require('node:fs'),path=require('node:path');
module.exports=async({accounts,configure,open,pages,store,win,app,processControl,visualWatch})=>{
  try{
    const secondary=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[app.getAppPath(),'--self-test','--self-test-root='+app.getPath('userData')],{windowsHide:true});let output='';
      const timer=setTimeout(()=>{child.kill();reject(new Error('secondary process did not exit'));},10000);
      child.stdout.on('data',data=>{output+=data;});child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,output});});
    });
    assert.equal(secondary.code,0);assert.ok(secondary.output.includes('SECONDARY_BLOCKED'),'second process must not open the same account directory');
    const a=account('synthetic A'),b=account('synthetic B');accounts.push(a,b);
    for(const item of [a,b]){
      const ses=configure(item.id);
      ses.protocol.handle('https',request=>new Response(new URL(request.url).pathname.endsWith('playmp4_pc.html')?'<html><title>Synthetic course</title><body><h3>Synthetic course</h3><video></video></body></html>':'<!doctype html><title>Synthetic test</title><body>Fixture</body>',{headers:{'Content-Type':'text/html'}}));
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
    const panel=win.webContents;
    panel.setBackgroundThrottling(false);
    await until(async()=>await panel.executeJavaScript('document.querySelectorAll(".account").length===2'));
    assert.equal(await panel.executeJavaScript('Array.from(document.querySelectorAll(".account-details")).every(n=>n.hidden)'),true);
    await panel.executeJavaScript(`document.querySelector('[data-account-id="${a.id}"] .disclosure').click()`);
    await until(async()=>await panel.executeJavaScript(`document.querySelector('[data-account-id="${a.id}"] .account-details').hidden===false`));
    assert.equal(await panel.executeJavaScript(`document.querySelector('[data-account-id="${b.id}"] .account-details').hidden`),true);
    assert.equal(await panel.executeJavaScript(`document.querySelector('[data-account-id="${a.id}"] .disclosure').getAttribute('aria-expanded')`),'true');
    await panel.executeJavaScript(`(()=>{const input=document.querySelector('[data-account-id="${a.id}"] .account-rename');input.focus();input.value='draft';window.client.command('state');})()`);
    assert.equal(await panel.executeJavaScript(`document.querySelector('[data-account-id="${a.id}"] .account-rename').value`),'draft');
    panel.reload();await until(async()=>await panel.executeJavaScript(`Boolean(document.querySelector('[data-account-id="${a.id}"] .account-details'))`));
    assert.equal(await panel.executeJavaScript(`document.querySelector('[data-account-id="${a.id}"] .account-details').hidden`),false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'panel.json'),'utf8'))[a.id],false);
    await panel.executeJavaScript('document.getElementById("toggle-all").click()');
    await until(async()=>await panel.executeJavaScript('Array.from(document.querySelectorAll(".account-details")).every(n=>n.hidden)'));
    assert.equal(await panel.executeJavaScript('document.getElementById("toggle-all").textContent'),'全部展开');
    await panel.executeJavaScript('document.getElementById("toggle-all").click()');
    await until(async()=>await panel.executeJavaScript('Array.from(document.querySelectorAll(".account-details")).every(n=>!n.hidden)'));
    await panel.executeJavaScript(`document.querySelector('[data-account-id="${b.id}"] .disclosure').click()`);
    // Reproduce the real failure: Vue puts course authorization on a page-world
    // DOM expando; an isolated preload cannot see that __vue__ property.
    for(const [wc,item] of [[aw,a],[bw,b]]){
      await wc.executeJavaScript(`(()=>{
        const fixture=document.createElement('div');fixture.id='pane-required';
        fixture.innerHTML='<span id="tab-required">必修(0/1)</span><div class="item_box"><span class="item_title">Synthetic course</span><span>学时：0.5</span><span class="item_status">未完成</span><div role="progressbar" aria-valuenow="0"></div></div>';
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
    const pw=pages.get(player).view.webContents;
    await pw.executeJavaScript(`(()=>{const f=document.createElement('iframe');f.src='https://cs1.gdgbpx.com/gdcecw/play_pc/playmp4_pc.html';document.body.append(f);})()`);
    await until(()=>Object.entries(store(a.id)).some(([key,v])=>key.endsWith(':gdgbpx_workshop_helper_media_heartbeat_v2')&&v?.paused!==null));
    const frame=pw.mainFrame.frames.find(f=>f.url.endsWith('playmp4_pc.html'));
    assert.ok(frame);
    assert.equal(await frame.executeJavaScript('document.querySelector("video").muted'),true);
    assert.equal(await frame.executeJavaScript('typeof window.require'),'undefined');
    assert.ok(pages.get(player).view.getBounds().width>0,'background player must have a real viewport');
    assert.equal(pw.isAudioMuted(),true,'player must be muted before media preload is ready');
    await panel.executeJavaScript(`document.querySelector('[data-account-id="${a.id}"] .disclosure').click()`);
    await until(async()=>await panel.executeJavaScript(`document.querySelector('[data-account-id="${a.id}"] .account-details').hidden`));
    assert.equal(pw.isDestroyed(),false,'folding account details must never close a player');
    assert.equal(pw.isAudioMuted(),true,'folding account details must not alter audio');
    await panel.executeJavaScript('new Promise(resolve=>{requestAnimationFrame(()=>requestAnimationFrame(resolve));setTimeout(resolve,500);})');
    const preview=await win.capturePage({x:0,y:68,width:300,height:480});fs.writeFileSync(path.join(__dirname,'..','test-data','panel-preview.png'),preview.toPNG());
    const stateKey='gdgbpx_account_v1:'+ascope.id+':gdgbpx_workshop_helper_state_v1',savedState=structuredClone(store(a.id)[stateKey]);
    store(a.id)[stateKey]={...savedState,status:'paused',phase:'login-required',message:'Synthetic login expired'};
    await panel.executeJavaScript('window.client.command("state")');
    await until(async()=>await panel.executeJavaScript(`document.querySelector('[data-account-id="${a.id}"] .badge').textContent==='需处理'`));
    assert.equal(await panel.executeJavaScript(`document.querySelector('[data-account-id="${a.id}"] .issue').hidden`),false,'errors must stay visible even while details are folded');
    assert.equal(await panel.executeJavaScript(`document.querySelector('[data-account-id="${a.id}"] .account-details').hidden`),true);
    store(a.id)[stateKey]=savedState;await panel.executeJavaScript('window.client.command("state")');
    await panel.executeJavaScript(`document.querySelector('[data-account-id="${a.id}"] .disclosure').click()`);
    await aw.executeJavaScript('document.getElementById("gbpx-muted").click()');
    await until(()=>!pw.isAudioMuted());
    const otherPlayer=[...pages.values()].find(p=>p.parent===bid).view.webContents;
    assert.equal(otherPlayer.isAudioMuted(),true,'changing one account mute must not unmute another account');
    const locationBefore=pw.getURL();
    for(const id of [a.id,b.id,a.id,b.id,a.id]){
      await panel.executeJavaScript(`window.client.command('player',${JSON.stringify(id)})`);
      const selected=[...pages.values()].find(p=>p.accountId===id&&p.parent);
      assert.equal(win.contentView.children.at(-1),selected.view,'selected player must be the top native view');
    }
    await panel.executeJavaScript(`window.client.command('repaint',${JSON.stringify(a.id)})`);
    assert.equal(pw.getURL(),locationBefore,'repaint must never navigate a playing page');assert.equal(pw.isDestroyed(),false);
    await pw.executeJavaScript("document.documentElement.style.backgroundColor='rgb(17,51,85)'");
    const captureRequest={id:require('node:crypto').randomUUID(),accountId:a.id,action:'capture-player',at:Date.now()};
    const captureDir=path.join(app.getPath('userData'),'control/inbox');fs.mkdirSync(captureDir,{recursive:true});fs.writeFileSync(path.join(captureDir,captureRequest.id+'.json'),JSON.stringify(captureRequest));processControl();
    const captureReceipt=path.join(app.getPath('userData'),'control/results',captureRequest.id+'.json');await until(()=>fs.existsSync(captureReceipt));
    const captured=JSON.parse(fs.readFileSync(captureReceipt,'utf8'));assert.ok(captured.result.startsWith('captured-local:diagnostics/visual-'));
    assert.ok(fs.statSync(path.join(app.getPath('userData'),captured.result.slice('captured-local:'.length))).size>100);
    const pixels=require('electron').nativeImage.createFromPath(path.join(app.getPath('userData'),captured.result.slice('captured-local:'.length))).toBitmap();
    assert.deepEqual([...pixels.subarray(0,3)],[85,51,17],'capture must contain the selected fixture surface, not a white bitmap');
    // Reproduce a visible-slot white screen: the selected native view is
    // unexpectedly hidden while its renderer/media continue running.
    const selectedPage=pages.get(player),siblingVisible=pages.get([...pages.entries()].find(([,p])=>p.view.webContents===otherPlayer)[0]).view.getVisible();
    selectedPage.loadedAt=Date.now()-20000;selectedPage.view.setVisible(false);
    assert.equal(selectedPage.view.getVisible(),false);
    await visualWatch.scan(player);
    assert.equal(visualWatch.get(player).phase,'recovered','automatic scan must repair the hidden selected view');
    assert.equal(selectedPage.view.getVisible(),true);assert.equal(win.contentView.children.at(-1),selectedPage.view);
    assert.equal(pw.getURL(),locationBefore,'automatic white-screen repair must not reload a healthy player');
    assert.equal(otherPlayer.isDestroyed(),false);assert.equal([...pages.values()].find(p=>p.view.webContents===otherPlayer).view.getVisible(),siblingVisible,'repair must preserve the background account visibility');
    await aw.executeJavaScript('document.getElementById("gbpx-muted").click()');
    await until(()=>pw.isAudioMuted());
    assert.equal(open(a.id,'https://cs1.gdgbpx.com/second',aid,false),null);
    const oldView=pages.get(player).view;
    pw.close();await until(()=>!pages.has(player));
    assert.ok(!win.contentView.children.includes(oldView),'closed player must release its native child view');
    await until(()=>Object.values(store(a.id)).some(v=>v?.phase==='player-manually-closed'));
    assert.equal(otherPlayer.isDestroyed(),false,'closing account A player must preserve account B player');
    assert.ok(!Object.values(store(a.id)).some(v=>Array.isArray(v)&&v.some(log=>log.event==='script-update-check-failed')),'embedded helper must not run a Tampermonkey-only update path');
    const input=path.join(app.getPath('userData'),'control/inbox');fs.mkdirSync(input,{recursive:true});
    for(const [action,expected]of [['inspect','inspected'],['retry','manual-or-unknown-pause'],['execute-js','unsupported-action']]){
      const request={id:require('node:crypto').randomUUID(),accountId:a.id,action,at:Date.now()};fs.writeFileSync(path.join(input,request.id+'.json'),JSON.stringify(request));processControl();const result=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'control/results',request.id+'.json'),'utf8'));assert.equal(result.result,expected);
    }
    await until(()=>Boolean(store(a.id).__clientLearning?.workshops?.synthetic));
    assert.equal(store(a.id).__clientLearning.workshops.synthetic.total,1);
    assert.equal(store(a.id).__clientLearning.workshops.synthetic.totalHours,0.5);
    await panel.executeJavaScript('window.client.command("state")');
    assert.ok((await panel.executeJavaScript('document.querySelector(".learning-details").textContent')).includes('必修完成'));
    const retryState=store(a.id)[stateKey];store(a.id)[stateKey]={...retryState,status:'paused',phase:'player-open-failed',userPaused:false};
    const validRequest={id:require('node:crypto').randomUUID(),accountId:a.id,action:'retry',at:Date.now()};
    fs.writeFileSync(path.join(input,validRequest.id+'.json'),JSON.stringify(validRequest));processControl();
    const receipt=path.join(app.getPath('userData'),'control/results',validRequest.id+'.json');await until(()=>fs.existsSync(receipt));
    assert.equal(JSON.parse(fs.readFileSync(receipt,'utf8')).result,'dispatched-needs-verification');
    fs.writeFileSync(path.join(input,validRequest.id+'.json'),JSON.stringify(validRequest));processControl();
    assert.equal(JSON.parse(fs.readFileSync(receipt,'utf8')).result,'duplicate-not-replayed');
    // Exercise the actual trusted panel -> main -> preload -> helper path.
    await panel.executeJavaScript('document.getElementById("batch-pause").click()');
    await until(()=>[a,b].every(item=>store(item.id).__clientManualHold?.action==='pause'));
    await until(()=>[a,b].every(item=>Object.values(store(item.id)).some(v=>v?.status==='paused'&&v?.userPaused===true)));
    await until(async()=>await panel.executeJavaScript('document.querySelector(".group-status").textContent.includes("2/2")'));
    await panel.executeJavaScript('document.getElementById("batch-start").click()');
    await until(()=>[a,b].every(item=>!store(item.id).__clientManualHold));
    await until(()=>[a,b].every(item=>Object.values(store(item.id)).some(v=>v?.status==='running'&&v?.userPaused===false)));
    await until(async()=>await panel.executeJavaScript('document.querySelector(".group-status").textContent.includes("已结束")'));
    await panel.executeJavaScript('document.getElementById("batch-stop").click()');
    await until(()=>[a,b].every(item=>store(item.id).__clientManualHold?.action==='stop'));
    await until(()=>[a,b].every(item=>Object.values(store(item.id)).some(v=>v?.status==='stopped')));
    await until(async()=>await panel.executeJavaScript('document.querySelector(".group-status").textContent.includes("2/2")'));
    assert.equal(pages.has(aid),true,'bulk stop retains the account main page');assert.equal(pages.has(bid),true);
    const heldRequest={id:require('node:crypto').randomUUID(),accountId:a.id,action:'reload-main',at:Date.now()};
    fs.writeFileSync(path.join(input,heldRequest.id+'.json'),JSON.stringify(heldRequest));processControl();
    assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'control/results',heldRequest.id+'.json'),'utf8')).result,'operator-hold');
    aw.reload();await until(async()=>await aw.executeJavaScript('localStorage.getItem("fixture")==="account-a"'));
    console.log('ENGINE PASS: bulk pause/resume/stop through real IPC; immediate persistent operator hold; recovery refused after stop; per-account disclosure; bulk disclosure; persisted preferences; focus preserved; collapse leaves player/audio intact; single-instance lock; isolated sessions; sandbox; Vue authorization; managed launch; nested media/mute; independent audio; viewport; duplicate limit; native view release; close callback; sibling preserved; client version path; reload');
    app.exit(0);
  }catch(error){console.error('ENGINE FAIL:',error);for(const p of pages.values())console.error('fixture DOM:',await p.view.webContents.executeJavaScript('document.body?.innerText'));app.exit(1);}
};
