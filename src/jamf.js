const CATALOGUES = [
  { key: "advancedComputerSearches", path: "/JSSResource/advancedcomputersearches", rows: data => data.advanced_computer_searches?.advanced_computer_search ?? [] },
  { key: "computerGroups", path: "/JSSResource/computergroups", rows: data => data.computer_groups?.computer_group ?? [] },
  { key: "departments", path: "/JSSResource/departments", rows: data => data.departments?.department ?? [] },
  { key: "buildings", path: "/JSSResource/buildings", rows: data => data.buildings?.building ?? [] },
  { key: "macosConfigurationProfiles", path: "/JSSResource/osxconfigurationprofiles", rows: data => data.os_x_configuration_profiles?.os_x_configuration_profile ?? [] },
  { key: "policies", path: "/JSSResource/policies", rows: data => data.policies?.policy ?? [] },
  { key: "computerExtensionAttributes", path: "/JSSResource/computerextensionattributes", rows: data => data.computer_extension_attributes?.computer_extension_attribute ?? [] },
  { key: "userExtensionAttributes", path: "/JSSResource/userextensionattributes", rows: data => data.user_extension_attributes?.user_extension_attribute ?? [] },
  { key: "users", path: "/JSSResource/users", rows: data => data.users?.user ?? [] },
  { key: "inventoryCollectionSettings", path: "/api/v3/computer-inventory-collection-settings", rows: data => data.results ?? [data].filter(Boolean) },
  { key: "blueprints", path: "/api/v1/blueprints", rows: data => data.results ?? data.blueprints ?? [] },
  { key: "complianceBenchmarks", path: "/api/v1/compliance-benchmarks", rows: data => data.results ?? data.benchmarks ?? [] }
];

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
      // Keep this proven request deliberately small. Optional catalogues are
      // collected separately and can never interrupt core computer inventory.
      const sections = "section=GENERAL&section=HARDWARE&section=OPERATING_SYSTEM&section=SECURITY";
      const data = await this.get(`/api/v3/computers-inventory?page=${page}&page-size=100&sort=id%3Aasc&${sections}`);
      const rows = data.results ?? [];
      all.push(...rows);
      if (all.length >= (data.totalCount ?? rows.length) || rows.length === 0) return all;
    }
  }

  async catalogues() {
    const checkedAt = new Date().toISOString();
    const entries = await Promise.all(CATALOGUES.map(async catalogue => {
      try {
        const data = await this.get(catalogue.path);
        const items = catalogue.rows(data);
        return [catalogue.key, { ok: true, count: items.length, items }];
      }
      catch (error) {
        return [catalogue.key, { ok: false, count: 0, items: [], error: error.message }];
      }
    }));
    const sources = Object.fromEntries(entries);
    return {
      ok: Object.values(sources).every(source => source.ok),
      partial: Object.values(sources).some(source => source.ok) && Object.values(sources).some(source => !source.ok),
      checkedAt,
      sources
    };
  }

  async policyLogs(computerId) {
    const data = await this.get(`/JSSResource/computerhistory/id/${encodeURIComponent(computerId)}/subset/Policy_Logs`);
    return data.computer_history?.policy_logs ?? data.computer_history?.policyLogs ?? [];
  }
}
