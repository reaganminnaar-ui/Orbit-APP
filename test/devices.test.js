import test from "node:test";
import assert from "node:assert/strict";
import { correlateDevices, jamfDeviceDetails } from "../src/devices.js";

test("correlates by serial before hostname and identifies gaps", () => {
  const jamf = jamfDeviceDetails([
    { id: 1, general: { name: "MAC-ONE" }, hardware: { serialNumber: "ABC" } },
    { id: 2, general: { name: "MAC-TWO" }, hardware: { serialNumber: "DEF" } }
  ]);
  const incydr = [
    { agentId: "a", deviceName: "renamed", serialNumber: "abc", healthy: true },
    { agentId: "b", deviceName: "orphan", serialNumber: "XYZ", healthy: false }
  ];
  const result = correlateDevices(jamf, incydr);
  assert.equal(result.counts.matched, 1);
  assert.equal(result.counts["missing-incydr"], 1);
  assert.equal(result.counts["missing-jamf"], 1);
  assert.equal(result.devices[0].matchMethod, "serial");
});

test("falls back to normalized hostname", () => {
  const jamf = jamfDeviceDetails([{ id: 1, general: { name: "MAC-ONE.local" } }]);
  const result = correlateDevices(jamf, [{ agentId: "a", deviceName: "mac-one", healthy: true }]);
  assert.equal(result.devices[0].matchMethod, "hostname");
  assert.equal(result.devices[0].status, "matched");
});

test("preserves the complete Jamf source payload for Orbit", () => {
  const [device]=jamfDeviceDetails([{id:1,general:{name:"Mac"},hardware:{serialNumber:"ABC",model:"MacBook Pro"},extensionAttributes:[{name:"Asset owner",value:"IT"}],deviceCompliance:[{compliant:true}]}]);
  assert.equal(device.hardware.model,"MacBook Pro");
  assert.equal(device.extensionAttributes[0].name,"Asset owner");
  assert.equal(device.deviceCompliance[0].compliant,true);
});
