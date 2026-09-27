import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet as showsRead} from '../functions/api/ai/shows.js';
import {onRequestGet as tracksRead} from '../functions/api/ai/tracks.js';
import {onRequestGet as analyticsRead} from '../functions/api/ai/analytics.js';

const request=(path,token='ai-secret')=>new Request('https://noahgrove.com'+path,{headers:{authorization:'Bearer '+token}});

test('AI endpoints reject missing credentials',async()=>{
  const response=await showsRead({request:new Request('https://noahgrove.com/api/ai/shows'),env:{NOAHGROVEMUSIC_AI_TOKEN:'ai-secret'}});
  assert.equal(response.status,401);
});

test('AI shows read returns bounded future public gig fields',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,source:'timebrain',events:[{id:'g1',title:'Public Show',location:'Venue',description:'Live music',url:'https://example.com',start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString()}]}),{status:200});
  try{const response=await showsRead({request:request('/api/ai/shows?limit=1'),env:{NOAHGROVEMUSIC_AI_TOKEN:'ai-secret'}});assert.equal(response.status,200);const body=await response.json();assert.equal(body.events.length,1);assert.equal(body.events[0].title,'Public Show');}
  finally{globalThis.fetch=original}
});

test('AI tracks read lists audio metadata without bucket credentials',async()=>{
  const env={NOAHGROVEMUSIC_AI_TOKEN:'ai-secret',MUSIC_BUCKET:{async list(){return{objects:[{key:'music/hello-world.mp3',size:123,uploaded:new Date('2026-01-01T00:00:00Z')},{key:'cover.jpg',size:1}]}}}};
  const response=await tracksRead({request:request('/api/ai/tracks'),env});assert.equal(response.status,200);const body=await response.json();assert.equal(body.count,1);assert.equal(body.tracks[0].title,'hello world');assert.match(body.tracks[0].audio_url,/\/api\/audio/);
});

test('AI analytics exposes aggregate site performance, not visitor-level recent activity',async()=>{
  const firstResult={events:20,visitors:5,sessions:6,page_views:10,song_plays:4,song_downloads:1,youtube_plays:2,tip_count:1,tip_total:10,merch_count:1,merch_total:20};
  const db={prepare(sql){return{bind(){return this},async run(){return{}},async first(){return firstResult},async all(){return{results:sql.includes('object_type')?[{title:'Song',id:'s1',plays:4,completions:1}]:[{page:'/',views:10,visitors:5}]}}}}};
  const response=await analyticsRead({request:request('/api/ai/analytics?days=30'),env:{NOAHGROVEMUSIC_AI_TOKEN:'ai-secret',ANALYTICS_DB:db}});assert.equal(response.status,200);const body=await response.json();assert.equal(body.summary.visitors,5);assert.equal(body.recent,undefined);assert.equal(body.countries,undefined);assert.equal(body.top_pages[0].page,'/');
});
