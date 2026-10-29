'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {candidate,incidentKey,permitted,recovered}=require('../rescue.cjs');
test('healthy states, manual stops and unchanged incidents never repeatedly call Codex',()=>{
 const event={id:'a',status:'recoverable',phase:'player-stalled',action:'retry'};
 for(const status of ['healthy','maintenance','complete','manual-hold-or-unverified-completion'])assert.equal(candidate({...event,status},{},1e9),false);
 assert.equal(candidate(event,{},1e9),true);assert.equal(candidate(event,{incidents:{[incidentKey(event)]:{at:1e9}}},1e9+100),false);
});
test('Codex cannot select arbitrary commands or recover a human login/stop',()=>{
 const r={status:'recoverable',action:'reload-player'};
 assert.equal(permitted({action:'reload-player',reason:'x'},r),true);
 for(const action of ['execute-js','start','retry'])assert.equal(permitted({action,reason:'x'},r),false);
 assert.equal(permitted({action:'reload-player',reason:'x'},{status:'needs-login'}),false);
 assert.equal(permitted({action:'reload-player',reason:'x'},{status:'manual-hold-or-unverified-completion'}),false);
});
test('a command receipt is insufficient to prove recovery',()=>{
 const before={mediaTime:30,progress:20,lesson:'a',topicCompleted:2};
 assert.equal(recovered(before,{...before,status:'healthy'}),false);
 assert.equal(recovered(before,{...before,status:'healthy',mediaTime:35}),true);
 assert.equal(recovered(before,{...before,status:'healthy',lesson:'b',mediaTime:1}),true);
 assert.equal(recovered(before,{...before,status:'needs-login',mediaTime:35}),false);
});
test('a failed recovery is not retried repeatedly for the same incident',()=>{const event={id:'a',status:'recoverable',phase:'watching-video',lesson:'l',action:'reload-main'};const ledger={incidents:{[incidentKey(event)]:{at:1e9,status:'recovery-unverified'}}};assert.equal(candidate(event,ledger,1e9+1800000),false);});
