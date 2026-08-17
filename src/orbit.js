import { failedPolicyAlerts, inventoryChangeAlerts, staleDeviceAlerts } from "./checks.js";
import { shouldSend, stateStore } from "./state.js";
import { notify } from "./notifiers.js";
import { jamfDeviceDetails } from "./devices.js";

export async function runOrbit(config, jamf, now = new Date()) {
  const store = stateStore(config);
  const state = await store.load();
  const isFirstRun = !state.lastRunAt;
  const computers = await jamf.computers();
  let alerts = [];
  if (config.enabled.staleDevices) alerts.push(...staleDeviceAlerts(computers, config.staleDeviceDays, now));
  if (config.enabled.inventoryChanges) { const changes = inventoryChangeAlerts(computers, state.inventory, now); alerts.push(...changes.alerts); state.inventory = changes.next; }
  if (config.enabled.failedPolicies) {
    const batches = await Promise.allSettled(computers.map(async c => failedPolicyAlerts(c, await jamf.policyLogs(c.id), config.policyLookbackMinutes, now)));
    for (const result of batches) result.status === "fulfilled" ? alerts.push(...result.value) : console.error("Policy log check failed:", result.reason);
  }
  let sent = 0, digest = 0;
  for (const alert of alerts) {
    if (!shouldSend(state, alert, config.alertCooldownMs, now.getTime())) continue;

    if (alert.notificationClass === "digest") {
      digest++;
      state.alerts[alert.key] = now.toISOString();
      continue;
    }

    // The first successful scan establishes a baseline. Record every existing
    // condition without notifying so a new installation cannot flood Slack.
    if (!isFirstRun) {
      await notify(config, alert);
      sent++;
    }
    state.alerts[alert.key] = now.toISOString();
  }
  state.lastRunAt = now.toISOString();
  await store.save(state);
  return { checked: computers.length, detected: alerts.length, sent, digest, baselineCreated: isFirstRun, devices: jamfDeviceDetails(computers) };
}
