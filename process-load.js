'use strict';
// CPU and memory per live session for the Spend page. A session's load is its whole process tree: the agent and
// everything it started (builds, tests, servers). One hidden PowerShell process samples the trees while someone
// is looking and exits 15 seconds after the last look, so NEXUS costs nothing here otherwise.
const os=require('os'),{spawn}=require('child_process');
const SCRIPT=String.raw`$ErrorActionPreference='SilentlyContinue';$ProgressPreference='SilentlyContinue'
$parents=@{};$mapAt=[datetime]::MinValue
while($true){
 $line=[Console]::In.ReadLine();if($line -eq $null){break}
 $roots=$line.Split(' ',[StringSplitOptions]::RemoveEmptyEntries)
 if(((Get-Date)-$mapAt).TotalSeconds -ge 10){$parents=@{};foreach($p in (Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId)){$parents[[int]$p.ProcessId]=[int]$p.ParentProcessId};$mapAt=Get-Date}
 $kids=@{};foreach($k in $parents.Keys){$pp=$parents[$k];if($pp -ne $k){if(-not $kids.ContainsKey($pp)){$kids[$pp]=New-Object System.Collections.ArrayList};[void]$kids[$pp].Add($k)}}
 $out=@{}
 foreach($r in $roots){
  $todo=New-Object System.Collections.Stack;$todo.Push([int]$r);$seen=@{};$cpu=0.0;$mem=[long]0;$n=0
  while($todo.Count -gt 0){$id=$todo.Pop();if($seen.ContainsKey($id)){continue};$seen[$id]=1
   try{$p=[System.Diagnostics.Process]::GetProcessById($id);$cpu+=$p.TotalProcessorTime.TotalMilliseconds;$mem+=$p.WorkingSet64;$n++}catch{}
   if($kids.ContainsKey($id)){foreach($c in $kids[$id]){$todo.Push($c)}}}
  $out[[string]$r]=@{cpu=$cpu;mem=$mem;n=$n}}
 [Console]::Out.WriteLine((ConvertTo-Json $out -Compress));[Console]::Out.Flush()
}`;
const HISTORY=30;
function machineTimes(){return os.cpus().reduce((t,c)=>{const v=c.times;t.busy+=v.user+v.nice+v.sys+v.irq;t.all+=v.user+v.nice+v.sys+v.irq+v.idle;return t;},{busy:0,all:0});}
function createLoad({spawnProcess=spawn,idle=15e3,now=Date.now,cores=os.cpus().length||1,memory=()=>({total:os.totalmem(),free:os.freemem()}),times=machineTimes}={}){
  let child=null,buffer='',reply=null,stopTimer=null,inflight=null,last=null,machinePrev=times();
  const prev=new Map(),history=new Map();
  function stop(){clearTimeout(stopTimer);if(child){try{child.stdin.end();}catch{}child=null;}}
  function ensure(){
    if(child)return;
    child=spawnProcess('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(SCRIPT,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    const mine=child;buffer='';
    mine.stdout.on('data',b=>{buffer+=b;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);if(line&&reply){const r=reply;reply=null;r(line);}}});
    mine.on('error',()=>{if(child===mine)child=null;reply?.(null);reply=null;});
    mine.on('exit',()=>{if(child===mine)child=null;reply?.(null);reply=null;});
  }
  function ask(pids){return new Promise(resolve=>{
    ensure();if(!child)return resolve(null);
    const timer=setTimeout(()=>{reply=null;resolve(null);},5000);
    reply=line=>{clearTimeout(timer);resolve(line);};
    try{child.stdin.write(pids.filter(Number.isInteger).join(' ')+'\n');}catch{clearTimeout(timer);reply=null;resolve(null);}
  });}
  // roots: [{key, pid}] for sessions with a live process. Returns per-session CPU (% of the whole PC), memory and history.
  async function measure(roots){
    const at=now(),line=await ask([...new Set(roots.map(r=>r.pid))]);
    let raw={};try{raw=line?JSON.parse(line):{};}catch{}
    const m=times(),machineCpu=m.all>machinePrev.all?Math.round((m.busy-machinePrev.busy)/(m.all-machinePrev.all)*100):0;machinePrev=m;
    const sessions={};
    for(const {key,pid} of roots){
      const r=raw[String(pid)];if(!r||!r.n)continue;
      const before=prev.get(key),cpu=before&&before.pid===pid&&at>before.at?Math.max(0,Math.min(100,(r.cpu-before.cpu)/((at-before.at)*cores)*100)):null;
      prev.set(key,{pid,cpu:r.cpu,at});
      const h=history.get(key)||[];if(cpu!=null){h.push(Math.round(cpu*10)/10);if(h.length>HISTORY)h.shift();}history.set(key,h);
      sessions[key]={cpu:cpu==null?null:Math.round(cpu*10)/10,memory:r.mem,processes:r.n,history:[...h]};
    }
    for(const key of [...prev.keys()])if(!sessions[key]){prev.delete(key);history.delete(key);}
    const mem=memory();
    return {at,cores,machine:{cpu:machineCpu,memoryUsed:mem.total-mem.free,memoryTotal:mem.total},sessions};
  }
  // Callers share one sample per 1.5 seconds; the sampler stops when nobody has asked for a while.
  async function sample(roots){
    clearTimeout(stopTimer);stopTimer=setTimeout(stop,idle);stopTimer.unref?.();
    if(last&&now()-last.at<1500)return last;
    if(!inflight)inflight=measure(roots).then(v=>(last=v)).finally(()=>{inflight=null;});
    return inflight;
  }
  return {sample,stop,running:()=>!!child};
}
module.exports={createLoad,SCRIPT};
