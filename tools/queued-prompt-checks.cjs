// A message typed while Claude is busy is recorded as a queued_command attachment, not a user record. NEXUS must
// still see it as the owner's message: in the chat, as the session's last prompt, and as delivery evidence.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-queued-')),port='4788',cwd=path.join(root,'project'),id='5426c80f-5821-46c8-abac-2862fa117fc6';
const project=path.join(root,'claude','projects',cwd.replace(/[^A-Za-z0-9]/g,'-'));
for(const d of [cwd,project,path.join(root,'codex','sessions')])fs.mkdirSync(d,{recursive:true});
const at=n=>new Date(Date.now()-60e3+n*1000).toISOString(),queued='Also show the ratio of the last two numbers.';
const rows=[
  {type:'user',cwd,sessionId:id,timestamp:at(0),message:{role:'user',content:'Add a speed slider.'}},
  {type:'assistant',cwd,sessionId:id,timestamp:at(1),message:{role:'assistant',model:'claude-haiku-5-5',content:[{type:'tool_use',id:'t1',name:'Edit',input:{file_path:path.join(cwd,'fib.html'),old_string:'a',new_string:'b'}}]}},
  {type:'queue-operation',operation:'enqueue',timestamp:at(2),content:queued},
  {type:'user',cwd,sessionId:id,timestamp:at(3),message:{role:'user',content:[{type:'tool_result',tool_use_id:'t1',content:'ok'}]}},
  {type:'queue-operation',operation:'remove',timestamp:at(4),content:queued},
  {type:'attachment',cwd,sessionId:id,timestamp:at(4),attachment:{type:'queued_command',prompt:queued,commandMode:'prompt',origin:{kind:'human'},timestamp:at(4),humanTurn:true}},
  {type:'attachment',cwd,sessionId:id,timestamp:at(4),attachment:{type:'queued_command',prompt:'hook text',commandMode:'prompt',origin:{kind:'hook'},timestamp:at(4)}},
  {type:'assistant',cwd,sessionId:id,timestamp:at(5),message:{role:'assistant',model:'claude-haiku-5-5',content:[{type:'text',text:'Added the slider and the ratio.'}]}}
];
fs.writeFileSync(path.join(project,id+'.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
fs.writeFileSync(path.join(root,'config.json'),'{}');
fs.mkdirSync(path.join(cwd,'assets'));fs.writeFileSync(path.join(cwd,'fib.html'),'<h1>fib</h1>');fs.writeFileSync(path.join(cwd,'assets','app.js'),'1');fs.writeFileSync(path.join(cwd,'run.bat'),'echo');fs.writeFileSync(path.join(root,'secret.html'),'no');
const env={...process.env,NEXUS_PORT:port,NEXUS_NO_ACCOUNT_POLL:'1',NEXUS_CLAUDE_DIR:path.join(root,'claude'),NEXUS_CODEX_DIR:path.join(root,'codex'),NEXUS_COPILOT_DIR:path.join(root,'copilot'),NEXUS_STATE_FILE:path.join(root,'state.json'),NEXUS_CONFIG_FILE:path.join(root,'config.json'),NEXUS_DEVICES_FILE:path.join(root,'devices.json')};
const server=spawn(process.execPath,['server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
(async()=>{try{
  await new Promise((r,j)=>{const t=setTimeout(()=>j(Error('Server start timed out')),15000);server.stdout.on('data',d=>{if(String(d).includes(':'+port+'/')){clearTimeout(t);r();}});server.once('exit',c=>j(Error('Server exited '+c)));});
  const get=async p=>(await fetch('http://127.0.0.1:'+port+p,{headers:{'X-Nexus':'1'}})).json();
  const s=(await get('/api/sessions')).sessions.find(x=>x.id===id);
  assert.equal(s.lastPrompt,queued,'a queued message is the session\'s last prompt');
  const users=(await get('/api/chat?key=claude:'+id)).events.filter(e=>e.t==='user').map(e=>e.text);
  assert.deepEqual(users,['Add a speed slider.',queued],'the queued message shows in the chat as the owner\'s; hook text does not');
  // Previews come only from the session folder, sandboxed, and only for page types.
  const page=await fetch('http://127.0.0.1:'+port+'/preview/'+encodeURIComponent('claude:'+id)+'/fib.html');
  assert.equal(page.status,200);assert.equal(await page.text(),'<h1>fib</h1>');assert.match(page.headers.get('content-security-policy'),/^sandbox allow-scripts/);
  assert.equal((await fetch('http://127.0.0.1:'+port+'/preview/'+encodeURIComponent('claude:'+id)+'/assets/app.js')).status,200,'pages can load their own files');
  for(const bad of ['/'+encodeURIComponent('..')+'/secret.html','/..%5Csecret.html','/run.bat','/missing.html'])assert.equal((await fetch('http://127.0.0.1:'+port+'/preview/'+encodeURIComponent('claude:'+id)+bad)).status,404,bad+' is not served');
  assert.equal((await fetch('http://127.0.0.1:'+port+'/preview/'+encodeURIComponent('claude:nope')+'/fib.html')).status,404,'unknown sessions serve nothing');
  console.log('PASS previews: session folder only, sandboxed, page types only');
  console.log('PASS queued Claude messages count as the owner\'s: chat, last prompt and delivery evidence');
}catch(e){console.error(e);process.exitCode=1;}finally{server.kill();setTimeout(()=>fs.rmSync(root,{recursive:true,force:true}),300);}})();
