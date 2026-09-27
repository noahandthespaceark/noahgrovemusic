export function aiAuthorized(request,env){
  const expected=String(env.NOAHGROVEMUSIC_AI_TOKEN||'').trim();
  const supplied=String(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!expected||!supplied||expected.length!==supplied.length)return false;
  let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^supplied.charCodeAt(i);return diff===0;
}
export function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex, nofollow'}})}
