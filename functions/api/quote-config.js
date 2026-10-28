import {json} from './_quote.js';
import {quoteMailConfig} from './_quote-mail.js';
import {leadConfig} from './_quote-leads.js';
export function onRequestGet({env}){
  return json({ok:true,version:'quote-2',venueSearchConfigured:!!env.GOOGLE_MAPS_API_KEY,
    travelConfigured:!!(env.GOOGLE_MAPS_API_KEY&&env.QUOTE_TRAVEL_ORIGIN),
    emailConfigured:quoteMailConfig(env).ready,emailConfiguration:quoteMailConfig(env).status,
    leadConfiguration:leadConfig(env).status});
}
