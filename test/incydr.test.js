import test from "node:test";
import assert from "node:assert/strict";
import { IncydrClient, summarizeIncydrAgents } from "../src/incydr.js";

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
