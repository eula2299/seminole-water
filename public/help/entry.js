(async () => {
  "use strict";
  const I = WaterHelpI18n;
  await I.set(I.preferred());
  const t = (k) => I.t(k),
    hub = document.getElementById("water-help-entry");
  if (!hub) return;
  const choice = document.getElementById("water-help-language");
  choice.value = I.language;
  let reportContext = null;
  const addressValues = () => ({
    address: document.getElementById("address")?.value || "",
    city: document.getElementById("city")?.value || "",
    state: document.getElementById("state")?.value || "",
  });
  window.addEventListener("water-report-ready", (e) => {
    reportContext = {
      action_token: e.detail?.action_token,
      location: addressValues(),
    };
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (
      !a ||
      new URL(a.href, location.href).origin !== location.origin ||
      !new URL(a.href, location.href).pathname.startsWith("/help")
    )
      return;
    const current = addressValues();
    try {
      sessionStorage.setItem(
        "water-help-context",
        JSON.stringify({
          location: current,
          action_token:
            reportContext &&
            JSON.stringify(current) === JSON.stringify(reportContext.location)
              ? reportContext.action_token
              : null,
          expires: Date.now() + 600000,
        }),
      );
    } catch {}
  });
  const titles = {
    en: "Can’t afford a water test? Start here. It’s free.",
    es: "¿No puedes pagar un análisis de agua? Empieza aquí. Es gratis.",
    fr: "Un test de l’eau coûte trop cher ? Commencez ici. C’est gratuit.",
    pt: "Não pode pagar um teste da água? Comece aqui. É grátis.",
    ht: "Ou pa ka peye pou teste dlo a? Kòmanse la. Li gratis.",
    ar: "لا تستطيع دفع تكلفة فحص المياه؟ ابدأ هنا. الخدمة مجانية.",
  };
  const descriptions = {
    en: "Enter your address. See available water results and free or lower-cost testing options. Public records do not replace a test of your own tap water.",
    es: "Escribe tu dirección. Consulta los resultados disponibles y opciones de análisis gratis o de menor costo. Los registros públicos no sustituyen un análisis del agua de tu grifo.",
    fr: "Entrez votre adresse. Consultez les résultats disponibles et les tests gratuits ou moins chers. Les données publiques ne remplacent pas un test de l’eau de votre robinet.",
    pt: "Digite seu endereço. Veja resultados disponíveis e testes gratuitos ou mais baratos. Registros públicos não substituem um teste da água da sua torneira.",
    ht: "Mete adrès ou. Gade rezilta ki disponib ak tès gratis oswa ki koute mwens. Dosye piblik pa ranplase yon tès dlo ki soti nan tiyo lakay ou.",
    ar: "أدخل عنوانك للاطلاع على نتائج المياه المتاحة وخيارات الفحص المجاني أو الأقل تكلفة. السجلات العامة لا تغني عن فحص مياه صنبور منزلك.",
  };
  const originals = new WeakMap();
  let translating = false;
  function apply() {
    document.documentElement.lang = I.language;
    document.documentElement.dir = I.language === "ar" ? "rtl" : "ltr";
    hub
      .querySelectorAll("[data-help-key]")
      .forEach((n) => (n.textContent = t(n.dataset.helpKey)));
    const hero = document.querySelector(".hero h1");
    if (hero) hero.textContent = titles[I.language];
    const intro = document.querySelector(".hero .intro");
    if (intro) intro.textContent = descriptions[I.language];
    const label = document.querySelector('label[for="address"]');
    if (label) label.textContent = t("street");
    const button = document.getElementById("lookup-button");
    if (button) button.textContent = t("address");
    for (const [id, key] of [
      ["address", "street"],
      ["city", "city"],
    ]) {
      const input = document.getElementById(id);
      if (input) {
        input.placeholder = t(key);
        input.setAttribute("aria-label", t(key));
      }
    }
    const state = document.getElementById("state");
    if (state) {
      state.options[0].textContent = t("state");
      state.setAttribute("aria-label", t("state"));
    }
    const note = document.getElementById("address-help");
    if (note) note.textContent = t("addressHint");
    const free = document.querySelector(".search-card .free");
    if (free) free.textContent = t("free");
    const translate = document.getElementById("water-help-translate");
    if (translate) translate.hidden = I.language === "en";
  }
  choice.addEventListener("change", async () => {
    await I.set(choice.value);
    apply();
  });
  apply();
  // Residents opt in before any result text is sent for translation.
  let config;
  try {
    config = await (await fetch("/api/help/config")).json();
  } catch {
    return;
  }
  if (!config.ai) return;
  const results = document.getElementById("results"),
    panel = document.createElement("details");
  panel.id = "water-help-translate";
  panel.className = "water-help-translate";
  panel.hidden = I.language === "en";
  const summary = document.createElement("summary");
  summary.textContent = t("aiTitle");
  panel.append(summary);
  const label = document.createElement("label"),
    consent = document.createElement("input");
  consent.type = "checkbox";
  label.append(consent, document.createTextNode(t("aiConsent")));
  panel.append(label);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = t("askAi");
  panel.append(button);
  const notice = document.createElement("p");
  panel.append(notice);
  results.after(panel);
  button.addEventListener("click", async () => {
    if (!consent.checked || translating) return;
    translating = true;
    button.disabled = true;
    notice.textContent = t("working");
    try {
      const walker = document.createTreeWalker(results, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          n.parentElement.closest("script,style,input,textarea") ||
          !n.textContent.trim()
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      if (nodes.length > 1000) throw Error();
      for (let i = 0; i < nodes.length; i += 20) {
        const group = nodes.slice(i, i + 20);
        for (const n of group)
          if (!originals.has(n)) originals.set(n, n.textContent);
        const texts = group.map((n) => originals.get(n));
        if (texts.some((x) => x.length > 1500) || texts.join("").length > 18000)
          continue;
        const r = await fetch("/api/help/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts, language: I.language, consent: true }),
        });
        if (!r.ok) throw Error();
        const data = await r.json();
        group.forEach((n, j) => (n.textContent = data.translations[j]));
      }
      notice.textContent = t("aiReview");
    } catch {
      notice.textContent = t("aiUnavailable");
    } finally {
      translating = false;
      button.disabled = false;
    }
  });
})().catch(() => {});
