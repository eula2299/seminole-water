'use strict';
const {validPwsid, validDate, finiteNumber, fingerprint} = require('./evidence');
const key = s => String(s).replace(/^\uFEFF/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
function fields(raw) { return Object.fromEntries(Object.entries(raw).map(([k,v]) => [key(k), String(v ?? '').trim()])); }
function date(value) {
  const s = String(value || '').trim();
  let d = s.slice(0,10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/);
  if (m) d = `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return validDate(d) ? d : null;
}
function identifyMember(source, name, header) {
  const keys = new Set(header.map(key));
  if (!keys.has('pwsid')) return null;
  if (source === 'ucmr5' && keys.has('contaminant') && keys.has('analyticalresultvalue')) return 'observation';
  if (source.startsWith('sdwis')) {
    if (/pub(?:lic)?[_ ]water[_ ]system/i.test(name) && keys.has('pwsname')) return 'system';
    if (/violations?(?:_enforcement)?\.(?:csv|txt)$/i.test(name) && keys.has('violationid')) return 'violation';
  }
  return null;
}
function normalize(source, kind, raw, provenance = {}) {
  const r = fields(raw), pwsid = (r.pwsid || '').toUpperCase();
  if (!validPwsid(pwsid)) throw new Error('Invalid full federal PWSID');
  const common = {pwsid, source, raw_sha256:fingerprint(raw)};
  if (kind === 'system') {
    const data = {...common, name:r.pwsname || pwsid, name_reported:!!r.pwsname, state:r.statecode || r.state || null,
      population_served:finiteNumber(r.populationservedcount), system_type:r.pwstypecode || null,
      active:r.pwsactivitycode === 'A', source_water_type:r.primarysourcecode || null,
      city:r.cityname || null, zip:r.zipcode || null, reporting_period:r.submissionyearquarter || null};
    return {kind,pwsid,record_key:pwsid,observed_at:null,data};
  }
  if (kind === 'violation') {
    if (!r.violationid) throw new Error('Missing violation ID');
    const data = {...common, violation_id:r.violationid, enforcement_id:r.enforcementid || null, enforcement_date:date(r.enforcementdate), contaminant_code:r.contaminantcode || null,
      violation_code:r.violationcode || null, violation_category:r.violationcategorycode || null,
      health_based:r.ishealthbasedind === 'Y', compliance_period_begin:date(r.noncomplperbegindate || r.complperbegindate),
      compliance_period_end:date(r.noncomplperenddate || r.complperenddate), returned_to_compliance:date(r.calculatedrtcdate || r.rtcdate),
      status:r.violationstatus || null, reporting_period:r.submissionyearquarter || null};
    return {kind,pwsid,record_key:fingerprint([pwsid,r.violationid,r.enforcementid || '']),observed_at:data.compliance_period_begin,data};
  }
  if (source !== 'ucmr5' || kind !== 'observation') throw new Error('Unsupported source schema');
  const sample_date=date(r.collectiondate || r.samplecollectiondate);
  if (!sample_date || !r.contaminant) throw new Error('Invalid UCMR sample date or analyte');
  const sign = r.analyticalresultssign || r.analyticalresultsign || '=', value = finiteNumber(r.analyticalresultvalue);
  if (value !== null && value < 0) throw new Error('Negative UCMR concentration');
  const censored = ['<','<=','ND'].includes(sign.toUpperCase());
  if (!['=','<','<=','ND',''].includes(sign.toUpperCase())) throw new Error('Unknown UCMR result qualifier');
  const unit = r.units || r.unit || null;
  if (!unit) throw new Error('UCMR unit missing');
  // UCMR blank nondetects are bounded by MRL; explicit bounds remain distinct from MRL.
  const data = {...common, analyte:r.contaminant, sample_date, reported_value:r.analyticalresultvalue,
    unit, qualifier:sign, censored, value:censored ? null : value,
    reporting_limit:finiteNumber(r.mrl), reported_bound:censored ? (value ?? finiteNumber(r.mrl)) : null,
    facility_id:r.facilityid || null, facility_name:r.facilityname || null,
    sample_point_id:r.samplepointid || null, sample_point_type:r.samplepointtype || null,
    sample_id:r.sampleid || null, analytical_method:r.methodid || r.analyticalmethod || null,
    name:r.pwsname || null, state:r.state || null};
  if (!censored && value === null) throw new Error('UCMR numerical result missing');
  // Require published sample identity. Never deduplicate merely by PWS/analyte/date.
  if (!data.sample_id || !data.facility_id || !data.sample_point_id) throw new Error('UCMR sample identity incomplete');
  const record_key=fingerprint([pwsid,data.facility_id,data.sample_point_id,data.sample_id,sample_date,data.analyte,data.analytical_method]);
  return {kind,pwsid,record_key,observed_at:sample_date,data};
}
module.exports={key,fields,date,identifyMember,normalize};
