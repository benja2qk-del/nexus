// Synthetic owner workflow. Installed BEFORE application scripts by cdp-tour.
// No request can open, resume, fork, or send input to an owner's session.
(() => {
  const now = Date.now(), ts = new Date(now).toISOString();
  const sessions = Array.from({length: 12}, (_, n) => ({
    kind: n === 2 ? 'astra' : 'claude', id: 'phoneux-fixture-' + n,
    title: ['Steam Cloud publishing', 'Beacon build validation', 'Beacon phone usability', 'Steam store copy review'][n % 4],
    group: n < 9 ? 'Beacon' : 'Atlas', groupLabel: n < 9 ? 'Beacon' : 'Atlas',
    cwd: 'C:\\fixture\\' + (n < 9 ? 'Beacon' : 'Atlas'), firstPrompt: 'Review the release and report the result.',
    lastPrompt: 'Please finish the publishing checks.', lastText: n === 0 ? 'Unticked the developers-only box on Steam Cloud. The public configuration is saved; publishing is ready for your approval.' : 'Validated the latest build and checked the release notes. All recorded checks passed.',
    recentTools: n === 0 ? ['Chrome', 'Astra'] : [], live: n < 3, remote: n === 0,
    status: n === 1 || n === 2 ? 'busy' : n === 0 ? 'idle' : 'offline', runState: n === 2 ? 'active' : 'complete',
    term: n === 0 ? 'phoneux-fixture' : null, updated: now - n * 60000, size: 123456 + n, model: 'claude-opus',
    insights: { objective: {title: 'Prepare the Beacon release', request: 'Verify Steam Cloud and publish the configuration.'},
      digest: {since: now - 3600000, turns: 2, tools: 5, files: ['release-notes.md'], commits: [], errors: 0, opening: 'Validated Steam Cloud and the release notes.'},
      alignment: {verdict: 'On track', reason: 'Recent work matches the request.'},
      spend: {measured: true, total: 82000, input: 12000, output: 5000, cacheRead: 65000, cacheWrite: 0, turns: [{request: 'Publish the configuration', total: 9000, at: now}]} }
  }));
  const events = [
    {t:'user',text:'Check Steam Cloud, then tell me what is ready to publish.',ts},
    {t:'think',text:'I will verify the public configuration before requesting permission to publish.',ts},
    {t:'ai',text:'I found the developers-only setting and checked the public configuration.',ts},
    {t:'tool',name:'mcp__claude-in-chrome__computer',id:'tool-1',text:'Click the developers-only checkbox',ts},
    {t:'result',id:'tool-1',text:'Checkbox cleared',ts},
    {t:'tool',name:'Bash',id:'tool-2',text:'codex exec "Review the release notes"',astra:true,ts},
    {t:'ai',text:'**Steam Cloud is ready.**\n\nUnticked the developers-only box. The public configuration is saved.\n\n- Windows and macOS paths are verified.\n- The release notes match this build.\n\nPublishing needs your approval below.',ts}
  ];
  const terminal = 'Saved.Nowpublishingit.\r\n\r\nDo you want to publish the Steam Cloud configuration?\r\n  1. Yes, publish this configuration\r\n  2. Yes, allow publishing for this session\r\n  3. No, keep the saved draft\r\nEsc to cancel';
  window.phoneuxFixture = { sessions, events, terminal, writes: [], offline: false, transcriptError: false, empty: false };
  window.phoneuxCheck = (ok, name) => { if (!ok) throw Error(name); console.log('PASS ' + name); };
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (url, options = {}) => {
    const route = new URL(typeof url === 'string' ? url : url.url, location.href).pathname;
    const f = window.phoneuxFixture;
    const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});
    if (route === '/api/sessions') return f.offline ? json({error:'Fixture connection unavailable'},503) : json({now:Date.now(),remote:innerWidth<701,home:'C:\\fixture',sessions:f.empty?[]:sessions,terms:f.empty?[]:[{id:'phoneux-fixture',kind:'claude',sessionKey:'claude:phoneux-fixture-0',title:sessions[0].title,cwd:sessions[0].cwd}],briefing:f.empty?{working:0,waiting:0,text:'No sessions are indexed yet.',tokens:0,measured:0}:{working:2,waiting:1,text:'Two sessions are working. Steam Cloud publishing is waiting for your answer.',tokens:984000,measured:12},usage:{}});
    if (route === '/api/transcript') return f.transcriptError ? json({error:'Fixture transcript unavailable'},503) : json({size:123456,events,capturedAt:Date.now(),activity:events.length ? {goal:'Publish the Steam Cloud configuration.',steps:2,current:{name:'Chrome',text:'Publish configuration'},thought:{text:'I will verify the public configuration before requesting permission to publish.',ts},tasks:[]} : null});
    if (route === '/api/action') return JSON.parse(options.body || '{}').action === 'viewed' ? json({result:true}) : json({error:'Fixture: launch refused; draft is retained.'},503);
    if (route === '/api/pair/new') return json({code:'TEST-1234',expiresAt:Date.now()+600000});
    if (route === '/api/devices') return json({devices:[{id:'fixture-device',name:'My iPhone',lastSeen:now,created:now-86400000}]});
    if (route === '/api/pair') return json({error:'This test code has expired. Generate a fresh code on the PC.'},400);
    if (route.startsWith('/api/') && route !== '/api/upload') return json({error:'Blocked by synthetic tour'},403);
    return originalFetch(url, options);
  };
  window.WebSocket = class {
    static OPEN = 1;
    constructor() { this.readyState = 1; setTimeout(() => {this.onopen?.(); this.onmessage?.({data:JSON.stringify({t:'o',d:terminal})});},30); }
    send(data) { window.phoneuxFixture.writes.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
  };
})();
