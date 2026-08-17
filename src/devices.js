function value(...values) {
  return values.find(item => item !== undefined && item !== null && item !== "") ?? null;
}

function canonicalSerial(value) {
  return String(value ?? "").trim().toUpperCase();
}

function canonicalHostname(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\.local$/, "");
}

export function jamfDeviceDetails(computers) {
  return computers.map(computer => ({
    jamfId: String(value(computer.id, computer.general?.id) ?? ""),
    deviceName: value(computer.general?.name, computer.name),
    serialNumber: value(computer.hardware?.serialNumber, computer.serialNumber, computer.general?.serialNumber),
    username: value(computer.userAndLocation?.username, computer.username),
    operatingSystem: value(computer.operatingSystem?.version, computer.osVersion),
    lastInventoryAt: value(computer.general?.lastInventoryUpdate, computer.lastInventoryUpdate),
    lastContactAt: value(computer.general?.lastContactTime, computer.lastContactTime),
    managed: computer.general?.managed !== false && computer.managed !== false,
    fileVaultEnabled: value(computer.security?.fileVault2Status, computer.fileVaultEnabled)
  }));
}

export function correlateDevices(jamfDevices, incydrAgents) {
  const remaining = new Set(incydrAgents.map((_, index) => index));
  const bySerial = new Map();
  const byName = new Map();
  incydrAgents.forEach((agent, index) => {
    const serial = canonicalSerial(agent.serialNumber);
    const name = canonicalHostname(agent.deviceName);
    if (serial) bySerial.set(serial, index);
    if (name && !byName.has(name)) byName.set(name, index);
  });

  const devices = jamfDevices.map(jamf => {
    const serial = canonicalSerial(jamf.serialNumber);
    const name = canonicalHostname(jamf.deviceName);
    let index = serial ? bySerial.get(serial) : undefined;
    let matchMethod = index === undefined ? null : "serial";
    if (index === undefined && name) {
      index = byName.get(name);
      matchMethod = index === undefined ? null : "hostname";
    }
    const incydr = index === undefined ? null : incydrAgents[index];
    if (index !== undefined) remaining.delete(index);
    const risk = !jamf.managed ? "critical" : !incydr ? "warning" : !incydr.healthy ? "warning" : "healthy";
    return {
      id: serial || `jamf:${jamf.jamfId}`,
      matchMethod,
      risk,
      status: !incydr ? "missing-incydr" : !incydr.healthy ? "incydr-unhealthy" : "matched",
      jamf,
      incydr
    };
  });

  for (const index of remaining) {
    const incydr = incydrAgents[index];
    devices.push({
      id: canonicalSerial(incydr.serialNumber) || `incydr:${incydr.agentId}`,
      matchMethod: null,
      risk: incydr.healthy ? "notice" : "warning",
      status: "missing-jamf",
      jamf: null,
      incydr
    });
  }

  return {
    counts: devices.reduce((counts, device) => {
      counts.total++;
      counts[device.status]++;
      return counts;
    }, { total: 0, matched: 0, "missing-incydr": 0, "missing-jamf": 0, "incydr-unhealthy": 0 }),
    devices
  };
}
