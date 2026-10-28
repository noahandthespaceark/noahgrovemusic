// Synthetic localhost QA only. No upstream provider calls, mail, or customer records.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {coreCosts} from '../quote-pricing.js';
const root=resolve('.');
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const offline=new URL(req.headers.referer||'http://localhost').searchParams.has('offline');
    const reply=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(url.pathname==='/api/quote-locations'){
      if(offline)return reply({ok:false,error:'Venue suggestions are unavailable. You can enter the name and address manually.'},503);
      return reply(url.searchParams.has('placeId')?{ok:true,place:{id:'qa',name:'Synthetic venue',address:'123 Example St, Charleston, SC'}}:{ok:true,suggestions:[{id:'qa',label:'Synthetic venue, Charleston, SC'}]});
    }
    if(url.pathname==='/api/quote-estimate'||url.pathname==='/api/send-quote'){
      let raw='';for await(const part of req)raw+=part;
      const input=JSON.parse(raw),core=coreCosts(input),ready=!!input.destination&&!offline;
      const data={ok:true,...core,travel:ready?20:null,total:ready?core.subtotal+20:null,travelStatus:ready?'ready':'unavailable',travelMeta:ready?'10.0 one-way driving miles · $2/mile':'Travel pending confirmation; not included in the subtotal.'};
      return reply(url.pathname.includes('send-quote')?{ok:true,customerConfirmation:true,estimate:data}:data);
    }
    if(req.method!=='GET'){res.writeHead(405);res.end();return;}
    const path=resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!path.startsWith(root+'/')||!['.html','.css','.js'].includes(extname(path))){res.writeHead(404);res.end();return;}
    const data=await readFile(path);res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'text/html');res.end(data);
  }catch{res.writeHead(400);res.end();}
}).listen(18846,'127.0.0.1',()=>console.log('Synthetic quote QA: http://127.0.0.1:18846/cost-calculator.html'));
