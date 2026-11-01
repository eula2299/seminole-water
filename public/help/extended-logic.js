(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.WaterHelpExtendedLogic=value;})(typeof window==='object'?window:this,()=>{
  'use strict';
  const num=v=>v===''||v===null||v===undefined?null:Number.isFinite(Number(v))?Number(v):null;
  const round=v=>Math.round((v+Number.EPSILON)*100)/100;
  const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
  function denverCharges(b,rate){
    const gallons=num(b.usage),threshold=num(b.winterThreshold),prices=rate.tiers[b.serviceClass],fixed=rate.fixed[b.meterSize];
    if(gallons===null||gallons<0||!prices||fixed===undefined||threshold===null||threshold<5000||threshold>15000)return null;
    if(!validDate(b.usageStart)||!validDate(b.usageEnd)||b.usageStart>b.usageEnd||b.usageStart<rate.from||b.usageEnd>b.readDate)return null;
    const boundary=rate.drought.usage_effective_from;
    if(b.usageStart<boundary&&b.usageEnd>=boundary)return null;
    const droughtApplies=b.usageStart>=boundary;
    const volumes=[Math.min(gallons,threshold),Math.min(Math.max(gallons-threshold,0),15000),Math.max(gallons-threshold-15000,0)];
    // Published rates are exact cents per 1,000 gallons. Round each bill line once.
    const line=rates=>Math.round(volumes.reduce((sum,g,i)=>sum+g*Math.round(rates[i]*100),0)/1000)/100;
    const base=line(prices),drought=droughtApplies?line(rate.drought.surcharge_per_1000_gallons):0;
    return {base,drought,fixed,total:round(base+drought+fixed),volumes,droughtApplies};
  }
  function auditBill(b,rate){
    const issues=[], start=num(b.start),end=num(b.end),usage=num(b.usage),charged=num(b.waterCharge),days=num(b.days),oldUsage=num(b.previousUsage),oldDays=num(b.previousDays);
    if(start!==null&&end!==null&&usage!==null){
      if(end<start)issues.push({code:'meterReset'});
      else if(Math.abs(end-start-usage)>.01)issues.push({code:'meterMismatch',expected:round(end-start),actual:usage});
    }
    if(usage!==null&&oldUsage>0&&days>0&&oldDays>0&&usage/days>oldUsage/oldDays*1.5)issues.push({code:'usageJump',percent:Math.round((usage/days/(oldUsage/oldDays)-1)*100)});
    const seen=new Set();for(const line of b.lines||[]){const k=String(line.name||'').trim().toLowerCase()+'|'+line.amount;if(seen.has(k))issues.push({code:'duplicateCharge',name:String(line.name)});seen.add(k);}
    let rateCheck=null;
    if(rate&&usage!==null&&usage>=0&&charged!==null&&b.unit===rate.unit&&validDate(b.readDate)&&b.readDate>=rate.from&&b.readDate<=rate.through&&b.scopeConfirmed===true){
      const breakdown=rate.model==='denver-single-family'?denverCharges(b,rate):null;
      if(rate.model!=='denver-single-family'||breakdown){
        const expected=breakdown?breakdown.base:round(usage*rate.perUnit);
        rateCheck={expected,charged,difference:round(charged-expected),source:rate.source,scope:rate.scope,...(breakdown?{breakdown}:{})};
        if(Math.abs(charged-expected)>.02)issues.push({code:'rateDifference',expected,actual:charged});
        if(breakdown){
          rateCheck.lines={};
          for(const kind of ['drought','fixed']){
            const actual=num(b[kind+'Charge']);
            if(actual!==null){
              const difference=round(actual-breakdown[kind]);
              rateCheck.lines[kind]={expected:breakdown[kind],charged:actual,difference};
              if(Math.abs(difference)>.02)issues.push({code:'rateDifference',line:kind,expected:breakdown[kind],actual});
            }
          }
        }
      }
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
