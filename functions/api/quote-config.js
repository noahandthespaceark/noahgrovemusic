import {json} from './_quote.js';
export function onRequestGet({env}){
  return json({ok:true,version:'quote-2',venueSearchConfigured:!!env.GOOGLE_MAPS_API_KEY,
    travelConfigured:!!(env.GOOGLE_MAPS_API_KEY&&env.QUOTE_TRAVEL_ORIGIN),
    emailConfigured:!!(env.RESEND_API_KEY&&env.QUOTE_TO_EMAIL&&env.QUOTE_FROM_EMAIL)});
}
