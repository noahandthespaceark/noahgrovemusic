import {json,sameSite,limited} from './_quote.js';
import {inspectLeadConnection} from './_quote-leads.js';
export async function onRequestGet({request,env}){
  if(!sameSite(request))return json({ok:false,error:'Use this website.'},403);
  if(limited(request,'lead-health',5))return json({ok:false,error:'Please wait before checking again.'},429);
  return json({ok:true,leadConnection:await inspectLeadConnection(env),writeTestPerformed:false});
}
