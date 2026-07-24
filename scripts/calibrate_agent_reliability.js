'use strict';
const fs=require('fs'),path=require('path');
const {calibrateProfile}=require('../lib/reliability_calibration');
const root=path.join(__dirname,'..');
const profile=JSON.parse(fs.readFileSync(path.join(root,'data/agent_reliability.json'),'utf8'));
const adjudications=JSON.parse(fs.readFileSync(path.join(root,'data/agent_adjudications.json'),'utf8')).adjudications||[];
const result=calibrateProfile(profile,adjudications);
fs.writeFileSync(path.join(root,'data/agent_reliability_calibrated.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({ok:true,adjudications:result.adjudication_count,reliability:result.reliability},null,2));
