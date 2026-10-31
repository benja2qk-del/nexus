'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
function fixture(port='4791') {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-voice-'));
  const cwd=path.join(root,'project'),claude=path.join(root,'claude'),codex=path.join(root,'codex');
  fs.mkdirSync(cwd);fs.mkdirSync(path.join(codex,'sessions'),{recursive:true});
  const project=path.join(claude,'projects',cwd.replace(/[^A-Za-z0-9]/g,'-'));fs.mkdirSync(project,{recursive:true});
  const ts=new Date().toISOString(),user='Check the release notes and tell me what is ready.';
  fs.writeFileSync(path.join(project,'voice-claude.jsonl'),[
    {type:'user',cwd,message:{content:user}},
    {type:'custom-title',customTitle:'Release notes · phone conversation'},
    {type:'assistant',message:{content:[{type:'thinking',thinking:'I will check the recorded release notes.'}]}},
    {type:'assistant',message:{content:[{type:'text',text:'The release notes are ready.\n\nThe phone checks passed. Send your next direction whenever you are ready.'}]}}
  ].map(r=>JSON.stringify({timestamp:ts,...r})).join('\n')+'\n');
  fs.writeFileSync(path.join(codex,'sessions','rollout-voice-astra.jsonl'),[
    {type:'session_meta',payload:{id:'voice-astra',cwd}},
    {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Review the phone conversation.'}]}},
    {type:'event_msg',payload:{type:'agent_message',message:'Astra validation passed. The phone layout is ready for review.'}},
    {type:'event_msg',payload:{type:'task_complete'}}
  ].map(r=>JSON.stringify({timestamp:ts,...r})).join('\n')+'\n');
  fs.writeFileSync(path.join(root,'stub-model'),'fixture');fs.writeFileSync(path.join(root,'utterance.txt'),'Reply with the word okay.');
  fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({remoteHost:'nexus.example.ts.net',remoteUser:'tester@example.test'}));
  const token='voice-fixture-device-token-0000001';
  fs.writeFileSync(path.join(root,'devices.json'),JSON.stringify({[crypto.createHash('sha256').update(token).digest('hex')]:{name:'Fixture phone',created:Date.now(),lastSeen:Date.now()}}));
  const env={...process.env,NEXUS_PORT:port,NEXUS_NO_ACCOUNT_POLL:'1',NEXUS_CLAUDE_DIR:claude,NEXUS_CODEX_DIR:codex,NEXUS_STATE_FILE:path.join(root,'state.json'),NEXUS_DEVICES_FILE:path.join(root,'devices.json'),NEXUS_UPLOAD_DIR:path.join(root,'uploads'),NEXUS_VOICE_FIXTURE:root};
  env.NEXUS_CONFIG_FILE=path.join(root,'config.json');env.NEXUS_COPILOT_DIR=path.join(root,'missing-copilot');
  return {root,cwd,env,token};
}
function cleanup(root) {
  const target=fs.realpathSync(root),parent=fs.realpathSync(os.tmpdir());
  if(!target.toLowerCase().startsWith(parent.toLowerCase()+path.sep)||!path.basename(target).startsWith('nexus-voice-'))throw Error('Unsafe cleanup');
  fs.rmSync(target,{recursive:true,force:true});
}
module.exports={fixture,cleanup};
