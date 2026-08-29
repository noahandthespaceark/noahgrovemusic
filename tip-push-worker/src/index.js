export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = env.TIP_PUSH_ROOM.idFromName('noah-tip-push-room');
    const room = env.TIP_PUSH_ROOM.get(id);
    return room.fetch(request);
  }
};

export class TipPushRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, service: 'noah-tip-push' });
    }

    if (url.pathname === '/stream') {
      const auth = this.authorize(request);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
      if (request.headers.get('Upgrade') !== 'websocket') {
        return json({ ok: false, error: 'Expected WebSocket upgrade.' }, 426);
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      server.accept();
      this.sockets.add(server);

      server.send(JSON.stringify({
        type: 'hello',
        ok: true,
        connectedAt: new Date().toISOString()
      }));

      server.addEventListener('close', () => this.sockets.delete(server));
      server.addEventListener('error', () => this.sockets.delete(server));
      server.addEventListener('message', event => {
        if (String(event.data || '').toLowerCase() === 'ping') {
          try { server.send(JSON.stringify({ type: 'pong', at: Date.now() })); } catch (_) {}
        }
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/publish' && request.method === 'POST') {
      const auth = this.authorize(request);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

      const body = await request.json().catch(() => ({}));
      const event = body.event || body;
      if (!event?.id) return json({ ok: false, error: 'Missing event.id.' }, 400);

      const message = JSON.stringify({
        type: 'tip_event',
        event,
        publishedAt: new Date().toISOString()
      });

      let sent = 0;
      for (const socket of [...this.sockets]) {
        try {
          socket.send(message);
          sent++;
        } catch (_) {
          this.sockets.delete(socket);
        }
      }

      return json({ ok: true, sent });
    }

    return json({ ok: false, error: 'Not found.' }, 404);
  }

  authorize(request) {
    if (!this.env.TIP_LISTENER_SECRET) return { ok: false, status: 500, error: 'Missing TIP_LISTENER_SECRET.' };
    const url = new URL(request.url);
    const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('secret') || '';
    if (!timingSafeEqual(given, this.env.TIP_LISTENER_SECRET)) return { ok: false, status: 401, error: 'Unauthorized.' };
    return { ok: true };
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function timingSafeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
