const fs=require('node:fs'),path=require('node:path');
function loadCore() {
    const built=fs.readFileSync(path.join(__dirname,'../gdgbpx-workshop-helper.user.js'),'utf8');
    const match=built.match(/\/\/ BEGIN HELPER CORE\s*([\s\S]*?)\/\/ END HELPER CORE/);
    if(!match)throw new Error('Built helper core not found');
    return match[1];
}
const runtimeStub={id:'fixture-account',label:'fixture',guard:()=>true,playerUrl:url=>url,bridgeEnabled:false};
module.exports={loadCore,runtimeStub};
