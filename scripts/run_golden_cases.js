'use strict';
const fs=require('fs'),path=require('path');const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/golden_cases.json')));if(!cfg.cases.length){console.log('Golden-case harness is installed; no reviewed cases have been loaded yet.');process.exit(0)}console.log(`Loaded ${cfg.cases.length} golden cases.`);
