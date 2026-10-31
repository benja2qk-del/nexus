// Headless tour: the Wall on a PC is one column per theme. Sessions in play show, older ones fold away,
// themes with nothing in play fold into one Quiet themes column, and dragging a tile onto another column (or a quiet theme,
// or New theme) moves it. The sidebar shows the focused theme's context instead of repeating the theme list. Also checks
// that a filtered theme column says what it hides. All session and theme data are in-page fixtures.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { privateServer } from './upload-server.mjs';
import { browser, sleep } from './polish-browser.mjs';
const out = 'docs/shots/board';
fs.mkdirSync(out, { recursive: true });
const server = await privateServer(); process.env.NEXUS_PORT = '4790';
const fixture = `
  const H = 3600e3, now = Date.now();
  window.themeCatalog = [{id:'web',name:'Web app',color:'#87b9cf'},{id:'data',name:'Data pipeline',color:'#c5a5df'},{id:'old',name:'Old notes',color:'#a0c4a0'}];
  const at = id => themeCatalog.find(t => t.id === id);
  const session = (id, title, theme, extra = {}) => ({kind:'claude',id,title,cwd:'C:\\\\Work',group:'Work',groupLabel:'Work',status:'idle',updated:now-60000,size:10,theme:theme?{id:theme,name:at(theme).name,color:at(theme).color,source:'owner'}:{id:null,name:'Unsorted',source:'unsorted'},...extra});
  window.fixtureSessions = [
    session('a','Fix login form','web',{status:'busy',live:true,updated:now-30000}),
    session('b','Refactor API client','web',{live:true,updated:now-H}),
    session('c','Old spike','web',{updated:now-72*H}),
    session('d','Nightly export','data',{updated:now-2*H}),
    session('e','Where are the files?',null,{updated:now-600000}),
    session('f','Ancient notes',null,{updated:now-120*H}),
    session('g','Archived plan','old',{updated:now-100*H})
  ];
  window.themeCalls = []; let rev = 0, undo = null;
  const json = body => new Response(JSON.stringify(body));
  const place = (keys, id) => { const before = fixtureSessions.map(s => ({...s})); for (const s of fixtureSessions) if (keys.includes('claude:' + s.id)) { const t = at(id); s.theme = t ? {id:t.id,name:t.name,color:t.color,source:'owner'} : {id:null,name:'Unsorted',source:'unsorted'}; } return before; };
  const nativeFetch = window.fetch;
  window.fetch = async (url, options) => {
    url = String(url);
    if (url.startsWith('/api/sessions')) return json({now:Date.now(),rev:'r' + (++rev),home:'C:\\\\Users\\\\fixture',sessions:fixtureSessions,terms:[],usage:{},briefing:null});
    if (url.startsWith('/api/themes')) {
      const body = options?.body ? JSON.parse(options.body) : null;
      if (body) themeCalls.push({url, ...body});
      if (url === '/api/themes' && body?.op === 'create') { const t = {id:'t' + themeCalls.length, name:body.name, color:'#dca0bb'}; themeCatalog.push(t); return json({ok:true,result:t,themes:themeCatalog}); }
      if (url === '/api/themes/assign') { undo = place(body.keys, body.themeId); return json({ok:true,undoToken:'u' + themeCalls.length,themes:themeCatalog}); }
      if (url === '/api/themes/undo') { fixtureSessions = undo; undo = null; return json({ok:true,themes:themeCatalog}); }
      return json({themes:themeCatalog});
    }
    if (url.startsWith('/api/chat') || url.startsWith('/api/transcript')) return json({events:[],status:'Waiting for you',queue:null});
    return nativeFetch(url, options);
  };
`;
async function tour(width, height) {
  const b = await browser(width, height), report = [];
  const check = async (expression, label) => { assert(await b.js(expression), label); report.push('PASS ' + label + ' @' + width); console.log(report.at(-1)); };
  const until = async (expression, label) => { await b.until(expression, 8000); report.push('PASS ' + label + ' @' + width); console.log(report.at(-1)); };
  try {
    await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: fixture });
    await b.navigate(); await b.until('state.booted&&nxThemes.loaded&&state.sessions.length===7'); await sleep(600);
    await b.js(`window.column=name=>[...document.querySelectorAll('.nx-board-col')].find(c=>c.getAttribute('aria-label')===name);window.tile=id=>document.querySelector('.nx-board-tile[data-session-key="claude:'+id+'"]');window.titles=name=>[...(column(name)?.querySelectorAll('.nx-board-tile strong')||[])].map(e=>e.textContent);
      window.dragTo=(id,target)=>{const dt=new DataTransfer();tile(id).dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt});target.dispatchEvent(over);window.lastDrag={dragging:document.body.classList.contains('nx-dragging'),highlighted:target.classList.contains('drop-target'),accepted:over.defaultPrevented};target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));return lastDrag;};
      setView('wall');true`);
    if (width <= 700) {
      await check(`!!document.querySelector('#wall .nx-pwall')&&!document.querySelector('.nx-board')&&document.querySelectorAll('.nx-pwall-theme').length>0&&[...document.querySelectorAll('.nx-pwall .nx-board-tile')].every(t=>nxBoardActive(state.byKey.get(t.dataset.sessionKey)))`, 'phone Wall stacks the themes in play with their tiles');
      await check(`document.querySelector('#mobileDock [data-nav=wall]')?.getAttribute('aria-current')==='page'&&!document.querySelector('#mobileDock [data-nav=new]')`, 'Wall sits in the phone bar where New was');
      await check(`document.documentElement.scrollWidth<=innerWidth`, 'no sideways scroll on the phone Wall');
      await b.js(`setView('sessions');nxThemes.phoneAt=null;[...document.querySelectorAll('[data-nx-filter=busy]')].find(e=>e.offsetParent).click();true`);
      await check(`!document.querySelector('#cards .nx-theme-rail')&&[...document.querySelectorAll('#cards .nx-phone-filtered [data-k], #cards .nx-phone-filtered .nx-session-row')].length>0&&[...document.querySelectorAll('#cards .nx-phone-filtered .nx-session-row')].every(r=>statusLabel(state.byKey.get(r.querySelector('[data-k]')?.dataset.k||r.dataset.k)||{})[0]==='busy')`, 'a phone filter shows the matching sessions, grouped by theme');
      await b.js(`[...document.querySelectorAll('[data-nx-filter=all]')].find(e=>e.offsetParent).click();true`);
      await check(`!!document.querySelector('#cards .nx-theme-rail')&&!document.querySelector('#cards .nx-phone-filtered')`, 'All brings the theme list back on the phone');
      await b.shot(`${out}/${width}-wall.png`);
      return report;
    }
    await check(`JSON.stringify([...document.querySelectorAll('.nx-board-col')].map(c=>c.getAttribute('aria-label')))==='["Unsorted","Web app","Data pipeline","Quiet themes",null]'`, 'a column per theme in play, Unsorted first, quiet themes folded, New theme last');
    await check(`[...column('Quiet themes').querySelectorAll('.nx-board-quiet-theme span')].map(e=>e.textContent).join()==='Old notes'`, 'a theme with nothing in play is one row in Quiet themes');
    await check(`!document.querySelector('#cards .nx-theme-rail')&&document.querySelector('.nx-wall-context h2').textContent==='Web app'&&column('Web app').classList.contains('focused')`, 'the sidebar shows the focused theme, not a second theme list');
    await check(`JSON.stringify(titles('Web app'))==='["Fix login form","Refactor API client"]'&&column('Web app').querySelector('[data-board-older]').textContent==='Show 1 older'`, 'sessions in play show and the older one folds away');
    await check(`document.documentElement.scrollWidth<=innerWidth`, 'no page-wide horizontal scroll');
    if (width >= 1200) await check(`Math.round(document.querySelector('#nxSidebar').getBoundingClientRect().width)===220&&!document.querySelector('.nx-theme-column')?.getClientRects().length`, 'the Wall gives the theme column space to the board');
    await b.shot(`${out}/${width}-board.png`);
    await check(`(()=>{const r=dragTo('e',column('Data pipeline'));return r.dragging&&r.highlighted&&r.accepted;})()`, 'dragging highlights the target column');
    await until(`titles('Data pipeline').includes('Where are the files?')&&!titles('Unsorted').includes('Where are the files?')`, 'dropping on a column moves the session there');
    await check(`themeCalls.at(-1).url==='/api/themes/assign'&&themeCalls.at(-1).themeId==='data'&&!document.body.classList.contains('nx-dragging')&&!!document.querySelector('.nx-undo-toast')`, 'one assignment with Undo, drag state cleared');
    await b.js(`document.querySelector('.nx-undo-toast button').click()`);
    await until(`titles('Unsorted').includes('Where are the files?')`, 'Undo puts it back');
    await check(`(()=>{const n=themeCalls.length;dragTo('a',column('Web app'));return themeCalls.length===n;})()`, 'dropping on its own column changes nothing');
    await b.js(`column('Data pipeline').querySelector('[data-board-focus]').click()`);
    await check(`document.querySelector('.nx-wall-context h2').textContent==='Data pipeline'&&column('Data pipeline').classList.contains('focused')&&!column('Web app').classList.contains('focused')`, 'clicking a column name shows that theme in the sidebar');
    await check(`(()=>{const r=dragTo('e',document.querySelector('.nx-board-quiet-theme[data-theme-drop=old]'));return r.accepted&&r.highlighted;})()`, 'a quiet theme row accepts a drop');
    await until(`themeCalls.at(-1).themeId==='old'&&titles('Old notes').includes('Where are the files?')`, 'dropping on a quiet theme moves the session and brings its column back');
    await b.js(`document.querySelector('.nx-undo-toast button').click()`);
    await until(`titles('Unsorted').includes('Where are the files?')&&!column('Old notes')`, 'Undo folds it away again');
    await b.js(`document.querySelector('.nx-board-quiet-theme[data-board-focus=old]').click()`);
    await check(`!!column('Old notes')&&document.querySelector('.nx-wall-context h2').textContent==='Old notes'&&column('Old notes').querySelector('[data-board-older]').textContent==='Show 1 older'`, 'clicking a quiet theme opens its column and context');
    await b.js(`dragTo('b',document.querySelector('[data-theme-drop=new]'))`);
    await until(`!!document.querySelector('#nxNewThemeName')`, 'dropping on New theme asks for a name');
    await b.js(`document.querySelector('#nxNewThemeName').value='Docs';document.querySelector('[data-new-theme-save]').click()`);
    await until(`JSON.stringify(titles('Docs'))==='["Refactor API client"]'`, 'the new theme is created with the dropped session in it');
    await check(`themeCalls.some(c=>c.op==='create'&&c.name==='Docs')&&themeCalls.at(-1).keys.join()==='claude:b'`, 'create then assign');
    await b.js(`column('Web app').querySelector('[data-board-older]').click()`);
    await check(`titles('Web app').includes('Old spike')&&column('Web app').querySelector('[data-board-older]').getAttribute('aria-expanded')==='true'`, 'Show older unfolds the rest');
    await b.shot(`${out}/${width}-moved.png`);
    await b.js(`state.filter='busy';renderCards();renderWall();true`);
    await check(`!!document.querySelector('#wall [data-nx-show-all]')&&titles('Web app').join()==='Fix login form'`, 'a filtered Wall says so');
    await b.js(`document.querySelector('#wall [data-nx-show-all]').click()`);
    await check(`state.filter==='all'&&titles('Web app').join()==='Fix login form,Old spike'`, 'Show all clears the filter');
    if (width >= 1200) {
      await b.js(`state.filter='busy';setView('overview');nxThemes.selected='data';renderCards();true`);
      await check(`(()=>{const c=document.querySelector('.nx-theme-column');return c.textContent.includes('0 of 1 shown')&&c.textContent.includes('No working sessions in Data pipeline')&&!!c.querySelector('[data-nx-show-all]');})()`, 'a filtered theme column says what it hides');
      await b.shot(`${out}/${width}-filtered-column.png`);
      await b.js(`document.querySelector('.nx-theme-column [data-nx-show-all]').click()`);
      await check(`state.filter==='all'&&document.querySelectorAll('.nx-theme-column [data-session-key]').length===1`, 'Show all brings the sessions back');
    }
    await b.js(`setView('overview');true`);
    await check(`!!document.querySelector('#cards .nx-theme-rail')&&!document.querySelector('.nx-wall-context')`, 'leaving the Wall brings the theme list back');
    await b.js(`document.querySelector('.nx-welcome [data-nx-view=wall]').click()`);
    await until(`state.view==='wall'&&!!document.querySelector('.nx-board')`, 'Home links to the board');
    assert.deepEqual(b.exceptions, [], 'page exceptions');
    return report;
  } finally { await b.close(); }
}
try {
  const report = [];
  for (const [w, h] of [[1568, 773], [1100, 800], [440, 956]]) report.push(...await tour(w, h));
  fs.writeFileSync(`${out}/report.txt`, report.join('\n') + '\n');
  console.log('board tour passed');
} finally { await server.close(); }
