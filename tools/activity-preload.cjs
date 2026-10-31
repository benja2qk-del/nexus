'use strict';
require('./themes-ui-preload.cjs');
const fs=require('fs'),path=require('path');
// Stable external working-state evidence, scoped entirely to the fixture.
fs.writeFileSync(path.join(process.env.NEXUS_CLAUDE_DIR,'sessions','activity.json'),JSON.stringify({sessionId:'s-dashboard',pid:process.pid,status:'busy',statusUpdatedAt:Date.now(),cwd:path.join(process.env.NEXUS_REDESIGN_FIXTURE,'work','release')}));
