'use strict';
// Live load on the Spend page: CPU and memory for each running session (the agent and everything it started),
// sampled every two seconds while Spend is open. A working session that barely uses the PC is waiting for its model;
// one using a full core or more is held up by work on this PC.
const nxLoad={data:null,timer:null};
function nxLoadPoll(){
  clearTimeout(nxLoad.timer);nxLoad.timer=null;
  if(state.view!=='spend'||document.hidden)return;
  nxLoad.timer=setTimeout(nxLoadPoll,2000);
  fetch('/api/load',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(v=>{if(v&&state.view==='spend'){nxLoad.data=v;nxRenderLoad();}}).catch(()=>{});
}
function nxLoadSession(key){return state.byKey.get(key)||state.terms?.find(t=>'term:'+t.id===key);}
function nxLoadHint(s,l,cores){
  if(l.cpu==null)return ['','Measuring…'];
  const core=l.cpu*cores/100,working=s&&statusLabel(s)[0]==='busy';
  if(core>=1)return ['pc','Working on this PC'];
  if(working)return core<.25?['model','Waiting for the model']:['','Working'];
  return ['','Idle'];
}
function nxSparkPoints(history){
  const h=history.length>1?history:[0,...history,0],max=Math.max(10,...h),step=60/(h.length-1);
  return h.map((v,i)=>`${(i*step).toFixed(1)},${(19-v/max*17).toFixed(1)}`).join(' ');
}
const nxPercent=v=>v==null?'—':v.toFixed(v<10?1:0)+'%';
// The frame is rebuilt only when the set of sessions changes; numbers, bars and lines update in place so they glide.
function nxRenderLoad(){
  const box=$('#nxSpendLoad'),d=nxLoad.data;if(!box)return;
  const rows=d?Object.entries(d.sessions).map(([key,l])=>({key,l,s:nxLoadSession(key)})).sort((a,b)=>(b.l.cpu||0)-(a.l.cpu||0)||b.l.memory-a.l.memory):[];
  const sig=d?rows.map(r=>r.key).join('|')||'none':'wait';
  if(box.dataset.sig!==sig){
    box.dataset.sig=sig;box._html=undefined;
    const meter=(name,label)=>`<span data-meter="${name}"><small>${label}</small><b></b><i class="nx-load-bar"><i></i></i></span>`;
    box.innerHTML=`<h2>Live load<small>updates every 2 seconds</small></h2>`+(!d?'<p class="nx-load-empty">Measuring…</p>':`<div class="nx-load-machine">${meter('cpu','CPU')}${meter('memory','Memory')}</div><div class="nx-load-list">${rows.length?rows.map(({key,s})=>`<button class="nx-load-row" data-load="${esc(key)}" ${s?.kind?`data-open="${esc(key)}"`:'disabled'}><span class="nx-load-name">${s?.kind?nxAgent(s):''}<b>${esc(s?.title||'Terminal')}</b><small><i></i><span></span></small></span><svg class="nx-load-spark" viewBox="0 0 60 20" preserveAspectRatio="none" aria-hidden="true"><polygon/><polyline/></svg><span class="nx-load-num" data-cpu><b></b><small>CPU</small></span><span class="nx-load-num" data-mem><b></b><small></small></span></button>`).join(''):'<p class="nx-load-empty">No session is running right now.</p>'}</div>`);
  }
  if(!d)return;
  const set=(el,text)=>{if(el&&el.textContent!==text)el.textContent=text;},width=(el,pct)=>{if(el)el.style.width=Math.max(0,Math.min(100,pct))+'%';};
  const memPct=d.machine.memoryTotal?d.machine.memoryUsed/d.machine.memoryTotal*100:0;
  set(box.querySelector('[data-meter=cpu] b'),d.machine.cpu+'%');width(box.querySelector('[data-meter=cpu] .nx-load-bar>i'),d.machine.cpu);
  set(box.querySelector('[data-meter=memory] b'),(d.machine.memoryUsed/1e9).toFixed(1)+' / '+(d.machine.memoryTotal/1e9).toFixed(1)+' GB');width(box.querySelector('[data-meter=memory] .nx-load-bar>i'),memPct);
  for(const {key,l,s} of rows){
    const row=box.querySelector(`[data-load="${CSS.escape(key)}"]`);if(!row)continue;
    const [tone,hint]=nxLoadHint(s,l,d.cores),points=nxSparkPoints(l.history);
    row.dataset.tone=tone;set(row.querySelector('.nx-load-name small span'),hint);
    set(row.querySelector('[data-cpu] b'),nxPercent(l.cpu));set(row.querySelector('[data-mem] b'),bytes(l.memory));set(row.querySelector('[data-mem] small'),l.processes+(l.processes===1?' process':' processes'));
    row.querySelector('.nx-load-spark polyline').setAttribute('points',points);row.querySelector('.nx-load-spark polygon').setAttribute('points',`0,20 ${points} 60,20`);
  }
}
const nxLoadSpend=spendOverview;spendOverview=function(){
  nxLoadSpend.apply(this,arguments);if(state.view!=='spend')return;
  const stats=$('#nxSpendStats');if(stats&&!$('#nxSpendLoad'))stats.insertAdjacentHTML('afterend','<section class="nx-data-panel glass nx-load" id="nxSpendLoad"></section>');
  nxRenderLoad();if(!nxLoad.timer)nxLoadPoll();
};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.view==='spend'&&!nxLoad.timer)nxLoadPoll();});
