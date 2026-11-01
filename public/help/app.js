(async () => {
  "use strict";
  const I = WaterHelpI18n,
    L = WaterHelpLogic,
    V = WaterHelpVault,
    D = WaterHelpDocuments;
  await I.set(I.preferred());
  const t = (k, v) => I.t(V.isSessionOnly?.() && k === "saved" ? "keptForNow" : V.isSessionOnly?.() && k === "save" ? "keepForVisit" : k, v),
    main = document.getElementById("main");
  let X;
  let config = { ai: false, groups: false, promises: false, forms: [] },
    catalog = null,
    current = () => home(),
    reading = false;
  const memory = {
    labText: "",
    billText: "",
    labRows: [],
    report: null,
    location: { address: "", city: "", state: "" },
  };
  try {
    const saved = JSON.parse(
      sessionStorage.getItem("water-help-context") || "null",
    );
    if (saved && saved.expires > Date.now()) {
      for (const key of ["address", "city", "state"])
        memory.location[key] = String(saved.location?.[key] || "").slice(
          0,
          200,
        );
      memory.action_token = saved.action_token;
      if(saved.brief && typeof saved.brief === "object") memory.brief = saved.brief;
    } else sessionStorage.removeItem("water-help-context");
  } catch {}
  const configReady = api("/api/help/config")
    .then((value) => {
      config = value;
    })
    .catch(() => {});
  function el(tag, text, cls) {
    const x = document.createElement(tag);
    if (text !== undefined) x.textContent = text;
    if (cls) x.className = cls;
    return x;
  }
  function text(parent, key, cls, values) {
    const p = el("p", t(key, values), cls);
    parent.append(p);
    return p;
  }
  function heading(parent, key, level = "h2") {
    const h = el(level, t(key));
    parent.append(h);
    return h;
  }
  function box(parent, cls = "card") {
    const b = el("section", undefined, cls);
    parent.append(b);
    return b;
  }
  function link(parent, key, url, cls) {
    let safe;
    try {
      safe = new URL(url, location.origin);
      if (
        !["https:", "http:"].includes(safe.protocol) ||
        (safe.protocol === "http:" && safe.origin !== location.origin)
      )
        return;
    } catch {
      return;
    }
    const a = el("a", t(key), cls);
    a.href = safe.href;
    if (safe.origin !== location.origin) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    parent.append(a);
    return a;
  }
  function button(parent, key, fn, cls = "") {
    const b = el("button", t(key), cls);
    b.type = "button";
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      b.disabled = true;
      try {
        await fn();
      } catch (e) {
        if(e.message === "VAULT_LOCKED" && X) await X.vault(fn);
        else toast(t(e.message === "CHECK_FIRST" ? "checkFirst" : "error"));
      } finally {
        b.disabled = false;
      }
    });
    parent.append(b);
    return b;
  }
  function toast(message) {
    document.getElementById("notice").textContent = message;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(
      () => (document.getElementById("notice").textContent = ""),
      6500,
    );
  }
  async function api(url, body, headers = {}) {
    const r = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal: AbortSignal.timeout(95000),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error || "FAILED");
    return data;
  }
  function page(title, intro, back = home) {
    if (window.speechSynthesis) speechSynthesis.cancel();
    reading = false;
    main.replaceChildren();
    if (back) button(main, "back", back, "back");
    if(X && title!=="advocate") button(main,"askAdvocate",()=>X.advocate(title),"context-help quiet");
    heading(main, title, "h1");
    if (intro) text(main, intro, "lead");
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    return main;
  }
  function navigate(fn) {
    current = fn;
    return fn();
  }
  function field(parent, key, type = "text", value = "", hint) {
    const label = el("label", undefined, "field");
    label.append(el("span", t(key)));
    const input = document.createElement(
      type === "textarea" ? "textarea" : "input",
    );
    if (type !== "textarea") input.type = type;
    if (type === "number") input.step = "any";
    input.value = value ?? "";
    input.maxLength = type === "textarea" ? 8000 : 300;
    label.append(input);
    if (hint) label.append(el("small", t(hint)));
    parent.append(label);
    return input;
  }
  function select(parent, key, items, value) {
    const label = el("label", undefined, "field");
    label.append(el("span", t(key)));
    const input = el("select");
    for (const [v, k] of items) {
      const o = el("option", t(k));
      o.value = v;
      input.append(o);
    }
    if (value !== undefined) input.value = value;
    label.append(input);
    parent.append(label);
    return input;
  }
  function check(parent, key, checked = false) {
    const label = el("label", undefined, "check"),
      input = el("input");
    input.type = "checkbox";
    input.checked = checked;
    label.append(input, el("span", t(key)));
    parent.append(label);
    return input;
  }
  function actions(parent) {
    return box(parent, "actions");
  }
  function tile(parent, key, hint, fn, index) {
    const b = button(parent, key, () => navigate(fn), "tile");
    b.replaceChildren();
    if (index) b.append(el("span", String(index).padStart(2, "0"), "number"));
    b.append(
      el("strong", t(key)),
      el("span", t(hint), "hint"),
      el("span", "↗", "arrow"),
    );
    return b;
  }
  function detail(parent, key, content) {
    const d = el("details"),
      s = el("summary", t(key));
    d.append(s);
    if (typeof content === "function") content(d);
    else d.append(el("p", content));
    parent.append(d);
    return d;
  }
  function money(value) {
    return value === null || value === undefined
      ? t("costUnknown")
      : new Intl.NumberFormat(I.language, {
          style: "currency",
          currency: "USD",
        }).format(value);
  }
  function save(parent, item) {
    const b = box(parent, "save");
    text(b, "reviewSave", "fine");
    button(
      b,
      "save",
      async () => {
        const data = await V.put(typeof item === "function" ? item() : item);
        toast(t("saved"));
        return data;
      },
      "quiet",
    );
  }
  function lettersActions(parent, content) {
    const a = actions(parent);
    button(
      a,
      "copy",
      async () => {
        await D.copy(content());
        toast(t("copied"));
      },
      "quiet",
    );
    button(
      a,
      "download",
      () => D.download(content(), "water-help-request.txt"),
      "quiet",
    );
    button(a, "print", () => window.print(), "quiet");
  }
  function home() {
    current = home;
    page("home", "intro", null);
    main.prepend(el("p", t("free"), "eyebrow"));
    const lead = box(main, "card soft");
    if(memory.location.address){
      heading(lead,"usingAddress");
      lead.append(el("p",Object.values(memory.location).filter(Boolean).join(", ")));
      link(lead,"changeAddress","/#lookup-form","button quiet");
    }else{
      heading(lead, "address");
      text(lead, "addressHint");
      link(lead, "address", "/#lookup-form", "button");
    }
    const tiles = box(main, "tiles home-tiles");
    tile(tiles, "report", "reportHint", reportUpload);
    tile(tiles, "filters", "filtersHint", filterForm);
    tile(tiles, "moneyHelp", "moneyHelpHint", costs);
    tile(tiles, "repairs", "pipeHelpHint", repairs);
    tile(tiles, "rights", "advocacyHint", rights);
    tile(tiles, "formHelp", "formHelpHint", X.forms);
    button(main,"findLocalHelp",()=>X.local(),"quiet");
    button(main,"allTools",X.directory,"quiet");
    button(main,"plainGuides",X.guideLibrary,"quiet");
    button(main, "progress", () => navigate(progress), "quiet");
    detail(main, "privacyDetails", (d) => {
      text(d, "privacy");
      text(d, "aiData");
    });
  }
  function costs() {
    page("costs");
    button(main,"findLocalHelp",()=>X.local("assistance"),"quiet");
    localOptions(main);
    const tiles = box(main, "tiles");
    tile(tiles, "filters", "filtersHint", filterForm);
    tile(tiles, "bill", "billHint", billUpload);
    tile(tiles,"rateCheck","billHint",X.billRates);
    tile(tiles,"maintenance","maintenanceHint",X.maintenance);
    tile(tiles,"assistanceTracker","progressHint",X.assistance);
    tile(tiles, "assistance", "assistanceHint", () =>
      requestWizard("assistance"),
    );
    link(main, "address", "/#lookup-form", "button quiet");
  }
  function repairs() {
    page("repairs");
    button(main,"findLocalHelp",()=>X.local("repairs"),"quiet");
    const tiles = box(main, "tiles");
    tile(tiles, "pipes", "pipesHint", pipeForm);
    tile(tiles,"pipeMap","pipeMapIntro",X.pipeMaps);
    tile(tiles, "inspection", "inspectionHint", () =>
      requestWizard("inspection"),
    );
    tile(tiles, "repairForm", "repairFormHint", repairIntake);
    tile(tiles, "repairStatus", "repairStatusIntro", X.repairStatus);
    tile(tiles, "progress", "progressHint", progress);
  }
  function rights() {
    page("rights");
    button(main,"findLocalHelp",()=>X.local("support"),"quiet");
    const tiles = box(main, "tiles");
    tile(tiles, "complaint", "complaintHint", () => requestWizard("complaint"));
    tile(tiles, "treatment", "treatmentHint", X.treatment);
    tile(tiles,"complaintForms","complaintFormsIntro",X.complaints);
    tile(tiles,"publicPromises","publicPromisesIntro",X.commitments);
    tile(tiles,"escalation","escalationIntro",X.escalation);
    tile(tiles, "meetings", "meetingsHint", meetingForm);
    tile(tiles, "joint", "jointHint", groupForm);
  }
  function documentInput(kind, onContinue) {
    page(
      kind === "lab" ? "report" : "bill",
      kind === "lab" ? "uploadIntro" : "billIntro",
      kind === "lab" ? home : costs,
    );
    const panel = box(main);
    heading(panel, "uploadTitle");
    const file = field(panel, "file", "file", "", "fileHelp");
    file.accept = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv";
    const manualText = detail(panel,"pasteInstead",()=>{});
    const words = field(
      manualText,
      "text",
      "textarea",
      memory[kind + "Text"],
      "textHint",
    );
    words.maxLength = 50000;
    words.rows = 7;
    words.addEventListener(
      "input",
      () => (memory[kind + "Text"] = words.value),
    );
    const status = el("p", "", "muted");
    panel.append(status);
    let readingFile = false;
    async function readSelected() {
        if(readingFile)return;
        if (!file.files[0]) {
          file.focus();
          return;
        }
        status.textContent = t("working");
        readingFile = true;file.disabled = true;
        try {
          words.value = await D.read(
            file.files[0],
            I.language,
            (n) => (status.textContent = t("working") + " " + n + "%"),
          );
          memory[kind + "Text"] = words.value;
          if(!words.value.trim())throw Error("EMPTY_DOCUMENT");
          onContinue(words.value);
        } catch {
          status.textContent = t("readFileError");
          manualText.open = true;
        } finally {
          readingFile = false;file.disabled = false;
        }
    }
    file.addEventListener("change",readSelected);
    text(panel,"readsAutomatically","fine");
    const row = actions(manualText);
    button(row, kind === "lab" ? "findResults" : "continue", () => {
      memory[kind + "Text"] = words.value;
      onContinue(words.value);
    });
    if (kind === "lab")
      button(
        row,
        "manual",
        () => {
          memory.labRows = [emptyRow()];
          reviewLab(0);
        },
        "quiet",
      );
    aiHelp(
      panel,
      kind,
      () => words.value,
      (result) => {
        if (kind === "lab" && result.rows?.length) {
          memory.labRows = L.validateRows(result.rows);
          reviewLab(0);
        }
      },
    );
  }
  function reportUpload() {
    documentInput("lab", (words) => {
      memory.labRows = L.parseLab(words);
      if (!memory.labRows.length) {
        toast(t("noResults"));
        memory.labRows = [emptyRow()];
        return reviewLab(0);
      }
      reviewLabSummary();
    });
  }
  function reviewLabSummary(){
    page("review","reviewText",reportUpload);
    text(main,"reportLimit","fine");
    for(const [index,row] of memory.labRows.entries()){
      const b=box(main);b.append(el("h2",t(row.name)||t("analyte")),el("p",[row.qualifier,row.value,row.unit].filter(v=>v!==null&&v!=="").join(" ")));
      if(row.quote)detail(b,"original",row.quote);
      if(!row.unit || row.value===null)text(b,"notStated","fine");
      button(b,"edit",()=>reviewLab(index),"quiet");
    }
    const checked=check(main,"checkedAllResults");
    button(main,"explainResults",()=>{
      if(!checked.checked){checked.focus();throw Error("CHECK_FIRST");}
      memory.labRows=L.validateRows(memory.labRows.map(row=>({...row,confirmed:true})));
      reportResults();
    });
    button(main,"addResult",()=>{memory.labRows.push(emptyRow());reviewLab(memory.labRows.length-1);},"quiet");
    aiHelp(main,"lab",()=>memory.labText,result=>{memory.labRows=L.validateRows(result.rows);reviewLabSummary();});
  }
  const emptyRow = () => ({
    name: "",
    value: null,
    unit: "",
    qualifier: "",
    basis: "not stated",
    sample_date: "",
    confirmed: false,
    quote: "",
  });
  function reviewLab(index) {
    const row = memory.labRows[index];
    page("review", "reviewText", () =>
      index ? reviewLab(index - 1) : reportUpload(),
    );
    text(main, "reportLimit", "fine");
    main.append(el("p", index + 1 + " / " + memory.labRows.length, "step"));
    const b = box(main);
    if (row.quote) b.append(el("blockquote", row.quote));
    const name = field(b, "analyte", "text", row.name),
      qty = field(b, "quantity", "number", row.value ?? "");
    qty.min = "0";
    qty.step = "any";
    const unit = field(b, "unit", "text", row.unit);
    unit.placeholder = "µg/L, mg/L, ng/L, ppb, ppm";
    const q = select(
      b,
      "qualifier",
      [
        ["", "—"],
        ["<", "<"],
        [">", ">"],
        ["≤", "≤"],
        ["≥", "≥"],
        ["ND", "ND"],
        ["positive", "positive"],
        ["negative", "negative"],
        ["present", "present"],
        ["absent", "absent"],
      ],
      row.qualifier,
    );
    const basis = select(
      b,
      "basis",
      [
        ["not stated", "notStated"],
        ["as nitrogen", "asN"],
        ["as nitrate", "asNO3"],
      ],
      row.basis,
    );
    basis.parentElement.hidden = !["nitrate", "nitrite"].includes(
      L.canonical(name.value),
    );
    name.addEventListener(
      "input",
      () =>
        (basis.parentElement.hidden = !["nitrate", "nitrite"].includes(
          L.canonical(name.value),
        )),
    );
    const extra = detail(b, "details", () => {});
    const date = field(extra, "sampleDate", "date", row.sample_date);
    const confirmed = check(b, "checkedResult", row.confirmed);
    const capture = () => {
      Object.assign(row, {
        name: name.value,
        value: qty.value === "" ? null : Number(qty.value),
        unit: unit.value,
        qualifier: q.value,
        basis: basis.value,
        sample_date: date.value,
        confirmed: confirmed.checked,
      });
      if (!name.value.trim() || !confirmed.checked) {
        name.reportValidity();
        throw Error("CHECK_FIRST");
      }
    };
    const rowActions = actions(b);
    button(
      rowActions,
      index < memory.labRows.length - 1 ? "continue" : "explainResults",
      () => {
        capture();
        if (index < memory.labRows.length - 1) reviewLab(index + 1);
        else {
          memory.labRows = L.validateRows(memory.labRows);
          reportResults();
        }
      },
    );
    button(
      rowActions,
      "addResult",
      () => {
        capture();
        memory.labRows.push(emptyRow());
        reviewLab(memory.labRows.length - 1);
      },
      "quiet",
    );
    if (memory.labRows.length > 1)
      button(
        rowActions,
        "remove",
        () => {
          memory.labRows.splice(index, 1);
          reviewLab(Math.min(index, memory.labRows.length - 1));
        },
        "quiet",
      );
  }
  function reportResults() {
    page("confirmedResults", "reportLimit", () => reviewLab(0));
    for (const row of memory.labRows) {
      const result = L.interpret(row),
        b = box(
          main,
          "card" + (result.level === "attention" ? " warning" : ""),
        );
      b.append(
        el("h2", t(row.name)),
        el(
          "p",
          [row.qualifier, row.value, row.unit]
            .filter((x) => x !== null && x !== "")
            .join(" "),
          "money",
        ),
      );
      text(b, result.code);
      if (row.sample_date)
        b.append(el("p", t("sampleDate") + ": " + row.sample_date, "muted"));
      if (row.quote) detail(b, "original", row.quote);
    }
    link(
      main,
      "healthSource",
      "https://www.epa.gov/ground-water-and-drinking-water/national-primary-drinking-water-regulations",
      "source",
    );
    link(
      main,
      "source",
      "https://www.cdc.gov/lead-prevention/prevention/drinking-water.html",
      "source",
    );
    const row = actions(main);
    button(row, "askLab", () => requestWizard("lab"));
    button(row, "filters", filterForm, "quiet");
    save(main, () => ({
      kind: "report",
      title: t("report"),
      status: "followup",
      rows: memory.labRows,
      document: memory.labText,
      events: [],
    }));
  }
  function aiHelp(parent, kind, getText, apply) {
    const d = detail(parent, "aiTitle", async (p) => {
      await configReady;
      text(p, "aiDescription");
      link(p, "aiPrivacy", "https://ai.google.dev/gemini-api/terms", "source");
      if (!config.ai) {
        text(p, "aiUnavailable");
        return;
      }
      const consent = check(p, "aiConsent");
      const output = box(p, "");
      button(p, "askAi", async () => {
        if (!consent.checked) {
          consent.focus();
          return;
        }
        const words = getText();
        if (words.trim().length < 10) {
          toast(t("required"));
          return;
        }
        output.replaceChildren(el("p", t("working")));
        try {
          const result = await api("/api/help/analyze", {
            kind,
            text: words,
            language: I.language,
            consent: true,
          });
          output.replaceChildren(
            el("p", t("aiReview"), "badge"),
            el("p", result.summary),
          );
          if (result.next_steps?.length) {
            heading(output, "nextSteps", "h3");
            const ul = el("ul");
            result.next_steps.forEach((s) => ul.append(el("li", s)));
            output.append(ul);
          }
          if (result.unknowns?.length)
            detail(output, "unknowns", (q) =>
              result.unknowns.forEach((s) => q.append(el("p", s))),
            );
          if (apply && result.rows?.length)
            button(output, "review", () => apply(result), "quiet");
        } catch {
          output.replaceChildren(el("p", t("aiUnavailable")));
        }
      });
    });
    return d;
  }
  async function filterForm() {
    if (!catalog) catalog = await api("/api/help/filters");
    page("filters", "filtersIntro", costs);
    const b = box(main);
    heading(b, "substances", "h2");
    const selected = new Set(
      memory.labRows
        .filter(
          (r) =>
            r.confirmed &&
            !["ND", "<", "≤", "absent", "negative"].includes(r.qualifier) &&
            r.value > 0,
        )
        .map((r) => r.name),
    );
    const choices = [],
      more = detail(b, "details", () => {});
    for (const name of [
      "lead",
      "arsenic",
      "nitrate",
      "nitrite",
      "PFOA",
      "PFOS",
      "PFHxS",
      "PFNA",
      "PFHpA",
      "PFBS",
      "PFDA",
      "mercury",
      "cadmium",
      "fluoride",
      "chlorine",
    ]) {
      const input = check(
        ["lead", "arsenic", "nitrate", "PFOA", "PFOS"].includes(name) ||
          selected.has(name)
          ? b
          : more,
        name,
        selected.has(name),
      );
      choices.push([name, input]);
    }
    b.append(more);
    link(b, "noResultYet", "/#lookup-form");
    const budget = field(b, "budget", "number", "");
    budget.min = "0";
    budget.step = "0.01";
    const gallons = field(b, "gallons", "number", "1", "gallonsHelp");
    gallons.min = ".1";
    gallons.max = "20";
    gallons.step = ".1";
    const noPlumbing = check(b, "noPlumbing", true);
    button(b, "compare", () => {
      const wanted = choices.filter(([, c]) => c.checked).map(([n]) => n);
      if (!wanted.length || !gallons.checkValidity() || !gallons.value) {
        toast(t("required"));
        return;
      }
      filterResults({
        contaminants: wanted,
        budget: budget.value,
        gallons: Number(gallons.value),
        no_plumbing: noPlumbing.checked,
      });
    });
  }
  function filterResults(query) {
    page("filters", "excludedCosts", filterForm);
    text(main, "priceNote", "fine", { date: catalog.checked_at });
    if (catalog.stale) text(main, "stalePrice", "warning");
    const matches = L.matchFilters(catalog, query),
      fits = matches.filter((p) => !p.missing.length && p.setup_matches);
    if (!fits.length) text(main, "noFullMatch", "card warning");
    text(main, "notMicrobes", "fine");
    let visible = 0;
    const other = el("details");
    other.append(el("summary", t("details")));
    for (const p of matches) {
      const recommended = p.missing.length === 0 && p.setup_matches;
      const b = box(recommended && visible++ < 3 ? main : other);
      b.append(el("h2", p.name));
      if (!p.missing.length) b.append(el("span", t("matched"), "badge"));
      else
        b.append(
          el("p", t("missing") + ": " + p.missing.map(t).join(", "), "muted"),
        );
      if (
        typeof p.price === "number" &&
        !p.within_budget &&
        query.budget !== ""
      )
        text(b, "overBudget", "badge");
      if (!p.setup_matches) text(b, "needsPlumbing", "badge");
      const prices = box(b, "price-grid");
      for (const [k, v] of [
        ["upfront", p.price],
        ["firstYear", p.cost?.first_year],
      ]) {
        const cell = box(prices, "");
        cell.append(el("span", t(k), "muted"), el("strong", money(v), "money"));
      }
      if (p.conditional) text(b, "conditionArsenic", "warning");
      const a = actions(b);
      if (recommended) link(a, "seller", p.purchase_url, "button");
      link(a, "proof", p.performance_source, "button quiet");
      if(recommended) button(a,"maintenance",()=>X.maintenance(p,catalog.replacement_families[p.replacement_family],query.gallons),"quiet");
      detail(b, "cartridges", (d) => {
        if (p.cost) {
          d.append(
            el("p", t("replacement") + ": " + money(p.cost.replacement_cost)),
          );
          d.append(
            el(
              "p",
              t("longTerm") +
                ": " +
                money(
                  L.annualCost(
                    p,
                    catalog.replacement_families[p.replacement_family],
                    query.gallons,
                    3,
                  )?.total_cost,
                ),
            ),
          );
          for (const order of p.cost.orders) {
            d.append(el("p", order.element + " · " + order.needed));
            const counts = new Map();
            for (const pack of order.packs) {
              const id = pack.url + "|" + pack.count;
              const item = counts.get(id) || { ...pack, orders: 0 };
              item.orders++;
              counts.set(id, item);
            }
            for (const pack of counts.values()) {
              const row = el(
                "p",
                pack.orders +
                  " × " +
                  pack.count +
                  " · " +
                  money(pack.price) +
                  " ",
              );
              link(row, "seller", pack.url);
              d.append(row);
            }
          }
        } else text(d, "costUnknown");
        text(d, "excludedCosts", "fine");
      });
    }
    if (other.children.length > 1) main.append(other);
    button(main, "assistance", () => requestWizard("assistance"), "quiet");
  }
  function billUpload() {
    documentInput("bill", (words) => billSummary(L.parseBill(words)));
  }
  function billSummary(bill){
    if(bill.amount_due===null || !bill.charges.length)return billReview(bill);
    memory.bill=bill;
    page("bill","reviewText",billUpload);
    const b=box(main);b.append(el("h2",t("amountDue")+": "+money(bill.amount_due)));
    if(bill.due_date)b.append(el("p",t("dueDate")+": "+bill.due_date));
    for(const charge of bill.charges)b.append(el("p",charge.label+": "+money(charge.amount)));
    const confirmed=check(b,"billComplete");
    button(b,"checkBill",()=>{
      if(!confirmed.checked){confirmed.focus();throw Error("CHECK_FIRST");}
      const data={...bill,all_charges_confirmed:true};billResult(data,L.billMath(data));
    });
    button(b,"edit",()=>billReview(bill),"quiet");
    aiHelp(main,"bill",()=>memory.billText);
  }
  function billReview(bill) {
    page("bill", "billIntro", billUpload);
    const b = box(main),
      total = field(b, "amountDue", "number", bill.amount_due ?? "");
    total.step = ".01";
    const due = field(b, "dueDate", "text", bill.due_date),
      rows = [];
    const list = box(b, "stack");
    function add(charge = { label: "", amount: "" }) {
      const entry = box(list, "result-grid");
      const name = field(entry, "charge", "text", charge.label),
        value = field(entry, "amount", "number", charge.amount);
      value.step = ".01";
      rows.push({ name, value, entry });
      button(
        entry,
        "remove",
        () => {
          entry.remove();
          rows.splice(
            rows.findIndex((r) => r.entry === entry),
            1,
          );
        },
        "quiet",
      );
    }
    for (const c of bill.charges.length
      ? bill.charges
      : [{ label: "", amount: "" }])
      add(c);
    button(b, "addCharge", () => add(), "quiet");
    const all = check(b, "billComplete");
    button(b, "checkBill", () => {
      if (
        total.value === "" ||
        !rows.length ||
        rows.some(
          (r) =>
            r.value.value === "" ||
            !r.value.checkValidity() ||
            !r.name.value.trim(),
        )
      ) {
        toast(t("required"));
        return;
      }
      const data = {
        amount_due: Number(total.value),
        due_date: due.value,
        charges: rows.map((r) => ({
          label: r.name.value,
          amount: Number(r.value.value),
        })),
        all_charges_confirmed: all.checked,
      };
      const result = L.billMath(data);
      if (!result) {
        toast(t("required"));
        return;
      }
      billResult(data, result);
    });
  }
  function billResult(data, result) {
    page("review", "billIntro", () => billReview(data));
    const b = box(main);
    for (const [key, value] of [
      ["amountDue", data.amount_due],
      ["subtotal", result.subtotal],
      ["difference", result.difference],
    ])
      b.append(el("p", t(key) + ": " + money(value)));
    text(b, result.difference ? "billDifference" : "billEqual");
    const document =
      data.charges.map((c) => c.label + ": " + money(c.amount)).join("\n") +
      "\n" +
      t("amountDue") +
      ": " +
      money(data.amount_due) +
      "\n" +
      t("dueDate") +
      ": " +
      data.due_date;
    button(b, "billDraft", () => requestWizard("bill", { facts: document }));
    save(main, {
      kind: "bill",
      title: t("bill"),
      status: "prepared",
      bill: data,
      document,
      follow_date: "",
      events: [],
    });
  }
  function locationFields(parent, withStreet = false) {
    const fields = {};
    if (withStreet)
      fields.address = field(parent, "street", "text", memory.location.address);
    fields.city = field(parent, "city", "text", memory.location.city);
    fields.state = field(parent, "state", "text", memory.location.state);
    fields.state.maxLength = 2;
    return () => {
      for (const [k, i] of Object.entries(fields))
        memory.location[k] = i.value.trim();
      memory.location.state = memory.location.state.toUpperCase();
      if (
        !memory.location.city ||
        !/^[A-Z]{2}$/.test(memory.location.state) ||
        (withStreet && !memory.location.address)
      )
        throw Error("INVALID_LOCATION");
      return { ...memory.location };
    };
  }
  function pipeForm() {
    page("pipes", "pipeIntro", repairs);
    const b = box(main),
      values = locationFields(b, true);
    button(b, "lookupPipes", async () => {
      const data = await api("/api/help/pipes", values());
      page("pipes", "pipeCaution", pipeForm);
      if (data.status !== "found")
        text(
          main,
          data.status === "not_connected"
            ? "notConnected"
            : data.status === "unavailable"
              ? "sourceUnavailable"
              : "pipeNotFound",
          "card",
        );
      for (const record of data.records) {
        const c = box(main);
        c.append(el("h2", record.address), el("p", record.provider));
        for (const m of record.materials)
          c.append(
            el(
              "p",
              t(
                m.part === "public"
                  ? "publicPipe"
                  : m.part === "private"
                    ? "privatePipe"
                    : "wholePipe",
              ) +
                ": " +
                m.value,
            ),
          );
        link(c, "officialMap", record.url);
        if (record.inspection_url)
          link(c, "requestInspection", record.inspection_url, "button quiet");
        save(c, {
          kind: "pipe",
          title: record.address,
          status: "followup",
          record,
          document: [
            record.address,
            record.provider,
            ...record.materials.map(
              (m) =>
                t(
                  m.part === "public"
                    ? "publicPipe"
                    : m.part === "private"
                      ? "privatePipe"
                      : "wholePipe",
                ) +
                ": " +
                m.value,
            ),
            record.url,
          ].join("\n"),
          events: [],
        });
      }
      const a = actions(main);
      button(a, "requestInspection", () =>
        requestWizard("inspection", {
          facts: Object.values(memory.location).join(", "),
        }),
      );
      link(a, "waterOffice", data.directory, "button quiet");
      detail(main, "officialMap", (d) =>
        data.coverage.forEach((c) => {
          const p = el("p", c.city + " · " + c.state + " ");
          link(p, "officialMap", c.url);
          d.append(p);
        }),
      );
    });
  }
  function wizard(title, intro, fields, complete, values = {}, back = home) {
    let index = 0;
    function draw() {
      page(title, index === 0 ? intro : null, () =>
        index > 0 ? (index--, draw()) : back(),
      );
      main.append(el("p", index + 1 + " / " + fields.length, "step"));
      const b = box(main),
        f = fields[index],
        input = field(b, f.key, f.type || "text", values[f.name] || "", f.hint);
      input.required = f.required === true;
      const a = actions(b);
      button(a, index === fields.length - 1 ? "review" : "continue", () => {
        if (!input.checkValidity()) {
          input.reportValidity();
          return;
        }
        values[f.name] = input.value;
        if (index < fields.length - 1) {
          index++;
          draw();
        } else complete(values);
      });
      input.focus({ preventScroll: true });
    }
    draw();
  }
  function publicContext(){
    const p=memory.brief||{},lines=[];
    if(memory.location.address)lines.push(t("street")+": "+Object.values(memory.location).filter(Boolean).join(", "));
    if(p.provider)lines.push(t("waterProvider")+": "+p.provider);
    if(p.findings?.length){lines.push(t("reportLimit"));for(const f of p.findings.slice(0,5))lines.push([f.name,f.result,f.scope,f.date,f.source_url].filter(Boolean).join(" · "));}
    if(p.tests?.length)lines.push(t("substances")+": "+p.tests.join(", "));
    return lines.join("\n");
  }
  function localOptions(parent){
    const options=(memory.brief?.options||[]).filter(o=>o && typeof o.url==="string").slice().sort((a,b)=>(a.price??Infinity)-(b.price??Infinity)).slice(0,4);
    if(!options.length)return;
    const b=box(parent,"card soft");heading(b,"helpAlreadyFound");
    for(const o of options){const row=box(b,"result");row.append(el("h3",o.title),el("p",[o.test,o.price===0?t("free"):o.price==null?t("costUnknown"):money(o.price)].filter(Boolean).join(" · ")));if(o.note)row.append(el("p",o.note,"fine"));link(row,"portal",o.url,"button quiet");button(row,"prepareRequest",()=>requestWizard("assistance",{recipient:o.title,facts:[publicContext(),o.title,o.test,o.url].filter(Boolean).join("\n")}),"quiet");}
  }
  function requestWizard(kind, initial = {}, edit = false) {
    const base = {
      lab: "labQuestions",
      bill: "billQuestions",
      inspection: "inspectionQuestions",
      assistance: "assistanceQuestions",
      repair: "repairQuestions",
      meeting: "meetingQuestions",
      followup: "followupQuestions",
    };
    const values = {
      facts: initial.facts || (kind==="lab"&&memory.labRows.length?memory.labRows.map(r=>[r.name,r.qualifier,r.value,r.unit,r.sample_date].filter(v=>v!==null&&v!=="").join(" ")).join("\n"):publicContext()),
      request: t(base[kind] || "repairQuestions"),
      ...initial,
    };
    if(!edit && values.facts && ["assistance","inspection","repair","lab","bill"].includes(kind))return letter(kind,values);
    const fields = [
      {
        key: "whatHappened",
        name: "facts",
        type: "textarea",
        hint: "whatHappenedHelp",
        required: true,
      },
    ];
    if (kind === "treatment")
      fields.push(
        { key: "whyUnfair", name: "unfair", type: "textarea" },
        { key: "witnesses", name: "witnesses", type: "textarea" },
      );
    fields.push(
      { key: "whatNeed", name: "request", type: "textarea", required: true },
      { key: "recipient", name: "recipient", hint: "recipientHelp" },
      {
        key: "accessNeeds",
        name: "access",
        type: "textarea",
        hint: "accessNeedsHelp",
      },
      { key: "name", name: "name" },
    );
    wizard(
      "requestTitle",
      kind === "treatment" ? "treatmentIntro" : "letterIntro",
      fields,
      (v) => letter(kind, v),
      values,
      kind === "lab" ? reportResults : home,
    );
  }
  function letter(kind, v) {
    page("reviewLetter", "letterIntro", () => requestWizard(kind, v, true));
    const parts = [
      t("letterSubject"),
      v.recipient || "",
      t("letterOpening"),
      t("letterFacts") + ":\n" + v.facts,
    ];
    if (v.unfair) parts.push(t("whyUnfair") + ":\n" + v.unfair);
    if (v.witnesses) parts.push(t("witnesses") + ":\n" + v.witnesses);
    parts.push(t("letterRequest") + ":\n" + v.request);
    if (v.access) parts.push(t("letterAccess") + ":\n" + v.access);
    parts.push(
      t("letterClosing"),
      v.name || "",
      new Date().toLocaleDateString(I.language),
    );
    const draft = field(
      main,
      "reviewLetter",
      "textarea",
      parts.filter(Boolean).join("\n\n"),
    );
    draft.rows = 16;
    text(main, "draftOnly", "badge");
    lettersActions(main, () => draft.value);
    save(main, () => ({
      kind,
      title: t("letterSubject"),
      status: "prepared",
      document: draft.value,
      recipient: v.recipient,
      events: [],
    }));
    officeLinks(main, kind);
    aiHelp(main, "letter", () => draft.value);
  }
  function officeLinks(parent, kind) {
    const d = detail(parent, "sendTo", p => {
      text(p,"officeNote");
      const found=box(p,"card soft");
      const show = async () => {
        if(!memory.action_token){found.remove();return;}
        found.replaceChildren(el("p",t("working")));
        try{
          const lane={assistance:"afford",repair:"rent",inspection:"rent",lab:"explain"}[kind]||"followup";
          const result=await api("/api/national/action-contact",{token:memory.action_token,lane,goal:kind==="repair"?"repair":undefined});
          found.replaceChildren();
          for(const contact of result.contacts||[]){
            const row=box(found,"result");row.append(el("h3",contact.name),el("p",contact.email));
            if(contact.source_url)link(row,"source",contact.source_url);
            button(row,"copy",async()=>{await D.copy(contact.email);toast(t("copied"));},"quiet");
          }
          for(const route of result.routes||[]){const row=el("p",route.name+" ");link(row,"portal",route.url);found.append(row);}
          if(!found.children.length)text(found,"sourceUnavailable");
        }catch{found.replaceChildren(el("p",t("sourceUnavailable")));}
      };
      show();
      const urls=[
        ["waterOffice",memory.brief?.agency?.url||"https://www.epa.gov/DWdata/primacy-agency-drinking-water-data"],
        ["housingOffice","https://www.usa.gov/tenant-rights"],
        ["legalAid","https://www.lsc.gov/about-lsc/what-legal-aid/i-need-legal-help"]
      ];
      if(kind==="treatment"||kind==="complaint")urls.push(["civilRights","https://www.epa.gov/external-civil-rights/filing-discrimination-complaint-against-recipient-epa-funds"]);
      for(const [key,url] of urls){const row=el("p");link(row,key,url);p.append(row);}
      text(p,"nextOfficeHelp","fine");
    });
    d.open=true;
    return d;
  }
  async function repairIntake(saved = {}) {
    saved={residence_address:Object.values(memory.location).filter(Boolean).join(", "),...saved};
    await configReady;
    page("repairForm", "formIntro", repairs);
    text(main, "formEligibility", "card");
    const spec = config.forms.find((f) => f.id === "usda-rd3550-35");
    const links = actions(main);
    link(
      links,
      "rural",
      "https://eligibility.sc.egov.usda.gov/",
      "button quiet",
    );
    link(
      links,
      "officialProgram",
      spec?.program ||
        "https://www.rd.usda.gov/programs-services/single-family-housing-programs/single-family-housing-repair-loans-grants",
      "button quiet",
    );
    if (!spec || new Date().toISOString().slice(0, 10) > spec.expires_at) {
      text(main, "formExpired");
      return;
    }
    const basic = [
      { key: "name", name: "applicant_name" },
      { key: "fullAddress", name: "residence_address" },
      { key: "phone", name: "phone", type: "tel" },
      { key: "email", name: "email", type: "email" },
      {
        key: "repairDescription",
        name: "repairs_line_1",
        type: "textarea",
        required: true,
      },
    ];
    const finance = [
      { key: "birthdate", name: "applicant_birthdate", type: "date" },
      {
        key: "employmentIncome",
        name: "monthly_gross_employment_income",
        type: "number",
      },
      {
        key: "otherIncome",
        name: "monthly_gross_other_income",
        type: "number",
      },
      { key: "dependents", name: "dependents_names_ages" },
      { key: "medicalCosts", name: "monthly_medical_expenses", type: "number" },
      {
        key: "childcareCosts",
        name: "monthly_childcare_expenses",
        type: "number",
      },
      { key: "debtCosts", name: "monthly_debt_payments", type: "number" },
      {
        key: "mortgageCosts",
        name: "monthly_mortgage_excluding_tax_insurance",
        type: "number",
      },
      { key: "propertyTax", name: "annual_property_tax", type: "number" },
      {
        key: "homeInsurance",
        name: "annual_homeowner_insurance",
        type: "number",
      },
      {
        key: "retirementAssets",
        name: "retirement_assets_value",
        type: "number",
      },
      {
        key: "otherAssets",
        name: "nonretirement_assets_value",
        type: "number",
      },
      { key: "estimatedRepair", name: "estimated_repair_cost", type: "number" },
    ];
    function reviewForm(values) {
      page("review", "formPrivate", () => repairIntake(values));
      const inputs = {};
      for (const f of basic)
        inputs[f.name] = field(main, f.key, f.type || "text", values[f.name]);
      const extra = detail(main, "details", () => {});
      for (const f of finance) {
        inputs[f.name] = field(extra, f.key, f.type || "text", values[f.name]);
        if (f.type === "number") {
          inputs[f.name].min = "0";
          inputs[f.name].step = ".01";
        }
      }
      const capture = () =>
        Object.fromEntries(
          Object.entries(inputs).map(([k, i]) => [k, i.value]),
        );
      button(
        main,
        "financeHelp",
        () =>
          wizard(
            "financeHelp",
            "formPrivate",
            finance,
            reviewForm,
            capture(),
            () => reviewForm(capture()),
          ),
        "quiet",
      );
      button(main, "formDownload", async () => {
        const fields = capture();
        if (fields.applicant_birthdate) {
          const [y, m, d] = fields.applicant_birthdate.split("-");
          fields.applicant_birthdate = m + "/" + d + "/" + y;
        }
        const pdf = await D.fillForm(fields, spec.field_map);
        D.download(pdf, "USDA-repair-intake-review.pdf");
        toast(t("formReview"));
      });
      text(main, "formReview", "card soft");
      link(main, "localOffice", spec.office, "button quiet");
      save(main, () => ({
        kind: "assistance",
        title: t("repairForm"),
        status: "prepared",
        form_fields: capture(),
        document: [...basic, ...finance]
          .filter((f) => inputs[f.name].value)
          .map((f) => t(f.key) + ": " + inputs[f.name].value)
          .join("\n"),
        events: [],
      }));
    }
    const own = check(main, "ownHome");
    button(main, "fillForm", () => {
      if (!own.checked) {
        own.focus();
        return;
      }
      wizard(
        "repairForm",
        "formPrivate",
        basic,
        reviewForm,
        saved,
        repairIntake,
      );
    });
  }
  function meetingForm() {
    page("meetings", "meetingIntro", rights);
    const b = box(main),
      values = locationFields(b);
    button(b, "findMeetings", async () => {
      const data = await api("/api/help/meetings", values());
      page("meetings", "meetingIntro", meetingForm);
      if (data.status !== "found")
        text(
          main,
          data.status === "not_connected"
            ? "notConnected"
            : "sourceUnavailable",
          "card",
        );
      if (data.calendar) link(main, "calendar", data.calendar, "button quiet");
      if (data.directory)
        link(main, "calendar", data.directory, "button quiet");
      if (data.status === "found" && !data.events.length)
        text(main, "noMeetings");
      for (const event of data.events) {
        const b = box(main);
        b.append(
          el("h2", event.title),
          el("p", event.date + " · " + event.time + " · " + data.timezone),
          el("p", event.location),
        );
        if (event.deadline) {
          b.append(
            el(
              "p",
              t("deadline") +
                ": " +
                event.deadline.date +
                " " +
                event.deadline.time +
                " · " +
                event.deadline.timezone,
              "badge",
            ),
          );
          text(b, "confirmDeadline", "fine");
        }
        const a = actions(b);
        link(a, "calendar", event.url, "button quiet");
        if (event.agenda) link(a, "agenda", event.agenda, "button quiet");
        link(a, "signup", data.signup_source, "button quiet");
        X.reminder(a,{title:event.title,date:event.date,description:event.location+' · '+event.url,url:event.url});
        if(event.deadline)X.reminder(a,{title:t("deadline")+' · '+event.title,date:event.deadline.date,time:event.deadline.time,timezone:event.deadline.timezone,description:t("confirmDeadline"),url:event.deadline.source});
        button(
          a,
          "writeComment",
          () =>
            requestWizard("meeting", {
              facts: event.title + " · " + event.date,
            }),
          "quiet",
        );
        save(b, {
          kind: "meeting",
          title: event.title,
          status: "prepared",
          follow_date: event.date,
          document: [
            event.date,
            event.time,
            data.timezone,
            event.location,
            event.url,
          ].join("\n"),
          events: [],
        });
      }
      button(
        main,
        "commitment",
        () =>
          editStep({
            kind: "commitment",
            title: "",
            status: "followup",
            events: [],
          }),
        "quiet",
      );
    });
  }
  async function groupForm() {
    await configReady;
    page("joint", "jointIntro", rights);
    const title = field(main, "groupTitle", "text", ""),
      request = field(main, "groupText", "textarea", "");
    request.maxLength = 5000;
    title.maxLength = 150;
    text(main, "personalOnly", "fine");
    const consent = check(main, "groupConsent");
    if (!config.groups) text(main, "groupUnavailable", "card");
    else
      button(main, "createGroup", async () => {
        if (
          !consent.checked ||
          title.value.length < 3 ||
          request.value.length < 20
        ) {
          toast(t("required"));
          return;
        }
        const data = await api("/api/help/groups", {
          title: title.value,
          request: request.value,
          consent: true,
        });
        groupCreated(data, title.value, request.value);
      });
    lettersActions(main, () => title.value + "\n\n" + request.value);
  }
  function groupUrl(id, key, owner = false) {
    return (
      location.origin +
      "/help/join#" +
      new URLSearchParams({ id, key, ...(owner ? { owner: "1" } : {}) })
    );
  }
  function groupCreated(data, title, request) {
    page("joint", "keepOwner", rights);
    const invite = field(
      main,
      "inviteLink",
      "text",
      groupUrl(data.id, data.invite),
    );
    invite.readOnly = true;
    button(
      main,
      "copy",
      async () => {
        await D.copy(invite.value);
        toast(t("copied"));
      },
      "quiet",
    );
    const owner = field(
      main,
      "ownerLink",
      "text",
      groupUrl(data.id, data.owner, true),
    );
    owner.readOnly = true;
    save(main, {
      kind: "group",
      title,
      status: "prepared",
      document: request,
      group_id: data.id,
      owner_key: data.owner,
      invite_key: data.invite,
      events: [],
    });
    link(main, "progress", owner.value, "button");
  }
  async function groupView(id, key, owner) {
    page("joint", "working", home);
    try {
      const data = await api(
        "/api/help/groups/" + id + "/view",
        { owner },
        { "X-Help-Key": key },
      );
      page("joint", "jointIntro", home);
      const b = box(main);
      b.append(el("h2", data.title), el("pre", data.request));
      text(main, "notVerifiedSignatures", "fine");
      main.append(el("p", t("supporters") + ": " + data.count));
      if (owner) {
        const supporters = data.supporters
          .map((s) => s.name + " · " + s.date.slice(0, 10))
          .join("\n");
        main.append(el("pre", supporters));
        lettersActions(
          main,
          () =>
            data.title +
            "\n\n" +
            data.request +
            "\n\n" +
            t("supporters") +
            "\n" +
            supporters +
            "\n\n" +
            t("notVerifiedSignatures"),
        );
        officeLinks(main, "complaint");
        button(main,"submissionHelp",()=>X.submission({kind:"group",title:data.title,document:data.request+"\n\n"+supporters}),"quiet");
        button(
          main,
          "deleteGroup",
          async () => {
            if (!confirm(t("confirmDelete"))) return;
            await api(
              "/api/help/groups/" + id + "/delete",
              {},
              { "X-Help-Key": key },
            );
            location.hash = "";
            home();
            toast(t("groupDeleted"));
          },
          "quiet danger",
        );
      } else {
        const name = field(main, "name", "text", ""),
          consent = check(main, "joinConsent");
        button(main, "joinButton", async () => {
          if (!consent.checked || !name.value.trim()) {
            toast(t("required"));
            return;
          }
          await api(
            "/api/help/groups/" + id + "/join",
            { name: name.value, consent: true },
            { "X-Help-Key": key },
          );
          page("joined", null, home);
        });
      }
    } catch {
      page("joint", "error", home);
    }
  }
  async function progress() {
    if((await V.state()).locked)return X.vault(progress);
    page("progress", "progressIntro");
    const items = await V.list(),
      total = items.reduce((n, i) => n + (L.amount(i.received) || 0), 0);
    if (total)
      main.append(el("p", t("totalReceived") + ": " + money(total), "money"));
    const a = actions(main);
    button(a, "addStep", () =>
      editStep({ kind: "request", title: "", status: "prepared", events: [] }),
    );
    button(a, "backup", backupForm, "quiet");
    if(!V.isSessionOnly())button(a,"lockVault",()=>{V.lock();X.vault(progress);},"quiet");
    else text(main,"sessionOnlyWarning","card warning");
    if (!items.length) text(main, "emptyProgress", "empty");
    for (const item of items) {
      const b = box(main);
      b.append(
        el("h2", item.title),
        el("span", t(item.status || "prepared"), "badge"),
      );
      if (item.follow_date) {
        b.append(el("p", t("followDate") + ": " + item.follow_date));
        X.reminder(b,{title:item.title,date:item.follow_date,description:item.document||""});
      }
      if(item.promise_id)button(b,"updatePromise",()=>X.updatePromise(item.promise_id,item.owner_key),"quiet");
      if (item.promised) b.append(el("p", item.promised));
      const a = actions(b);
      button(a, "edit", () => editStep(item), "quiet");
      if (item.form_fields)
        button(a, "fillForm", () => repairIntake(item.form_fields), "quiet");
      button(
        a,
        "exportRecord",
        () =>
          D.download(
            [
              item.title,
              t(item.status || "prepared"),
              item.document || "",
              item.promised || "",
              item.receipt || "",
              item.follow_date || "",
              ...(item.events || []).map(
                (e) => e.date + " · " + t(e.status) + " · " + (e.note || ""),
              ),
            ]
              .filter(Boolean)
              .join("\n\n"),
            "water-help-record.txt",
          ),
        "quiet",
      );
      if (item.kind === "group" && item.group_id)
        button(
          a,
          "joint",
          () => groupView(item.group_id, item.owner_key, true),
          "quiet",
        );
      button(
        a,
        "followupLetter",
        () =>
          requestWizard("followup", {
            facts: (item.document || item.title) + "\n" + (item.receipt || ""),
            recipient: item.recipient || "",
          }),
        "quiet",
      );
      button(
        a,
        "delete",
        async () => {
          if (confirm(t("confirmDelete"))) {
            await V.remove(item.id);
            progress();
          }
        },
        "quiet danger",
      );
    }
  }
  async function editStep(item) {
    page("progress", "proofStatus", progress);
    const title = field(main, "stepTitle", "text", item.title),
      status = select(
        main,
        "status",
        [
          "prepared",
          "submitted",
          "acknowledged",
          "scheduled",
          "resolved",
          "followup",
        ].map((k) => [k, k]),
        item.status || "prepared",
      ),
      follow = field(main, "followDate", "date", item.follow_date || ""),
      extra = detail(main, "details", () => {}),
      promised = field(extra, "promised", "textarea", item.promised || ""),
      received = field(
        extra,
        "received",
        "number",
        item.received ?? "",
        "receivedHelp",
      );
    received.min = "0";
    received.step = ".01";
    const receipt = field(extra, "receipt", "text", item.receipt || ""),
      notes = field(extra, "notes", "textarea", item.document || ""),
      file = field(extra, "evidence", "file", "", "evidenceHelp");
    file.accept = ".pdf,.png,.jpg,.jpeg,.webp,.txt";
    const attachments = [...(item.attachments || [])];
    for (const attachment of attachments) {
      const row = el("p", attachment.name + " ");
      button(
        row,
        "download",
        () => {
          const bytes = Uint8Array.from(atob(attachment.data), (c) =>
            c.charCodeAt(0),
          );
          D.download(
            new Blob([bytes], { type: attachment.type }),
            attachment.name,
          );
        },
        "quiet",
      );
      extra.append(row);
    }
    button(main, "save", async () => {
      if (!title.value.trim()) {
        toast(t("required"));
        return;
      }
      if (file.files[0]) {
        const f = file.files[0];
        if (f.size > 8 * 1024 * 1024) throw Error("TOO_LARGE");
        const data = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result.split(",")[1]);
          r.onerror = reject;
          r.readAsDataURL(f);
        });
        attachments.push({
          name: f.name,
          type: f.type || "application/octet-stream",
          data,
        });
      }
      const event = {
        date: new Date().toISOString(),
        status: status.value,
        note: promised.value,
        receipt: receipt.value,
      };
      await V.put({
        ...item,
        title: title.value,
        status: status.value,
        follow_date: follow.value,
        promised: promised.value,
        received: L.amount(received.value),
        receipt: receipt.value,
        document: notes.value,
        attachments,
        events: [...(item.events || []), event].slice(-100),
      });
      toast(t("saved"));
      await progress();
    });
    if (item.events?.length)
      detail(main, "history", (d) =>
        item.events.forEach((e) =>
          d.append(
            el(
              "p",
              e.date.slice(0, 10) +
                " · " +
                t(e.status) +
                " · " +
                (e.note || ""),
            ),
          ),
        ),
      );
  }
  function backupForm() {
    page("backup", "progressIntro", progress);
    if (!crypto.subtle) {
      text(main, "backupSecure", "card");
      return;
    }
    const password = field(main, "password", "password", "", "passwordHelp");
    password.minLength = 12;
    password.autocomplete = "new-password";
    button(main, "backup", async () => {
      if (password.value.length < 12) {
        password.reportValidity();
        return;
      }
      D.download(
        await V.backup(password.value),
        "water-help-backup.json",
        "application/json",
      );
    });
    const b = box(main);
    heading(b, "restore");
    const file = field(b, "backupFile", "file");
    file.accept = ".json";
    button(
      b,
      "restore",
      async () => {
        if (!file.files[0] || password.value.length < 12) {
          toast(t("required"));
          return;
        }
        try {
          await V.restore(await file.files[0].text(), password.value);
          toast(t("restored"));
          progress();
        } catch {
          toast(t("backupError"));
        }
      },
      "quiet",
    );
  }
  X=WaterHelpExtended.create({I,L,V,D,main,page,el,text,box,field,select,check,button,link,actions,detail,save,toast,api,tile,money,requestWizard,home,editStep,progress,configReady,getConfig:()=>config,costs,repairs,rights,repairIntake,billUpload,wizard,pipeForm,reportUpload,filterForm,meetingForm,groupForm,getLocation:()=>({...memory.location}),publicContext,localOptions});
  function chrome() {
    document.getElementById("language").value = I.language;
    document.getElementById("language").disabled = false;
    document
      .getElementById("large")
      .setAttribute("aria-label", t("largerText"));
    document.querySelector(".skip").textContent = t("skipHelp");
    document.getElementById("speak").textContent = t(
      reading ? "stopReading" : "readAloud",
    );
    const foot = document.getElementById("footer");
    foot.replaceChildren(el("p", t("footer")));
  }
  document.getElementById("language").addEventListener("change", async (e) => {
    e.target.disabled = true;
    try {
      const before = I.snapshot();
      await I.set(e.target.value);
      const translation = new Map(
        Object.entries(before).map(([key, value]) => [value, t(key)]),
      );
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (
          translation.has(n.textContent) &&
          !n.parentElement.closest("textarea,input,pre,blockquote")
        )
          n.textContent = translation.get(n.textContent);
      }
      chrome();
    } catch {
      toast(t("error"));
    } finally {
      e.target.disabled = false;
    }
  });
  document.getElementById("large").addEventListener("click", (e) => {
    const large = document.documentElement.classList.toggle("large");
    e.currentTarget.setAttribute("aria-pressed", String(large));
  });
  document.getElementById("speak").addEventListener("click", () => {
    if (!window.speechSynthesis) {
      toast(t("readUnavailable"));
      return;
    }
    speechSynthesis.cancel();
    if (reading) {
      reading = false;
      chrome();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(
      main.innerText.slice(0, 12000),
    );
    utterance.lang = I.language;
    utterance.rate = 0.85;
    reading = true;
    utterance.onend = () => {
      reading = false;
      chrome();
    };
    utterance.onerror = () => {
      reading = false;
      chrome();
      toast(t("readUnavailable"));
    };
    speechSynthesis.speak(utterance);
    chrome();
  });
  chrome();
  const hash = new URLSearchParams(location.hash.slice(1));
  if (location.pathname === "/help/join" && hash.get("id") && hash.get("key")) {
    current = () =>
      groupView(hash.get("id"), hash.get("key"), hash.get("owner") === "1");
    current();
  } else {
    const route = {
      "/help/report": reportUpload,
      "/help/costs": costs,
      "/help/repairs": repairs,
      "/help/rights": rights,
      "/help/progress": progress,
      "/help/forms":X.forms,
      "/help/tools":X.directory,
      "/help/local":X.local,
      "/help/filters":filterForm,
      "/help/bills":billUpload,
      "/help/maintenance":X.maintenance,
      "/help/assistance":X.assistance,
      "/help/advocate":X.advocate,
      "/help/promises":()=>hash.get("id")&&hash.get("key")?X.updatePromise(hash.get("id"),hash.get("key")):X.commitments(),
      "/help/complaints":X.complaints,
      "/help/escalation":X.escalation,
      "/help/guides":X.guideLibrary,
      "/help/status":X.repairStatus,
      "/help/pipes":pipeForm,
    };
    current = route[location.pathname] || home;
    current();
  }
})().catch(() => {
  document.getElementById("main").textContent =
    "Help could not load. Please refresh this page. / No se pudo cargar la ayuda. Actualiza la página.";
});
