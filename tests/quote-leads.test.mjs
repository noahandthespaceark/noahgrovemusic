import test from 'node:test';
import assert from 'node:assert/strict';
import {leadConfig,captureQuoteLead,inspectLeadConnection} from '../functions/api/_quote-leads.js';
const env={GIGDASHBOARD_POSSIBLE_CLIENTS_URL:' https://dashboard.example.test/api/possible-clients ',GIGDASHBOARD_API_KEY:' private-key '};
async function mocked(fetch,run){const before=globalThis.fetch;globalThis.fetch=fetch;try{await run();}finally{globalThis.fetch=before;}}
test('lead configuration trims settings, supports a base URL, validates credentials and hides values',()=>{
  const config=leadConfig(env);assert.equal(config.status.ready,true);assert.equal(config.key,'private-key');assert.equal(config.endpoint,'https://dashboard.example.test/api/possible-clients');
  for(const url of ['https://dashboard.example.test','https://dashboard.example.test/api/'])assert.equal(leadConfig({...env,GIGDASHBOARD_POSSIBLE_CLIENTS_URL:url}).endpoint,config.endpoint);
  for(const url of ['not a url','http://dashboard.example.test','https://user:pass@dashboard.example.test','https://dashboard.example.test/wrong'])assert.equal(leadConfig({...env,GIGDASHBOARD_POSSIBLE_CLIENTS_URL:url}).status.ready,false);
  assert.equal(leadConfig({...env,GIGDASHBOARD_API_KEY:'bad\nheader'}).status.ready,false);
  assert.doesNotMatch(JSON.stringify(config.status),/private-key|example.test/);
});
test('lead acceptance requires matching saved estimate receipt; successful HTML and empty JSON are not saves',async()=>{
  for(const [response,expected] of [[()=>new Response('<html>Login</html>'),false],[()=>Response.json({ok:true}),false],
    [()=>Response.json({ok:true,prospect:{id:'saved',estimateId:'other'}}),false],
    [()=>Response.json({ok:true,prospect:{id:'saved',estimateId:'NQ-TEST'}}),true]]){
    await mocked(async(url,options)=>{assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer private-key');assert.equal(JSON.parse(options.body).estimateId,'NQ-TEST');return response();},async()=>{
      assert.equal((await captureQuoteLead({estimateId:'NQ-TEST'},env)).ok,expected);
    });
  }
});
test('lead errors classify authentication, redirects, timeouts and network failures without exposing private data',async()=>{
  for(const [fn,code] of [[()=>Response.json({error:'private-key'},{status:401}),'authentication_failed'],
    [()=>new Response(null,{status:302,headers:{location:'https://private.example.test'}}),'endpoint_redirect'],
    [()=>{throw new TypeError('private-key private address');},'connection_failed'],
    [()=>{throw new DOMException('private','TimeoutError');},'connection_timeout']]){
    await mocked(async()=>fn(),async()=>{const result=await captureQuoteLead({estimateId:'NQ-TEST'},env);assert.equal(result.code,code);assert.doesNotMatch(JSON.stringify(result),/private/);});
  }
});
test('lead health check only performs GET and never saves or returns prospect data',async()=>{
  await mocked(async(url,options)=>{assert.equal(options.method,'GET');assert.equal(options.body,undefined);return Response.json({private:'must not return'});},async()=>{
    const result=await inspectLeadConnection(env);assert.equal(result.code,'reachable_not_write_verified');assert.doesNotMatch(JSON.stringify(result),/private-key|must not return/);
  });
  await mocked(async()=>assert.fail('unconfigured connection must not be called'),async()=>{assert.equal((await captureQuoteLead({},{})).code,'configuration_invalid');});
});
