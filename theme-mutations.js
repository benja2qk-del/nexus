'use strict';
const {randomUUID}=require('crypto');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const maps=s=>({themes:Object.fromEntries(s.themes.map(t=>[t.id,t])),assignments:s.assignments,folders:s.folders});
class ThemeMutations{
 constructor(themes,{now=Date.now}={}){this.themes=themes;this.now=now;this.undo=new Map();}
 run(operation){
  const before=structuredClone(this.themes.state),result=operation(),after=this.themes.state,changes=[];
  const a=maps(before),b=maps(after);
  for(const name of Object.keys(a))for(const key of new Set([...Object.keys(a[name]),...Object.keys(b[name])]))if(!equal(a[name][key],b[name][key]))changes.push({name,key,before:a[name][key],after:structuredClone(b[name][key])});
  const undoToken=randomUUID();this.undo.set(undoToken,{changes,expires:this.now()+30000,inherited:before.inherited||{},afterInherited:structuredClone(after.inherited||{})});
  for(const[id,u]of this.undo)if(u.expires<this.now())this.undo.delete(id);
  return {result,undoToken};
 }
 restore(token){
  const u=this.undo.get(token);if(!u||u.expires<this.now())throw Error('Undo expired.');
  const next=structuredClone(this.themes.state),data=maps(next);
  for(const c of u.changes)if(!equal(data[c.name][c.key],c.after))throw Error('This theme changed again. Refresh before reorganizing it.');
  for(const c of u.changes){if(c.before===undefined)delete data[c.name][c.key];else data[c.name][c.key]=c.before;}
  next.themes=Object.values(data.themes);
  for(const[k,h]of Object.entries(u.inherited))if(h.id!==u.afterInherited[k]?.id&&next.inherited?.[k]?.id===u.afterInherited[k]?.id)next.inherited[k]={...next.inherited[k],id:h.id};
  // Do not restore a deleted theme over newly made assignments into it.
  const ids=new Set(next.themes.map(t=>t.id));if(Object.values(next.assignments).some(a=>a.themeId&&!ids.has(a.themeId)))throw Error('Sessions moved into this theme. Move them out before undoing its creation.');
  this.themes.save(next);this.undo.delete(token);return {restored:true};
 }
}
module.exports={ThemeMutations};
