// A theme without a purpose is described by its project's own files: package.json, pyproject, the opening of the
// README/CLAUDE.md/AGENTS.md (never a later section or an instructions heading), or a Godot project name.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {about,fromMarkdown}=require('../theme-about');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-about-')),dir=name=>{const d=path.join(root,name);fs.mkdirSync(d);return d;};
try{
 const node=dir('node');fs.writeFileSync(path.join(node,'package.json'),JSON.stringify({description:'A local session deck for coding agents.'}));fs.writeFileSync(path.join(node,'README.md'),'# Deck\n\nSomething else.');
 assert.equal(about({id:'a',mainFolder:node}),'A local session deck for coding agents.');
 const py=dir('py');fs.writeFileSync(path.join(py,'pyproject.toml'),'[project]\nname = "x"\ndescription = "Deterministic portfolio engine with a decision layer"\n');
 assert.equal(about({id:'b',mainFolder:py}),'Deterministic portfolio engine with a decision layer');
 const lens=dir('lens');fs.writeFileSync(path.join(lens,'CLAUDE.md'),'# Atlas Lens — Claude Code instructions\n\nOffline snapshot translator that runs **on smart glasses**.\nThe PC develops it.\n\n## Session start\n\nRead the tasks.');
 assert.equal(about({id:'c',mainFolder:lens}),'Offline snapshot translator that runs on smart glasses.');
 const game=dir('game');fs.writeFileSync(path.join(game,'PROJECT_CONTEXT.md'),'# Project Context\n\n> quick orientation\n\n## 1. Overview\n\nA deep paragraph that is not the opening.');fs.writeFileSync(path.join(game,'project.godot'),'config/name="BEACON"\n');
 assert.equal(about({id:'d',mainFolder:path.join(root,'missing')},[{theme:{id:'d'},workFolders:[{path:game}]}]),'Godot project BEACON','session folders are read after the main folder');
 assert.equal(about({id:'e',mainFolder:dir('empty')}),'');
 const copies=dir('copies');for(const n of ['wt1','wt2','wt3']){fs.mkdirSync(path.join(copies,n));fs.writeFileSync(path.join(copies,n,'project.godot'),'config/name="BEEKEEP"\n');}
 fs.mkdirSync(path.join(copies,'handoff'));fs.writeFileSync(path.join(copies,'handoff','README.md'),'# Handoff\n\nBEEKEEP is a cozy farming game about bees.\n');
 assert.equal(about({id:'f',mainFolder:copies}),'BEEKEEP is a cozy farming game about bees.','copies of one project speak for their parent folder');
 const mixed=dir('mixed');for(const [n,d] of [['a','First tool that sorts invoices by date.'],['b','Second tool that renames photos in bulk.']]){fs.mkdirSync(path.join(mixed,n));fs.writeFileSync(path.join(mixed,n,'package.json'),JSON.stringify({description:d}));}
 assert.equal(about({id:'g',mainFolder:mixed}),'','a folder of unrelated projects says nothing');
 assert.equal(fromMarkdown('# ibagent — autonomous trading agent with a decision layer\n\nMoney is controlled by Python.'),'Autonomous trading agent with a decision layer');
 assert.equal(fromMarkdown('<div align="center">\n\n# Globe\n\n[![CI](x)](y)\n\nA spy-satellite simulator in your browser, built on public data.\n'),'A spy-satellite simulator in your browser, built on public data.');
 console.log('theme about checks passed');
}finally{fs.rmSync(root,{recursive:true,force:true});}
