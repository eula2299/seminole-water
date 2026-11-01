"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createAi } = require("../justice/ai");
const { createGroups } = require("../justice/groups");
test("AI only returns quoted extracted facts, never auto-confirms results, and stops at its cap", async () => {
  const text = "Example: Lead 12 ug/L. This is a fictional test report.";
  let calls = 0;
  const ai = createAi({
    key: "unit-test-not-a-real-key",
    dailyLimit: 1,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(
        new URL(url).origin,
        "https://generativelanguage.googleapis.com",
      );
      assert.equal(options.redirect, "error");
      const body = JSON.parse(options.body);
      assert.match(body.systemInstruction.parts[0].text, /untrusted/);
      const result = {
        summary: "Draft",
        next_steps: [],
        unknowns: [],
        facts: [
          { label: "result", value: "12", quote: "Lead 12 ug/L" },
          { label: "invented", value: "bad", quote: "not in input" },
        ],
        rows: [
          {
            name: "lead",
            value: 12,
            unit: "ug/L",
            qualifier: "",
            basis: "not stated",
            sample_date: "",
            quote: "Lead 12 ug/L",
            confirmed: true,
          },
          { name: "arsenic", value: 30, quote: "invented" },
        ],
      };
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: JSON.stringify(result) }] },
            },
          ],
        }),
      );
    },
  });
  const result = await ai.analyze({ kind: "lab", text });
  assert.equal(result.facts.length, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].confirmed, false);
  await assert.rejects(ai.analyze({ kind: "lab", text }), /AI_BUSY/);
  assert.equal(calls, 1);
});
test("group organizer and invitation keys have distinct privileges; invitation readers cannot see names", async (t) => {
  const rows = new Map();
  const pool = {
    async query(sql, p = []) {
      if (
        sql.startsWith("CREATE") ||
        sql.startsWith("DELETE FROM water_help_groups WHERE expires_at")
      )
        return { rows: [] };
      if (sql.startsWith("INSERT")) {
        rows.set(p[0], {
          id: p[0],
          owner_hash: p[1],
          invite_hash: p[2],
          title: p[3],
          request: p[4],
          supporters: [],
          expires_at: "2099-01-01",
        });
        return { rowCount: 1 };
      }
      if (sql.startsWith("SELECT")) {
        const r = rows.get(p[0]);
        return {
          rows:
            r &&
            r[sql.includes("owner_hash=$2") ? "owner_hash" : "invite_hash"] ===
              p[1]
              ? [r]
              : [],
        };
      }
      if (sql.startsWith("UPDATE")) {
        const r = rows.get(p[0]);
        if (!r || r.invite_hash !== p[1]) return { rowCount: 0 };
        r.supporters.push(...JSON.parse(p[2]));
        return { rowCount: 1 };
      }
      if (sql.startsWith("DELETE")) {
        rows.delete(p[0]);
        return { rowCount: 1 };
      }
      throw Error("unexpected query");
    },
    async end() {},
  };
  const groups = createGroups({ pool });
  t.after(() => groups.close());
  const g = await groups.create({
    title: "Example request",
    request: "Please review this fictional group request.",
    consent: true,
  });
  assert.notEqual(g.owner, g.invite);
  assert.notEqual(rows.get(g.id).owner_hash, g.owner);
  await assert.rejects(
    groups.join(g.id, g.invite, { name: "Example", consent: false }),
    /INVALID_SUPPORTER/,
  );
  await groups.join(g.id, g.invite, { name: "Example", consent: true });
  const invite = await groups.view(g.id, g.invite);
  assert.equal(invite.count, 1);
  assert.equal(invite.supporters, undefined);
  await assert.rejects(groups.view(g.id, g.invite, true), /NOT_FOUND/);
  const owner = await groups.view(g.id, g.owner, true);
  assert.equal(owner.supporters[0].name, "Example");
  await assert.rejects(groups.remove(g.id, g.invite), /NOT_FOUND/);
  await groups.remove(g.id, g.owner);
  await assert.rejects(groups.view(g.id, g.invite), /NOT_FOUND/);
});
