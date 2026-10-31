'use strict';
// What every session NEXUS starts or resumes is told: Claude in its system prompt, Codex as developer instructions,
// Copilot through an instruction folder NEXUS owns. Always: what NEXUS's chat can show. With "Agents can hand work to
// each other" on: a short guide to giving tasks to the other installed agents. That switch is off by default and kept in
// NEXUS's settings file. Resumed sessions also skip permission prompts unless that is turned off, in the same file.
const fs=require('fs'),os=require('os'),path=require('path');
// Without it agents tell the owner that a page cannot be shown in the chat.
const CHAT=['NEXUS: the owner reads and answers this session in NEXUS, a dashboard for their agent sessions, on the PC or a phone.',
  '- Replies are shown as Markdown: headings, bold, lists, tables, code blocks and links render properly. Put figures in a table.',
  '- A full file path in a reply (C:\\...) becomes a link that opens the file on the PC.',
  '- To show a page (a chart, a mockup, a report), write a self-contained .html file inside the session folder and give its full path in the reply. NEXUS adds a Preview button that shows the page inside the chat, scripts included. When the owner asks for HTML in the chat, do this; do not say it cannot be shown.'
].join('\n');
const SKIP_PROMPTS={claude:'--dangerously-skip-permissions',copilot:'--yolo'};
const NAMES={claude:'Claude Code',astra:'Codex (called Astra in NEXUS)',copilot:'GitHub Copilot CLI'};
const CALLS={
  astra:'codex exec --sandbox workspace-write -C "<worktree>" - < "<brief.md>" > "<log>" 2>&1   (use --sandbox danger-full-access only if the owner allows it)',
  claude:'cd "<worktree>" && claude -p --permission-mode auto < "<brief.md>" > "<log>" 2>&1',
  copilot:'cd "<worktree>" && copilot -p "Read <brief.md> and do what it says." --allow-all-tools --add-dir "<folder of brief.md>" -s < /dev/null > "<log>" 2>&1   (each run uses Copilot premium requests)'
};
// The guide for one agent, naming only the other agents installed on this PC; '' when there is nobody to call.
function guide(self,installed){
  const others=['astra','claude','copilot'].filter(k=>k!==self&&installed[k]?.installed);
  if(!others.length)return '';
  return ['NEXUS: agents can hand work to each other (the owner turned this on).',
    'You may give a task to another coding agent on this PC, but only when the owner asks you to, or agrees after you suggest it. You stay responsible for the result.',
    '',
    'Agents you can call from your shell, in the background and without opening a window:',
    ...others.map(k=>'- '+NAMES[k]+': '+CALLS[k]),
    'In PowerShell, pipe instead of redirecting stdin: '+others.map(k=>({astra:'Get-Content "<brief.md>" -Raw | codex exec ... -',claude:'Get-Content "<brief.md>" -Raw | claude -p ...',copilot:'$null | copilot -p ...'})[k]).join('   or   '),
    '',
    'How to delegate well:',
    '1. One git worktree per helper (git worktree add ../<repo>-<helper> -b <helper>/<topic>). Never let two agents edit the same folder, and never the owner\'s main checkout.',
    '2. Put the task in a brief file: the goal, the files it may change, how to test, what not to touch, and "finish with a short report in <report.md>". Pass long briefs by file, never as one long argument.',
    '3. Always give stdin an end (the brief file or /dev/null); otherwise Codex waits forever. Never retry with resume or --continue; start a fresh run.',
    '4. Read the report and the diff yourself (helpers can claim more than they did), run the tests, then merge.',
    '5. Each run spends the owner\'s plan for that agent. Run at most two helpers at once and stop if one reports a usage limit. Never stop processes you did not start.'
  ].join('\n');
}
function stateDir(){return path.dirname(process.env.NEXUS_STATE_FILE||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'NexusDeck','state.json'));}
function createHandoff({dir=stateDir(),installed=()=>({}),codexHome=process.env.NEXUS_CODEX_DIR||process.env.CODEX_HOME||path.join(os.homedir(),'.codex')}={}){
  const file=path.join(dir,'settings.json'),folder=path.join(dir,'handoff');
  let settings={};try{settings=JSON.parse(fs.readFileSync(file,'utf8'))||{};}catch{}
  const enabled=()=>settings.handoff===true;
  const fullAccess=()=>settings.fullAccess!==false;
  function save(patch){
    settings={...settings,...patch};
    fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(settings,null,2));fs.renameSync(file+'.tmp',file);
  }
  function set(on){save({handoff:!!on});return enabled();}
  function setFullAccess(on){save({fullAccess:!!on});return fullAccess();}
  const resumeArgs=kind=>fullAccess()&&SKIP_PROMPTS[kind]?[SKIP_PROMPTS[kind]]:[];
  function withResumeArgs(spec){
    const key=spec.kind==='copilot'?'copilotArgs':'claudeArgs',args=spec[key]||[];
    return args.includes('--resume')?{...spec,[key]:[...args,...resumeArgs(spec.kind)]}:spec;
  }
  // Codex has one developer_instructions value; a user's own setting in config.toml is never replaced.
  function codexHasOwn(){try{return /^\s*developer_instructions\s*=/m.test(fs.readFileSync(path.join(codexHome,'config.toml'),'utf8'));}catch{return false;}}
  function guides(spec){
    const text=[CHAT,enabled()?guide(spec.kind,installed()):''].filter(Boolean).join('\n\n');
    if(spec.kind==='claude'){
      const args=[...(spec.claudeArgs||[])],at=args.indexOf('--append-system-prompt');
      if(at>=0&&at+1<args.length)args[at+1]+='\n\n'+text;else args.push('--append-system-prompt',text);
      return {...spec,claudeArgs:args};
    }
    if(spec.kind==='astra'){
      if(codexHasOwn())return spec;
      return {...spec,codexArgs:['-c','developer_instructions='+JSON.stringify(text),...(spec.codexArgs||[])]};
    }
    if(spec.kind==='copilot'){
      if(folder.includes(','))return spec;
      fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'AGENTS.md'),text+'\n');
      const env={...spec.env},dirs=[env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS||process.env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS,folder].filter(Boolean);
      return {...spec,env:{...env,COPILOT_CUSTOM_INSTRUCTIONS_DIRS:dirs.join(',')}};
    }
    return spec;
  }
  return {enabled,set,fullAccess,setFullAccess,resumeArgs,apply:spec=>guides(withResumeArgs(spec)),view:()=>({handoff:enabled(),fullAccess:fullAccess()})};
}
module.exports={createHandoff,guide,CHAT};
