export class JamfClient {
  constructor(config, fetchImpl = fetch) { this.config = config; this.fetch = fetchImpl; this.token = null; }

  async authenticate() {
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: this.config.jamfClientId, client_secret: this.config.jamfClientSecret });
    const response = await this.fetch(`${this.config.jamfBaseUrl}/api/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    if (!response.ok) throw new Error(`Jamf authentication failed (${response.status})`);
    const data = await response.json();
    this.token = data.access_token;
  }

  async get(path) {
    if (!this.token) await this.authenticate();
    let response = await this.fetch(`${this.config.jamfBaseUrl}${path}`, { headers: { accept: "application/json", authorization: `Bearer ${this.token}` } });
    if (response.status === 401) { await this.authenticate(); response = await this.fetch(`${this.config.jamfBaseUrl}${path}`, { headers: { accept: "application/json", authorization: `Bearer ${this.token}` } }); }
    if (!response.ok) throw new Error(`Jamf request ${path} failed (${response.status})`);
    return response.json();
  }

  async computers() {
    const all = [];
    for (let page = 0; ; page++) {
      const sections = [
        "GENERAL","HARDWARE","OPERATING_SYSTEM","USER_AND_LOCATION","SECURITY",
        "DISK_ENCRYPTION","EXTENSION_ATTRIBUTES","CONFIGURATION_PROFILES",
        "LOCAL_USER_ACCOUNTS","CERTIFICATES","STORAGE","CONTENT_CACHING",
        "APPLICATIONS","FONTS","PACKAGE_RECEIPTS","PLUGINS","PRINTERS","SERVICES",
        "SOFTWARE_UPDATES","LICENSED_SOFTWARE"
      ].map(section => `section=${section}`).join("&");
      const data = await this.get(`/api/v3/computers-inventory?page=${page}&page-size=100&sort=id%3Aasc&${sections}`);
      const rows = data.results ?? [];
      all.push(...rows);
      if (all.length >= (data.totalCount ?? rows.length) || rows.length === 0) return all;
    }
  }

  async paged(path, resultKeys = ["results"]) {
    const all = [];
    for (let page = 0; page < 100; page++) {
      const separator = path.includes("?") ? "&" : "?";
      const data = await this.get(`${path}${separator}page=${page}&page-size=100`);
      const rows = resultKeys.map(key => data?.[key]).find(Array.isArray) ?? (Array.isArray(data) ? data : []);
      all.push(...rows);
      if (!rows.length || all.length >= Number(data.totalCount ?? data.total ?? rows.length)) return all;
    }
    return all;
  }

  async first(paths) {
    let lastError;
    for (const path of paths) {
      try { return await this.get(path); }
      catch (error) { lastError = error; }
    }
    throw lastError ?? new Error("No Jamf API path was available");
  }

  async catalog() {
    const sources = {
      advancedComputerSearches: () => this.get("/JSSResource/advancedcomputersearches"),
      groups: () => this.paged('/api/v2/groups?filter=groupType=="COMPUTER"', ["results"]),
      staticComputerGroups: () => this.paged("/api/v3/computer-groups/static-groups", ["results"]),
      smartComputerGroups: () => this.first(["/JSSResource/computergroups", "/api/v2/groups?page=0&page-size=100&filter=groupType==%22COMPUTER%22%20and%20isSmart==%22true%22"]),
      departments: () => this.get("/JSSResource/departments"),
      buildings: () => this.get("/JSSResource/buildings"),
      macosConfigurationProfiles: () => this.get("/JSSResource/osxconfigurationprofiles"),
      policies: () => this.get("/JSSResource/policies"),
      computerExtensionAttributes: () => this.first(["/api/v1/computer-extension-attributes?page=0&page-size=100", "/JSSResource/computerextensionattributes"]),
      userExtensionAttributes: () => this.get("/JSSResource/userextensionattributes"),
      users: () => this.get("/JSSResource/users"),
      inventoryCollectionSettings: () => this.first(["/api/v1/computer-inventory-collection-settings", "/api/v1/computer-inventory-collection"]),
      blueprints: () => this.first(["/api/v1/blueprints?page=0&page-size=100", "/api/v2/blueprints?page=0&page-size=100"]),
      complianceBenchmarks: () => this.first(["/api/v1/compliance-benchmarks?page=0&page-size=100", "/api/v2/compliance-benchmarks?page=0&page-size=100"])
    };
    const entries = await Promise.all(Object.entries(sources).map(async ([name, load]) => {
      try { const data = await load(); return [name, { ok: true, data, count: countRecords(data) }]; }
      catch (error) { return [name, { ok: false, error: safeError(error), data: null, count: 0 }]; }
    }));
    return Object.fromEntries(entries);
  }

  async attachCompliance(computers, concurrency = 6) {
    let next = 0;
    const output = computers.map(computer => ({ ...computer }));
    const workers = Array.from({ length: Math.min(concurrency, output.length) }, async () => {
      while (next < output.length) {
        const index = next++;
        const computer = output[index];
        try { computer.deviceCompliance = await this.get(`/api/v1/conditional-access/device-compliance-information/computer/${encodeURIComponent(computer.id)}`); }
        catch (error) { computer.deviceComplianceError = safeError(error); }
      }
    });
    await Promise.all(workers);
    return output;
  }

  async policyLogs(computerId) {
    const data = await this.get(`/JSSResource/computerhistory/id/${encodeURIComponent(computerId)}/subset/Policy_Logs`);
    return data.computer_history?.policy_logs ?? data.computer_history?.policyLogs ?? [];
  }
}

function countRecords(data) {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== "object") return 0;
  if (Number.isFinite(Number(data.totalCount))) return Number(data.totalCount);
  const array = Object.values(data).find(Array.isArray);
  return array?.length ?? 1;
}

function safeError(error) { return String(error?.message ?? error ?? "Unknown Jamf error").slice(0, 240); }
