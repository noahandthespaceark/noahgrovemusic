import { json } from './_merch-shared.js';
export async function onRequestGet({ env }) {
  return json({
    ok: true,
    paypalClientId: env.PAYPAL_CLIENT_ID || '',
    squareApplicationId: env.SQUARE_APPLICATION_ID || '',
    squareLocationId: env.SQUARE_LOCATION_ID || '',
    squareEnvironment: env.SQUARE_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production'
  });
}
