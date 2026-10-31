// Evaluated only by the headless fixture harness; never loaded by the app.
window.parityMeasure = () => {
  const props=['backgroundColor','backgroundImage','backgroundSize','color','borderTopColor','borderTopWidth','boxShadow','backdropFilter','opacity','fontFamily','fontWeight','fontSize','letterSpacing','fontFeatureSettings','borderRadius','transitionProperty','transitionDuration','transitionTimingFunction'];
  const style=(el,pseudo)=>Object.fromEntries(props.map(p=>[p,getComputedStyle(el,pseudo)[p]]));
  const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  const elements=[...document.querySelectorAll('body *')].filter(el=>{
    const r=el.getBoundingClientRect();return r.width&&r.height&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth&&getComputedStyle(el).visibility!=='hidden';
  }).map(el=>({tag:el.tagName,id:el.id,classes:el.getAttribute('class'),label:el.getAttribute('aria-label'),text:el.textContent.trim().slice(0,100),rect:rect(el),style:style(el)}));
  const regions={};
  for(const [name,selector] of Object.entries(window.parityRegions||{})){
    const el=typeof selector==='string'?document.querySelector(selector):selector;
    if(!el)continue;
    const ancestors=[];for(let parent=el.parentElement;parent;parent=parent.parentElement)ancestors.push({tag:parent.tagName,id:parent.id,rect:rect(parent),style:style(parent)});
    regions[name]={rect:rect(el),style:style(el),before:style(el,'::before'),after:style(el,'::after'),ancestors};
  }
  return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},themeColor:document.querySelector('meta[name=theme-color]')?.content,regions,elements,animations:document.getAnimations().map(a=>({name:a.animationName||a.transitionProperty||'WAAPI',target:a.effect?.target?.id||a.effect?.target?.getAttribute?.('class'),pseudo:a.effect?.pseudoElement,timing:a.effect?.getTiming(),keyframes:a.effect?.getKeyframes(),playState:a.playState}))};
};
