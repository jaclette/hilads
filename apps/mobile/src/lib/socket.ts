import { WS_URL } from '@/constants';

type Handler = (data: Record<string, unknown>) => void;

// ── Hilads WebSocket client ───────────────────────────────────────────────────
// The WS server uses { event: '...' } for both directions (not { type: '...' }).
// Dispatch is keyed on `data.event`. Use '*' to receive all messages.

class HiladsSocket {
  private ws:             WebSocket | null = null;
  private handlers:       Map<string, Set<Handler>> = new Map();
  private shouldConnect:  boolean = false;
  private reconnectMs:    number  = 2000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Connection ──────────────────────────────────────────────────────────────

  connect(): void {
    this.shouldConnect = true;
    this._connect();
  }

  disconnect(): void {
    this.shouldConnect = false;
    this._clearReconnect();
    this.ws?.close();
    this.ws = null;
  }

  /** Force an immediate reconnect attempt — use when app returns to foreground. */
  reconnectNow(): void {
    if (!this.shouldConnect) return;
    this._clearReconnect();
    this._connect();
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Subscriptions ───────────────────────────────────────────────────────────

  /** Subscribe to a WS event name. Returns an unsubscribe function. */
  on(event: string, handler: Handler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  /** Send a raw message. Silently drops if disconnected. */
  send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // ── Presence helpers ────────────────────────────────────────────────────────

  joinCity(cityId: string, sessionId: string, nickname: string, userId?: string): void {
    this.send({ event: 'joinRoom', cityId, sessionId, nickname, ...(userId ? { userId } : {}) });
  }

  leaveCity(cityId: string, sessionId: string): void {
    this.send({ event: 'leaveRoom', cityId, sessionId });
  }

  joinEvent(eventId: string, sessionId: string): void {
    this.send({ event: 'joinEvent', eventId, sessionId });
  }

  leaveEvent(eventId: string, sessionId: string): void {
    this.send({ event: 'leaveEvent', eventId, sessionId });
  }

  heartbeat(cityId: string, sessionId: string): void {
    this.send({ event: 'heartbeat', cityId, sessionId });
  }

  joinDm(conversationId: string, userId: string): void {
    this.send({ event: 'joinDm', conversationId, userId });
  }

  leaveDm(conversationId: string): void {
    this.send({ event: 'leaveDm', conversationId });
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private _connect(): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('[WS] connected');
        this.reconnectMs = 2000;
        this._dispatch('connected', {});
      };

      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data as string) as Record<string, unknown>;
          // Server uses `event` field; fall back to `type` for compat
          const eventName = (data.event ?? data.type ?? 'unknown') as string;
          this._dispatch(eventName, data);
          this._dispatch('*', data);
        } catch (err) {
          console.warn('[WS] parse error:', err);
        }
      };

      this.ws.onerror = () => {/* handled in onclose */};

      this.ws.onclose = () => {
        console.log('[WS] disconnected');
        this._dispatch('disconnected', {});
        if (this.shouldConnect) this._scheduleReconnect();
      };
    } catch (err) {
      console.error('[WS] create failed:', err);
      if (this.shouldConnect) this._scheduleReconnect();
    }
  }

  private _scheduleReconnect(): void {
    this._clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectMs = Math.min(this.reconnectMs * 1.5, 30_000);
      this._connect();
    }, this.reconnectMs);
  }

  private _clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private _dispatch(event: string, data: Record<string, unknown>): void {
    this.handlers.get(event)?.forEach(h => h(data));
  }
}

export const socket = new HiladsSocket();
