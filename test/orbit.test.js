import test from "node:test";
import assert from "node:assert/strict";
import { runOrbit } from "../src/orbit.js";

function config() {
  return {
    stateBackend: "file",
    stateFile: "/tmp/orbit-test-state.json",
    staleDeviceDays: 7,
    policyLookbackMinutes: 30,
    alertCooldownMs: 86_400_000,
    enabled: { staleDevices: true, inventoryChanges: false, failedPolicies: false },
    slackWebhookUrl: "https://example.invalid/webhook",
    smtp: { host: "", from: "", to: [] }
  };
}

test("first run creates a silent alert baseline", async () => {
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  let notifications = 0;
  global.fetch = async () => { notifications++; return { ok: true }; };
  Date.now = () => new Date("2026-08-05T12:00:00Z").getTime();

  const stateFile = `/tmp/orbit-test-${process.pid}-${Math.random()}.json`;
  const testConfig = { ...config(), stateFile };
  const jamf = {
    computers: async () => [{ id: "1", general: { name: "Old Mac", lastContactTime: "2026-01-01T00:00:00Z" } }]
  };

  try {
    const result = await runOrbit(testConfig, jamf, new Date("2026-08-05T12:00:00Z"));
    assert.equal(result.detected, 1);
    assert.equal(result.sent, 0);
    assert.equal(result.baselineCreated, true);
    assert.equal(notifications, 0);
  } finally {
    global.fetch = originalFetch;
    Date.now = originalNow;
  }
});

test("routine OS upgrades are counted for digest but not sent immediately", async () => {
  const originalFetch = global.fetch;
  let notifications = 0;
  global.fetch = async () => { notifications++; return { ok: true }; };
  const stateFile = `/tmp/orbit-test-${process.pid}-${Math.random()}.json`;
  const testConfig = { ...config(), stateFile, enabled: { staleDevices: false, inventoryChanges: true, failedPolicies: false } };
  const jamf = { computers: async () => [{ id: "1", general: { name: "Mac" }, operatingSystem: { version: "26.5.2" } }] };
  try {
    await runOrbit(testConfig, jamf, new Date("2026-08-05T12:00:00Z"));
    jamf.computers = async () => [{ id: "1", general: { name: "Mac" }, operatingSystem: { version: "26.6" } }];
    const result = await runOrbit(testConfig, jamf, new Date("2026-08-06T12:00:00Z"));
    assert.equal(result.detected, 1);
    assert.equal(result.digest, 1);
    assert.equal(result.sent, 0);
    assert.equal(notifications, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
