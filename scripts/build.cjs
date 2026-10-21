const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'src',name),'utf8').replace(/\r\n/g,'\n');
const header=read('header.txt');
const version=header.match(/^\/\/ @version\s+(\S+)$/m)?.[1];
if(!version)throw new Error('Missing userscript version');
function withVersion(name) {
    const source=read(name),marker='null /* SCRIPT_VERSION */';
    if(source.split(marker).length!==2)throw new Error('Expected one version marker in '+name);
    return source.replace(marker,()=>JSON.stringify(version));
}
const modules=['account-storage.cjs','account-context.cjs','session-request.cjs']
    .map(name=>read(name).replace(/^module.exports\s*=.*$/gm,'')).join('\n');
const body=withVersion('bootstrap.js').replace('/* ACCOUNT_MODULES */',()=>modules)
    .replace('/* HELPER_CORE */',()=>'// BEGIN HELPER CORE\n'+withVersion('helper.js')+'// END HELPER CORE');
const output=header+'\n\n'+body;
const target=path.join(root,'gdgbpx-workshop-helper.user.js');
if(process.argv.includes('--check')) {
    if(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==output)throw new Error('Generated script is stale');
} else fs.writeFileSync(target,output);
