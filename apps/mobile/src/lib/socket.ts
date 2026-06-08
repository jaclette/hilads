import { WS_URL } from '@/constants';

type Handler = (data: Record<string, unknown>) => void;

// ── Hilads WebSocket client ───────────────────────────────────────────────────
// The WS server uses { event: '...' } for both directions (not { type: '...' }).
// Dispatch is keyed on `data.event`. Use '*' to receive all messages.

// During a Render cold start (~30-50s) the server hasn't bound to the port
// yet, so every attempt closes with 1006 in <100ms. Rather than letting the
// exponential backoff climb to 15-30s (making the user wait long after the
// server is actually up), we retry at a fixed 3s for the first
// RAPID_RETRY_MAX attempts, then switch to normal backoff.
const RAPID_RETRY_MAX = 15;   // 15 × 3s = 45s fast window
const RAPID_RETRY_MS  = 3000;

// Pending room state replayed automatically on every (re)connect - mirrors
// `pendingJoin` etc. in apps/web/src/socket.js. The socket owns its own
// replay so consumers don't have to wire up an `on('connected', joinX)`
// callback (which leaks if not unsubscribed and accumulates joins on
// every reconnect).
type PendingCity  = { cityId: string; sessionId: string; nickname: string; userId?: string; guestId?: string; mode?: string | null };
type PendingEvent = { eventId: string; sessionId: string; nickname?: string };
type PendingTopic = { topicId: string; sessionId: string };
type PendingChallenge = { challengeId: string; sessionId: string };
type PendingChallengeThread = { threadChannelId: string; sessionId: string };
type PendingDm    = { conversationId: string; userId: string };
type PendingUser  = { userId: string };

class HiladsSocket {
  private ws:             WebSocket | null = null;
  private handlers:       Map<string, Set<Handler>> = new Map();
  private shouldConnect:  boolean = false;
  private reconnectMs:    number  = 2000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rapidRetries:   number  = 0;

  private pendingCity:  PendingCity  | null = null;
  private pendingEvent: PendingEvent | null = null;
  private pendingTopic:     PendingTopic     | null = null;
  private pendingChallenge: PendingChallenge | null = null;
  private pendingChallengeThread: PendingChallengeThread | null = null;
  private pendingDm:    PendingDm    | null = null;
  private pendingUser:  PendingUser  | null = null;

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

  /** Force an immediate reconnect attempt - use when app returns to foreground. */
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
  //
  // IMPORTANT: WS server uses integer cityId as Map keys.
  // The API returns channelId as a string (e.g. "1") but the server expects
  // the numeric form (1). Sending "1" (string) joins a DIFFERENT Map room
  // than 1 (integer), so web and native users never see each other.
  // All city-scoped WS messages must coerce to integer before sending.

  /** Coerce string cityId to integer to match server's Map key type. */
  private _numericCityId(cityId: string): number {
    const n = parseInt(cityId, 10);
    return isNaN(n) ? (cityId as unknown as number) : n;
  }

  joinCity(cityId: string, sessionId: string, nickname: string, userId?: string, guestId?: string, mode?: string | null): void {
    // If the socket was already tracking a different city, leave it first so
    // we never accumulate city-room memberships on the server. (Server has its
    // own defensive auto-leave, but this saves a round-trip and keeps logs
    // clean.)
    if (this.pendingCity && this.pendingCity.cityId !== cityId) {
      this.send({ event: 'leaveRoom', cityId: this._numericCityId(this.pendingCity.cityId), sessionId: this.pendingCity.sessionId });
    }
    this.pendingCity = { cityId, sessionId, nickname, userId, guestId, mode: mode ?? null };
    this.send({ event: 'joinRoom', cityId: this._numericCityId(cityId), sessionId, nickname, ...(userId ? { userId } : {}), ...(guestId ? { guestId } : {}), ...(mode ? { mode } : {}) });
  }

  leaveCity(cityId: string, sessionId: string): void {
    if (this.pendingCity?.cityId === cityId) this.pendingCity = null;
    this.send({ event: 'leaveRoom', cityId: this._numericCityId(cityId), sessionId });
  }

