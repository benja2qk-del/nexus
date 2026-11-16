'use strict';
// What the client draws matches what happened: repeated messages, file and command names, list numbers, list status, file links.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),design=require('../public/redesign-core'),language=require('../public/activity-language');
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8'),slice=(from,to)=>app.slice(app.indexOf(from),app.indexOf(to));

{const user=(text,ms)=>({t:'user',text,ts:new Date(1700000000000+ms).toISOString()}),shown=events=>design.dedupeUsers(events).map(e=>e.t+':'+e.text);
  assert.deepEqual(shown([user('yes',0),{t:'ai',text:'Run it now?'},user('yes',20000),{t:'ai',text:'Done.'}]),['user:yes','ai:Run it now?','user:yes','ai:Done.'],'the same answer after a reply was sent again');
  assert.deepEqual(shown([user('continue',0),{t:'tool',name:'Bash',text:'npm test'},{t:'result',text:'ok'},user('continue',5000)]),['user:continue','tool:npm test','result:ok','user:continue'],'tool work between two messages keeps both');
  assert.deepEqual(shown([user('Please review this.',0),user('Please review this',1500),{t:'ai',text:'Reviewing.'}]),['user:Please review this.','ai:Reviewing.'],'a back-to-back double delivery is still one message');
  assert.deepEqual(shown([user('yes',0),{t:'note',text:'context compacted'},user('yes',3000)]),['user:yes','note:context compacted','user:yes'],'anything in between separates two sends');
  console.log('PASS repeated messages: only back-to-back copies merge, a message sent again after a reply or tool work is shown');}

{const edit=file=>language.describe([language.tool('Edit',{file_path:file})]),read=file=>language.describe([language.tool('Read',{file_path:file})]);
  assert.equal(edit('C:\\fixture\\src\\message_queue.js'),'Edited message_queue.js');
  assert.equal(read('C:/fixture/pkg/__init__.py'),'Read __init__.py');
  assert.equal(language.groups([{name:'Edit',input:{file_path:'C:\\fixture\\my_lib\\a.js'}},{name:'Write',input:{file_path:'C:\\fixture\\my_lib\\b.js'}}])[0],'Edited 2 files in my_lib/');
  assert.equal(language.step({name:'Bash',text:'node tools/telemetry_checks.cjs --max_old_space=4\nmore'}),'node tools/telemetry_checks.cjs --max_old_space=4');
  assert.equal(language.step({name:'Bash',text:'cd C:\\fixture\\My Project && node tools/run_all.cjs'}),'cd C:\\fixture\\My Project && node tools/run_all.cjs','a command is shown as it was run');
  assert.equal(language.step({human:language.tool('Bash',{command:'x',description:'Run test_*.py with --dry_run'})}),'Run test_*.py with --dry_run');
  assert.equal(language.readable('I wrote C:\\out\\report.md (see docs/plan.md)'),'I wrote report.md (see docs/plan.md)','a path ends at its file name');
  assert.equal(language.readable('**Renamed** `get_user_name` to _fetch_user_name_ in app_config.json'),'Renamed get_user_name to fetch_user_name in app_config.json');
  assert.equal(language.unmark('**The `x_y` button** and *src/*.js* stay'),'The x_y button and src/*.js stay');
  assert.equal(language.unmark('2*3*4 and a * b'),'2*3*4 and a * b');
  // A glob's star never pairs with emphasis later on the line, or on a later line once a summary joins them.
  assert.equal(language.readable('Run test_*.py and check *important* now'),'Run test_*.py and check important now');
  assert.equal(language.unmark('Files test_*.py, *_spec.js and **all** checks pass.'),'Files test_*.py, *_spec.js and all checks pass.');
  assert.equal(language.unmark('glob **/*.md matched *three* files'),'glob **/*.md matched three files');
  assert.equal(design.plainSummary('Run test_*.py now; this is **really** important.'),'Run test_*.py now; this is really important.');
  assert.equal(design.plainSummary('Run test_*.py\nThis is **really** important'),'Run test_*.py This is really important');
  assert.equal(language.unmark('**_Both_** and ***all*** go'),'Both and all go','nested marks still go');
  assert.equal(design.plainSummary('Updated `session_preview.js` and MAX_RETRY_COUNT. Next.'),'Updated session_preview.js and MAX_RETRY_COUNT.');
  assert.equal(design.plainSummary('Keep it when ratio < 0.5 and count > 10.'),'Keep it when ratio < 0.5 and count > 10.');
  assert.equal(design.plainSummary('<b>Bold</b> ~~old~~ __init__.py is **ready**.'),'Bold old __init__.py is ready.');
  console.log('PASS file names, commands and identifiers keep their underscores and stars; only markdown marks and tags are removed');}

