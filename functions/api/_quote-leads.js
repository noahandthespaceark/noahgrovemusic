export function leadConfig(env){
  const raw=String(env.GIGDASHBOARD_POSSIBLE_CLIENTS_URL||env.GIGDASHBOARD_API_URL||'').trim();
  const key=String(env.GIGDASHBOARD_API_KEY||'').trim();
  const issues=[];let endpoint;
  if(!raw)issues.push('missing_endpoint');
  else try{
    endpoint=new URL(raw);
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.hash)issues.push('invalid_endpoint');
    if(endpoint.pathname==='/'||endpoint.pathname==='/api'||endpoint.pathname==='/api/')endpoint.pathname='/api/possible-clients';
    if(endpoint.pathname!=='/api/possible-clients')issues.push('incorrect_endpoint_path');
  }catch{issues.push('invalid_endpoint');}
  if(!key)issues.push('missing_api_key');else if(/[^\x21-\x7e]/.test(key))issues.push('invalid_api_key_format');
  return {endpoint:endpoint?.href,key,status:{ready:!issues.length,issues}};
}
function connectionError(error){return error?.name==='TimeoutError'||error?.name==='AbortError'?'connection_timeout':'connection_failed';}
function httpCode(status){return status===401||status===403?'authentication_failed':status===404?'endpoint_not_found':status===429?'rate_limited':status>=500?'dashboard_unavailable':'dashboard_rejected';}
export async function inspectLeadConnection(env){
  const config=leadConfig(env);
  if(!config.status.ready)return {ok:false,code:'configuration_invalid',configuration:config.status};
  try{
    // GET never creates a prospect. GigDashboard middleware checks this API key.
    const response=await fetch(config.endpoint,{method:'GET',headers:{Authorization:'Bearer '+config.key,'X-API-Key':config.key},redirect:'manual',signal:AbortSignal.timeout(8000)});
    await response.body?.cancel();
    return {ok:response.ok,configuration:config.status,status:response.status,
      code:response.status>=300&&response.status<400?'endpoint_redirect':response.ok?'reachable_not_write_verified':httpCode(response.status)};
  }catch(error){return {ok:false,configuration:config.status,code:connectionError(error)};}
}
export async function captureQuoteLead(data,env){
  const config=leadConfig(env);
  if(!config.status.ready)return {ok:false,skipped:true,code:'configuration_invalid',issues:config.status.issues};
  try{
    const response=await fetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key,'X-API-Key':config.key},
      body:JSON.stringify(data),signal:AbortSignal.timeout(15000),redirect:'manual'});
    if(response.status>=300&&response.status<400){await response.body?.cancel();return {ok:false,status:response.status,code:'endpoint_redirect'};}
    const result=await response.json().catch(()=>null);
    if(response.ok&&result?.ok===true&&typeof result.prospect?.id==='string'&&result.prospect.estimateId===data.estimateId){
      return {ok:true,status:response.status,code:'saved',reference:data.estimateId,duplicate:result.duplicate===true};
    }
    return {ok:false,status:response.status,code:response.ok?'unconfirmed_receipt':httpCode(response.status)};
  }catch(error){return {ok:false,code:connectionError(error)};}
}
