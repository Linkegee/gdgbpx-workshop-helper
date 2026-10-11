const {test}=require('node:test'),assert=require('node:assert/strict');const {parseBulk}=require('../bulk.js');
test('bulk rows preserve password whitespace when tab delimited and accept pasted spreadsheet rows',()=>{
 assert.deepEqual(parseBulk('alice\tp a ss\r\nbob pass2\n'),[{username:'alice',password:'p a ss'},{username:'bob',password:'pass2'}]);
});
test('invalid and duplicate bulk rows reject whole batch without echoing credentials',()=>{
 for(const input of ['alice SECRET extra','alice SECRET\nalice SECRET','alice\t','']){assert.throws(()=>parseBulk(input),error=>!/SECRET/.test(error.message));}
});
