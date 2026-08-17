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
      const sections = "section=GENERAL&section=HARDWARE&section=OPERATING_SYSTEM&section=SECURITY";
      const data = await this.get(`/api/v3/computers-inventory?page=${page}&page-size=100&sort=id%3Aasc&${sections}`);
      const rows = data.results ?? [];
      all.push(...rows);
      if (all.length >= (data.totalCount ?? rows.length) || rows.length === 0) return all;
    }
  }

  async policyLogs(computerId) {
    const data = await this.get(`/JSSResource/computerhistory/id/${encodeURIComponent(computerId)}/subset/Policy_Logs`);
    return data.computer_history?.policy_logs ?? data.computer_history?.policyLogs ?? [];
  }
}
