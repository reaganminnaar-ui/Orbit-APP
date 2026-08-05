import test from "node:test";
import assert from "node:assert/strict";
import { inventoryChangeAlerts, staleDeviceAlerts } from "../src/checks.js";
import { loadSupabaseState, saveSupabaseState } from "../src/state.js";

test("stale device checker only reports old contacts", () => {
  const computers = [{ id: "1", general: { name: "Old Mac", lastContactTime: "2026-01-01T00:00:00Z" } }, { id: "2", general: { name: "New Mac", lastContactTime: "2026-01-10T00:00:00Z" } }];
  assert.deepEqual(staleDeviceAlerts(computers, 7, new Date("2026-01-12T00:00:00Z")).map(a => a.title), ["Old Mac"]);
});

test("first inventory run establishes baseline and next change alerts", () => {
  const computers = [{ id: "1", general: { name: "Mac" }, operatingSystem: { version: "15.0" }, security: { fileVault2Enabled: true } }];
  const first = inventoryChangeAlerts(computers, {}, new Date());
  assert.equal(first.alerts.length, 0);
  computers[0].operatingSystem.version = "15.1";
  assert.equal(inventoryChangeAlerts(computers, first.next, new Date()).alerts.length, 1);
});

test("Supabase state uses a protected REST read", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, "https://project.supabase.co/rest/v1/orbit_state?id=eq.main&select=state");
    assert.equal(options.headers.Authorization, "Bearer secret");
    return { ok: true, json: async () => [{ state: { lastRunAt: "now" } }] };
  };
  try { assert.equal((await loadSupabaseState("https://project.supabase.co", "secret")).lastRunAt, "now"); }
  finally { global.fetch = originalFetch; }
});

test("Supabase state upserts the main row", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { id: "main", state: { alerts: {} } });
    return { ok: true };
  };
  try { await saveSupabaseState("https://project.supabase.co", "secret", { alerts: {} }); }
  finally { global.fetch = originalFetch; }
});