  joinEvent(eventId: string, sessionId: string, nickname?: string): void {
    if (this.pendingEvent && this.pendingEvent.eventId !== eventId) {
      this.send({ event: 'leaveEvent', eventId: this.pendingEvent.eventId, sessionId: this.pendingEvent.sessionId });
    }
    this.pendingEvent = { eventId, sessionId, nickname };
    this.send({ event: 'joinEvent', eventId, sessionId, ...(nickname ? { nickname } : {}) });
  }

  leaveEvent(eventId: string, sessionId: string): void {
    if (this.pendingEvent?.eventId === eventId) this.pendingEvent = null;
    this.send({ event: 'leaveEvent', eventId, sessionId });
  }

  heartbeat(cityId: string, sessionId: string): void {
    this.send({ event: 'heartbeat', cityId: this._numericCityId(cityId), sessionId });
  }

  typingStart(cityId: string, sessionId: string, nickname: string): void {
    this.send({ event: 'typingStart', cityId: this._numericCityId(cityId), sessionId, nickname });
  }

  typingStop(cityId: string, sessionId: string): void {
    this.send({ event: 'typingStop', cityId: this._numericCityId(cityId), sessionId });
  }

  // Mirrors web socket.js joinConversation() - event name must match server exactly.
  joinTopic(topicId: string, sessionId: string): void {
    if (this.pendingTopic && this.pendingTopic.topicId !== topicId) {
      this.send({ event: 'leaveTopic', topicId: this.pendingTopic.topicId, sessionId: this.pendingTopic.sessionId });
    }
    this.pendingTopic = { topicId, sessionId };
    this.send({ event: 'joinTopic', topicId, sessionId });
  }

  leaveTopic(topicId: string, sessionId: string): void {
    if (this.pendingTopic?.topicId === topicId) this.pendingTopic = null;
    this.send({ event: 'leaveTopic', topicId, sessionId });
  }

  // Same pattern as joinTopic - pendingChallenge replays the room after a
  // WS reconnect (single active subscription at a time per socket).
  joinChallenge(challengeId: string, sessionId: string): void {
    if (this.pendingChallenge && this.pendingChallenge.challengeId !== challengeId) {
      this.send({ event: 'leaveChallenge', challengeId: this.pendingChallenge.challengeId, sessionId: this.pendingChallenge.sessionId });
    }
    this.pendingChallenge = { challengeId, sessionId };
    this.send({ event: 'joinChallenge', challengeId, sessionId });
  }

  leaveChallenge(challengeId: string, sessionId: string): void {
    if (this.pendingChallenge?.challengeId === challengeId) this.pendingChallenge = null;
    this.send({ event: 'leaveChallenge', challengeId, sessionId });
  }

  // Per-acceptance 1:1 thread (channels.type='challenge_thread'). Same replay
  // pattern as joinChallenge - single active subscription per socket.
  joinChallengeThread(threadChannelId: string, sessionId: string): void {
    if (this.pendingChallengeThread && this.pendingChallengeThread.threadChannelId !== threadChannelId) {
      this.send({ event: 'leaveChallengeThread', threadChannelId: this.pendingChallengeThread.threadChannelId, sessionId: this.pendingChallengeThread.sessionId });
    }
    this.pendingChallengeThread = { threadChannelId, sessionId };
    this.send({ event: 'joinChallengeThread', threadChannelId, sessionId });
  }

  leaveChallengeThread(threadChannelId: string, sessionId: string): void {
    if (this.pendingChallengeThread?.threadChannelId === threadChannelId) this.pendingChallengeThread = null;
    this.send({ event: 'leaveChallengeThread', threadChannelId, sessionId });
  }

  /**
   * Broadcast a reaction animation to everyone in the same city channel.
   * type: 'heart' | 'like' | 'laugh' | 'wow' | 'fire'
   * Purely visual - does not affect stored reaction counts.
   */
  sendReaction(type: string, messageId: string, cityId: string, userId?: string | null): void {
    this.send({
      event:     'reaction',
      type,
      messageId,
      cityId:    this._numericCityId(cityId),
      userId:    userId ?? null,
      timestamp: Date.now(),
    });
  }

