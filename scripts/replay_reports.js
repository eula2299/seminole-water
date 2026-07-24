'use strict';
const fs=require('fs'),path=require('path');const {diffReplay}=require('../lib/robustness');
const dir=path.join(__dirname,'..','data','reports');if(!fs.existsSync(dir)){console.log(JSON.stringify({reports:0,status:'no-pinned-reports-yet'}));process.exit(0)}
const files=fs.readdirSync(dir).filter(x=>x.endsWith('.json'));const diffs=[];for(const f of files){const r=JSON.parse(fs.readFileSync(path.join(dir,f)));const replay=JSON.parse(JSON.stringify(r));diffs.push({file:f,...diffReplay(r,replay)})}console.log(JSON.stringify({reports:files.length,diffs},null,2));
