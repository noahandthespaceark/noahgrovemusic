import {aiAuthorized,json} from './_auth.js';
const DEFAULT_TIMEBRAIN_GIGS_URL='https://timebrain.pages.dev/api/public/gigs';
export async function onRequestGet({request,env}){
  if(!aiAuthorized(request,env))return json({ok:false,error:'Unauthorized'},401);
  const url=new URL(request.url),limit=Math.max(1,Math.min(50,Number(url.searchParams.get('limit')||20)));
  try{
    const response=await fetch(String(env.TIMEBRAIN_GIGS_URL||DEFAULT_TIMEBRAIN_GIGS_URL).trim(),{headers:{accept:'application/json','cache-control':'no-cache','user-agent':'NoahGroveMusic-AI/1.0'}});
    if(!response.ok)return json({ok:false,error:'TimeBrain gigs feed unavailable'},502);
    const data=await response.json();const events=(Array.isArray(data?.events)?data.events:[]).map(event=>({uid:String(event.uid||event.id||''),title:String(event.title||'Noah Grove Music'),location:String(event.location||''),description:String(event.description||''),url:String(event.url||''),start:String(event.start||''),end:String(event.end||event.start||''),all_day:Boolean(event.allDay),recurring:Boolean(event.recurring),sequence:Number(event.sequence||0)})).filter(event=>event.start&&!Number.isNaN(Date.parse(event.start))&&Date.parse(event.end||event.start)>=Date.now()).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).slice(0,limit);
    return json({ok:true,source:'timebrain',events,generated_at:String(data?.generatedAt||new Date().toISOString())});
  }catch{return json({ok:false,error:'TimeBrain gigs feed unavailable'},502)}
}
