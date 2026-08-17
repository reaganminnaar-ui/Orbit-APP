import test from "node:test";
import assert from "node:assert/strict";
import { JamfClient } from "../src/jamf.js";

const config={jamfBaseUrl:"https://example.jamfcloud.com",jamfClientId:"id",jamfClientSecret:"secret"};

test("requests the complete authorised computer inventory section set", async()=>{
  const requests=[];
  const fetchImpl=async(url,options={})=>{
    requests.push({url,options});
    if(url.endsWith("/api/oauth/token"))return{ok:true,status:200,json:async()=>({access_token:"token"})};
    return{ok:true,status:200,json:async()=>({totalCount:1,results:[{id:"1",general:{name:"Mac"}}]})};
  };
  const client=new JamfClient(config,fetchImpl);
  const rows=await client.computers();
  assert.equal(rows.length,1);
  const url=requests.at(-1).url;
  for(const section of ["GENERAL","HARDWARE","OPERATING_SYSTEM","USER_AND_LOCATION","SECURITY","DISK_ENCRYPTION","EXTENSION_ATTRIBUTES","CONFIGURATION_PROFILES","LOCAL_USER_ACCOUNTS","CERTIFICATES","STORAGE","APPLICATIONS","SOFTWARE_UPDATES"])assert.match(url,new RegExp(`section=${section}`));
});

test("collects every authorised catalogue independently", async()=>{
  const fetchImpl=async(url)=>{
    if(url.endsWith("/api/oauth/token"))return{ok:true,status:200,json:async()=>({access_token:"token"})};
    if(url.includes("compliance-benchmarks"))return{ok:false,status:403,json:async()=>({})};
    return{ok:true,status:200,json:async()=>({results:[{id:"1"}]})};
  };
  const catalog=await new JamfClient(config,fetchImpl).catalog();
  for(const key of ["advancedComputerSearches","groups","staticComputerGroups","smartComputerGroups","departments","buildings","macosConfigurationProfiles","policies","computerExtensionAttributes","userExtensionAttributes","users","inventoryCollectionSettings","blueprints","complianceBenchmarks"])assert.ok(key in catalog,key);
  assert.equal(catalog.groups.ok,true);
  assert.equal(catalog.complianceBenchmarks.ok,false);
});

test("attaches per-computer compliance without losing successful devices", async()=>{
  const fetchImpl=async(url)=>{
    if(url.endsWith("/api/oauth/token"))return{ok:true,status:200,json:async()=>({access_token:"token"})};
    if(url.endsWith("/computer/2"))return{ok:false,status:404,json:async()=>({})};
    return{ok:true,status:200,json:async()=>[{compliant:true}]};
  };
  const rows=await new JamfClient(config,fetchImpl).attachCompliance([{id:"1"},{id:"2"}],2);
  assert.deepEqual(rows[0].deviceCompliance,[{compliant:true}]);
  assert.match(rows[1].deviceComplianceError,/404/);
});
