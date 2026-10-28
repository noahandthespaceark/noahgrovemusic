import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteMailConfig,sendQuoteMail,validEmail} from '../functions/api/_quote-mail.js';
import {onRequestGet as health} from '../functions/api/quote-email-health.js';
import {onRequestPost as send} from '../functions/api/send-quote.js';
const env={RESEND_API_KEY:'secret-test',FROM_EMAIL:'Noah <sender@example.test>',TO_EMAIL:'Owner <owner@example.test>'};
async function mocked(fetch,run){const before=globalThis.fetch;globalThis.fetch=fetch;try{await run();}finally{globalThis.fetch=before;}}
const request=body=>new Request('https://www.noahgrove.com/api/send-quote',{method:'POST',headers:{origin:'https://www.noahgrove.com','cf-connecting-ip':crypto.randomUUID()},body:JSON.stringify({fullName:'Synthetic Person',email:'person@example.test',phone:'5550100000',submissionId:'stable-test',...body})});
const healthRequest=()=>new Request('https://www.noahgrove.com/api/quote-email-health',{headers:{'cf-connecting-ip':crypto.randomUUID()}});
test('mail configuration supports legacy names, explicit precedence, defaults and safe public status',()=>{
  const legacy=quoteMailConfig(env);assert.equal(legacy.ready,true);assert.equal(legacy.to,'owner@example.test');assert.equal(legacy.replyTo,'owner@example.test');
  assert.equal(legacy.status.senderSource,'FROM_EMAIL');assert.doesNotMatch(JSON.stringify(legacy.status),/secret-test|example.test/);
  const defaults=quoteMailConfig({RESEND_API_KEY:'secret'});assert.equal(defaults.ready,true);assert.equal(defaults.to,'noah@noahgrove.com');assert.equal(defaults.status.senderSource,'default');
  const explicit=quoteMailConfig({...env,QUOTE_FROM_EMAIL:'preferred@example.test',QUOTE_TO_EMAIL:'preferred-owner@example.test',QUOTE_REPLY_TO_EMAIL:'reply@example.test'});
  assert.equal(explicit.from,'preferred@example.test');assert.equal(explicit.to,'preferred-owner@example.test');assert.equal(explicit.replyTo,'reply@example.test');
  assert.equal(quoteMailConfig({...env,QUOTE_FROM_EMAIL:'invalid'}).ready,false);
  assert.equal(quoteMailConfig({}).status.issues[0],'missing_api_key');
  assert.equal(quoteMailConfig({...env,RESEND_API_KEY:'bad\nkey'}).ready,false);
  for(const email of ['a@example.test\nBcc:b@example.test','a@example.test,b@example.test','<a@example.test>','not-an-email'])assert.equal(validEmail(email),false);
});
test('provider acceptance requires a valid receipt and redirects never forward credentials',async()=>{
  const cases=[{response:()=>Response.json({id:'accepted'}),outcome:'accepted'},
    {response:()=>Response.json({}),outcome:'unknown'},
    {response:()=>new Response('not json'),outcome:'unknown'},
    {response:()=>Response.json({message:'secret-test private recipient'},{status:403}),outcome:'rejected'},
    {response:()=>Response.json({error:'private'},{status:500}),outcome:'unknown'},
    {response:()=>new Response(null,{status:302,headers:{location:'https://untrusted.test'}}),outcome:'unknown'},
    {response:()=>{throw new Error('secret-test');},outcome:'unknown'}];
  for(const item of cases)await mocked(async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');assert.equal(options.redirect,'manual');return item.response();},async()=>{
    const result=await sendQuoteMail(quoteMailConfig(env),{to:['person@example.test']},'stable');
    assert.equal(result.outcome,item.outcome);assert.doesNotMatch(JSON.stringify(result),/secret-test|private|untrusted/);
  });
});
test('sender health is read-only, limited to configured domain, and does not expose provider data',async()=>{
  for(const [response,expected] of [
    [()=>Response.json({data:[{name:'example.test',status:'verified',capabilities:{sending:'enabled'}},{name:'private-other.test'}]}),'verified'],
    [()=>Response.json({data:[{name:'example.test',status:'pending'}]}),'not_verified'],
    [()=>Response.json({data:[],has_more:true}),'unknown'],
    [()=>Response.json({data:[]}),'not_found'],
    [()=>Response.json({message:'private-secret'},{status:403}),'read_scope_unavailable'],
    [()=>Response.json({},{status:401}),'authentication_failed']
  ])await mocked(async(url,options)=>{assert.equal(url,'https://api.resend.com/domains');assert.equal(options.method,undefined);assert.equal(options.redirect,'manual');return response();},async()=>{
    const result=await (await health({request:healthRequest(),env})).json();assert.equal(result.senderVerification,expected);assert.equal(result.deliveryTestPerformed,false);
    assert.doesNotMatch(JSON.stringify(result),/secret-test|example.test|private/);
  });
});
test('unconfigured mail and invalid input never contact a provider',async()=>{
  await mocked(async()=>assert.fail('must not contact provider'),async()=>{
    assert.equal((await send({request:request(),env:{}})).status,503);
    for(const body of [{email:'a@example.test\r\nBcc:b@example.test'},{eventDate:'2026-02-30'},{startTime:'25:00'},{venueName:'A\r\nsubject'}])assert.equal((await send({request:request(body),env})).status,400);
    const result=await (await health({request:healthRequest(),env:{}})).json();assert.equal(result.senderVerification,'not_configured');
  });
});
test('owner rejection stops confirmation and exposes only safe outcome plus reference',async()=>{
  let calls=0;
  await mocked(async()=>{calls++;return Response.json({message:'secret-test address@example.test'},{status:403});},async()=>{
    const response=await send({request:request(),env});assert.equal(response.status,502);const result=await response.json();
    assert.equal(result.code,'sender_or_permission_rejected');assert.equal(result.emailOutcome,'rejected');assert.match(result.reference,/^NQ-[A-F0-9]{12}$/);assert.equal(calls,1);
    assert.doesNotMatch(JSON.stringify(result),/secret-test|address@example.test/);
  });
});
test('both emails have matching breakdowns, readable dates, correct replies and stable retry keys',async()=>{
  const calls=[];
  await mocked(async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return Response.json({id:'accepted'});},async()=>{
    for(let i=0;i<2;i++){
      const result=await (await send({request:request({eventDate:'2026-11-22',startTime:'17:30',notes:'<private notes>',hours:2,songCount:3,setups:2}),env})).json();
      assert.equal(result.ok,true);assert.equal(result.ownerEmailAccepted,true);assert.equal(result.customerConfirmation,true);
    }
    assert.equal(calls.length,4);assert.equal(calls[0].body.reply_to,'person@example.test');assert.equal(calls[1].body.reply_to,'owner@example.test');
    assert.equal(calls[0].options.headers['Idempotency-Key'],calls[2].options.headers['Idempotency-Key']);
    assert.notEqual(calls[0].options.headers['Idempotency-Key'],calls[1].options.headers['Idempotency-Key']);
    for(const call of calls){assert.match(call.body.text,/November 22, 2026/);assert.match(call.body.text,/5:30 PM/);assert.match(call.body.text,/\$750/);assert.match(call.body.text,/Reference: NQ-/);assert.match(call.body.html,/&lt;private notes&gt;/);}
    assert.match(calls[1].body.text,/not a confirmed booking/);
  });
});
