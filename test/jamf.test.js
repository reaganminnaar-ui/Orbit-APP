import test from "node:test";
import assert from "node:assert/strict";
import { JamfClient } from "../src/jamf.js";

const config = { jamfBaseUrl: "https://example.jamfcloud.com", jamfClientId: "id", jamfClientSecret: "secret" };

test("core computer inventory keeps the proven section set", async () => {
  const requested = [];
  const client = new JamfClient(config, async (url) => {
    requested.push(String(url));
    return { ok: true, status: 200, json: async () => ({ totalCount: 0, results: [] }) };
  });
  client.token = "token";
  await client.computers();
  assert.match(requested[0], /section=GENERAL&section=HARDWARE&section=OPERATING_SYSTEM&section=SECURITY/);
  assert.doesNotMatch(requested[0], /LICENSED_SOFTWARE|CONTENT_CACHING|USER_AND_LOCATION/);
});

test("optional catalogue failures are isolated", async () => {
  const client = new JamfClient(config, async (url) => {
    const path = new URL(url).pathname;
    if (path === "/JSSResource/departments") return { ok: false, status: 400, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  });
  client.token = "token";
  const result = await client.catalogues();
  assert.equal(result.ok, false);
  assert.equal(result.partial, true);
  assert.equal(result.sources.departments.ok, false);
  assert.equal(result.sources.buildings.ok, true);
});
