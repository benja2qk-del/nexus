'use strict';
// Test preload: intercept the native PTY boundary BEFORE terms.js loads. The
// production command is recorded, never executed. All model spawns are blocked.
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module');
const root = fs.realpathSync(process.env.NEXUS_ONECHAT_FIXTURE || '');
if (process.env.NEXUS_PORT !== '4791' || !root.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase() + path.sep) || !path.basename(root).startsWith('nexus-onechat-')) throw Error('Unsafe fixture preload');
const projects = path.join(root,'claude','projects');
const log = entry => fs.appendFileSync(path.join(root,'pty-log.jsonl'),JSON.stringify(entry)+'\n');
const nativeLoad = Module._load;
const exitedOnce = new Set();
const screens = require('./fixtures/onechat/screens.json');
const idle = fs.readFileSync(path.join(__dirname,'fixtures/onechat/fresh-session.raw'),'utf8');
Module._load = function(name, parent, main) {
  if (name !== '@lydell/node-pty') return nativeLoad.apply(this,arguments);
  return { spawn(file,args,options) {
    if (!path.resolve(options.cwd).toLowerCase().startsWith(root.toLowerCase()+path.sep)) throw Error('Fixture cwd required');
    log({type:'spawn',file,args,cwd:options.cwd});
    const id = args.at(-1), folder = path.join(projects,options.cwd.replace(/[^A-Za-z0-9]/g,'-'));
    const transcript = path.join(folder,id+'.jsonl');
    if (!fs.existsSync(transcript)) throw Error('Unknown fixture session');
    let data = () => {}, exit = () => {}, pasted = '', question = false, ended = false, selected = 1, busy = false;
    const append = record => fs.appendFileSync(transcript,JSON.stringify({timestamp:new Date().toISOString(),...record})+'\n');
    const clear = text => data('\x1b[2J\x1b[H'+text.replace(/\r?\n/g,'\r\n'));
    const trust = () => clear(selected === 1 ? screens.A : screens.A.replace(' ❯ No, exit','   No, exit').replace('   Yes, I trust',' ❯ Yes, I trust'));
    setTimeout(()=>{if(id==='onechat-trust'){question='trust';trust();}else data(idle);},1600);
    return { pid:process.pid,
      onData(fn){data=fn},onExit(fn){exit=fn},resize(){},kill(){ended=true;exit({exitCode:0})},
      write(value) {
        if(ended)throw Error('Ended fixture PTY');log({type:'write',value});
        if(question==='trust'){
          if(value==='\x1b[B'){selected=2;trust();}
          else if(value==='\x1b[A'){selected=1;trust();}
          else if(value==='\r' && selected===2){question=false;data(idle);append({type:'assistant',message:{content:[{type:'text',text:'The fixture folder was explicitly trusted.'}]}});}
          else if(value==='\r'||value==='\x1b'){ended=true;exit({exitCode:0});}
          else throw Error('Text was written into the trust prompt');
          return;
        }
        if(value.startsWith('\x1b[200~')){pasted=value.slice(6,-6);return;}
        if(question){
          if(value==='\r'||value==='\x1b'){question=false;append({type:'assistant',message:{content:[{type:'text',text:'Your answer was received. The preview remains a draft.'}]}});clear(screens.B);}
          return;
        }
        if(value!=='\r')return;
        const text=pasted;pasted='';
        if(text==='Start a long step'){
          busy=true;append({type:'user',message:{content:text}});clear('Working on the current step...\nEsc to interrupt');return;
        }
        if(busy){
          setTimeout(()=>{if(ended)return;busy=false;append({type:'user',message:{content:text}});append({type:'assistant',message:{content:[{type:'text',text:'The queued message was read after the current step.'}]}});clear(screens.B);},6500);return;
        }
        if(text==='Simulate exit' && !exitedOnce.has(id)){exitedOnce.add(id);ended=true;exit({exitCode:1});return;}
        if(text==='Simulate missing receipt'){clear(screens.B);return;}
        clear('Thinking...\r\nEsc to interrupt');
        setTimeout(()=>{
          if(ended)return;
          append({type:'user',cwd:options.cwd,message:{content:text}});
          append({type:'assistant',message:{content:[{type:'thinking',thinking:'Checking the requested release changes.'}]}});
          if(text==='Show a question'){
            question=true;clear('Do you want to publish this preview?\r\n❯ 1. Yes, publish the preview\r\n  2. No, keep the draft\r\nEnter to confirm · Esc to cancel');
          }else setTimeout(()=>{
            append({type:'assistant',message:{content:[{type:'text',text:'**Delivered through Chat.**\n\nThe fixture received your message and completed the check.'}]}});
            clear(screens.B);
          },700);
        },500);
      }
    };
  }};
};
const child = require('child_process');
child.spawn = child.exec = child.execFile = child.spawnSync = child.execFileSync = () => { throw Error('External process/model calls are disabled in the fixture server'); };
