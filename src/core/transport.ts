// How the Director Desk and the participant view talk.
//   ChannelTransport: same browser, same machine (BroadcastChannel). No server.
//   RelayTransport:   any two devices, through a tiny WebSocket relay (relay/server.mjs).
// Both carry the same messages: hello, hb (heartbeat), cmd, result, state.

export type Msg = { t: string; [k: string]: unknown };

export interface Transport {
  readonly kind: 'channel' | 'relay';
  post(msg: Msg): void;
  onMessage(fn: (m: Msg) => void): void;
  onStatus(fn: (status: 'connecting' | 'open' | 'closed') => void): void;
}

export class ChannelTransport implements Transport {
  readonly kind = 'channel' as const;
  private ch: BroadcastChannel;
  constructor(room: string) {
    this.ch = new BroadcastChannel(`therapeutic-realms-${room}`);
  }
  post(msg: Msg) {
    this.ch.postMessage(msg);
  }
  onMessage(fn: (m: Msg) => void) {
    this.ch.addEventListener('message', (e: MessageEvent) => fn(e.data as Msg));
  }
  onStatus(fn: (s: 'connecting' | 'open' | 'closed') => void) {
    fn('open');
  }
}

export class RelayTransport implements Transport {
  readonly kind = 'relay' as const;
  private ws: WebSocket | null = null;
  private listeners: Array<(m: Msg) => void> = [];
  private statusFns: Array<(s: 'connecting' | 'open' | 'closed') => void> = [];
  private retry = 500;
  constructor(private url: string, private room: string) {
    this.connect();
  }
  private setStatus(s: 'connecting' | 'open' | 'closed') {
    this.statusFns.forEach((f) => f(s));
  }
  private connect() {
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 500;
      ws.send(JSON.stringify({ t: 'join', room: this.room }));
      this.setStatus('open');
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as Msg;
        this.listeners.forEach((f) => f(m));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      this.setStatus('closed');
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }
  private scheduleReconnect() {
    setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(5000, this.retry * 2);
  }
  post(msg: Msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  onMessage(fn: (m: Msg) => void) {
    this.listeners.push(fn);
  }
  onStatus(fn: (s: 'connecting' | 'open' | 'closed') => void) {
    this.statusFns.push(fn);
  }
}

export function makeTransport(room: string, relayUrl: string | null): Transport {
  return relayUrl ? new RelayTransport(relayUrl, room) : new ChannelTransport(room);
}

/** Short, readable session code (no 0/O/1/I). */
export function newSessionCode(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const r = crypto.getRandomValues(new Uint32Array(6));
  for (const n of r) s += a[n % a.length];
  return s;
}
