'use strict';
// Expiry, rate limiting and failed disk writes, without touching the real device store.
const fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-polish-auth-unit-'));
let now=Date.now(),failSave=false;
class Clock extends Date {static now(){return now;}}
const moduleStub={exports:{}};
vm.runInNewContext(fs.readFileSync('auth.js','utf8'),{require:n=>n==='fs'?{...fs,renameSync(...args){if(failSave)throw Error('disk failure fixture');return fs.renameSync(...args);}}:require(n),process:{env:{NEXUS_DEVICES_FILE:path.join(dir,'devices.json')},pid:process.pid},module:moduleStub,Date:Clock});
const auth=moduleStub.exports;
auth.configure({remoteHost:'phone.test',remoteUser:'owner@test'});
let code=auth.newCode();now+=600001;assert.throws(()=>auth.redeem(code.code,'Expired'),/expired/);
code=auth.newCode();for(let n=0;n<7;n++)assert.throws(()=>auth.redeem('INVALID','Bad'),/expired/);
assert.throws(()=>auth.redeem(code.code,'Throttled'),/Too many/);
now+=900001;code=auth.newCode();failSave=true;
assert.throws(()=>auth.redeem(code.code,'Disk failed'),/disk failure/);assert.equal(auth.list().length,0);
failSave=false;const token=auth.redeem(code.code,'Recovered');assert.equal(auth.list().length,1);
const request={headers:{cookie:'nexus_device='+token}};
failSave=true;assert.throws(()=>auth.revoke(auth.list()[0].id),/disk failure/);assert(auth.deviceFor(request));
failSave=false;assert.equal(auth.revoke(''),false);assert.equal(auth.revoke(auth.list()[0].id),true);assert.equal(auth.deviceFor(request),null);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'devices.json'),'utf8')),{});
console.log('PASS expired codes, eight-failure rate limit, pairing rollback, revoke rollback, safe device identifiers and atomic persisted revocation');
