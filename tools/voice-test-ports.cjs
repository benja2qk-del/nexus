'use strict';
// npm test includes older theme fixtures with literal ports. Remap only those
// fixture modules in memory so this voice branch never binds another run's port.
const Module=require('module'),path=require('path'),fs=require('fs');
const original=Module._extensions['.js'];
Module._extensions['.js']=function(module,file){
 const name=path.basename(file);
 if(path.dirname(file)===path.resolve('tools')&&['themes-api-checks.cjs','themes-test-preload.cjs'].includes(name)){
  module._compile(fs.readFileSync(file,'utf8').replaceAll('4791','4787'),file);return;
 }
 return original(module,file);
};
process.env.NEXUS_TEST_PORT='4787';process.env.NEXUS_ASR_DISABLED='1';process.env.NEXUS_TTS_PORT='4788';
