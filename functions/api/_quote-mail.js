export const BOOKING_EMAIL='noah@noahgrove.com';
export function validEmail(value){return typeof value==='string'&&value.length<=254&&/^[^\s<>@,;"\x00-\x1f\x7f]+@[^\s<>@,;"\x00-\x1f\x7f]+\.[^\s<>@,;"\x00-\x1f\x7f]+$/.test(value);}
function mailbox(value,display=false){
  if(/[\r\n\x00-\x1f\x7f]/.test(value))return null;
  if(validEmail(value))return value;
  const match=display&&value.match(/^[^<>\r\n]+<([^<>]+)>$/);
  return match&&validEmail(match[1])?match[1]:null;
}
export function quoteMailConfig(env){
  const pick=(names,fallback)=>{for(const name of names)if(typeof env[name]==='string'&&env[name].trim())return {value:env[name].trim(),source:name};return {value:fallback,source:'default'};};
  const sender=pick(['QUOTE_FROM_EMAIL','FROM_EMAIL'],'Noah Grove Music <'+BOOKING_EMAIL+'>');
  const recipient=pick(['QUOTE_TO_EMAIL','TO_EMAIL'],BOOKING_EMAIL);
  const reply=pick(['QUOTE_REPLY_TO_EMAIL'],recipient.value);
  const key=typeof env.RESEND_API_KEY==='string'?env.RESEND_API_KEY.trim():'';
  const senderAddress=mailbox(sender.value,true),to=mailbox(recipient.value,true),replyTo=mailbox(reply.value,true);
  const issues=[];
  if(!key)issues.push('missing_api_key');else if(/\s|[^\x21-\x7e]/.test(key))issues.push('invalid_api_key_format');
  if(!senderAddress)issues.push('invalid_sender');if(!to)issues.push('invalid_recipient');if(!replyTo)issues.push('invalid_reply_to');
  return {key,from:sender.value,to,replyTo,senderAddress,ready:!issues.length,
    status:{ready:!issues.length,issues,senderSource:sender.source,recipientSource:recipient.source,replyToSource:reply.source,deliveryVerified:false}};
}
export async function sendQuoteMail(config,payload,idempotencyKey){
  try{
    const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(payload)});
    if(response.status>=300&&response.status<400){await response.body?.cancel();return {accepted:false,outcome:'unknown',code:'unexpected_redirect'};}
    const data=await response.json().catch(()=>null);
    if(response.ok&&typeof data?.id==='string'&&data.id.length>0&&!data.error)return {accepted:true,outcome:'accepted',code:'accepted'};
    const code=response.status===401?'authentication_failed':response.status===403?'sender_or_permission_rejected':response.status===429?'rate_limited':response.status===409?'idempotency_conflict':response.ok?'invalid_provider_response':response.status>=500?'provider_unavailable':'provider_rejected';
    return {accepted:false,outcome:response.ok||response.status>=500?'unknown':'rejected',code};
  }catch{return {accepted:false,outcome:'unknown',code:'connection_unconfirmed'};}
}
