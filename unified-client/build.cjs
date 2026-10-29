'use strict';
const fs=require('node:fs'),path=require('node:path');
const base=__dirname;
fs.mkdirSync(path.join(base,'generated'),{recursive:true});
const adapter=fs.readFileSync(path.join(base,'page-preload.cjs'),'utf8');
const helper=fs.readFileSync(path.join(base,'..','gdgbpx-workshop-helper.user.js'),'utf8');
// The helper runs inside the sandboxed, isolated preload world. No IPC bridge
// or Node object is exposed to the remote page's JavaScript world.
fs.writeFileSync(path.join(base,'generated','page.cjs'),adapter+'\n'+helper+'\n}\n');
console.log('Bundled helper '+helper.match(/@version\s+(\S+)/)[1]);
