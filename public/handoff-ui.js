'use strict';
// "Agents can hand work to each other": one NEXUS setting, switched from Settings > Agents, Commands or /handoff.
// It applies when a session starts or resumes in NEXUS.
function nxHandoffSetting(){
  const on=!!state.settings?.handoff;
  return `<div class="glass nx-notifications"><label><span><strong>Agents can hand work to each other</strong><small>Sessions started in NEXUS learn how to give tasks to your other installed agents. They only do it when you ask.</small></span><input type="checkbox" role="switch" data-nx-handoff ${on?'checked':''}></label></div><p class="nx-coverage">Applies when a session starts or resumes. You can also type /handoff in a session or use Commands.</p>`;
}
function nxFullAccessSetting(){
  return `<div class="glass nx-notifications"><label><span><strong>Resume without permission prompts</strong><small>Claude resumes with --dangerously-skip-permissions and Copilot with --yolo, so they act without asking you first.</small></span><input type="checkbox" role="switch" data-nx-full-access ${state.settings?.fullAccess!==false?'checked':''}></label></div><p class="nx-coverage">Applies the next time a session resumes. An open session keeps how it started.</p>`;
}
async function nxSetFullAccess(on){
  const result=await act('full-access',{on});
  if(!result||typeof result!=='object'){$$('[data-nx-full-access]').forEach(b=>b.checked=state.settings?.fullAccess!==false);return;}
  state.settings={...state.settings,fullAccess:result.fullAccess};
  toast(result.fullAccess?'Permission prompts off':'Permission prompts on',result.fullAccess?'Claude and Copilot resume without asking first.':'Claude and Copilot ask as usual when they resume.');
}
// on: true, false, or undefined to flip it.
async function nxSetHandoff(on){
  const result=await act('handoff',on===undefined?{}:{on});
  if(!result||typeof result!=='object'){$$('[data-nx-handoff]').forEach(b=>b.checked=!!state.settings?.handoff);return;}
  state.settings={...state.settings,handoff:result.handoff};
  $$('[data-nx-handoff]').forEach(b=>b.checked=result.handoff);
  toast(result.handoff?'Hand-off on':'Hand-off off',result.handoff?'Sessions you start or resume can hand work to your other agents.':'Sessions you start or resume work on their own.');
}
document.addEventListener('change',e=>{if(e.target.matches('[data-nx-handoff]'))nxSetHandoff(e.target.checked);if(e.target.matches('[data-nx-full-access]'))nxSetFullAccess(e.target.checked);});
