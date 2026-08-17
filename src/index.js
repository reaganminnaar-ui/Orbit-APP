import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { JamfClient } from "./jamf.js";
import { collectIncydrStatus, incydrOperationalView, IncydrClient } from "./incydr.js";
import { runOrbit } from "./orbit.js";
import { correlateDevices } from "./devices.js";

const config = loadConfig();
const jamf = new JamfClient(config);
const incydr = config.incydr.url ? new IncydrClient(config) : null;
let running = false, lastResult = null, lastError = null, incydrAgents = [], jamfDevices = [];

async function tick() {
  if (running) return;
  running = true;
  try {
    const orbitResult = await runOrbit(config, jamf);
    jamfDevices = orbitResult.devices;
    delete orbitResult.devices;
    lastResult = orbitResult;
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

function authorized(request) {
  return request.headers.authorization === `Bearer ${config.pollSecret}`;
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  const requestUrl = new URL(request.url, "http://orbit.local");
  if (requestUrl.pathname === "/api/jamf/catalog" && request.method === "GET") {
    if (!authorized(request)) return json(response, 401, { ok: false, error: "Unauthorized" });
    // Always return 200 after authentication. Unsupported optional Jamf
    // endpoints are represented per source and never poison service health.
    return json(response, 200, await jamf.catalogues());
  }
  if (requestUrl.pathname === "/api/incydr/agents" && request.method === "GET") {
    if (!authorized(request)) return json(response, 401, { ok: false, error: "Unauthorized" });
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
    return json(response, 200, { ok: true, checkedAt: lastResult?.incydr?.checkedAt ?? null, alertsEnabled: view.alertsEnabled, policy: view.policy, counts: view.counts, total: agents.length, agents });
  }
  if (requestUrl.pathname === "/api/devices" && request.method === "GET") {
    if (!authorized(request)) return json(response, 401, { ok: false, error: "Unauthorized" });
    const correlated = correlateDevices(jamfDevices, incydrOperationalView(incydrAgents, config.incydr).agents);
    const status = requestUrl.searchParams.get("status");
    const query = requestUrl.searchParams.get("q")?.trim().toLowerCase();
    const devices = correlated.devices.filter(device => {
      if (status && status !== "all" && device.status !== status) return false;
      if (!query) return true;
      const values = [device.jamf?.deviceName, device.jamf?.serialNumber, device.jamf?.username, device.incydr?.deviceName, device.incydr?.serialNumber, device.incydr?.username];
      return values.some(item => item?.toLowerCase().includes(query));
    });
    return json(response, 200, { ok: true, checkedAt: lastResult?.incydr?.checkedAt ?? null, counts: correlated.counts, total: devices.length, devices });
  }
  if (requestUrl.pathname === "/poll" && request.method === "POST") {
    if (!authorized(request)) return json(response, 401, { ok: false, error: "Unauthorized" });
    await tick();
    return json(response, lastError ? 500 : 200, { ok: !lastError, result: lastResult, error: lastError });
  }
  if (requestUrl.pathname !== "/health") { response.writeHead(404).end(); return; }
  json(response, 200, { ok: !lastError, running, lastResult, lastError });
}).listen(config.port, () => console.log(`Orbit health server listening on ${config.port}`));

if (config.runOnStart) void tick();
if (config.internalScheduler) setInterval(tick, config.pollIntervalMs).unref();
