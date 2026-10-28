import {google,json,sameSite,text,limited} from './_quote.js';
import {diagnosticFor} from './_maps-diagnostics.js';
export async function onRequestGet({request,env}){
  if(!sameSite(request))return json({ok:false,error:'Use the quote form on this website.'},403);
  if(limited(request,'maps'))return json({ok:false,error:'Too many lookups. Please wait a minute.'},429);
  const q=new URL(request.url).searchParams,query=text(q.get('q'),200),id=text(q.get('placeId'),200);
  const session=text(q.get('session'),36);
  if(session&&!/^[a-zA-Z0-9_-]{1,36}$/.test(session))return json({ok:false,error:'Invalid search session.'},400);
  if(id&&!/^[a-zA-Z0-9_-]+$/.test(id))return json({ok:false,error:'Invalid place.'},400);
  if(!id&&query.length<3)return json({ok:true,suggestions:[]});
  try{
    if(id){
      const data=await google(env,'https://places.googleapis.com/v1/places/'+encodeURIComponent(id)+(session?'?sessionToken='+encodeURIComponent(session):''),null,'id,displayName,formattedAddress','place_details');
      return json({ok:true,place:{id:data.id,name:data.displayName?.text||'',address:data.formattedAddress||''}});
    }
    const data=await google(env,'https://places.googleapis.com/v1/places:autocomplete',{
      input:query,languageCode:'en',includedRegionCodes:['us'],...(session?{sessionToken:session}:{}),
      locationBias:{circle:{center:{latitude:32.7765,longitude:-79.9311},radius:50000}}
    },undefined,'places_autocomplete');
    return json({ok:true,suggestions:(data.suggestions||[]).filter(s=>s.placePrediction?.placeId).slice(0,5).map(s=>({
      id:s.placePrediction.placeId,label:s.placePrediction.text?.text||''
    }))});
  }catch(error){return json({ok:false,error:'Venue suggestions are unavailable. You can enter the name and address manually.',diagnostic:diagnosticFor(error,id?'place_details':'places_autocomplete')},503);}
}
