export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runReminder(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/health') return new Response('Not found', { status:404 });
    return Response.json({ ok:true, worker:'noahgrove-outreach-reminder' });
  }
};

async function runReminder(env) {
  if (!env.OUTREACH_REMINDER_TOKEN) throw new Error('Missing OUTREACH_REMINDER_TOKEN worker secret.');
  const endpoint = env.OUTREACH_REMINDER_URL || 'https://noahgrove.com/api/outreach-reminders';
  const response = await fetch(endpoint, {
    method:'POST',
    headers:{ 'x-outreach-reminder-token':env.OUTREACH_REMINDER_TOKEN, 'Content-Type':'application/json' }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Reminder endpoint failed (${response.status}): ${body}`);
  console.log('Outreach reminder check:', body);
}
