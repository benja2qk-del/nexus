(function(root) {
  'use strict';
  const labels = { 'gpt-5.5':'GPT-5.5', 'gpt-5.5-codex':'GPT-5.5 Codex', 'gpt-5.4-mini':'GPT-5.4 mini', 'gpt-6-astra':'GPT-6 Astra', 'claude-opus-5-5':'Opus 5.5', 'claude-sonnet-5-5':'Sonnet 5.5', 'claude-haiku-5-5':'Haiku 5.5', 'claude-haiku-4-5-20251001':'Haiku 4.5', 'claude-fable-5':'Fable 5', 'claude-fable-5-1':'Fable 5.1' };
  function modelLabel(id) {
    if(!id)return '';
    if(labels[id])return labels[id];
    const known=String(id).replace(/^claude-/i,'')
      .replace(/^(opus|sonnet|haiku|fable)(?:-(\d+(?:\.\d+)?)(?:-(\d{1,2}))?)?(?:-\d{8})?(-fast)?$/i,(_,name,a,b,fast)=>name[0].toUpperCase()+name.slice(1).toLowerCase()+(a?' '+a:'')+(b?'.'+b:'')+(fast?' Fast':''))
      .replace(/^gpt-/i,'GPT-').replace(/-(mini|nano|codex|astra|terra|luna|sol)$/i,(_,suffix)=>' '+(['mini','nano'].includes(suffix.toLowerCase())?suffix.toLowerCase():suffix[0].toUpperCase()+suffix.slice(1).toLowerCase()));
    if(known!==id||!/^[a-z][a-z0-9.-]*$/.test(id))return known;
    // Other providers' IDs (gemini-3.8-flash, grok-4.7, kimi-k3, mai-code-1.1-flash, auto): title case each word.
    return id.split('-').map(w=>/^\d/.test(w)?w:w.length<=3&&!/\d/.test(w)&&w!=='pro'?w.toUpperCase():w[0].toUpperCase()+w.slice(1)).join(' ');
  }
  function wordLimit(text,max=140) {
    if(text.length<=max)return text;
    if(max<1)return '';
    const fragment=text.slice(0,max-1),boundary=/\s/.test(text[max-1]||'')?fragment:fragment.replace(/\s*\S+$/,'');
    return boundary.trimEnd()+'…';
  }
  function plainSummary(markdown,max=140) {
    const lines=String(markdown||'').replace(/^ASTRA RESULT:\s*[^|]+\|\s*([^|\n]+).*$/im,'$1').replace(/(?:```|~~~)[\s\S]*?(?:(?:```|~~~)|$)/g,'\n').split(/\r?\n/),table=new Set();
    for(let i=1;i<lines.length;i++)if(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i])){table.add(i-1);table.add(i);for(let j=i+1;j<lines.length&&lines[j].includes('|');j++)table.add(j);}
    const text=lines.filter((line,i)=>!table.has(i)&&!/^\s*(?:#{1,6}\s|\||>|(?:[-*_=]\s*){3,}$)/.test(line)&&!/^\s*(?:={3,}|-{3,})\s*$/.test(lines[i+1]||''))
      .map(line=>line.replace(/^\s*(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/,''))
      .join(' ').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
      .replace(/<[^>]+>/g,'').replace(/(?:\*\*|__|~~|[*`_])/g,'').replace(/\s+/g,' ').trim();
    const first=text.match(/^.+?[.!?](?=\s|$)/)?.[0]||text;
    return wordLimit(first,max);
  }
  const known=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
  function usageValues(value={}) {
    const usage=value.insights?.spend||value.copilotUsage||value;
    const cost=usage.costUSD??usage.costUsd??value.costUSD??value.costUsd;
    const total=usage.total??usage.tokens??value.tokens;
    return {cost:known(cost)?cost:null,tokens:known(total)&&usage.measured!==false?total:null};
  }
  function tokenText(value){return value>=1e6?Number((value/1e6).toFixed(2))+'M':value>=1e3?Number((value/1e3).toFixed(2))+'K':String(value);}
  function usageText(value){const u=usageValues(value);return u.cost!==null?'$'+u.cost.toFixed(2):u.tokens!==null?tokenText(u.tokens)+' tokens':'';}
  function spendText(value){const u=usageValues(value);return [u.cost!==null?'$'+u.cost.toFixed(2)+' cost':'',u.tokens!==null?tokenText(u.tokens)+' tokens':''].filter(Boolean).join(' / ');}
  const messageText=text=>String(text||'').replace(/[\p{P}\s]+$/gu,'');
  function duplicateUser(previous,current){
    const a=typeof previous?.ts==='number'?previous.ts:Date.parse(previous?.ts),b=typeof current?.ts==='number'?current.ts:Date.parse(current?.ts);
    return previous?.t==='user'&&current?.t==='user'&&!!messageText(current.text)&&messageText(previous.text)===messageText(current.text)&&Number.isFinite(a)&&Number.isFinite(b)&&b>=a&&b-a<=120000;
  }
  function dedupeUsers(events){let previous;return events.filter(e=>{if(e.t!=='user')return true;const duplicate=duplicateUser(previous,e);previous=e;return !duplicate;});}
  function dedupeMirrors(events){
    const responses=new Map();for(const e of events)if(!e.mirror){const key=e.t+':'+messageText(e.text);if(!responses.has(key))responses.set(key,[]);responses.get(key).push(e);}
    return events.filter(e=>!e.mirror||!(responses.get(e.t+':'+messageText(e.text))||[]).some(r=>{const a=Date.parse(e.ts),b=Date.parse(r.ts);return Number.isFinite(a)&&Number.isFinite(b)?Math.abs(a-b)<=120000:e.ts===r.ts;}));
  }
  function filterCommands(commands, query) {
    const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter(c=>words.every(w=>[c.label,c.hint,c.group,c.search].filter(Boolean).join(' ').toLowerCase().includes(w)));
  }
  const api = {modelLabel,modelDisplayName:modelLabel,plainSummary,wordLimit,usageValues,usageText,spendText,messageText,duplicateUser,dedupeUsers,dedupeMirrors,filterCommands};
  if(typeof module==='object')module.exports=api; else root.NexusDesign=api;
})(typeof window==='object'?window:globalThis);
