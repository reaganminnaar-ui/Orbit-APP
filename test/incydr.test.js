import test from "node:test";
import assert from "node:assert/strict";
import { classifyIncydrAgent, IncydrClient, incydrAgentDetails, incydrOperationalView, summarizeIncydrAgents } from "../src/incydr.js";

test("authenticates and reads agents without using write methods", async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes("/v1/oauth")) return { ok: true, status: 200, json: async () => ({ access_token: "token" }) };
    return { ok: true, status: 200, json: async () => ({ agents: [{ agentId: "1" }], totalCount: 1 }) };
  };
  const client = new IncydrClient({ url: "https://api.za.code42.com", clientId: "id", clientSecret: "secret", pageSize: 500 }, fetchImpl);

  const agents = await client.agents();

  assert.equal(agents.length, 1);
  assert.equal(requests[0].options.method, "POST");
  assert.match(requests[0].options.headers.authorization, /^Basic /);
  assert.equal(requests[1].options.method, undefined);
  assert.match(requests[1].url, /\/v1\/agents\?pageNum=1&pageSize=500$/);
});

test("summarizes active, unhealthy and registration-problem agents", () => {
  const result = summarizeIncydrAgents([
    { active: true, agentHealthy: true },
    { active: true, agentHealthy: false, agentHealthIssueTypes: ["NOT_CONNECTING"], registered: false },
    { active: false, healthIssueTypes: ["NOT_SENDING_SECURITY_EVENTS"] }
  ], new Date("2026-08-06T10:00:00Z"));

  assert.deepEqual(result.agents, {
    total: 3,
    active: 2,
    inactive: 1,
    healthy: 1,
    unhealthy: 2,
    registrationProblems: 1,
    healthIssues: { NOT_CONNECTING: 1, NOT_SENDING_SECURITY_EVENTS: 1 }
  });
});

test("normalizes read-only device details without retaining the source object", () => {
  const source = {
    agentId: "agent-1",
    deviceName: "Finance-Mac",
    username: "user@example.com",
    serialNumber: "SERIAL1",
    operatingSystem: "macOS",
    agentVersion: "11.2.0",
    active: true,
    registered: true,
    agentHealthy: false,
    agentHealthIssueTypes: ["NOT_CONNECTING"],
    lastConnectedAt: "2026-08-01T10:00:00Z",
    secretField: "must-not-leak"
  };

  const [detail] = incydrAgentDetails([source], new Date("2026-08-06T10:00:00Z"));

  assert.equal(detail.deviceName, "Finance-Mac");
  assert.equal(detail.operatingSystem, "macOS");
  assert.equal(detail.healthy, false);
  assert.deepEqual(detail.healthIssues, ["NOT_CONNECTING"]);
  assert.equal(detail.connectionAgeDays, 5);
  assert.equal("secretField" in detail, false);
});

test("classifies Incydr conditions while notifications remain disabled", () => {
  const details = [
    { healthIssues: ["NOT_CONNECTING"], connectionAgeDays: 8 },
    { healthIssues: ["NOT_SENDING_SECURITY_EVENTS"], connectionAgeDays: 2 },
    { healthIssues: [], connectionAgeDays: 0 }
  ];
  assert.equal(classifyIncydrAgent(details[0], { notConnectingImmediateDays: 7 }), "immediate");
  const view = incydrOperationalView(details, { alertsEnabled: false, notConnectingImmediateDays: 7, digestAfterDays: 1 });
  assert.equal(view.alertsEnabled, false);
  assert.deepEqual(view.counts, { immediate: 1, digest: 1, dashboard: 1 });
});
