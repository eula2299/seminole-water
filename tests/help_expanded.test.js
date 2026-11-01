'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../public/help/extended-logic'),S=require('../justice/extended-sources');
const {PGlite}=require('@electric-sql/pglite');
const {createGroups}=require('../justice/groups'),{createPromises}=require('../justice/promises');
test('uploaded bill extraction retains credits, payments and balance forward without counting totals twice',()=>{
 const L=require('../public/help/logic');
 const bill=L.parseBill('Previous balance $20.00\nWater charge $30.00\nSewer fee $10.00\nPayment received $15.00\nBilling credit $5.00\nAdjustment charge ($2.00)\nTotal amount due $38.00');
 assert.equal(bill.charges.length,6);
 assert.deepEqual(bill.charges.map(c=>c.amount),[20,30,10,-15,-5,-2]);
 assert.equal(L.billMath(bill).difference,0);
 assert.equal(L.billMath(bill).complete,false);
});
test('bill rate check compares only supported water use, requires scope and dates, and detects meter mismatch',()=>{
 const rate=S.rates[0],b={unit:'CCF',usage:6,waterCharge:25,readDate:'2026-10-10',scopeConfirmed:true,start:100,end:107};
 const r=E.auditBill(b,rate);assert.equal(r.rateCheck.expected,23.28);assert.equal(r.rateCheck.difference,1.72);assert.ok(r.issues.some(i=>i.code==='meterMismatch'));
 for(const extra of [{readDate:'2027-01-01'},{scopeConfirmed:false},{unit:'gallons'},{usage:''}])assert.equal(E.auditBill({...b,...extra},rate).rateCheck,null);
});
test('maintenance uses the earlier capacity or calendar limit and handles month ends',()=>{
 assert.equal(E.maintenance({installed:'2026-01-31',months:1},new Date('2026-01-31')).due,'2026-02-28');
 assert.equal(E.maintenance({installed:'2026-01-01',months:6,gallons:20,daily:2},new Date('2026-01-01')).due,'2026-01-11');
});
test('calendar reminder includes an alarm, safe escaped text, valid local time and no forged event',()=>{
 const data=E.calendar({title:'Water\nBEGIN:VEVENT',date:'2026-11-05',time:'14:00',timezone:'America/New_York'});
 assert.ok(data.includes('DTSTART;TZID=America/New_York:20261105T140000'));assert.ok(data.includes('TRIGGER:-P1D'));assert.equal(data.split('\r\nBEGIN:VEVENT').length,2);
 assert.throws(()=>E.calendar({date:'2026-02-31'}));assert.throws(()=>E.calendar({date:'2026-11-01',time:'25:00'}));
});
test('repair source matches exact case and year and requests no resident addresses',async()=>{
 const fake=async url=>{const u=new URL(url);assert.equal(JSON.parse(u.searchParams.get('filters')).case_number,'99-00082323');assert.ok(!u.searchParams.get('fields').includes('address'));return new Response(JSON.stringify({success:true,result:{records:[{case_number:'99-00082323',unique_id:'old',created_date_utc:'2016-01-01',status:'Closed'},{case_number:'99-00082323',unique_id:'new',created_date_utc:'2024-01-01',status:'Open'}]}}));};
 const data=await S.requestStatus({number:'99-00082323',year:'2024'},fake);assert.equal(data.records.length,1);assert.equal(data.records[0].id,'new');assert.equal(data.records[0].status,'Open');
});
test('real local PostgreSQL engine supports group permissions and public commitment ownership',async()=>{
 const db=new PGlite(),pool={async query(q,p){const r=await db.query(q,p);return {...r,rowCount:r.affectedRows??r.rows.length};},end:async()=>{}};
 const groups=createGroups({pool}),promises=createPromises({pool});
 try{
 const g=await groups.create({title:'Fictional pipe request',request:'Fictional test only: please inspect our pipes.',consent:true});
 await groups.join(g.id,g.invite,{name:'Fictional participant',consent:true});
 assert.equal((await groups.view(g.id,g.invite)).count,1);assert.equal((await groups.view(g.id,g.invite)).supporters,undefined);
 await assert.rejects(groups.view(g.id,g.invite,true));assert.equal((await groups.view(g.id,g.owner,true)).supporters[0].name,'Fictional participant');
 const b={city:'Example',state:'FL',official:'Example office',promise:'Fictional test statement only.',source:'https://example.gov/meeting',due:'2026-12-01',publishConsent:true};
 await assert.rejects(promises.create({...b,publishConsent:false}));
 const p=await promises.create(b);const list=await promises.list({city:'Example',state:'FL'});assert.equal(list.records.length,1);assert.equal(list.records[0].owner_hash,undefined);
 await assert.rejects(promises.update(p.id,'bad',{status:'completed',note:'test',source:'https://example.gov/update'}));
 await promises.update(p.id,p.owner,{status:'completed',note:'Test update',source:'https://example.gov/update'});
 assert.equal((await promises.list(b)).records[0].status,'completed');
 await promises.update(p.id,p.owner,{status:'withdrawn',note:'Remove test'});assert.equal((await promises.list(b)).records.length,0);
 }finally{await groups.close();await promises.close();await db.close();}
});
test('uploaded PDF form fills ordinary answers while leaving signature and government ID fields unchanged',async()=>{
 const PDFLib=require('pdf-lib'),fontkit=require('@pdf-lib/fontkit'),fs=require('node:fs'),vm=require('node:vm');
 const doc=await PDFLib.PDFDocument.create(),page=doc.addPage([612,792]),form=doc.getForm();
 for(const [name,y] of [['Applicant',650],['Signature',600],['SSN',550]]){const f=form.createTextField(name);f.addToPage(page,{x:50,y,width:300,height:25});}
 const file=new File([await doc.save()],'fictional-form.pdf',{type:'application/pdf'});
 const window={PDFLib,fontkit};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/help/documents.js'),'utf8'),{window,PDFLib,fontkit,Blob,File,Uint8Array,fetch:async()=>new Response(fs.readFileSync(require.resolve('../justice/fonts/DejaVuSans.ttf')))});
 const D=window.WaterHelpDocuments,spec=await D.inspectForm(file);
 assert.equal(spec.fields.length,3);assert.equal(spec.fields.find(f=>f.id==='Signature').sensitive,true);assert.equal(spec.fields.find(f=>f.id==='SSN').sensitive,true);
 const filled=await D.fillUploadedForm(spec,{Applicant:'Fictional Test Resident',Signature:'should not be inserted',SSN:'should not be inserted'});
 const result=await PDFLib.PDFDocument.load(await filled.arrayBuffer());assert.equal(result.getForm().getTextField('Applicant').getText(),'Fictional Test Resident');assert.equal(result.getForm().getTextField('Signature').getText(),undefined);assert.equal(result.getForm().getTextField('SSN').getText(),undefined);
});
