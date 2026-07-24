'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  pwsid,activeViolation,violationKind,summarizeSdwis,nearbyWqp,ccrForPws,federalSummary,buildFederalContext
}=require('../lib/epa_data');

function fixture(){
  return {
    manifest:{status:'synced',sdwis:{status:'synced-quarterly-bulk'},wqp:{status:'synced'},ccr:{status:'synced'}},
    systems:[{pwsid:'3590970',pws_name:'OVIEDO, CITY OF',population_served:47933,primary_source:'Ground water'}],
    facilities:[{pwsid:'3590970',facility_name:'Well 1'}],geographicAreas:[],serviceAreas:[],
    violations:[
      {pwsid:'3590970',violation_name:'Total coliform MCL',status:'OPEN',begin_date:'2026-01-01'},
      {pwsid:'3590970',violation_name:'Monitoring and reporting',status:'CLOSED',begin_date:'2024-01-01'}
    ],
    lcrSamples:[{pwsid:'3590970',sample_date:'2025-10-01',lead_90th_percentile:4}],siteVisits:[],events:[],publicNotices:[],
    wqpStations:[
      {monitoring_location_id:'A',monitoring_location_name:'Lake Jesup station',monitoring_location_type:'Lake',latitude:28.70,longitude:-81.20,organization_name:'USGS'},
      {monitoring_location_id:'B',monitoring_location_name:'Far station',latitude:30,longitude:-84}
    ],
    wqpResults:[
      {monitoring_location_id:'A',activity_start_date:'2025-03-01',characteristic_name:'Nitrate',result_value:'0.3',result_unit:'mg/L'},
      {monitoring_location_id:'A',activity_start_date:'2024-03-01',characteristic_name:'Nitrate',result_value:'0.2',result_unit:'mg/L'},
      {monitoring_location_id:'A',activity_start_date:'2025-04-01',characteristic_name:'Dissolved oxygen',result_value:'7.1',result_unit:'mg/L'}
    ],
    ccrIndex:[{pwsid:'3590970',report_year:2024,title:'2024 Water Quality Report',url:'https://example.gov/oviedo-2024.pdf',publisher:'City of Oviedo'}]
  };
}

test('normalizes state-prefixed PWS IDs',()=>{
  assert.equal(pwsid('FL3590970'),'3590970');
  assert.equal(pwsid('US-FL-3590205'),'3590205');
});

test('classifies active health and monitoring violations',()=>{
  assert.equal(activeViolation({status:'OPEN'}),true);
  assert.equal(activeViolation({status:'RETURNED TO COMPLIANCE'}),false);
  assert.equal(violationKind({violation_name:'Maximum contaminant level exceedance'}),'health-based-or-treatment');
  assert.equal(violationKind({violation_name:'Monitoring and reporting violation'}),'monitoring-or-reporting');
});

test('SDWIS summary yields health-based compliance status and system metadata',()=>{
  const s=summarizeSdwis(fixture(),'FL3590970');
  assert.equal(s.synced,true);
  assert.equal(s.system.pws_name,'OVIEDO, CITY OF');
  assert.equal(s.compliance_status,'active-health-based-or-treatment-violation');
  assert.equal(s.violations.active.length,1);
  assert.equal(s.lcr_samples.length,1);
});

test('monitoring-only active violation gets the monitoring status',()=>{
  const d=fixture();
  d.violations=[{pwsid:'3590970',violation_name:'Monitoring and reporting',status:'OPEN'}];
  assert.equal(summarizeSdwis(d,'3590970').compliance_status,'active-monitoring-or-reporting-violation');
});

test('WQP nearby-station logic selects nearest stations and latest result per characteristic',()=>{
  const x=nearbyWqp(fixture(),{lat:28.71,lon:-81.21},{radiusMiles:20,limit:5});
  assert.equal(x.synced,true);
  assert.equal(x.stations.length,1);
  assert.equal(x.stations[0].monitoring_location_id,'A');
  assert.equal(x.stations[0].latest_results.length,2);
  assert.equal(x.stations[0].latest_results.find(r=>r.characteristic==='Nitrate').value,'0.3');
  assert.match(x.disclaimer,/not household tap samples/i);
});

test('CCR index returns the newest report for the exact PWS',()=>{
  const x=ccrForPws(fixture(),'3590970');
  assert.equal(x.latest.report_year,2024);
  assert.match(x.disclaimer,/system-level/i);
});

test('federal summary and combined context report all three source families',()=>{
  const d=fixture();
  const s=federalSummary(d);
  assert.equal(s.sdwis_systems,1);
  assert.equal(s.wqp_stations,2);
  assert.equal(s.ccr_reports,1);
  const c=buildFederalContext(d,'3590970',{lat:28.71,lon:-81.21});
  assert.equal(c.sdwis.system.pws_name,'OVIEDO, CITY OF');
  assert.equal(c.ccr.latest.report_year,2024);
  assert.equal(c.wqp.stations.length,1);
});
