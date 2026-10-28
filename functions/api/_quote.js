import {PRICING,coreCosts} from '../../quote-pricing.js';
import {failure,providerFailure,diagnosticFor,transportFailure} from './_maps-diagnostics.js';

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
export async function google(env,url,body,mask,operation='maps_request'){
  if(!env.GOOGLE_MAPS_API_KEY)throw failure(operation,'configuration','KEY_NOT_CONFIGURED');
  const key=String(env.GOOGLE_MAPS_API_KEY);
  if(key!==key.trim()||/[\r\n\u0000-\u001f\u007f-\uffff]/.test(key)||/^["']|["']$/.test(key)){
    throw failure(operation,'configuration','KEY_FORMAT_INVALID',{explanation:'The stored key includes whitespace, quotes, or unsupported characters. Its value is not shown.'});
  }
  if(typeof AbortSignal.timeout!=='function')throw failure(operation,'request_setup','TIMEOUT_API_UNSUPPORTED',{explanation:'The deployed runtime does not support the timeout API used by this integration.'});
  let options;
  try{
    options={method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,
      ...(mask?{'X-Goog-FieldMask':mask}:{})},...(body?{body:JSON.stringify(body)}:{}),
      signal:AbortSignal.timeout(8000),redirect:'error'};
  }catch{throw failure(operation,'request_setup','REQUEST_SETUP_FAILED');}
  let response;
  try{response=await fetch(url,options);}
  catch(error){throw transportFailure(operation,error);}
  let data;try{data=await response.json();}catch{
    if(!response.ok)throw providerFailure(operation,response,null);
    throw failure(operation,'response_decode','INVALID_JSON_RESPONSE',{httpStatus:response.status});
  }
  if(!response.ok||data?.error)throw providerFailure(operation,response,data);
  return data;
}
export async function estimate(input,env){
  const core=coreCosts(input),destination=text(input.destination);
  const pending={...core,travel:null,total:null,travelStatus:destination?'unavailable':'missing_address',
    travelMeta:destination?'Travel pending confirmation; not included in the subtotal.':'Venue address needed; travel is not included in the subtotal.'};
  if(!destination)return pending;
  if(!env.QUOTE_TRAVEL_ORIGIN)return {...pending,code:'MAPS_NOT_CONFIGURED',diagnostic:diagnosticFor(failure('routes','configuration','ORIGIN_NOT_CONFIGURED'),'routes')};
  try{
    const data=await google(env,'https://routes.googleapis.com/directions/v2:computeRoutes',{
      origin:{address:env.QUOTE_TRAVEL_ORIGIN},destination:{address:destination},
      travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',computeAlternativeRoutes:false
    },'routes.distanceMeters','routes');
    const meters=data.routes?.[0]?.distanceMeters;
    if(typeof meters!=='number'||!Number.isFinite(meters)||meters<0)return {...pending,code:'ROUTE_NOT_FOUND',diagnostic:{version:1,operation:'routes',stage:'route_result',reason:Array.isArray(data.routes)&&!data.routes.length?'NO_ROUTE_RETURNED':'INVALID_ROUTE_DISTANCE'}};
    const miles=meters/1609.344,travel=Math.round(miles*(PRICING.roundTrip?2:1)*PRICING.travelPerMile);
    return {...core,travel,total:core.subtotal+travel,travelStatus:'ready',
      travelMeta:`${miles.toFixed(1)} one-way driving miles · $${PRICING.travelPerMile}/mile`};
  }catch(error){return {...pending,code:['MAPS_NOT_CONFIGURED','MAPS_ACCESS_DENIED'].includes(error.message)?error.message:'MAPS_UNAVAILABLE',diagnostic:diagnosticFor(error,'routes')};}
}
