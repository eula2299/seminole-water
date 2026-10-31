window.WaterHelpI18n = (() => {
  let language = "en",
    dictionary = {},
    english = {};
  const supported = ["en", "es", "fr", "pt", "ht", "ar"];
  async function set(lang) {
    if (!supported.includes(lang)) lang = "en";
    if (!Object.keys(english).length) {
      const r = await fetch("/help/en.json", { cache: "no-cache" });
      if (!r.ok) throw Error("LANGUAGE_UNAVAILABLE");
      english = await r.json();
    }
    const r =
      lang === "en"
        ? null
        : await fetch("/help/" + lang + ".json", { cache: "no-cache" });
    if (r && !r.ok) throw Error("LANGUAGE_UNAVAILABLE");
    dictionary = r ? await r.json() : english;
    language = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem("water-help-language", lang);
    } catch {}
    return lang;
  }
  function t(key, values = {}) {
    return Object.entries(values).reduce(
      (s, [k, v]) => s.replaceAll("{" + k + "}", v),
      dictionary[key] || english[key] || key,
    );
  }
  function preferred() {
    try {
      const saved = localStorage.getItem("water-help-language");
      if (supported.includes(saved)) return saved;
    } catch {}
    const browser = navigator.language.split("-")[0];
    return supported.includes(browser) ? browser : "en";
  }
  function snapshot() {
    return { ...english, ...dictionary };
  }
  return {
    set,
    t,
    preferred,
    snapshot,
    get language() {
      return language;
    },
  };
})();
