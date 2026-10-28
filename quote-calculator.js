import {coreCosts} from './quote-pricing.js?v=quote-2';
const $=id=>document.getElementById(id),money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const selection=()=>({hours:Number(document.querySelector('[name="hours"]:checked').value),songCount:Number($('songs').value||0),setups:Number(document.querySelector('[name="setups"]:checked').value)});
let version=0,controller=null,routeTimer,searchTimer,searchController,searchVersion=0,session=crypto.randomUUID(),sending=false;
let result=null,submission=null,routeCache=null;
const error=message=>{$('calcError').textContent=message;$('calcError').style.display=message?'block':'none';};
const hint=message=>{$('bookingHint').textContent=message;$('bookingHint').style.display=message?'block':'none';};
async function api(url,options={}){
  const response=await fetch(url,{...options,cache:'no-store',signal:options.signal||AbortSignal.timeout(12000)});
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||'The service is unavailable. Please try again.');
  return data;
}
function render(data){
  $('perfCost').textContent=money(data.performance);$('songCost').textContent=money(data.songs);
  $('setupCost').textContent=money(data.setupsCost);$('travelCost').textContent=data.travel===null?'Pending':money(data.travel);
  $('songsRow').classList.toggle('hidden',!data.songs);$('setupRow').classList.toggle('hidden',!data.setupsCost);
  $('travelRow').classList.remove('hidden');$('travelMeta').textContent=data.travelMeta;
  $('totalLabel').textContent=data.total===null?'Subtotal · travel not included':'Estimated total';
  $('grandTotal').textContent=money(data.total??data.subtotal);
}
function invalidateTravel(){
  version++;controller?.abort();clearTimeout(routeTimer);result=null;
  render({...coreCosts(selection()),travel:null,total:null,travelMeta:$('destination').value.trim()?'Calculating travel…':'Enter a venue address to calculate travel.'});
}
async function calculate(){
  clearTimeout(routeTimer);const token=++version;controller?.abort();controller=new AbortController();
  const input={...selection(),destination:$('destination').value.trim()};
  if(routeCache?.destination===input.destination){
    result={...coreCosts(input),travel:routeCache.travel,total:coreCosts(input).subtotal+routeCache.travel,travelStatus:'ready',travelMeta:routeCache.travelMeta};render(result);return result;
  }
  render({...coreCosts(input),travel:null,total:null,travelMeta:input.destination?'Calculating travel…':'Enter a venue address to calculate travel.'});
  try{
    const data=await api('/api/quote-estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
    if(token!==version)return null;
    if(data.travelStatus==='ready')routeCache={destination:input.destination,travel:data.travel,travelMeta:data.travelMeta};
    result=data;render(data);return data;
  }catch(e){
    if(token!==version)return null;
    result={...coreCosts(input),travel:null,total:null,travelStatus:'unavailable',travelMeta:'Travel pending confirmation; not included in the subtotal.'};
    render(result);return result;
  }
}
function clearSuggestions(){searchVersion++;searchController?.abort();clearTimeout(searchTimer);$('venueSuggestions').replaceChildren();$('venueSuggestions').hidden=true;$('venueName').setAttribute('aria-expanded','false');$('venueName').removeAttribute('aria-activedescendant');}
async function choosePlace(id){
  clearSuggestions();const token=searchVersion;
  $('venueSearchStatus').textContent='Loading venue address…';
  try{
    const data=await api('/api/quote-locations?placeId='+encodeURIComponent(id)+'&session='+encodeURIComponent(session));
    if(token!==searchVersion)return;
    if(!data.place.address)throw new Error('No address found. Please enter the venue address manually.');
    $('venueName').value=data.place.name;$('destination').value=data.place.address;
    $('venueSearchStatus').textContent='Venue selected. You can edit the address if needed.';
    session=crypto.randomUUID();invalidateTravel();calculate();
  }catch(e){if(token===searchVersion)$('venueSearchStatus').textContent=e.message;}
}
function searchVenues(){
  clearSuggestions();const query=$('venueName').value.trim(),token=searchVersion;
  $('venueSearchStatus').textContent=query.length<3?'Type at least 3 characters, or enter the venue manually.':'Searching venues…';
  if(query.length<3)return;
  searchTimer=setTimeout(async()=>{
    searchController=new AbortController();
    try{
      const data=await api('/api/quote-locations?q='+encodeURIComponent(query)+'&session='+encodeURIComponent(session),{signal:AbortSignal.any([searchController.signal,AbortSignal.timeout(10000)])});
      if(token!==searchVersion)return;
      for(const [i,s] of data.suggestions.entries()){
        const option=document.createElement('li');option.id='venue-option-'+i;option.setAttribute('role','option');option.textContent=s.label;option.dataset.placeId=s.id;
        option.addEventListener('mousedown',e=>e.preventDefault());option.addEventListener('click',()=>choosePlace(s.id));$('venueSuggestions').append(option);
      }
      $('venueSuggestions').hidden=!data.suggestions.length;$('venueName').setAttribute('aria-expanded',String(!!data.suggestions.length));
      $('venueSearchStatus').textContent=data.suggestions.length?'Use arrow keys and Enter to choose a venue.':'No matches. Try a city with the venue name, or enter the address manually.';
    }catch(e){if(token===searchVersion)$('venueSearchStatus').textContent=e.message;}
  },350);
}
$('venueName').addEventListener('input',searchVenues);
$('venueName').addEventListener('keydown',e=>{
  const options=[...$('venueSuggestions').children],active=$('venueName').getAttribute('aria-activedescendant');
  let index=options.findIndex(o=>o.id===active);
  if(e.key==='Escape'){clearSuggestions();return;}
  if(!options.length)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    e.preventDefault();index=(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;
    for(const [i,o] of options.entries())o.setAttribute('aria-selected',String(i===index));
    $('venueName').setAttribute('aria-activedescendant',options[index].id);
  }else if(e.key==='Enter'&&index>=0){e.preventDefault();choosePlace(options[index].dataset.placeId);}
});
$('venueName').addEventListener('blur',()=>clearSuggestions());
$('destination').addEventListener('input',()=>{clearSuggestions();invalidateTravel();routeTimer=setTimeout(calculate,650);});
$('destination').addEventListener('change',calculate);
document.querySelectorAll('[name="hours"],[name="setups"]').forEach(n=>n.addEventListener('change',()=>{invalidateTravel();calculate();}));
$('songs').addEventListener('input',()=>{
  $('songs').value=$('songs').value.replace(/\D/g,'').slice(0,2);invalidateTravel();calculate();
});
$('resetBtn').addEventListener('click',()=>{
  if(sending)return;clearSuggestions();invalidateTravel();
  for(const id of ['eventDate','startTime','venueName','destination','notes','fullName','email','phone'])$(id).value='';
  $('songs').value='0';document.querySelector('[name="hours"][value="2"]').checked=true;document.querySelector('[name="setups"][value="1"]').checked=true;
  $('contactPanel').classList.add('hidden');$('venueSearchStatus').textContent='Type at least 3 characters, or enter the venue manually.';
  submission=null;routeCache=null;session=crypto.randomUUID();error('');hint('');calculate();
});
$('bookNowBtn').addEventListener('click',async()=>{
  if(sending)return;hint('');
  if($('contactPanel').classList.contains('hidden')){$('contactPanel').classList.remove('hidden');$('fullName').focus();return;}
  if(!['fullName','email','phone'].every(id=>$(id).value.trim())){error('Please enter your full name, email address, and phone number.');return;}
  if(!$('email').checkValidity()){error('Please enter a valid email address.');return;}
  const payload={...selection()};
  for(const id of ['eventDate','startTime','venueName','destination','notes','fullName','email','phone'])payload[id]=$(id).value.trim();
  payload.eventDetails=payload.notes;
  const signature=JSON.stringify(payload);if(submission?.signature!==signature)submission={signature,id:crypto.randomUUID()};
  if(submission.delivered){hint('This request has already reached Noah. Edit the details to send a different request.');return;}
  payload.submissionId=submission.id;
  sending=true;$('bookNowBtn').disabled=true;$('resetBtn').disabled=true;$('bookNowBtn').textContent='Sending…';error('');
  // Freeze the submitted snapshot so edits cannot disagree with the displayed confirmation.
  const fields=[...document.querySelectorAll('input,textarea')];fields.forEach(n=>n.disabled=true);clearSuggestions();
  try{
    const data=await api('/api/send-quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
    submission.delivered=true;
    if(data.estimate){version++;controller?.abort();result=data.estimate;render(result);}
    hint(data.customerConfirmation===false?'Your request reached Noah, but the confirmation email could not be sent. Please do not resubmit.':'Success — your request reached Noah and a confirmation was sent to your email.');
  }catch(e){error(e.message||'Could not confirm delivery. Please contact Noah before resubmitting.');}
  finally{sending=false;fields.forEach(n=>n.disabled=false);$('bookNowBtn').disabled=false;$('resetBtn').disabled=false;$('bookNowBtn').textContent='Email Me the Quote';}
});
calculate();
