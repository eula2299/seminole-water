(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.WaterHelpExtendedLogic=value;})(typeof window==='object'?window:this,()=>{
  'use strict';
  const num=v=>v===''||v===null||v===undefined?null:Number.isFinite(Number(v))?Number(v):null;
  const round=v=>Math.round((v+Number.EPSILON)*100)/100;
  function auditBill(b,rate){
    const issues=[], start=num(b.start),end=num(b.end),usage=num(b.usage),charged=num(b.waterCharge),days=num(b.days),oldUsage=num(b.previousUsage),oldDays=num(b.previousDays);
    if(start!==null&&end!==null&&usage!==null){
      if(end<start)issues.push({code:'meterReset'});
      else if(Math.abs(end-start-usage)>.01)issues.push({code:'meterMismatch',expected:round(end-start),actual:usage});
    }
    if(usage!==null&&oldUsage>0&&days>0&&oldDays>0&&usage/days>oldUsage/oldDays*1.5)issues.push({code:'usageJump',percent:Math.round((usage/days/(oldUsage/oldDays)-1)*100)});
    const seen=new Set();for(const line of b.lines||[]){const k=String(line.name||'').trim().toLowerCase()+'|'+line.amount;if(seen.has(k))issues.push({code:'duplicateCharge',name:String(line.name)});seen.add(k);}
    let rateCheck=null;
    if(rate&&usage!==null&&usage>=0&&charged!==null&&b.unit===rate.unit&&b.readDate>=rate.from&&b.readDate<=rate.through&&b.scopeConfirmed===true){
      const expected=round(usage*rate.perUnit);
      rateCheck={expected,charged,difference:round(charged-expected),source:rate.source,scope:rate.scope};
      if(Math.abs(charged-expected)>.02)issues.push({code:'rateDifference',expected,actual:charged});
    }
    return {issues,rateCheck,notAnOverchargeFinding:true};
  }
  function maintenance({installed,months,gallons,daily,used=0},today=new Date()){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(installed||''))return null;
    const start=new Date(installed+'T12:00:00Z');if(!Number.isFinite(+start))return null;
    const candidates=[];
    if(num(months)>0){const date=new Date(start), original=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+Number(months));const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(original,last));candidates.push(+date);}
    if(num(gallons)>0&&num(daily)>0)candidates.push(+start+Number(gallons)/Number(daily)*86400000);
    if(!candidates.length)return null;
    const due=new Date(Math.min(...candidates));
    return {due:due.toISOString().slice(0,10),days:Math.ceil((+due-+today)/86400000),capacityReached:num(gallons)>0&&num(used)>=num(gallons)};
  }
  const escape=v=>String(v||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  function calendar({title,date,time,timezone='UTC',description='',url='',daysBefore=1}){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw Error('INVALID_DATE');
    const parsed = new Date(date+'T12:00:00Z');
    if(!Number.isFinite(+parsed)||parsed.toISOString().slice(0,10)!==date)throw Error('INVALID_DATE');
    const day=date.replace(/-/g,''), timed=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time||'');
    if(time&&!timed)throw Error('INVALID_TIME');
    if(!/^[A-Za-z_]+(?:\/[A-Za-z_+-]+){0,2}$/.test(timezone))throw Error('INVALID_ZONE');
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
    const uid=Array.from(crypto.getRandomValues(new Uint8Array(12)),x=>x.toString(16).padStart(2,'0')).join('');
    const rows=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//IsMyWaterOK//Water help//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+uid+'@ismywaterok.com','DTSTAMP:'+stamp,timed?'DTSTART;TZID='+timezone+':'+day+'T'+time.replace(':','')+'00':'DTSTART;VALUE=DATE:'+day,'SUMMARY:'+escape(title),'DESCRIPTION:'+escape(description)];
    if(/^https:\/\//.test(url))rows.push('URL:'+escape(url));
    rows.push('BEGIN:VALARM','TRIGGER:-P'+Math.max(1,Math.min(30,Number(daysBefore)||1))+'D','ACTION:DISPLAY','DESCRIPTION:'+escape(title),'END:VALARM','END:VEVENT','END:VCALENDAR');
    return rows.map(s=>{let out='',line='';for(const c of s){if(new TextEncoder().encode(line+c).length>70){out+=line+'\r\n ';line='';}line+=c;}return out+line;}).join('\r\n')+'\r\n';
  }
  function escalation({issue,contacted,response,providerType}){
    const routes=[];
    if(!contacted)routes.push('provider');
    if(issue==='quality'||issue==='pipes')routes.push('drinkingWater');
    if(issue==='bill')routes.push(providerType==='regulated'?'commission':'municipal');
    if(issue==='housing')routes.push('housing');
    if(issue==='discrimination')routes.push('civilRights','legalAid');
    if(contacted&&response==='none')routes.push('followup','legalAid');
    if(!routes.length)routes.push('provider','legalAid');
    return [...new Set(routes)];
  }
  return {auditBill,maintenance,calendar,escalation};
});
