'use strict';
const root=document.getElementById('accounts'),cards=new Map();
function element(tag,cls,text=''){const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;}
function button(text,op,id,cls=''){const b=element('button',cls,text);b.type='button';b.onclick=()=>window.client.command(op,id);return b;}
const group=element('div','group-controls'),groupStatus=element('p','group-status'),rescueStatus=element('p','rescue-status');
groupStatus.setAttribute('role','status');rescueStatus.setAttribute('role','status');
group.append(element('strong','','群控'),button('全部开始 / 继续','batch','start'),button('全部暂停','batch','pause'),button('全部停止','batch','stop','danger'),groupStatus,rescueStatus);
for(const [index,action]of ['start','pause','stop'].entries())group.querySelectorAll('button')[index].id='batch-'+action;
document.querySelector('.account-toolbar').before(group);
let rescueEnabled=true;
const rescueToggle=element('button','','关闭异常接管');rescueToggle.type='button';rescueToggle.onclick=()=>window.client.command('rescue-enabled',!rescueEnabled);group.append(rescueToggle);
const resultLabels={'dispatched-needs-verification':'已下发，等待状态核验','already-running':'已在运行','already-stopped':'已停止','already-paused':'已暂停','already-complete':'专题已完成','login-required':'需重新登录','helper-unavailable':'助手未就绪','delivery-unknown':'未收到回执，请检查','account-unavailable':'页面未打开','dispatch-failed':'发送失败','cancelled-by-new-command':'已由新命令取消'};
document.getElementById('overview-button').onclick=()=>window.client.command('overview');
const removedButton=button('已移除账号','removed-accounts');removedButton.id='removed-accounts';document.getElementById('add').after(removedButton);
document.getElementById('add').onclick=()=>window.client.command('add');
let collapseAllNext=false;
document.getElementById('toggle-all').onclick=()=>window.client.command('collapse-all',collapseAllNext);
document.getElementById('reminders').onclick=()=>document.getElementById('bark').showModal();
document.getElementById('bark-cancel').onclick=()=>document.getElementById('bark').close();
document.getElementById('bark-disable').onclick=async()=>{await window.client.command('bark',null);document.getElementById('bark').close();};
document.getElementById('bark-form').onsubmit=async event=>{event.preventDefault();try{await window.client.command('bark',{key:document.getElementById('bark-key').value,minutes:document.getElementById('bark-minutes').value});document.getElementById('bark-key').value='';document.getElementById('bark').close();}catch{document.getElementById('bark-status').textContent='保存失败，请检查 key 和系统加密是否可用';}};
function createCard(id){
 const section=element('section','account');section.dataset.accountId=id;
 const header=element('div','account-header'),title=element('h3','account-name'),badge=element('span','badge'),toggle=element('button','disclosure');
 toggle.type='button';toggle.setAttribute('aria-controls','account-detail-'+id);
 const details=element('div','account-details');details.id='account-detail-'+id;
 toggle.onclick=()=>window.client.command('collapse',{accountId:id,collapsed:!details.hidden});
 header.append(title,badge,toggle);
 const course=element('p','course-summary'),progressRow=element('div','progress-row'),progress=element('progress','course-progress'),progressText=element('span','progress-text');progress.max=100;progressRow.append(progress,progressText);
 const issue=element('p','issue');issue.setAttribute('role','status');
 const actions=element('div','account-actions'),play=button('▶ 查看播放','player',id),home=button('专题 / 首页','home',id);actions.append(play,home);
 const renameLabel=element('label','rename-label','账号备注'),rename=element('input','account-rename');rename.setAttribute('aria-label','账号备注');rename.maxLength=40;rename.onchange=()=>window.client.command('rename',{accountId:id,name:rename.value});renameLabel.append(rename);
 const individual=element('div','account-actions');for(const [text,action]of [['开始 / 继续','start'],['暂停','pause'],['停止','stop']])individual.append(button(text,'account-action',{accountId:id,action}));
 const commandResult=element('p','command-result');commandResult.setAttribute('role','status');
 const stateText=element('p','status'),learning=element('div','learning-details'),tabs=element('div','account-tabs');const management=element('div','account-management');management.append(button('移除账号','remove-account',id,'danger'),element('span','','保留记录，可恢复'));details.append(individual,learning,renameLabel,stateText,tabs,management);
 section.append(header,course,progressRow,issue,actions,commandResult,details);root.append(section);
 return {section,title,badge,toggle,details,course,progress,progressText,issue,play,rename,stateText,learning,tabs,commandResult,tabSignature:''};
}
function updateCard(card,a,state){
 card.title.textContent=a.name;card.title.title=a.name;
 card.details.hidden=a.collapsed;card.toggle.textContent=a.collapsed?'展开 ▾':'收纳 ▴';card.toggle.setAttribute('aria-expanded',String(!a.collapsed));card.toggle.setAttribute('aria-label',(a.collapsed?'展开':'收纳')+a.name+'详细信息');
 const current=a.states.filter(s=>s.status==='running').sort((a,b)=>(b.media?.at||0)-(a.media?.at||0))[0]||a.states[0];
 const visualFailure=a.tabs.find(t=>t.visualHealth?.phase==='needs-help');
 const problem=a.tabs.find(t=>t.issue)?.issue||(visualFailure?'画面自动重绘未恢复，已交给异常接管':null)||a.states.find(s=>['account-context-changed','login-required','player-open-failed','completed-close-failed','identity-entry-failed','player-lesson-mismatch'].includes(s.phase))?.message||'';
 const ended=current?.media?.duration>0&&current.media.currentTime>=current.media.duration-1&&current.media.paused===true;
 const mediaLabel=ended?'结束待核验':current?.media?.at&&Date.now()-current.media.at>120000?'心跳过期':current?.media?.paused===true?'媒体暂停':'运行中';
 const label=problem?'需处理':current?.status==='running'?mediaLabel:({paused:'已暂停',stopped:'已停止',complete:'已完成'}[current?.status]||'未启动');
 card.badge.textContent=label;card.badge.className='badge '+(problem?'attention':current?.status==='running'?'running':'neutral');
 card.section.classList.toggle('needs-attention',Boolean(problem));
 card.course.textContent=current?.lesson||'尚未选择课程';card.course.title=card.course.textContent;
 const value=Number(current?.progress),known=current?.progress!=null&&Number.isFinite(value);
 card.progress.hidden=!known;card.progress.value=known?Math.max(0,Math.min(100,value)):0;
 card.progress.setAttribute('aria-label',a.name+'服务器课程进度');card.progressText.textContent=known?'服务器 '+Number(value.toFixed(2))+'%':'进度未读取';
 card.issue.textContent=problem;card.issue.hidden=!problem;
 card.commandResult.hidden=!a.operatorResult;card.commandResult.textContent=a.operatorResult?(resultLabels[a.operatorResult.result]||a.operatorResult.result):'';
 card.play.hidden=!a.tabs.some(t=>t.kind==='播放器');
 if(document.activeElement!==card.rename)card.rename.value=a.name;
 card.stateText.textContent=a.states.map(s=>s.message).filter(Boolean).join(' · ')||'从专题助手点击开始';
 const info=a.learning,topic=info?.workshops?.[current?.classId||info?.currentClassId];
 const lines=[['必修正式学时',info?.required?info.required.earned+' / '+STUDY_HOURS_TARGET:'等待首页读取'],['当前专题',current?.workshop||topic?.title||'未读取'],['专题课程完成',topic?topic.completed+' / '+topic.total+' 门':'未读取'],['完成课程标注学时',topic?.completedHours!=null?topic.completedHours+' / '+topic.totalHours+'（非年度累计）':'课程学时未读取'],['已完成专题',String(current?.finishedWorkshops?.length||0)]];
 const learningSignature=JSON.stringify([lines,info?.workshops]);
 if(card.learningSignature!==learningSignature){card.learningSignature=learningSignature;card.learning.replaceChildren(element('h4','','学习情况'));for(const [name,value]of lines){const row=element('p','learning-row');row.append(element('span','learning-label',name),element('span','learning-value',value));card.learning.append(row);}if(topic)card.learning.append(element('p','learning-updated','最近核验：'+new Date(topic.at).toLocaleTimeString('zh-CN')+' · '+(topic.allCompleted?'服务器显示全部完成':topic.verificationComplete?'仍有未完成课程':'课程列表未完整核验')));for(const t of Object.values(info?.workshops||{})){card.learning.append(element('p','topic-row',t.title+' · '+t.completed+'/'+t.total+'门'+(t.allCompleted?' · 已完成':'')));}}
 const signature=JSON.stringify(a.tabs.map(t=>[t.id,t.title,t.kind,t.issue,t.id===state.active]));
 if(signature!==card.tabSignature){card.tabSignature=signature;card.tabs.replaceChildren();for(const t of a.tabs){const row=element('div','page-row');row.append(button(t.kind+' · '+t.title,'show',t.id,'tab'+(t.id===state.active?' active':'')));const controls=element('div','page-actions');controls.append(button('重新加载','reload',t.id),button('助手菜单','menu',t.id),button('关闭','close',t.id,'danger'));row.append(controls);card.tabs.append(row);}}
}
window.client.onState(state=>{
 updateOverview(state);removedButton.textContent='已移除账号'+(state.removedCount?'（'+state.removedCount+'）':'');
 collapseAllNext=state.accounts.some(a=>!a.collapsed);
 const toggleAll=document.getElementById('toggle-all');toggleAll.textContent=collapseAllNext?'全部收纳':'全部展开';toggleAll.setAttribute('aria-expanded',String(collapseAllNext));toggleAll.disabled=!state.accounts.length;
 const batch=state.batch;
 groupStatus.textContent=batch?({start:'开始 / 继续',pause:'暂停',stop:'停止'}[batch.action])+'：'+batch.results.length+'/'+batch.total+' 已返回'+(batch.running?' · 发送中':' · 已结束，请核对账号状态'): '开始会错峰发送；停止会取消待发送的开始命令。';
 const rescue=state.rescue;
 rescueEnabled=rescue?.status!=='disabled';rescueToggle.textContent=rescueEnabled?'关闭异常接管':'开启异常接管';
 rescueStatus.textContent=rescue&&Date.now()-rescue.at<45000?'本地异常接管：'+({watching:'监听中，异常时触发 Codex',handling:'Codex 正在分析异常',verifying:'正在核验恢复',failed:'接管失败，需检查',disabled:'已关闭'}[rescue.status]||rescue.status):'本地异常接管：等待监听器心跳';
 document.getElementById('reminders').textContent=state.barkEnabled?'Bark 已配置':'Bark 未配置';
 const live=new Set(state.accounts.map(a=>a.id));for(const [id,card]of cards)if(!live.has(id)){card.section.remove();cards.delete(id);}
 for(const a of state.accounts){if(!cards.has(a.id))cards.set(a.id,createCard(a.id));updateCard(cards.get(a.id),a,state);}
 const running=state.accounts.filter(a=>a.states.some(s=>s.status==='running')).length;
 const playing=state.accounts.filter(a=>a.states.some(s=>s.status==='running'&&s.media?.paused===false&&Date.now()-s.media.at<20000)).length;
 document.getElementById('account-count').textContent=state.accounts.length+' 个账号 · '+running+' 任务 / '+playing+' 播放';
});
const overviewRows=new Map();let overviewState=null;
document.getElementById('overview-filter').onchange=()=>overviewState&&updateOverview(overviewState);
function updateOverview(state){
 overviewState=state;const now=Date.now(),rows=state.accounts.map(a=>accountOverview(a,now)),totals=overviewTotals(rows);
 document.getElementById('overview').hidden=Boolean(state.active);
 document.getElementById('overview-button').setAttribute('aria-pressed',String(!state.active));
 const metrics=document.getElementById('overview-metrics');
 const values=[['账号',totals.accounts],['播放中',totals.playing],['需处理',totals.attention],['专题完成',totals.complete+'/'+totals.accounts],['专题已完成学时合计',totals.known?totals.hours+' / '+totals.total:'—']];
 const signature=JSON.stringify(values);if(metrics.dataset.signature!==signature){metrics.dataset.signature=signature;metrics.replaceChildren();for(const [label,value]of values){const card=element('div','metric');card.append(element('span','',label),element('strong','',String(value)));metrics.append(card);}}
 metrics.title='学时合计覆盖 '+totals.known+'/'+totals.accounts+' 个账号；同一专题在不同账号分别计入，不是个人年度累计。';
 document.getElementById('overview-time').textContent='面板更新 '+new Date(now).toLocaleTimeString('zh-CN');
 const rescueFresh=state.rescue&&now-state.rescue.at<45000;
 document.getElementById('overview-health').textContent='接管：'+(!rescueFresh?'心跳待确认':state.rescue.status==='watching'?'监听中':state.rescue.status==='disabled'?'已关闭':'处理中 / 需检查')+' · Bark '+(state.barkEnabled?'已配置':'未配置')+' · 学时覆盖 '+totals.known+'/'+totals.accounts;
 const body=document.querySelector('#overview-table tbody'),filter=document.getElementById('overview-filter').value,live=new Set(rows.map(r=>r.id));let visible=0;
 for(const [id,row]of overviewRows)if(!live.has(id)){row.tr.remove();overviewRows.delete(id);}
 for(const r of rows){
  let row=overviewRows.get(r.id);if(!row){const tr=element('tr','');tr.dataset.accountId=r.id;const cells=Array.from({length:7},()=>element('td',''));tr.append(...cells);cells[6].append(button('播放','player',r.id),button('专题','home',r.id));body.append(tr);row={tr,cells};overviewRows.set(r.id,row);}
  row.tr.hidden=filter==='attention'?!r.attention:filter==='incomplete'?r.topic?.allCompleted===true:false;if(!row.tr.hidden)visible++;
  row.tr.classList.toggle('attention-row',r.attention);const c=row.cells,t=r.topic;
  c[0].replaceChildren(element('strong','',r.name),element('span','table-sub',r.status));
  c[1].textContent=r.required?r.required.earned+' / '+r.required.target:'— 等待首页读取';c[1].title=r.required?'目标按本阶段约定为50学时；已获数来自首页必修学时，采集于 '+new Date(r.required.at).toLocaleString('zh-CN'):'按所属账号会话每60秒读取首页，不跳转当前播放页';
  c[2].replaceChildren(element('strong','',r.unofficial!=null?r.unofficial+' / '+r.required.target:'—'),element('span','table-sub','含待计入 '+r.pendingHours+' 学时（估算）'+(r.creditUnknown?' · '+r.creditUnknown+' 个已完专题计入状态待核验，未重复相加':'')));
  c[3].replaceChildren(element('strong','',t?t.completed+' / '+t.total:'—'),element('span','table-sub',t?.title||'专题未读取'));if(t&&!t.verificationComplete)c[3].append(element('span','table-sub','列表尚未完整核验'));
  c[4].replaceChildren(element('span','table-course',r.lesson||'课程未读取'),element('span','table-sub',Number.isFinite(r.progress)?'服务器 '+r.progress+'%（约30秒更新）':'服务器进度未读取'));
  if(r.media&&Number.isFinite(r.media.currentTime)&&r.media.duration>0)c[4].append(element('span','table-sub','播放 '+Math.floor(r.media.currentTime/60)+':'+String(Math.floor(r.media.currentTime%60)).padStart(2,'0')+' / '+Math.floor(r.media.duration/60)+':'+String(Math.floor(r.media.duration%60)).padStart(2,'0')+' · '+(100*r.media.currentTime/r.media.duration).toFixed(1)+'%'+(r.media.paused?' · 暂停':'')));
  else c[4].append(element('span','table-sub','媒体心跳待更新'));
  c[5].textContent=t?new Date(t.at).toLocaleTimeString('zh-CN')+(r.stale?' · 待更新':''):'—';c[5].classList.toggle('stale',r.stale);
 }
 document.getElementById('overview-empty').hidden=visible>0;
}
window.client.command('state');