  joinDm(conversationId: string, userId: string): void {
    if (this.pendingDm && this.pendingDm.conversationId !== conversationId) {
      this.send({ event: 'leaveConversation', conversationId: this.pendingDm.conversationId, userId: this.pendingDm.userId });
    }
    this.pendingDm = { conversationId, userId };
    this.send({ event: 'joinConversation', conversationId, userId });
  }

  leaveDm(conversationId: string): void {
    if (this.pendingDm?.conversationId === conversationId) this.pendingDm = null;
    this.send({ event: 'leaveConversation', conversationId });
  }

  /**
   * Subscribe this socket to the registered user's personal channel. The
   * server pushes per-user events here (friendRequestReceived/Accepted/
   * Declined/Cancelled, future profile-view bursts, etc). Safe to call on
   * every reconnect - the server tracks one entry per (userId, ws).
   */
  joinUser(userId: string): void {
    if (!userId) return;
    this.pendingUser = { userId };
    this.send({ event: 'joinUser', userId });
  }

  /**
   * Drop all replay state - call from logout so a future reconnect doesn't
   * silently re-join rooms tied to the previous identity.
   */
  resetPending(): void {
    this.pendingCity            = null;
    this.pendingEvent           = null;
    this.pendingTopic           = null;
    this.pendingChallenge       = null;
    this.pendingChallengeThread = null;
    this.pendingDm              = null;
    this.pendingUser            = null;
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private _connect(): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        console.log('[WS] connected');
        this.reconnectMs = 2000;
        this.rapidRetries = 0;
        // Replay room memberships so the server restores them after reconnect.
        // Mirrors web socket.js onopen replay block. Consumers no longer need
        // to wire `socket.on('connected', () => socket.joinX(...))` themselves
        // - that pattern leaked because handlers were never unsubscribed and
        // accumulated joinX calls on every reconnect.
        if (this.pendingCity) {
          const c = this.pendingCity;
          this.send({ event: 'joinRoom', cityId: this._numericCityId(c.cityId), sessionId: c.sessionId, nickname: c.nickname, ...(c.userId ? { userId: c.userId } : {}), ...(c.guestId ? { guestId: c.guestId } : {}), ...(c.mode ? { mode: c.mode } : {}) });
        }
        if (this.pendingEvent) {
          const e = this.pendingEvent;
          this.send({ event: 'joinEvent', eventId: e.eventId, sessionId: e.sessionId, ...(e.nickname ? { nickname: e.nickname } : {}) });
        }
        if (this.pendingTopic)           this.send({ event: 'joinTopic',           ...this.pendingTopic });
        if (this.pendingChallenge)       this.send({ event: 'joinChallenge',       ...this.pendingChallenge });
        if (this.pendingChallengeThread) this.send({ event: 'joinChallengeThread', ...this.pendingChallengeThread });
        if (this.pendingDm)              this.send({ event: 'joinConversation',    ...this.pendingDm });
        if (this.pendingUser)  this.send({ event: 'joinUser',         ...this.pendingUser });
        this._dispatch('connected', {});
      };

      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data as string) as Record<string, unknown>;
          // Server uses `event` field; fall back to `type` for compat
          const eventName = (data.event ?? data.type ?? 'unknown') as string;
          // Log all events in dev so we can verify event names (remove in prod if noisy)
          if (__DEV__) console.log(`[WS] ← ${eventName}`, JSON.stringify(data).slice(0, 120));
          this._dispatch(eventName, data);
          this._dispatch('*', data);
        } catch (err) {
          console.warn('[WS] parse error:', err);
        }
      };

      this.ws.onerror = () => {/* handled in onclose */};

      this.ws.onclose = (e) => {
        // Log close code so origin-rejection (1008) is visible in native logs
        console.log(`[WS] disconnected - code: ${e.code}, reason: "${e.reason ?? ''}"`);
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
    let delay: number;
    if (this.rapidRetries < RAPID_RETRY_MAX) {
      // Fast retry: server may be cold-starting (Render free tier).
      this.rapidRetries++;
      delay = RAPID_RETRY_MS;
    } else {
      // Server appears persistently unavailable - back off normally.
      delay = this.reconnectMs;
      this.reconnectMs = Math.min(this.reconnectMs * 1.5, 30_000);
    }
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
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
