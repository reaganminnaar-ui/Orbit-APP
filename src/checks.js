import { createHash } from "node:crypto";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const date = value => value ? new Date(value) : null;

export function staleDeviceAlerts(computers, days, now = new Date()) {
  const cutoff = now.getTime() - days * 86_400_000;
  return computers.flatMap(c => {
    const last = date(c.general?.lastContactTime);
    if (last && last.getTime() >= cutoff) return [];
    const name = c.general?.name ?? c.hardware?.serialNumber ?? `Computer ${c.id}`;
    return [{ key: `stale:${c.id}`, type: "Device not checking in", severity: "warning", title: name, details: last ? `Last check-in: ${last.toISOString()}` : "No check-in date reported", occurredAt: last?.toISOString() ?? now.toISOString() }];
  });
}

export function inventoryChangeAlerts(computers, previous, now = new Date()) {
  const alerts = [], next = {};
  for (const c of computers) {
    const snapshot = { os: c.operatingSystem?.version ?? null, fileVault: c.security?.fileVault2Enabled ?? c.diskEncryption?.fileVault2Enabled ?? null, managed: c.general?.remoteManagement?.managed ?? null, serial: c.hardware?.serialNumber ?? null };
    next[c.id] = snapshot;
    if (previous[c.id] && hash(previous[c.id]) !== hash(snapshot)) {
      const changed = Object.keys(snapshot).filter(k => previous[c.id][k] !== snapshot[k]);
      alerts.push({ key: `inventory:${c.id}:${hash(snapshot)}`, type: "Compliance or inventory change", severity: changed.some(k => ["fileVault", "managed"].includes(k)) ? "critical" : "info", title: c.general?.name ?? snapshot.serial ?? `Computer ${c.id}`, details: changed.map(k => `${k}: ${previous[c.id][k] ?? "unknown"} → ${snapshot[k] ?? "unknown"}`).join("; "), occurredAt: now.toISOString() });
    }
  }
  return { alerts, next };
}

export function failedPolicyAlerts(computer, logs, lookbackMinutes, now = new Date()) {
  const cutoff = now.getTime() - lookbackMinutes * 60_000;
  return logs.flatMap(log => {
    const status = String(log.status ?? log.statusCode ?? "").toLowerCase();
    const occurred = date(log.date_time ?? log.dateTime ?? log.statusDate);
    if (!status.includes("fail") || !occurred || occurred.getTime() < cutoff) return [];
    const policy = log.name ?? log.policy_name ?? `Policy ${log.id ?? "unknown"}`;
    return [{ key: `policy:${computer.id}:${log.id ?? hash(log)}:${occurred.toISOString()}`, type: "Failed policy", severity: "critical", title: `${policy} on ${computer.general?.name ?? computer.id}`, details: log.detail ?? log.error ?? `Status: ${status}`, occurredAt: occurred.toISOString() }];
  });
}
