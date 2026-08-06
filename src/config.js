function bool(name, fallback) {
  const value = process.env[name];
  return value == null ? fallback : value.toLowerCase() === "true";
}

function number(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

export function loadConfig() {
  const config = {
    jamfBaseUrl: (process.env.JAMF_BASE_URL ?? "").replace(/\/$/, ""),
    jamfClientId: process.env.JAMF_CLIENT_ID ?? "",
    jamfClientSecret: process.env.JAMF_CLIENT_SECRET ?? "",
    incydr: {
      url: (process.env.INCYDR_URL ?? "").replace(/\/$/, ""),
      clientId: process.env.INCYDR_API_CLIENT_ID ?? "",
      clientSecret: process.env.INCYDR_API_CLIENT_SECRET ?? "",
      pageSize: number("INCYDR_PAGE_SIZE", 500),
      alertsEnabled: bool("INCYDR_ALERTS_ENABLED", false),
      notConnectingImmediateDays: number("INCYDR_NOT_CONNECTING_IMMEDIATE_DAYS", 7),
      digestAfterDays: number("INCYDR_DIGEST_AFTER_DAYS", 1)
    },
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      port: number("SMTP_PORT", 587),
      secure: bool("SMTP_SECURE", false),
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
      from: process.env.EMAIL_FROM ?? "",
      to: (process.env.EMAIL_TO ?? "").split(",").map(v => v.trim()).filter(Boolean)
    },
    pollIntervalMs: number("POLL_INTERVAL_MINUTES", 15) * 60_000,
    staleDeviceDays: number("STALE_DEVICE_DAYS", 7),
    policyLookbackMinutes: number("POLICY_LOOKBACK_MINUTES", 30),
    alertCooldownMs: number("ALERT_COOLDOWN_HOURS", 24) * 3_600_000,
    stateFile: process.env.STATE_FILE ?? "./data/orbit-state.json",
    stateBackend: process.env.STATE_BACKEND ?? "supabase",
    supabaseUrl: (process.env.SUPABASE_URL ?? "").replace(/\/$/, ""),
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    pollSecret: process.env.POLL_SECRET ?? "",
    port: number("PORT", 10000),
    runOnStart: bool("RUN_ON_START", true),
    internalScheduler: bool("INTERNAL_SCHEDULER", false),
    enabled: {
      failedPolicies: bool("ENABLE_FAILED_POLICIES", true),
      staleDevices: bool("ENABLE_STALE_DEVICES", true),
      inventoryChanges: bool("ENABLE_INVENTORY_CHANGES", true)
    }
  };
  const missing = ["jamfBaseUrl", "jamfClientId", "jamfClientSecret"].filter(k => !config[k]);
  if (missing.length) throw new Error(`Missing Jamf configuration: ${missing.join(", ")}`);
  const incydrValues = [config.incydr.url, config.incydr.clientId, config.incydr.clientSecret];
  if (incydrValues.some(Boolean) && !incydrValues.every(Boolean)) {
    throw new Error("INCYDR_URL, INCYDR_API_CLIENT_ID and INCYDR_API_CLIENT_SECRET must be configured together");
  }
  if (!config.slackWebhookUrl && (!config.smtp.host || !config.smtp.from || !config.smtp.to.length)) {
    throw new Error("Configure Slack, email, or both");
  }
  if (config.stateBackend === "supabase" && (!config.supabaseUrl || !config.supabaseKey)) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  if (!config.pollSecret) throw new Error("POLL_SECRET is required");
  return config;
}
