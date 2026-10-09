const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'src',name),'utf8').replace(/\r\n/g,'\n');
const modules=['account-storage.cjs','account-context.cjs','session-request.cjs']
    .map(name=>read(name).replace(/^module.exports\s*=.*$/gm,'')).join('\n');
const body=read('bootstrap.js').replace('null /* SCRIPT_VERSION */',()=>JSON.stringify(read('header.txt').match(/@version\s+(\S+)/)[1])).replace('/* ACCOUNT_MODULES */',()=>modules)
    .replace('/* HELPER_CORE */',()=>'// BEGIN HELPER CORE\n'+read('helper.js')+'// END HELPER CORE');
const output=read('header.txt')+'\n\n'+body;
const target=path.join(root,'gdgbpx-workshop-helper.user.js');
if(process.argv.includes('--check')) {
    if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==output)throw new Error('Generated script is stale');
} else fs.writeFileSync(target,output);
