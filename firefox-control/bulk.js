(function(root){
'use strict';
function parseBulk(text){
 const rows=[],seen=new Set();
 for(const [index,line] of String(text).split(/\r?\n/).entries()){
  if(!line.trim())continue;
  const fields=line.includes('\t')?line.split('\t'):line.trim().split(/\s+/);
  if(fields.length!==2 || !fields[0].trim() || !fields[1] || fields[0].trim().length>100 || fields[1].length>512)throw Error('第 '+(index+1)+' 行格式不正确，请使用账号、Tab、密码');
  const username=fields[0].trim();if(seen.has(username))throw Error('第 '+(index+1)+' 行账号重复');
  seen.add(username);rows.push({username,password:fields[1]});
 }
 if(!rows.length)throw Error('请先粘贴账号和密码');if(rows.length>30)throw Error('每批最多30个账号');return rows;
}
root.GanbuBulk={parseBulk};if(typeof module!=='undefined')module.exports={parseBulk};
})(globalThis);
