import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {tipHistory,isSquareTip} from '../functions/api/_tip-history.js';
import {onRequestGet} from '../functions/api/ai/tips.js';
function env(){const raw=new DatabaseSync(':memory:');return{TIP_HISTORY_READ_TOKEN:'limited',SQUARE_ACCESS_TOKEN:'merchant',SQUARE_LOCATION_ID:'location',DB:{prepare(sql){return{bind(...args){this.args=args;return this},async run(){raw.prepare(sql).run(...this.args||[])},async first(){return raw.prepare(sql).get(...this.args||[])},async all(){return{results:raw.prepare(sql).all(...this.args||[])}}}}}};}
test('tip-only credential does not fall back to unrelated credentials or public access',async()=>{
 for(const authorization of ['', 'Bearer merchant','Bearer unknown'])assert.equal((await onRequestGet({env:env(),request:new Request('https://noahgrove.test/api/ai/tips',{headers:{authorization}})})).status,401);
});
test('legacy $5/$10 payments are verified against Square, stored once, and never trigger outbound events',async()=>{
 const e=env(),old=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{assert.equal(init.method||'GET','GET');const u=new URL(url);
  if(u.pathname==='/v2/payments')return Response.json({payments:[500,1000].map(n=>({id:String(n),order_id:'o'+n,location_id:'location',status:'COMPLETED',created_at:'2026-11-10T23:00:00Z',amount_money:{amount:n,currency:'USD'}}))});
  if(u.pathname.startsWith('/v2/orders/'))return Response.json({order:{line_items:[{name:'Support the Music'}]}});
  throw Error('Unexpected request');
 };
 try{const q=new URLSearchParams({after:'2026-11-10T05:00:00Z',before:'2026-11-11T05:00:00Z'});await tipHistory(e,q);const r=await tipHistory(e,q);assert.equal(r.receipts.length,2);assert.equal(r.totals[0].amountCents,1500);assert.equal(r.partial,false);assert.equal(r.receipts[0].customerName,undefined);}finally{globalThis.fetch=old;}
 assert.equal(isSquareTip({}, {reference_id:'NG-TIP-new'}),true);
});
