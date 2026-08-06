function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pageRows(data) {
  return asArray(data?.agents ?? data?.items ?? data?.results ?? data?.data);
}

function totalRows(data, fallback) {
  return data?.totalCount ?? data?.total ?? data?.totalElements ?? fallback;
}

function healthIssues(agent) {
  const value = agent.agentHealthIssueTypes ?? agent.healthIssueTypes ?? agent.healthIssues ?? [];
  return asArray(value).map(issue => typeof issue === "string" ? issue : issue?.type).filter(Boolean);
}

function isActive(agent) {
  return agent.active !== false && agent.status !== "DEACTIVATED";
}

function firstValue(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "") ?? null;
}

function ageDays(value, now) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? Math.max(0, Math.floor((now.getTime() - time) / 86_400_000)) : null;
}

export function incydrAgentDetails(agents, now = new Date()) {
  return agents.map(agent => ({
    agentId: firstValue(agent.agentId, agent.id),
    deviceName: firstValue(agent.deviceName, agent.name, agent.computerName),
    username: firstValue(agent.username, agent.userName, agent.user?.username, agent.user?.email),
    serialNumber: firstValue(agent.serialNumber, agent.deviceSerialNumber),
    operatingSystem: firstValue(agent.operatingSystem, agent.os, agent.osName),
    agentVersion: firstValue(agent.agentVersion, agent.version),
    active: isActive(agent),
    registered: agent.registered !== false && agent.registrationStatus !== "PROBLEM",
    registrationStatus: firstValue(agent.registrationStatus, agent.registered === false ? "PROBLEM" : "REGISTERED"),
    healthy: healthIssues(agent).length === 0 && agent.agentHealthy !== false && agent.healthy !== false,
    healthIssues: healthIssues(agent),
    lastConnectedAt: firstValue(agent.lastConnectedAt, agent.lastConnection, agent.lastConnected),
    lastActivityAt: firstValue(agent.lastActivityAt, agent.lastActivity, agent.lastSeen),
    connectionAgeDays: ageDays(firstValue(agent.lastConnectedAt, agent.lastConnection, agent.lastConnected), now)
  }));
}

export function classifyIncydrAgent(agent, config = {}) {
  const issues = asArray(agent.healthIssues);
  const immediateDays = config.notConnectingImmediateDays ?? 7;
  const digestDays = config.digestAfterDays ?? 1;
  if (issues.includes("SECURITY_INGEST_REJECTED") || issues.some(issue => issue.startsWith("MISSING_MACOS_PERMISSION_"))) return "immediate";
  if (issues.includes("NOT_CONNECTING") && (agent.connectionAgeDays ?? 0) >= immediateDays) return "immediate";
  if (issues.includes("NOT_SENDING_SECURITY_EVENTS") || (issues.includes("NOT_CONNECTING") && (agent.connectionAgeDays ?? 0) >= digestDays)) return "digest";
  return "dashboard";
}

export function incydrOperationalView(details, config = {}) {
  const agents = details.map(agent => ({ ...agent, notificationClass: classifyIncydrAgent(agent, config) }));
  return {
    alertsEnabled: config.alertsEnabled === true,
    policy: {
      immediate: ["Security ingestion rejected", "Missing required macOS permission", `Not connecting for ${config.notConnectingImmediateDays ?? 7}+ days`],
      digest: ["Not sending security events", `Not connecting for ${config.digestAfterDays ?? 1}+ days`],
      dashboard: ["Inactive", "Healthy", "Recently disconnected"]
    },
    counts: agents.reduce((counts, agent) => {
      counts[agent.notificationClass]++;
      return counts;
    }, { immediate: 0, digest: 0, dashboard: 0 }),
    agents
  };
}

export class IncydrClient {
  constructor(config, fetchImpl = fetch) {
    this.config = config.incydr ?? config;
    this.fetch = fetchImpl;
    this.token = null;
  }

  async authenticate() {
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const response = await this.fetch(`${this.config.url}/v1/oauth?grant_type=client_credentials`, {
      method: "POST",
      headers: { accept: "application/json", authorization: `Basic ${credentials}` }
    });
    if (!response.ok) throw new Error(`Incydr authentication failed (${response.status})`);
    const data = await response.json();
    this.token = data.access_token ?? data.token;
    if (!this.token) throw new Error("Incydr authentication response did not include a token");
  }

  async get(path) {
    if (!this.token) await this.authenticate();
    const request = () => this.fetch(`${this.config.url}${path}`, {
      headers: { accept: "application/json", authorization: `Bearer ${this.token}` }
    });
    let response = await request();
    if (response.status === 401) {
      await this.authenticate();
      response = await request();
    }
    if (!response.ok) throw new Error(`Incydr request ${path} failed (${response.status})`);
    return response.json();
  }

  async agents() {
    const all = [];
    const pageSize = this.config.pageSize ?? 500;
    for (let page = 1; ; page++) {
      const data = await this.get(`/v1/agents?pageNum=${page}&pageSize=${pageSize}`);
      const rows = pageRows(data);
      all.push(...rows);
      if (!rows.length || rows.length < pageSize || all.length >= totalRows(data, all.length)) return all;
    }
  }
}

export function summarizeIncydrAgents(agents, checkedAt = new Date()) {
  const issueCounts = {};
  let active = 0;
  let healthy = 0;
  let registrationProblems = 0;

  for (const agent of agents) {
    if (isActive(agent)) active++;
    const issues = healthIssues(agent);
    if (issues.length === 0 && agent.agentHealthy !== false && agent.healthy !== false) healthy++;
    for (const issue of issues) issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
    if (agent.registrationIssue || agent.registrationStatus === "PROBLEM" || agent.registered === false) registrationProblems++;
  }

  return {
    ok: true,
    checkedAt: checkedAt.toISOString(),
    agents: {
      total: agents.length,
      active,
      inactive: agents.length - active,
      healthy,
      unhealthy: agents.length - healthy,
      registrationProblems,
      healthIssues: issueCounts
    }
  };
}

export async function collectIncydrStatus(client, now = new Date()) {
  const agents = await client.agents();
  return { summary: summarizeIncydrAgents(agents, now), details: incydrAgentDetails(agents, now) };
}
