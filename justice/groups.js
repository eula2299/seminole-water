"use strict";
const crypto = require("node:crypto");
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const token = () => crypto.randomBytes(24).toString("base64url");
function createGroups({
  connectionString = process.env.DATABASE_URL,
  pool = null,
} = {}) {
  let db = pool,
    ready = null,
    purge = null;
  if (!db && connectionString) {
    const { Pool } = require("pg");
    db = new Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 5000,
      statement_timeout: 8000,
      ssl:
        process.env.PGSSLMODE === "require"
          ? { rejectUnauthorized: true }
          : undefined,
    });
    db.on("error", () => {});
  }
  async function init() {
    if (!db) throw Object.assign(Error("GROUPS_UNAVAILABLE"), { status: 503 });
    if (!ready)
      ready = db
        .query(
          "CREATE TABLE IF NOT EXISTS water_help_groups (id text PRIMARY KEY, owner_hash text NOT NULL, invite_hash text NOT NULL, title text NOT NULL, request text NOT NULL, supporters jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now() + interval '90 days')",
        )
        .catch((e) => {
          ready = null;
          throw e;
        });
    await ready;
  }
  async function access(id, secret, owner = false) {
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(id) || !secret || secret.length > 100)
      throw Object.assign(Error("NOT_FOUND"), { status: 404 });
    await init();
    const r = await db.query(
      `SELECT * FROM water_help_groups WHERE id=$1 AND ${owner ? "owner_hash" : "invite_hash"}=$2 AND expires_at>now()`,
      [id, hash(secret)],
    );
    if (!r.rows[0]) throw Object.assign(Error("NOT_FOUND"), { status: 404 });
    return r.rows[0];
  }
  if (db) {
    const clean = () =>
      init()
        .then(() =>
          db.query("DELETE FROM water_help_groups WHERE expires_at<now()"),
        )
        .catch(() => {});
    purge = setInterval(clean, 60 * 60 * 1000);
    purge.unref();
    clean();
  }
  return {
    enabled: !!db,
    async available() {
      try {
        await init();
        return true;
      } catch {
        return false;
      }
    },
    async create(body) {
      if (
        body.consent !== true ||
        typeof body.title !== "string" ||
        typeof body.request !== "string" ||
        body.title.length < 3 ||
        body.title.length > 150 ||
        body.request.length < 20 ||
        body.request.length > 5000
      )
        throw Object.assign(Error("INVALID_GROUP"), { status: 400 });
      await init();
      const id = token(),
        owner = token(),
        invite = token();
      await db.query("DELETE FROM water_help_groups WHERE expires_at<now()");
      await db.query(
        "INSERT INTO water_help_groups(id,owner_hash,invite_hash,title,request) VALUES($1,$2,$3,$4,$5)",
        [id, hash(owner), hash(invite), body.title, body.request],
      );
      return { id, owner, invite, expires_days: 90 };
    },
    async view(id, secret, owner = false) {
      const r = await access(id, secret, owner);
      return {
        id: r.id,
        title: r.title,
        request: r.request,
        count: r.supporters.length,
        expires_at: r.expires_at,
        ...(owner ? { supporters: r.supporters } : {}),
      };
    },
    async join(id, secret, body) {
      if (
        body.consent !== true ||
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.length > 100
      )
        throw Object.assign(Error("INVALID_SUPPORTER"), { status: 400 });
      await access(id, secret);
      const supporter = {
        name: body.name.trim(),
        date: new Date().toISOString(),
        id: token(),
      };
      const r = await db.query(
        "UPDATE water_help_groups SET supporters=supporters || $3::jsonb WHERE id=$1 AND invite_hash=$2 AND expires_at>now() AND jsonb_array_length(supporters)<200 RETURNING id",
        [id, hash(secret), JSON.stringify([supporter])],
      );
      if (!r.rowCount)
        throw Object.assign(Error("GROUP_FULL"), { status: 409 });
      return { recorded: true, submitted_to_official: false };
    },
    async remove(id, secret) {
      await access(id, secret, true);
      await db.query(
        "DELETE FROM water_help_groups WHERE id=$1 AND owner_hash=$2",
        [id, hash(secret)],
      );
      return { deleted: true };
    },
    close: () => {
      clearInterval(purge);
      return db?.end();
    },
  };
}
module.exports = { createGroups };
