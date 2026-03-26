import { WS_URL } from '@/constants';
import type { WsMessage } from '@/types';

type Handler = (data: WsMessage) => void;

// ── Hilads WebSocket client ───────────────────────────────────────────────────
// Single persistent connection. Reconnects automatically with backoff.
// Handlers are keyed by WS message type; use '*' to receive everything.

class HiladsSocket {
  private ws:            WebSocket | null = null;
  private handlers:      Map<string, Set<Handler>> = new Map();
  private shouldConnect: boolean = false;
  private reconnectMs:   number  = 2000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

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

  /** Subscribe to a message type. Returns an unsubscribe function. */
  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  /** Send a JSON message. Silently drops if not connected. */
  send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /** Join a city or event channel. */
  joinChannel(channelId: string, guestId: string, nickname: string): void {
    this.send({ type: 'join', channelId, guestId, nickname });
  }

  /** Leave a channel. */
  leaveChannel(channelId: string, guestId: string): void {
    this.send({ type: 'leave', channelId, guestId });
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private _connect(): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('[WS] connected');
        this.reconnectMs = 2000; // reset backoff on success
        this._emit({ type: 'connected' });
      };

      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data as string) as WsMessage;
          this._emit(data);
          // Also emit to wildcard listeners
          if (data.type !== '*') {
            const wildcardData = { ...data, type: '*' };
            this.handlers.get('*')?.forEach(h => h(wildcardData));
          }
        } catch (err) {
          console.warn('[WS] failed to parse message:', err);
        }
      };

      this.ws.onerror = (e) => {
        console.warn('[WS] error:', e);
      };

      this.ws.onclose = () => {
        console.log('[WS] disconnected');
        this._emit({ type: 'disconnected' });
        if (this.shouldConnect) {
          this._scheduleReconnect();
        }
      };
    } catch (err) {
      console.error('[WS] failed to create socket:', err);
      if (this.shouldConnect) {
        this._scheduleReconnect();
      }
    }
  }

  private _scheduleReconnect(): void {
    this._clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      // Exponential backoff capped at 30s
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

  private _emit(data: WsMessage): void {
    this.handlers.get(data.type)?.forEach(h => h(data));
  }
}

// Singleton — one connection for the entire app
export const socket = new HiladsSocket();
