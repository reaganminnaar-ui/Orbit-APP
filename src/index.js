import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { JamfClient } from "./jamf.js";
import { collectIncydrStatus, incydrOperationalView, IncydrClient } from "./incydr.js";
import { runOrbit } from "./orbit.js";

const config = loadConfig();
const jamf = new JamfClient(config);
const incydr = config.incydr.url ? new IncydrClient(config) : null;
let running = false, lastResult = null, lastError = null, incydrAgents = [];

async function tick() {
  if (running) return;
  running = true;
  try {
    lastResult = await runOrbit(config, jamf);
    lastError = null;
    if (incydr) {
      try {
        const result = await collectIncydrStatus(incydr);
        lastResult.incydr = result.summary;
        incydrAgents = result.details;
      }
      catch (error) {
        lastResult.incydr = { ok: false, error: error.message, checkedAt: new Date().toISOString() };
        console.error("Incydr read-only check failed", error);
      }
    }
    console.log("Orbit run complete", lastResult);
  }
  catch (error) { lastError = { message: error.message, at: new Date().toISOString() }; console.error("Orbit run failed", error); }
  finally { running = false; }
}

createServer(async (request, response) => {
  const requestUrl = new URL(request.url, "http://orbit.local");
  if (requestUrl.pathname === "/api/incydr/agents" && request.method === "GET") {
    if (request.headers.authorization !== `Bearer ${config.pollSecret}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }
    const view = incydrOperationalView(incydrAgents, config.incydr);
    const status = requestUrl.searchParams.get("status");
    const issue = requestUrl.searchParams.get("issue");
    const query = requestUrl.searchParams.get("q")?.trim().toLowerCase();
    const agents = view.agents.filter(agent => {
      if (status && status !== "all" && agent.notificationClass !== status && !(status === "unhealthy" && !agent.healthy)) return false;
      if (issue && !agent.healthIssues.includes(issue)) return false;
      if (query && ![agent.deviceName, agent.username, agent.serialNumber, agent.agentId].some(value => value?.toLowerCase().includes(query))) return false;
      return true;
    });
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    response.end(JSON.stringify({ ok: true, checkedAt: lastResult?.incydr?.checkedAt ?? null, alertsEnabled: view.alertsEnabled, policy: view.policy, counts: view.counts, total: agents.length, agents }));
    return;
  }
  if (requestUrl.pathname === "/poll" && request.method === "POST") {
    if (request.headers.authorization !== `Bearer ${config.pollSecret}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }
    await tick();
    response.writeHead(lastError ? 500 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: !lastError, result: lastResult, error: lastError }));
    return;
  }
  if (requestUrl.pathname !== "/health") { response.writeHead(404).end(); return; }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ ok: !lastError, running, lastResult, lastError }));
}).listen(config.port, () => console.log(`Orbit health server listening on ${config.port}`));

if (config.runOnStart) void tick();
if (config.internalScheduler) setInterval(tick, config.pollIntervalMs).unref();
