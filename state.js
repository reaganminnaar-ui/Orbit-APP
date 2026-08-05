import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const empty = () => ({ alerts: {}, inventory: {}, lastRunAt: null });

export async function loadState(path) {
  try { return { ...empty(), ...JSON.parse(await readFile(path, "utf8")) }; }
  catch (error) { if (error.code === "ENOENT") return empty(); throw error; }
}

export async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2));
  await rename(temp, path);
}

export async function loadSupabaseState(url, key) {
  const response = await fetch(`${url}/rest/v1/orbit_state?id=eq.main&select=state`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!response.ok) throw new Error(`Supabase state read failed (${response.status}): ${await response.text()}`);
  const rows = await response.json();
  return rows[0]?.state ? { ...empty(), ...rows[0].state } : empty();
}

export async function saveSupabaseState(url, key, state) {
  const response = await fetch(`${url}/rest/v1/orbit_state?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ id: "main", state })
  });
  if (!response.ok) throw new Error(`Supabase state write failed (${response.status}): ${await response.text()}`);
}

export function stateStore(config) {
  if (config.stateBackend === "file") {
    return { load: () => loadState(config.stateFile), save: state => saveState(config.stateFile, state) };
  }
  return {
    load: () => loadSupabaseState(config.supabaseUrl, config.supabaseKey),
    save: state => saveSupabaseState(config.supabaseUrl, config.supabaseKey, state)
  };
}

export function shouldSend(state, alert, cooldownMs, now = Date.now()) {
  const sentAt = state.alerts[alert.key];
  return !sentAt || now - Date.parse(sentAt) >= cooldownMs;
}
