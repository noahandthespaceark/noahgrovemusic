// Shared by the calculator and server; customer-supplied totals are never authoritative.
export const PRICING = Object.freeze({
  baseByHours: Object.freeze({1:400,2:600,3:800,4:1000,5:1250}),
  perSong:25,freeSongs:1,extraSetup:100,travelPerMile:2,roundTrip:false
});
export function coreCosts({hours=2,songCount=0,setups=1}={}) {
  hours=Number(hours);songCount=Number(songCount);setups=Number(setups);
  if(!Number.isInteger(hours)||!PRICING.baseByHours[hours]||
    !Number.isInteger(songCount)||songCount<0||songCount>99||
    !Number.isInteger(setups)||setups<1||setups>3)throw new Error('Choose valid hours, songs, and setup counts.');
  const performance=PRICING.baseByHours[hours],songs=Math.max(0,songCount-PRICING.freeSongs)*PRICING.perSong,setupsCost=(setups-1)*PRICING.extraSetup;
  return {performance,songs,setupsCost,subtotal:performance+songs+setupsCost};
}
