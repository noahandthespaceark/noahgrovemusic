import {estimate,json,sameSite,limited} from './_quote.js';
export async function onRequestPost({request,env}){
  if(!sameSite(request))return json({ok:false,error:'Use the quote form on this website.'},403);
  if(limited(request,'maps'))return json({ok:false,error:'Too many lookups. Please wait a minute.'},429);
  try{
    const raw=await request.text();if(raw.length>12000)return json({ok:false,error:'Request too large.'},413);
    const body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();
    return json({ok:true,...await estimate(body,env)});
  }catch{return json({ok:false,error:'Choose valid event details.'},400);}
}
