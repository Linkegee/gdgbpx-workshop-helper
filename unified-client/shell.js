'use strict';
const root=document.getElementById('accounts');
function button(text,op,id,cls=''){const b=document.createElement('button');b.textContent=text;b.className=cls;b.onclick=()=>window.client.command(op,id);return b;}
document.getElementById('add').onclick=()=>window.client.command('add');
document.getElementById('reminders').onclick=()=>document.getElementById('bark').showModal();
document.getElementById('bark-cancel').onclick=()=>document.getElementById('bark').close();
document.getElementById('bark-disable').onclick=async()=>{await window.client.command('bark',null);document.getElementById('bark').close();};
document.getElementById('bark-form').onsubmit=async event=>{event.preventDefault();try{await window.client.command('bark',{key:document.getElementById('bark-key').value,minutes:document.getElementById('bark-minutes').value});document.getElementById('bark-key').value='';document.getElementById('bark').close();}catch{document.getElementById('bark-status').textContent='保存失败，请检查 key 和系统加密是否可用';}};
window.client.onState(state=>{
 document.getElementById('reminders').textContent=state.barkEnabled?'Bark 已配置':'Bark 未配置';
 // Keep a pressed button / account-name field alive during frequent heartbeats.
 if(root.querySelector(':active')||(document.hasFocus()&&root.contains(document.activeElement)&&document.activeElement.matches('input')))return;
 root.replaceChildren();
 for(const a of state.accounts){const card=document.createElement('section');card.className='account';const title=document.createElement('h3');title.textContent=a.name;card.append(title);
  card.append(button('打开首页','home',a.id));if(a.tabs.some(t=>t.kind==='播放器'))card.append(button('▶ 查看播放画面','player',a.id));const rename=document.createElement('input');rename.value=a.name;rename.setAttribute('aria-label','账号备注');rename.onchange=()=>window.client.command('rename',{accountId:a.id,name:rename.value});card.append(rename);
  for(const s of a.states){const text=document.createElement('p');text.className='status';text.textContent=[s.message,s.lesson].filter(Boolean).join(' · ');card.append(text);}
  for(const t of a.tabs){card.append(button(t.kind+' · '+t.title,'show',t.id,'tab'+(t.id===state.active?' active':'')));if(t.issue){const issue=document.createElement('p');issue.className='issue';issue.textContent=t.issue;card.append(issue);}card.append(button('重新加载','reload',t.id),button('助手菜单','menu',t.id),button('关闭','close',t.id));}
  root.append(card);
 }
});
window.client.command('state');
