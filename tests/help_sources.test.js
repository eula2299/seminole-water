"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { pipes, meetings, deadline } = require("../justice/sources");
const mock = (data) => async () =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
test("pipe query only requests necessary fields and accepts an exact address, never a nearby one", async () => {
  let query;
  const data = await pipes(
    { address: "123 O'NEIL ST", city: "Pittsburgh", state: "PA" },
    async (url) => {
      query = new URL(url);
      return mock({
        features: [
          {
            attributes: {
              Address: "123 O'NEIL ST",
              FinalReportedMaterialPublic: "Lead",
              FinalReportedMaterialPrivate: "Unknown",
            },
          },
          {
            attributes: {
              Address: "125 O'NEIL ST",
              FinalReportedMaterialPublic: "NonLead",
            },
          },
        ],
      })();
    },
  );
  assert.equal(
    query.searchParams.get("where"),
    "UPPER(Address) = '123 O''NEIL ST'",
  );
  assert.ok(!query.searchParams.get("outFields").includes("*"));
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].materials[0].value, "Lead");
  assert.equal(data.records[0].materials[1].value, "Unknown");
});
test("unconnected locations are a coverage gap, not a no-lead finding", async () => {
  let fetched = false;
  const d = await pipes(
    { address: "123 MAIN ST", city: "Orlando", state: "FL" },
    () => {
      fetched = true;
    },
  );
  assert.equal(d.status, "not_connected");
  assert.equal(fetched, false);
});
test("Denver machine status is converted to public wording", async () => {
  const d = await pipes(
    { address: "5912 BOSTON CT", city: "Denver", state: "CO" },
    mock({
      features: [
        {
          attributes: {
            prem_full_addr: "5912 BOSTON CT",
            PREM_CITY: "DENVER",
            PREM_STATE: "CO",
            lsli_final_lead_cat:
              "No lead service line. Not included in Lead Reduction Program.",
          },
        },
      ],
    }),
  );
  assert.equal(d.records[0].materials[0].value, "No lead recorded");
});
test("meeting query uses the local calendar date, not UTC date during midnight boundary", async () => {
  let url;
  await meetings(
    { city: "Denver", state: "CO" },
    async (u) => {
      url = new URL(u);
      return mock([])();
    },
    new Date("2026-11-01T02:00:00Z"),
  );
  assert.match(url.searchParams.get("$filter"), /2026-10-31/);
});
test("comment deadline is only derived for known meeting types, retaining timezone", () => {
  const client = {
    client: "pittsburgh",
    timezone: "America/New_York",
    official_signup_source: "https://example.gov",
  };
  const e = {
    EventBodyName: "City Council",
    EventTime: "10:00 AM",
    EventDate: "2026-11-03T00:00:00",
  };
  assert.equal(deadline(e, client).time, "09:00");
  assert.equal(deadline({ ...e, EventBodyName: "Post Agenda" }, client), null);
  assert.equal(
    deadline({ ...e, EventBodyName: "Public Hearing" }, client),
    null,
  );
  assert.equal(deadline(e, { ...client, client: "denver" }), null);
});
