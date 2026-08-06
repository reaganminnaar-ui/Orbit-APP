import test from "node:test";
import assert from "node:assert/strict";
import { inventoryChangeAlerts, normalizeOsVersion, staleDeviceAlerts } from "../src/checks.js";
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
  const result = inventoryChangeAlerts(computers, first.next, new Date());
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].notificationClass, "digest");
});

test("OS version normalization ignores trailing patch zero", () => {
  assert.equal(normalizeOsVersion("26.6.0"), "26.6");
  const computers = [{ id: "1", general: { name: "Mac" }, operatingSystem: { version: "26.6" } }];
  const previous = { "1": { os: "26.6.0", fileVault: null, managed: null, serial: null } };
  assert.equal(inventoryChangeAlerts(computers, previous, new Date()).alerts.length, 0);
});

test("compliance changes remain immediate", () => {
  const computers = [{ id: "1", general: { name: "Mac", remoteManagement: { managed: false } }, operatingSystem: { version: "26.6" }, security: { fileVault2Enabled: false } }];
  const previous = { "1": { os: "26.6", fileVault: true, managed: true, serial: null } };
  const result = inventoryChangeAlerts(computers, previous, new Date());
  assert.equal(result.alerts[0].severity, "critical");
  assert.equal(result.alerts[0].notificationClass, "immediate");
});

test("compliance recoveries go to digest instead of immediate Slack", () => {
  const computers = [{ id: "1", general: { name: "Mac", remoteManagement: { managed: true } }, operatingSystem: { version: "26.6" }, security: { fileVault2Enabled: true } }];
  const previous = { "1": { os: "26.6", fileVault: false, managed: false, serial: null } };
  const result = inventoryChangeAlerts(computers, previous, new Date());
  assert.equal(result.alerts[0].severity, "info");
  assert.equal(result.alerts[0].notificationClass, "digest");
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
