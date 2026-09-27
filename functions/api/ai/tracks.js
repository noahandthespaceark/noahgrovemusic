import {aiAuthorized,json} from './_auth.js';
const NAMES=['MUSIC_BUCKET','AUDIO_BUCKET','MEDIA_BUCKET','R2_BUCKET','NOAH_MUSIC_BUCKET','NOAH_GROVE_MUSIC_BUCKET'];
const AUDIO=new Set(['mp3','m4a','wav','ogg','flac','aac']);
function bucket(env){for(const name of NAMES)if(env[name]&&typeof env[name].list==='function')return env[name];return null}
function title(key){return String(key).split('/').pop().replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim()}
export async function onRequestGet({request,env}){
  if(!aiAuthorized(request,env))return json({ok:false,error:'Unauthorized'},401);
  const b=bucket(env);if(!b)return json({ok:false,error:'Music bucket unavailable'},503);
  const url=new URL(request.url),limit=Math.max(1,Math.min(500,Number(url.searchParams.get('limit')||200))),prefix=String(url.searchParams.get('prefix')||'').slice(0,200);
  const listed=await b.list({prefix,limit:Math.min(1000,limit*3)});const origin=url.origin;
  const tracks=(listed.objects||[]).filter(o=>AUDIO.has(String(o.key||'').split('.').pop().toLowerCase())).slice(0,limit).map(o=>({title:title(o.key),key:String(o.key),audio_url:new URL('/api/audio?key='+encodeURIComponent(o.key),origin).toString(),download_url:new URL('/api/download?key='+encodeURIComponent(o.key),origin).toString(),size_bytes:Number(o.size||0),uploaded:o.uploaded?.toISOString?.()||String(o.uploaded||'')})).sort((a,b)=>a.title.localeCompare(b.title,undefined,{sensitivity:'base',numeric:true}));
  return json({ok:true,count:tracks.length,tracks});
}
