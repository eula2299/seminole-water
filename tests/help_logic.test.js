"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const L = require("../public/help/logic"),
  catalog = require("../justice/filter-catalog.json");
test("lab extraction preserves qualifiers, units and nitrate basis without making a safety finding", () => {
  const rows = L.parseLab(
    "Lead 0.012 mg/L\nArsenic < 2 ug/L\nNitrate as N 12 mg/L\nPFOS ND\nE. coli positive",
  );
  assert.equal(rows.length, 5);
  assert.equal(rows[0].value, 0.012);
  assert.equal(rows[1].qualifier, "<");
  assert.equal(rows[2].basis, "as nitrogen");
  assert.equal(rows[3].value, null);
  for (const r of rows) assert.equal(L.interpret(r).code, "confirm_result");
  rows.forEach((r) => (r.confirmed = true));
  assert.equal(L.interpret(rows[0]).code, "lead_followup");
  assert.equal(L.interpret(rows[1]).code, "below_reporting");
  assert.equal(L.interpret(rows[2]).code, "nitrate_followup");
  assert.equal(L.interpret(rows[3]).code, "below_reporting");
  assert.equal(L.interpret(rows[4]).code, "microbe_followup");
});
test("missing units and nitrate basis remain unknown, not safe", () => {
  assert.equal(
    L.interpret({
      name: "nitrate",
      value: 4,
      unit: "mg/L",
      basis: "not stated",
      confirmed: true,
    }).code,
    "nitrate_basis",
  );
  assert.equal(
    L.interpret({ name: "lead", value: 10, unit: "unknown", confirmed: true })
      .code,
    "unit_check",
  );
});
test("maintenance cost buys whole packs and includes the cartridge supplied with each device", () => {
  const p = catalog.products.find((p) => p.id === "culligan-zerop07");
  const cost = L.annualCost(
    p,
    catalog.replacement_families[p.replacement_family],
    1,
  );
  assert.equal(cost.orders[0].needed, 18);
  assert.equal(cost.replacement_cost, 269.97);
  assert.equal(cost.first_year, 294.96);
  const brita = catalog.products.find((p) => p.id === "brita-denali-elite");
  assert.equal(
    L.annualCost(
      brita,
      catalog.replacement_families[brita.replacement_family],
      1,
    ).replacement_cost,
    52.98,
  );
});
test("complete certified matches sort ahead of partial matches; arsenic and grouped PFAS never assumed", () => {
  const r = L.matchFilters(catalog, {
    contaminants: ["lead", "nitrate"],
    gallons: 1,
    no_plumbing: true,
  });
  assert.equal(r[0].missing.length, 0);
  assert.ok(
    r.find((p) => p.id === "brita-denali-elite").missing.includes("nitrate"),
  );
  const a = L.matchFilters(catalog, { contaminants: ["arsenic"] });
  assert.ok(a.every((p) => p.missing.includes("arsenic")));
  const pf = L.matchFilters(catalog, { contaminants: ["PFOS"] });
  assert.ok(pf.find((p) => p.id === "pur-pfm150w").missing.includes("PFOS"));
});
test("unknown prices are never treated as free, and assistance received must be entered", () => {
  assert.equal(L.amount(""), null);
  assert.equal(L.amount(null), null);
  const p = catalog.products.find((p) => p.id === "pur-pfm150w");
  assert.equal(
    L.annualCost(p, catalog.replacement_families[p.replacement_family], 1),
    null,
  );
  assert.equal(L.bestPacks(2, [{ count: 2, price: null }]), null);
});
test("bill arithmetic includes credits and never silently treats a missing total as zero", () => {
  assert.deepEqual(
    L.billMath({ amount_due: 25, charges: [{ amount: 30 }, { amount: -5 }] }),
    { subtotal: 25, difference: 0, complete: false },
  );
  assert.equal(
    L.billMath({ amount_due: null, charges: [{ amount: 30 }] }),
    null,
  );
});
test("all six built-in languages have identical keys and placeholders", () => {
  const english = require("../public/help/en.json");
  for (const lang of ["es", "fr", "pt", "ht", "ar"]) {
    const data = require("../public/help/" + lang + ".json");
    assert.deepEqual(
      Object.keys(data).sort(),
      Object.keys(english).sort(),
      lang,
    );
    for (const key of Object.keys(english)) {
      assert.ok(data[key].trim(), lang + " " + key);
      assert.deepEqual(
        data[key].match(/\{\w+\}/g),
        english[key].match(/\{\w+\}/g),
        lang + " " + key,
      );
    }
  }
});
test("new front end avoids executable interpolation of user documents", () => {
  for (const f of ["app.js", "documents.js", "entry.js"]) {
    const code = fs.readFileSync(
      require.resolve("../public/help/" + f),
      "utf8",
    );
    assert.doesNotMatch(code, /\.innerHTML\s*=|eval\(/);
  }
});
