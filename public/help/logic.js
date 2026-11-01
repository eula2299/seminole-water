(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WaterHelpLogic = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const analytes = [
    ["lead", /\blead\b/i],
    ["arsenic", /\barsenic\b/i],
    ["nitrate", /\bnitrate\b/i],
    ["nitrite", /\bnitrite\b/i],
    ["PFOA", /\bPFOA\b|perfluorooctanoic/i],
    ["PFOS", /\bPFOS\b|perfluorooctane\s*sulfon/i],
    ["PFHxS", /\bPFH[xX]S\b/i],
    ["PFNA", /\bPFNA\b/i],
    ["PFHpA", /\bPFHpA\b/i],
    ["PFBS", /\bPFBS\b/i],
    ["PFDA", /\bPFDA\b/i],
    ["copper", /\bcopper\b/i],
    ["cadmium", /\bcadmium\b/i],
    ["mercury", /\bmercury\b/i],
    ["fluoride", /\bfluoride\b/i],
    ["chlorine", /\bchlorine\b/i],
    ["E. coli", /e\.?\s*coli|escherichia/i],
    ["total coliform", /total\s+coliform/i],
  ];
  const clean = (v) =>
    String(v == null ? "" : v)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .slice(0, 50000);
  function canonical(name) {
    const found = analytes.find((x) => x[1].test(name));
    return found ? found[0] : clean(name).slice(0, 100);
  }
  function unit(v) {
    const u = String(v || "")
      .trim()
      .replace(/[μµ]/g, "u")
      .replace(/\s+/g, "")
      .toLowerCase();
    return (
      {
        "mg/l": "mg/L",
        "ug/l": "µg/L",
        "ng/l": "ng/L",
        ppm: "mg/L",
        ppb: "µg/L",
        ppt: "ng/L",
      }[u] || String(v || "").slice(0, 24)
    );
  }
  function parseLab(text) {
    const rows = [];
    let index = 0;
    for (const raw of clean(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const found = analytes.find((x) => x[1].test(line));
      if (!found) continue;
      const match = found[1].exec(line),
        tail = line
          .slice(match.index + match[0].length)
          .replace(/"/g, "")
          .replace(/,\s*(?=(?:mg|[uµμ]g|ng)\s*\/\s*l\b|pp[mbt]\b)/gi, " ");
      let result = tail.match(
        /(?:^|[\s,:;|])([<>≤≥]?)\s*(\d+(?:\.\d+)?|\.\d+)\s*(mg\s*\/\s*l|[uµμ]g\s*\/\s*l|ng\s*\/\s*l|ppm|ppb|ppt)\b/i,
      );
      // A decimal comma or thousands separator must not turn 12,000 into 000.
      if (result && /\d[\s,]*$/.test(tail.slice(0, result.index)))
        result = null;
      const nd = /\b(?:ND|not detected|non.detect)\b/i.test(tail),
        presence = /\b(present|absent|positive|negative)\b/i.exec(tail);
      if (!result && !nd && !presence) continue;
      rows.push({
        id: "row-" + index++,
        name: found[0],
        value: nd ? null : result ? Number(result[2]) : null,
        qualifier: nd ? "ND" : result ? result[1] : presence[1].toLowerCase(),
        unit: result ? unit(result[3]) : "",
        basis: /as\s*(?:N\b|nitrogen)/i.test(line)
          ? "as nitrogen"
          : /as\s*NO3/i.test(line)
            ? "as nitrate"
            : "not stated",
        sample_date: "",
        quote: line.slice(0, 600),
        confirmed: false,
      });
      if (rows.length >= 100) break;
    }
    return rows;
  }
  function validateRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .slice(0, 100)
      .filter((r) => r && typeof r.name === "string" && r.name.trim())
      .map((r, i) => ({
        id: "row-" + i,
        name: canonical(r.name),
        value:
          r.value === null || r.value === "" || r.value === undefined
            ? null
            : Number.isFinite(Number(r.value)) &&
                Number(r.value) >= 0 &&
                Number(r.value) < 1e12
              ? Number(r.value)
              : null,
        unit: unit(r.unit),
        qualifier: [
          "",
          "<",
          ">",
          "≤",
          "≥",
          "ND",
          "present",
          "absent",
          "positive",
          "negative",
        ].includes(r.qualifier)
          ? r.qualifier
          : "",
        basis: ["as nitrogen", "as nitrate", "not stated"].includes(r.basis)
          ? r.basis
          : "not stated",
        sample_date: /^\d{4}-\d{2}-\d{2}$/.test(r.sample_date || "")
          ? r.sample_date
          : "",
        quote: clean(r.quote).slice(0, 600),
        confirmed: r.confirmed === true,
      }));
  }
  function micrograms(row) {
    if (row.value === null) return null;
    return row.unit === "mg/L"
      ? row.value * 1000
      : row.unit === "µg/L"
        ? row.value
        : row.unit === "ng/L"
          ? row.value / 1000
          : null;
  }
  function interpret(row) {
    if (!row.confirmed) return { code: "confirm_result", level: "review" };
    if (
      row.qualifier === "ND" ||
      row.qualifier === "<" ||
      row.qualifier === "≤"
    )
      return { code: "below_reporting", level: "information" };
    if (/coli|coliform/i.test(row.name))
      return {
        code: /present|positive/.test(row.qualifier)
          ? "microbe_followup"
          : "microbe_guidance",
        level: /present|positive/.test(row.qualifier)
          ? "attention"
          : "information",
      };
    const amount = micrograms(row);
    if (amount === null) return { code: "unit_check", level: "review" };
    if (row.name === "lead" && amount > 0)
      return { code: "lead_followup", level: "attention" };
    if (row.name === "arsenic" && amount > 10)
      return { code: "arsenic_followup", level: "attention" };
    if (row.name === "nitrate" || row.name === "nitrite") {
      if (row.basis === "not stated")
        return { code: "nitrate_basis", level: "review" };
      const limit =
        row.name === "nitrate"
          ? row.basis === "as nitrogen"
            ? 10000
            : 44300
          : row.basis === "as nitrogen"
            ? 1000
            : null;
      if (limit !== null && amount > limit)
        return { code: "nitrate_followup", level: "attention" };
    }
    if (/^PF/.test(row.name) && amount > 0)
      return { code: "pfas_followup", level: "followup" };
    return { code: "report_context", level: "information" };
  }
  function parseBill(text) {
    const source = clean(text),
      amount = source.match(
        /(?:total\s+amount\s+due|total\s+due|amount\s+due|balance\s+due)\s*[:$\s]*([\d,]+\.\d{2})/i,
      ),
      due = source.match(
        /(?:due\s+date|pay\s+by|due\s+on)\s*[:\s]*([^\n]{4,35})/i,
      );
    const charges = [];
    for (const line of source.split(/\r?\n/)) {
      if (/total|amount due|balance due|current balance|new balance/i.test(line))
        continue;
      const m = line.match(/^\s*(.{2,65}?)\s+([($\-\s]*[\d,]+\.\d{2}\)?)(?:\s+(CR))?\s*$/i);
      if (
        m &&
        /water|sewer|storm|service|base|fee|tax|waste|usage|charge|payment|credit|previous balance|balance forward/i.test(m[1])
      )
        charges.push({
          label: m[1].trim(),
          amount: Number(m[2].replace(/[^\d.]/g, "")) * (m[3] || /[-(]/.test(m[2]) || /payment|credit/i.test(m[1]) ? -1 : 1),
          quote: line,
        });
    }
    return {
      amount_due: amount ? Number(amount[1].replace(/,/g, "")) : null,
      due_date: due ? due[1].trim() : "",
      charges,
      scope: "arithmetic-only",
      confirmed: false,
    };
  }
  function billMath(bill) {
    const amounts = (bill.charges || []).map((c) => Number(c.amount));
    if (
      !amounts.length ||
      amounts.some((v) => !Number.isFinite(v)) ||
      bill.amount_due === null ||
      bill.amount_due === "" ||
      !Number.isFinite(Number(bill.amount_due))
    )
      return null;
    const subtotal = Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;
    return {
      subtotal,
      difference: Math.round((Number(bill.amount_due) - subtotal) * 100) / 100,
      complete: bill.all_charges_confirmed === true,
    };
  }
  function bestPacks(needed, offers) {
    if (!needed) return { cost: 0, packs: [] };
    if (!Number.isInteger(needed) || needed < 0 || needed > 2000) return null;
    const choices = (offers || []).filter(
      (o) =>
        o.available !== false &&
        Number.isFinite(o.price) &&
        o.price >= 0 &&
        Number.isInteger(o.count) &&
        o.count > 0 &&
        o.count <= 24 &&
        !o.subscription,
    );
    if (!choices.length) return null;
    const max = Math.max(...choices.map((o) => o.count)),
      dp = Array(needed + max).fill(null);
    dp[0] = { cost: 0, packs: [] };
    for (let i = 1; i < dp.length; i++)
      for (const o of choices) {
        if (i >= o.count && dp[i - o.count]) {
          const cents =
            Math.round(dp[i - o.count].cost * 100) + Math.round(o.price * 100);
          if (!dp[i] || cents < Math.round(dp[i].cost * 100))
            dp[i] = {
              cost: cents / 100,
              packs: dp[i - o.count].packs.concat(o),
            };
        }
      }
    return (
      dp
        .slice(needed)
        .filter(Boolean)
        .sort((a, b) => a.cost - b.cost)[0] || null
    );
  }
  function annualCost(product, family, gallons, years = 1) {
    if (
      !Number.isFinite(gallons) ||
      gallons <= 0 ||
      gallons > 20 ||
      !family ||
      !Number.isInteger(years) ||
      years < 1 ||
      years > 5
    )
      return null;
    let cost = 0,
      orders = [];
    const elements = family.elements || [
      {
        sku: family.element,
        capacity_gallons: family.capacity_gallons_each,
        max_months: family.max_months,
        offers: family.offers,
      },
    ];
    for (const e of elements) {
      const cycles = Math.ceil(
        Math.max(
          e.capacity_gallons ? (365 * years * gallons) / e.capacity_gallons : 0,
          e.max_months ? (12 * years) / e.max_months : 0,
        ),
      );
      if (!cycles) return null;
      const needed = Math.max(0, cycles - 1),
        offers = e.offers || [
          { count: 1, price: e.price, url: e.url, available: e.available },
        ],
        cart = bestPacks(needed, offers);
      if (!cart) return null;
      cost += cart.cost;
      orders.push({
        element: e.sku,
        needed,
        cost: cart.cost,
        packs: cart.packs,
      });
    }
    return {
      replacement_cost: Math.round(cost * 100) / 100,
      first_year:
        typeof product.price === "number"
          ? Math.round((cost + product.price) * 100) / 100
          : null,
      years,
      total_cost:
        typeof product.price === "number"
          ? Math.round((cost + product.price) * 100) / 100
          : null,
      gallons_per_day: gallons,
      orders,
      excludes: [
        "tax",
        "shipping",
        "installation",
        "electricity",
        "reject water",
      ],
      estimate: true,
    };
  }
  function matchFilters(catalog, query) {
    const wanted = (query.contaminants || []).map(canonical),
      gallons = Number(query.gallons || 1),
      budget =
        query.budget === "" || query.budget == null
          ? Infinity
          : Number(query.budget);
    return catalog.products
      .map((p) => {
        const claims = p.certified_claims || [],
          covered = wanted.filter(
            (n) =>
              claims.includes(n) ||
              (n === "arsenic" &&
                claims.includes("pentavalent_arsenic") &&
                query.arsenic_confirmed === true),
          );
        const conditional =
          wanted.includes("arsenic") &&
          claims.includes("pentavalent_arsenic") &&
          query.arsenic_confirmed !== true;
        return {
          ...p,
          cost: annualCost(
            p,
            catalog.replacement_families[p.replacement_family],
            gallons,
          ),
          covered,
          missing: wanted.filter((n) => !covered.includes(n)),
          conditional,
          within_budget: typeof p.price === "number" && p.price <= budget,
          setup_matches: !query.no_plumbing || p.no_plumbing === true,
        };
      })
      .filter((p) => p.available !== false)
      .sort(
        (a, b) =>
          Number(b.setup_matches) - Number(a.setup_matches) ||
          Number(b.missing.length === 0 && wanted.length > 0) -
            Number(a.missing.length === 0 && wanted.length > 0) ||
          (a.cost?.first_year ?? Infinity) - (b.cost?.first_year ?? Infinity),
      );
  }
  function amount(v) {
    return v !== "" &&
      v !== null &&
      v !== undefined &&
      Number.isFinite(Number(v)) &&
      Number(v) >= 0
      ? Math.round(Number(v) * 100) / 100
      : null;
  }
  return {
    clean,
    canonical,
    unit,
    parseLab,
    validateRows,
    interpret,
    parseBill,
    billMath,
    bestPacks,
    annualCost,
    matchFilters,
    amount,
  };
});