{const ctx=vm.createContext({esc});vm.runInContext(slice('function md(src)','// ---------------- toasts'),ctx);
  const numbers=html=>[...html.matchAll(/<ol(?: start="(\d+)")?>([\s\S]*?)<\/ol>/g)].flatMap(m=>[...m[2].matchAll(/<li>/g)].map((_,i)=>(+(m[1]||1))+i));
  assert.deepEqual(numbers(ctx.md('1. **Keep** the cache\n   It is faster.\n2. **Drop** the cache\n   It is simpler.\n3. **Ask** later')),[1,2,3]);
  assert.deepEqual(numbers(ctx.md('1. First\n   - detail\n2. Second\n```\ncode\n```\n3. Third')),[1,2,3]);
  assert.deepEqual(numbers(ctx.md('3. third\n4. fourth')),[3,4]);
  assert.equal(ctx.md('1. a\n2. b'),'<ol><li>a</li><li>b</li></ol>');
  console.log('PASS numbered lists keep their written numbers across continuation lines, sub-bullets and code');}

{const label=(view,sel,chat,row)=>{const ctx=vm.createContext({keyOf:s=>s.kind+':'+s.id,termViews:new Map(),document:{hidden:false},chats:new Map(chat?[['claude:a',chat]]:[]),
    state:{ready:new Set(row.newReply?['claude:a']:[]),terms:[],view,tab:'chat',sel,byKey:new Map()}});vm.runInContext(slice('function statusLabel(s)','function cardHTML'),ctx);ctx.s={kind:'claude',id:'a',live:true,...row};return [...vm.runInContext('statusLabel(s)',ctx)];};
  assert.deepEqual(label('home','claude:a',{terminal:{busy:true}},{status:'idle',newReply:true}),['done','New reply'],'a chat left while working does not keep saying Working');
  assert.deepEqual(label('focus','claude:b',{terminal:{ready:true}},{status:'busy'}),['busy','Working'],'a chat left idle shows the list status');
  assert.deepEqual(label('home','claude:a',{terminal:{prompt:{text:'Allow?'}}},{status:'busy'}),['busy','Working'],'an answered question elsewhere is not still Needs you');
  assert.deepEqual(label('focus','claude:a',{terminal:{prompt:{text:'Allow?'}}},{status:'busy'}),['ready','Needs you'],'the chat on screen still reads its own terminal');
  assert.deepEqual(label('focus','claude:a',{terminal:{busy:true}},{status:'idle'}),['busy','Working']);
  console.log('PASS list status: a chat\'s cached terminal state counts only while that chat is on screen');}

{const ctx={esc,blockHTML:b=>b.html,renderReadableChat(){},document:{addEventListener(){}},state:{},$:()=>null,console};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'public/paths-ui.js'),'utf8'),ctx);
  const links=(html,s)=>[...ctx.nxLinkPaths(html,s).matchAll(/data-path="([^"]+)"/g)].map(m=>m[1]),s={cwd:'C:\\fixture\\proj'};
  assert.deepEqual(links('<p><code>console.log</code> <code>Date.now</code> <code>e.target</code> <strong>state.sel</strong></p>',s),[],'identifiers are not files');
  assert.deepEqual(links('<p><code>app.js</code> <code>package.json</code> <strong>notes/plan.md</strong></p>',s),['C:\\fixture\\proj\\app.js','C:\\fixture\\proj\\package.json','C:\\fixture\\proj\\notes\\plan.md']);
  assert.deepEqual(links('<p><code>server.log</code></p>',{...s,touchedFiles:['server.log']}),['C:\\fixture\\proj\\server.log'],'a file the session touched is linked whatever its type');
  // Logs, lock files, Gradle scripts and Godot shaders are files; a well-known object's member is code whatever it ends with.
  assert.deepEqual(links('<p><code>error.log</code> <code>yarn.lock</code> <code>build.gradle.kts</code> <strong>player.gdshader</strong> <code>icon.svg.import</code></p>',s),
    ['C:\\fixture\\proj\\error.log','C:\\fixture\\proj\\yarn.lock','C:\\fixture\\proj\\build.gradle.kts','C:\\fixture\\proj\\player.gdshader','C:\\fixture\\proj\\icon.svg.import']);
  assert.deepEqual(links('<p><code>console.log</code> <code>res.json</code> <code>process.env</code> <code>this.lock</code></p>',s),[],'members of well-known objects are not files');
  console.log('PASS answer links: bare names link only with a file type\'s extension or when the session touched them');}

// F31: a Codex run's request is usually a brief another agent wrote; the theme row does not call it theirs.
{const ui=fs.readFileSync(path.join(root,'public/themes-ui.js'),'utf8'),ctx=vm.createContext({NexusDesign:design,NexusActivity:language,statusLabel:()=>['done','Done'],agentName:k=>({codex:'Codex',claude:'Claude'})[k],sessionPreview:()=>'preview'});
  vm.runInContext(ui.slice(ui.indexOf('function nxGist('),ui.indexOf('function nxSessionRow(')),ctx);
  assert.match(ctx.nxExchange({kind:'codex',commission:'Refactor the parser for nested quotes',lastText:'Refactored it.'}),/^Request: Refactor the parser.* · Codex: Refactored it/);
  assert.match(ctx.nxExchange({kind:'claude',lastPrompt:'Refactor the parser for nested quotes',lastText:'Refactored it.'}),/^You: Refactor the parser.* · Claude: Refactored it/);
  console.log('PASS a theme row heads a Codex request "Request:", as the chat does, and keeps "You:" for what they typed');}
