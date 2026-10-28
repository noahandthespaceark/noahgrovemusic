import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {coreCosts} from '../quote-pricing.js';
import {estimate} from '../functions/api/_quote.js';
import {limited} from '../functions/api/_quote.js';
import {onRequestPost as route} from '../functions/api/quote-estimate.js';
import {onRequestGet as places} from '../functions/api/quote-locations.js';
import {onRequestGet as config} from '../functions/api/quote-config.js';
import {onRequestPost as send} from '../functions/api/send-quote.js';
const env={GOOGLE_MAPS_API_KEY:'private-key',QUOTE_TRAVEL_ORIGIN:'private-origin',RESEND_API_KEY:'mail-secret',QUOTE_TO_EMAIL:'host@example.test',QUOTE_FROM_EMAIL:'quotes@example.test'};
const request=(path,body)=>new Request('https://www.noahgrove.com/api/'+path,{method:'POST',headers:{origin:'https://www.noahgrove.com','cf-connecting-ip':crypto.randomUUID()},body:typeof body==='string'?body:JSON.stringify(body)});
async function mocked(fn,run){const before=globalThis.fetch;globalThis.fetch=fn;try{return await run();}finally{globalThis.fetch=before;}}
test('published rates remain unchanged; invalid counts cannot produce a price',()=>{
  assert.deepEqual(coreCosts({hours:2,songCount:3,setups:2}),{performance:600,songs:50,setupsCost:100,subtotal:750});
  for(const hours of [0,6,-1,1.5,'<script>'])assert.throws(()=>coreCosts({hours}));
  assert.throws(()=>coreCosts({songCount:100}));assert.throws(()=>coreCosts({setups:4}));
});
test('route distance is driving mileage, pricing is server-owned, private fields are not returned',async()=>{
  await mocked(async(url,options)=>{
    assert.match(url,/routes.googleapis.com/);assert.equal(options.headers['X-Goog-Api-Key'],'private-key');
    const input=JSON.parse(options.body);assert.deepEqual(input.origin,{address:'private-origin'});assert.equal(input.travelMode,'DRIVE');
    return Response.json({routes:[{distanceMeters:16093.44}]});
  },async()=>{
    const data=await estimate({hours:2,destination:'Public venue',travel:999,total:1},env);
    assert.equal(data.travel,20);assert.equal(data.total,620);assert.equal(data.travelStatus,'ready');
    assert.doesNotMatch(JSON.stringify(data),/private-key|private-origin/);
  });
});
test('missing configuration, no route, Google denial, timeout and malformed distance never become free travel',async()=>{
  assert.equal((await estimate({destination:'A'},{})).total,null);
  assert.equal((await estimate({},env)).travelStatus,'missing_address');
  for(const response of [Response.json({routes:[]}),Response.json({routes:[{distanceMeters:'bad'}]}),new Response('secret upstream error',{status:403})]){
    await mocked(async()=>response,async()=>{const d=await estimate({destination:'A'},env);assert.equal(d.travel,null);assert.equal(d.total,null);assert.equal(d.subtotal,600);});
  }
  await mocked(async()=>{throw new Error('private-key');},async()=>{const d=await estimate({destination:'A'},env);assert.equal(d.code,'MAPS_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(d),/private-key/);});
});
test('estimate input and cross-site requests are bounded before provider calls',async()=>{
  for(const body of ['bad','null','[]',JSON.stringify({hours:9})])assert.equal((await route({request:request('quote-estimate',body),env})).status,400);
  assert.equal((await route({request:request('quote-estimate','x'.repeat(12001)),env})).status,413);
  assert.equal((await route({request:new Request('https://www.noahgrove.com/api/quote-estimate',{method:'POST',headers:{origin:'https://other.test'},body:'{}'}),env})).status,403);
});
test('Places autocomplete returns normalized public data with session and city bias; selection fetches only required details',async()=>{
  await mocked(async(url,options)=>{
    if(url.includes(':autocomplete')){const b=JSON.parse(options.body);assert.equal(b.sessionToken,'session-1');assert(b.locationBias);return Response.json({suggestions:[{placePrediction:{placeId:'venue-1',text:{text:'Venue, Charleston'}}}]});}
    assert.match(url,/places\/venue-1\?sessionToken=session-1/);assert.equal(options.headers['X-Goog-FieldMask'],'id,displayName,formattedAddress');
    return Response.json({id:'venue-1',displayName:{text:'Venue'},formattedAddress:'123 Public St'});
  },async()=>{
    const get=s=>places({request:new Request('https://www.noahgrove.com/api/quote-locations?'+s),env});
    assert.equal((await (await get('q=Ven&session=session-1')).json()).suggestions[0].id,'venue-1');
    assert.equal((await (await get('placeId=venue-1&session=session-1')).json()).place.address,'123 Public St');
    assert.equal((await get('placeId=../secret')).status,400);
  });
  const response=await places({request:new Request('https://www.noahgrove.com/api/quote-locations?q=Venue'),env:{}});
  assert.equal(response.status,503);assert.match((await response.json()).error,/manually/);
});
test('public configuration returns booleans only',async()=>{
  assert.deepEqual(await config({env}).json(),{ok:true,version:'quote-2',venueSearchConfigured:true,travelConfigured:true,emailConfigured:true});
});
test('burst guard limits a client without consuming a different client quota',()=>{
  const a=request('quote-estimate',{}),b=request('quote-estimate',{});
  assert.equal(limited(a,'test',2),false);assert.equal(limited(a,'test',2),false);
  assert.equal(limited(a,'test',2),true);assert.equal(limited(b,'test',2),false);
});
test('customer email timeout does not discard an already delivered inquiry',async()=>{
  let sent=0;
  await mocked(async()=>{if(++sent===1)return Response.json({id:'accepted'});throw new Error('timeout');},async()=>{
    const response=await send({request:request('send-quote',{fullName:'Synthetic',email:'test@example.test',phone:'5550100000'}),env:{...env,GOOGLE_MAPS_API_KEY:''}});
    const d=await response.json();assert.equal(d.ok,true);assert.equal(d.customerConfirmation,false);
  });
});
test('email totals are recalculated and pending travel is labeled; confirmation failure preserves lead flow',async()=>{
  const calls=[];
  await mocked(async(url,options)=>{
    const b=JSON.parse(options.body);calls.push({url,options,b});
    if(url==='https://api.resend.com/emails')return Response.json({id:'email'}, {status:calls.length===1?200:500});
    return Response.json({ok:true});
  },async()=>{
    const response=await send({request:request('send-quote',{fullName:'Test <person>',email:'person@example.test',phone:'5550100000',hours:2,destination:'Venue',total:1,travel:0,submissionId:'test'}),env:{...env,GOOGLE_MAPS_API_KEY:'',GIGDASHBOARD_POSSIBLE_CLIENTS_URL:'https://lead.example.test'}});
    const d=await response.json();assert.equal(d.ok,true);assert.equal(d.customerConfirmation,false);assert.equal(d.estimate.total,null);assert.equal(d.estimate.subtotal,600);
    assert.equal(calls.length,3);assert.match(calls[0].b.text,/Subtotal — travel not included: \$600/);assert.match(calls[0].b.html,/&lt;person&gt;/);
    assert.equal(calls[2].b.estimate.total,null);assert.equal(calls[2].b.estimate.travelStatus,'unavailable');
    assert.match(calls[0].options.headers['Idempotency-Key'],/^quote-admin-/);
  });
});
test('frontend ignores obsolete routes and reset cancels pending work',async()=>{
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',hidden:false,dataset:{},classList:{toggle(){},remove(){},add(){},contains(){return false;}},setAttribute(){},getAttribute(){},removeAttribute(){},replaceChildren(){},addEventListener(){},focus(){}});return nodes.get(id);};
  const deferred=[];
  const context={document:{getElementById:node,querySelector:s=>({value:s.includes('hours')?'2':'1'}),querySelectorAll:()=>[]},crypto,Intl,Number,String,JSON,AbortController,AbortSignal,setTimeout,clearTimeout,fetch:()=>new Promise(resolve=>deferred.push(resolve))};
  vm.createContext(context);vm.runInContext(readFileSync('quote-calculator.js','utf8').replace(/^import .*;\n/,''),Object.assign(context,{coreCosts}));
  node('destination').value='New venue';vm.runInContext('invalidateTravel();calculate()',context);
  deferred[1](Response.json({ok:true,...coreCosts(),travel:20,total:620,travelMeta:'New route'}));await new Promise(resolve=>setImmediate(resolve));
  deferred[0](Response.json({ok:true,...coreCosts(),travel:999,total:1599,travelMeta:'Old route'}));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(node('grandTotal').textContent,'$620');assert.equal(node('travelMeta').textContent,'New route');
});
