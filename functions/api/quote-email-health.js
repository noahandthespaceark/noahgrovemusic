import {json,limited,sameSite} from './_quote.js';
import {quoteMailConfig} from './_quote-mail.js';
export async function onRequestGet({request,env}){
  if(!sameSite(request))return json({ok:false,error:'Use this website.'},403);
  if(limited(request,'email-health',5))return json({ok:false,error:'Please wait before checking again.'},429);
  const config=quoteMailConfig(env);
  const result=status=>json({ok:true,configuration:config.status,senderVerification:status,deliveryTestPerformed:false});
  if(!config.ready)return result('not_configured');
  try{
    const response=await fetch('https://api.resend.com/domains',{headers:{Authorization:'Bearer '+config.key},redirect:'manual',signal:AbortSignal.timeout(8000)});
    if(response.status>=300&&response.status<400){await response.body?.cancel();return result('unavailable');}
    if(response.status===401)return result('authentication_failed');
    if(response.status===403)return result('read_scope_unavailable');
    const data=await response.json().catch(()=>null);
    if(!response.ok||!Array.isArray(data?.data))return result('unavailable');
    const domain=config.senderAddress.split('@')[1].toLowerCase();
    const entry=data.data.find(item=>typeof item.name==='string'&&item.name.toLowerCase()===domain);
    return result(entry?(entry.status==='verified'&&entry.capabilities?.sending!=='disabled'?'verified':'not_verified'):data.has_more?'unknown':'not_found');
  }catch{return result('unavailable');}
}
