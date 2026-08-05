import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { JamfClient } from "./jamf.js";
import { runOrbit } from "./orbit.js";

const config = loadConfig();
const jamf = new JamfClient(config);
let running = false, lastResult = null, lastError = null;

async function tick() {
  if (running) return;
  running = true;
  try { lastResult = await runOrbit(config, jamf); lastError = null; console.log("Orbit run complete", lastResult); }
  catch (error) { lastError = { message: error.message, at: new Date().toISOString() }; console.error("Orbit run failed", error); }
  finally { running = false; }
}

createServer(async (request, response) => {
  if (request.url === "/poll" && request.method === "POST") {
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
  if (request.url !== "/health") { response.writeHead(404).end(); return; }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ ok: !lastError, running, lastResult, lastError }));
}).listen(config.port, () => console.log(`Orbit health server listening on ${config.port}`));

if (config.runOnStart) void tick();
if (config.internalScheduler) setInterval(tick, config.pollIntervalMs).unref();
