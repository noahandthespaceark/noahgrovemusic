import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../functions/calendar.js', import.meta.url), 'utf8');
const { onRequestGet } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('new gigs are included, expired events removed, and dates sorted', async () => {
  const originalFetch = globalThis.fetch;
  let events = [
    { uid: 'later', title: 'Later gig', start: '2099-10-01T18:00:00Z' },
    { uid: 'expired', start: '2000-01-01T18:00:00Z' },
    { uid: 'invalid', start: 'invalid' },
    { uid: 'earlier', title: 'New gig', start: '2099-09-01T18:00:00Z' },
  ];
  globalThis.fetch = async url => {
    assert.equal(url, 'https://timebrain.pages.dev/api/public/gigs');
    return Response.json({ ok: true, source: 'timebrain', events });
  };
  try {
    const response = await onRequestGet({ env: {} });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await response.json()).events.map(e => e.uid), ['earlier', 'later']);
    events.push({ uid: 'just-added', start: '2099-09-02T18:00:00Z' });
    assert.deepEqual((await (await onRequestGet({ env: {} })).json()).events.map(e => e.uid), ['earlier', 'just-added', 'later']);
  } finally { globalThis.fetch = originalFetch; }
});

test('an old or failed source cannot silently look like a successful empty calendar', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const body of [{ events: [] }, { source: 'timebrain', ok: false, events: [] }]) {
      globalThis.fetch = async () => Response.json(body);
      const response = await onRequestGet({ env: {} });
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    assert.equal((await onRequestGet({ env: {} })).status, 502);
  } finally { globalThis.fetch = originalFetch; }
});
