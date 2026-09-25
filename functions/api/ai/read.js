const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const clean = (value) => String(value == null ? '' : value).trim();

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const action = clean(url.searchParams.get('action') || 'getContactOptions');
  if (action === 'getContactOptions') return json({ schema_version: '1', action, read_only: true, data: { contact_options: [{ type: 'quote', path: '/support.html' }, { type: 'public_contact', path: '/follow.html' }] } });
  if (action === 'getPublicContent') return json({ schema_version: '1', action, read_only: true, data: { site: 'NoahGroveMusic', pages: ['/', '/about-noah-grove.html', '/listen.html', '/support.html', '/spaceark.html'] } });
  if (action === 'getPublicEvents') {
    const endpoint = new URL('/api/calendar', url.origin);
    const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return json({ ok: false, error: 'Public calendar unavailable.', status: response.status }, 502);
    return json({ schema_version: '1', action, read_only: true, data: { events: Array.isArray(data.events) ? data.events : [] } });
  }
  return json({ ok: false, error: 'Unsupported AI read action.' }, 400);
}