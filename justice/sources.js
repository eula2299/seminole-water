"use strict";
const sources = require("./local-sources.json");
const safeLink = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
};
const norm = (v) =>
  String(v || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
async function json(url, fetcher = fetch) {
  const r = await fetcher(url, {
    signal: AbortSignal.timeout(12000),
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw Error("SOURCE_UNAVAILABLE");
  }
  let size = 0,
    parts = [];
  for await (const chunk of r.body) {
    size += chunk.length;
    if (size > 2e6) throw Error("SOURCE_TOO_LARGE");
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString());
}
function materialLabel(s, value) {
  const mapped = s.material_values[String(value)] || String(value ?? "Unknown");
  return (
    {
      lead_confirmed: "Lead recorded",
      non_lead_inventory: "No lead recorded",
      unknown_likely_lead: "Unknown; likely lead",
      unknown_unlikely_lead: "Unknown; unlikely lead",
    }[mapped] || mapped
  );
}
async function pipes(input, fetcher = fetch) {
  const city = norm(input.city),
    state = norm(input.state),
    address = norm(input.address);
  if (address.length < 3 || address.length > 200)
    throw Object.assign(Error("INVALID_ADDRESS"), { status: 400 });
  const connectors = sources.pipes.filter(
    (s) => norm(s.city) === city && s.state === state,
  );
  const records = [];
  let unavailable = false;
  for (const s of connectors) {
    const u = new URL(s.query_endpoint);
    u.search = new URLSearchParams({
      where: `UPPER(${s.address_field}) = '${address.replace(/'/g, "''")}'`,
      outFields: s.out_fields.join(","),
      returnGeometry: "false",
      resultRecordCount: "5",
      f: "json",
    });
    try {
      const data = await json(u, fetcher);
      if (data.error) throw Error();
      for (const f of data.features || []) {
        const a = f.attributes;
        if (norm(a[s.address_field]) !== address) continue;
        if (a.PREM_CITY && norm(a.PREM_CITY) !== city) continue;
        if (a.PREM_STATE && norm(a.PREM_STATE) !== state) continue;
        records.push({
          address: a[s.address_field],
          provider: s.provider,
          materials: s.material_fields.map((k, i) => ({
            part:
              s.material_fields.length === 2
                ? i === 0
                  ? "public"
                  : "private"
                : "whole",
            value: materialLabel(s, a[k]),
          })),
          updated: s.date_field ? a[s.date_field] : null,
          url: s.official_map,
          inspection_url: s.inspection_route,
          repair_url: s.repair_route || null,
        });
      }
    } catch {
      unavailable = true;
    }
  }
  return {
    status: unavailable
      ? "unavailable"
      : !connectors.length
        ? "not_connected"
        : records.length
          ? "found"
          : "not_found",
    records,
    coverage: sources.pipes.map((s) => ({
      city: s.city,
      state: s.state,
      url: s.official_map,
    })),
    directory: "https://www.epa.gov/DWdata/primacy-agency-drinking-water-data",
  };
}
function localDate(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function clock(value) {
  const m = String(value || "").match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] > 59) return null;
  return ((+m[1] % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + +m[2];
}
function deadline(event, client) {
  const t = clock(event.EventTime),
    type = event.EventBodyName || "";
  if (
    client.client !== "pittsburgh" ||
    !["City Council", "Standing Committee", "Standing Committees"].includes(
      type,
    ) ||
    t === null ||
    t < 60 ||
    /hearing|post.?agenda|cancel/i.test(type + " " + (event.EventComment || ""))
  )
    return null;
  const mins = t - 60;
  return {
    date: String(event.EventDate).slice(0, 10),
    time:
      String(Math.floor(mins / 60)).padStart(2, "0") +
      ":" +
      String(mins % 60).padStart(2, "0"),
    timezone: client.timezone,
    source: client.official_signup_source,
    kind: "registration",
    confirm: true,
  };
}
async function meetings(input, fetcher = fetch, now = new Date()) {
  const client = sources.meetings.clients.find(
    (c) => norm(c.city) === norm(input.city) && c.state === norm(input.state),
  );
  if (!client)
    return {
      status: "not_connected",
      events: [],
      directory: "https://www.usa.gov/local-governments",
      coverage: sources.meetings.clients.map((c) => c.city),
    };
  const u = new URL(client.endpoint);
  u.search = new URLSearchParams({
    $filter: `EventDate ge datetime'${localDate(now, client.timezone)}T00:00:00'`,
    $orderby: "EventDate asc",
    $top: "20",
  });
  try {
    const data = await json(u, fetcher);
    if (!Array.isArray(data)) throw Error();
    return {
      status: "found",
      city: client.city,
      timezone: client.timezone,
      calendar: client.official_calendar,
      signup_url: client.signup_url,
      signup_source: client.official_signup_source,
      events: data.map((e) => ({
        id: e.EventId,
        title: String(e.EventBodyName || "").slice(0, 250),
        date: String(e.EventDate).slice(0, 10),
        time: e.EventTime,
        location: String(e.EventLocation || "")
          .replace(/<[^>]*>/g, "")
          .slice(0, 500),
        url: safeLink(e.EventInSiteURL) || client.official_calendar,
        agenda: safeLink(e.EventAgendaFile),
        status: e.EventAgendaStatusName,
        deadline: deadline(e, client),
      })),
    };
  } catch {
    return {
      status: "unavailable",
      events: [],
      calendar: client.official_calendar,
    };
  }
}
module.exports = { pipes, meetings, deadline, localDate, norm, safeLink };
