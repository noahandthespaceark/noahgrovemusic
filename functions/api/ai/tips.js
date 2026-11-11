import { json } from './_auth.js';
import { tipHistory } from '../_tip-history.js';
export async function onRequestGet({request,env}) {
 const token=String(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
 if(!env.TIP_HISTORY_READ_TOKEN || token!==env.TIP_HISTORY_READ_TOKEN) return json({ok:false,error:'Unauthorized'},401);
 try{return json({...await tipHistory(env,new URL(request.url).searchParams),source:'noahgrovemusic_square'});}
 catch(e){return json({ok:false,error:e.message},400);}
}
