import {PRICING,coreCosts} from '../../quote-pricing.js';

export function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
export function sameSite(request){
  const origin=request.headers.get('origin');
  return (!origin||origin===new URL(request.url).origin)&&request.headers.get('sec-fetch-site')!=='cross-site';
}
export function text(value,max=300){return String(value??'').trim().slice(0,max);}
// Best-effort per-isolate burst guard; configure Cloudflare WAF limits for a global budget cap.
const windows=new Map();
export function limited(request,scope,limit=40){
  const key=scope+':'+(request.headers.get('cf-connecting-ip')||'local'),now=Date.now();
  let slot=windows.get(key);if(!slot||now-slot.start>=60000){slot={start:now,count:0};windows.delete(key);windows.set(key,slot);}
  while(windows.size>1000)windows.delete(windows.keys().next().value);
  return ++slot.count>limit;
}
export async function google(env,url,body,mask){
  if(!env.GOOGLE_MAPS_API_KEY)throw new Error('MAPS_NOT_CONFIGURED');
  const response=await fetch(url,{method:body?'POST':'GET',headers:{
    'Content-Type':'application/json','X-Goog-Api-Key':env.GOOGLE_MAPS_API_KEY,
    ...(mask?{'X-Goog-FieldMask':mask}:{})
  },...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!response.ok)throw new Error(response.status===403?'MAPS_ACCESS_DENIED':'MAPS_UNAVAILABLE');
  return response.json();
}
export async function estimate(input,env){
  const core=coreCosts(input),destination=text(input.destination);
  const pending={...core,travel:null,total:null,travelStatus:destination?'unavailable':'missing_address',
    travelMeta:destination?'Travel pending confirmation; not included in the subtotal.':'Venue address needed; travel is not included in the subtotal.'};
  if(!destination)return pending;
  if(!env.QUOTE_TRAVEL_ORIGIN)return {...pending,code:'MAPS_NOT_CONFIGURED'};
  try{
    const data=await google(env,'https://routes.googleapis.com/directions/v2:computeRoutes',{
      origin:{address:env.QUOTE_TRAVEL_ORIGIN},destination:{address:destination},
      travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',computeAlternativeRoutes:false
    },'routes.distanceMeters');
    const meters=data.routes?.[0]?.distanceMeters;
    if(typeof meters!=='number'||!Number.isFinite(meters)||meters<0)return {...pending,code:'ROUTE_NOT_FOUND'};
    const miles=meters/1609.344,travel=Math.round(miles*(PRICING.roundTrip?2:1)*PRICING.travelPerMile);
    return {...core,travel,total:core.subtotal+travel,travelStatus:'ready',
      travelMeta:`${miles.toFixed(1)} one-way driving miles · $${PRICING.travelPerMile}/mile`};
  }catch(error){return {...pending,code:['MAPS_NOT_CONFIGURED','MAPS_ACCESS_DENIED'].includes(error.message)?error.message:'MAPS_UNAVAILABLE'};}
}
