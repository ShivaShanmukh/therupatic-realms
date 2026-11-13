// Minimal relay for The Living Scene.
// Clients send {t:'join', room}. Every later message is forwarded, unchanged,
// to the other clients in the same room. No storage, no logging of content.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8787);
const MAX_BYTES = 256 * 1024;
const MAX_PER_ROOM = 4;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

const rooms = new Map(); // room -> Set<ws>

const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`living-scene relay ok · rooms ${rooms.size}\n`);
});

const wss = new WebSocketServer({
  server: http,
  maxPayload: MAX_BYTES,
  verifyClient: ({ origin }) => ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin),
});

wss.on('connection', (ws) => {
  let room = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg?.t === 'join') {
      const code = String(msg.room || '').slice(0, 64);
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(code)) return ws.close(1008, 'bad room');
      const set = rooms.get(code) ?? new Set();
      if (set.size >= MAX_PER_ROOM) return ws.close(1008, 'room full');
      set.add(ws);
      rooms.set(code, set);
      room = code;
      return;
    }
    if (!room) return;
    for (const peer of rooms.get(room) ?? []) {
      if (peer !== ws && peer.readyState === 1) peer.send(String(data));
    }
  });
  ws.on('close', () => {
    if (!room) return;
    const set = rooms.get(room);
    set?.delete(ws);
    if (set && set.size === 0) rooms.delete(room);
  });
});

// Drop dead sockets so a vanished Desk is noticed (the participant also uses heartbeats).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) ws.terminate();
    else {
      ws.isAlive = false;
      ws.ping();
    }
  }
}, 15000);

http.listen(PORT, () => console.log(`relay listening on :${PORT}`));
