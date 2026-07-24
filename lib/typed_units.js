'use strict';
const MASS_PER_VOLUME = Object.freeze({
  'ng/L': 0.001,
  'ug/L': 1,
  'µg/L': 1,
  'mcg/L': 1,
  'mg/L': 1000,
  'g/L': 1000000,
  'ppt': 0.001,
  'ppb': 1,
  'ppm': 1000
});
class Concentration {
  constructor(value, unit, analyteKey) {
    if (!Number.isFinite(Number(value))) throw new TypeError('Concentration value must be finite');
    if (!(unit in MASS_PER_VOLUME)) throw new TypeError(`Unsupported concentration unit: ${unit}`);
    if (!analyteKey) throw new TypeError('analyteKey is required');
    this.value = Number(value); this.unit = unit; this.analyteKey = analyteKey;
    Object.freeze(this);
  }
  to(unit) {
    if (!(unit in MASS_PER_VOLUME)) throw new TypeError(`Unsupported concentration unit: ${unit}`);
    const ugL = this.value * MASS_PER_VOLUME[this.unit];
    return new Concentration(ugL / MASS_PER_VOLUME[unit], unit, this.analyteKey);
  }
  compare(other) {
    if (!(other instanceof Concentration)) throw new TypeError('Can only compare Concentration values');
    if (other.analyteKey !== this.analyteKey) throw new TypeError('Cannot compare different analytes');
    const a=this.to('ug/L').value,b=other.to('ug/L').value; return a===b?0:(a<b?-1:1);
  }
  add(other) {
    if (!(other instanceof Concentration) || other.analyteKey!==this.analyteKey) throw new TypeError('Unit-safe addition requires same analyte');
    return new Concentration(this.to('ug/L').value+other.to('ug/L').value,'ug/L',this.analyteKey).to(this.unit);
  }
  toJSON(){return {value:this.value,unit:this.unit,analyte_key:this.analyteKey,canonical_ug_L:this.to('ug/L').value,type:'Concentration'};}
}
function concentration(value,unit,analyteKey){return new Concentration(value,unit,analyteKey)}
module.exports={Concentration,concentration,MASS_PER_VOLUME};
