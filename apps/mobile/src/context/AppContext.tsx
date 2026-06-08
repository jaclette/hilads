import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { GuestIdentity, City, Message, User, OnlineUser, EventChatPreview } from '@/types';
import { authLogout } from '@/api/auth';
import { clearToken } from '@/services/session';
import { unregisterPushToken } from '@/services/push';
import { socket } from '@/lib/socket';
import { track, resetAnalytics } from '@/services/analytics';
import { EMPTY_BLOCKED_SET, type BlockedSet } from '@/lib/blockFilter';

// Pre-loaded data returned by POST /channels/{id}/bootstrap.
// Consumed once by chat (messages) tab on first render.
// Events and topics are fetched separately via GET /channels/{id}/now.
export interface BootstrapData {
  channelId:            string;
  messages:             Message[];
  hasMore:              boolean;
  hasUnreadDMs:         boolean | null;
  unreadNotifications:  number | null;
}

// Matches web geoState values exactly:
// 'pending'   → permission dialog showing ("› requesting location...")
// 'resolving' → coords acquired, calling /location/resolve ("› locating...")
// 'resolved'  → city known, show city card
// 'denied'    → user denied permission
// 'error'     → GPS unavailable / API failure
export type GeoState = 'pending' | 'resolving' | 'resolved' | 'denied' | 'error';

interface AppState {
  booting:              boolean;
  bootError:            string | null;
  identity:             GuestIdentity | null;
  sessionId:            string | null;   // UUID v4, per-session, not persisted
  account:              User | null;
  city:                 City | null;
  wsConnected:          boolean;
  unreadDMs:            number;
  unreadNotifications:  number;
  eventChatPreviews:    Record<string, EventChatPreview>; // per event-id unread state
  activeEventId:        string | null;   // event/[id] screen currently mounted
  activeDmId:           string | null;   // dm/[id] screen currently mounted
  geoState:             GeoState;
  detectedCity:         City | null;     // geo-resolved city, shown on landing screen
  joined:               boolean;         // true once user has joined a city (or auto-rejoined)
  onlineUsers:          OnlineUser[];    // live presence list for the current city
  bootstrapData:        BootstrapData | null; // pre-loaded from /bootstrap, consumed once by tabs
  showOnboarding:       boolean;         // first-time guest carousel visibility (auto-show + "?" reopen)
  showAccountWelcome:   boolean;         // one-time congrats screen shown right after signup
  // Monotonic counter bumped when a chat reminder card auto-dismisses; the tab
  // bar watches it to pulse the NOW icon once. Throttled so a burst = one pulse.
  nowPulse:             number;
  // Outgoing block set (users / guests this account has blocked). Hydrated once
  // on boot via fetchMyBlocks() and patched optimistically on each block /
  // unblock action so the UI removes content instantly without a refetch.
  // The reverse direction (blocked-by-others) is server-side only.
  blockedSet:           BlockedSet;
}

interface AppActions {
  setIdentity:             (identity: GuestIdentity) => void;
  setSessionId:            (id: string) => void;
  setAccount:              (account: User | null) => void;
  setCity:                 (city: City) => void;
  setBooting:              (booting: boolean) => void;
  setBootError:            (error: string | null) => void;
  setWsConnected:          (connected: boolean) => void;
  setUnreadDMs:            (count: number | ((prev: number) => number)) => void;
  setUnreadNotifications:  (count: number) => void;
  setEventChatPreview:     (eventId: string, preview: EventChatPreview) => void;
  removeEventChatPreview:  (eventId: string) => void;
  clearEventChatCounts:    () => void;
  setActiveEventId:        (id: string | null) => void;
  setActiveDmId:           (id: string | null) => void;
  setGeoState:             (state: GeoState) => void;
  setDetectedCity:         (city: City | null) => void;
  setJoined:               (joined: boolean) => void;
  setOnlineUsers:          (users: OnlineUser[]) => void;
  setBootstrapData:        (data: BootstrapData | null) => void;
  setShowOnboarding:       (show: boolean) => void;
  setShowAccountWelcome:   (show: boolean) => void;
  /** Signal the NOW tab to pulse once (e.g. a chat reminder faded). Throttled. */
  pulseNow:                () => void;
  setBlockedSet:           (set: BlockedSet) => void;
  /** Optimistic add - call right before submitBlock() so UI updates instantly. */
  addBlocked:              (target: { userId?: string | null; guestId?: string | null }) => void;
  /** Optimistic remove - call right before unblock so the row disappears instantly. */
  removeBlocked:           (target: { userId?: string | null; guestId?: string | null }) => void;
  logout:                  () => Promise<void>;
}

const AppContext = createContext<(AppState & AppActions) | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [booting,      setBooting]      = useState(true);
  const [bootError,    setBootError]    = useState<string | null>(null);
  const [identity,     setIdentityRaw]  = useState<GuestIdentity | null>(null);
  const [sessionId,    setSessionId]    = useState<string | null>(null);
  const [account,      setAccount]      = useState<User | null>(null);
  const [city,         setCity]         = useState<City | null>(null);
  const [wsConnected,             setWsConnected]             = useState(false);
  const [unreadDMs,               setUnreadDMs]               = useState(0);
  const [unreadNotifications,     setUnreadNotifications]     = useState(0);
  const [eventChatPreviews,       setEventChatPreviewsRaw]    = useState<Record<string, EventChatPreview>>({});
  const [activeEventId,           setActiveEventId]           = useState<string | null>(null);
  const [activeDmId,              setActiveDmId]              = useState<string | null>(null);
  const [geoState,                setGeoState]                = useState<GeoState>('pending');
  const [detectedCity, setDetectedCity] = useState<City | null>(null);
  const [joined,         setJoined]         = useState(false);
  const [onlineUsers,    setOnlineUsers]    = useState<OnlineUser[]>([]);
  const [bootstrapData,  setBootstrapData]  = useState<BootstrapData | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showAccountWelcome, setShowAccountWelcome] = useState(false);
  const [nowPulse,       setNowPulse]       = useState(0);
  const lastPulseAtRef   = useRef(0);
  const [blockedSet,     setBlockedSetRaw]  = useState<BlockedSet>(EMPTY_BLOCKED_SET);

  // Bump nowPulse, but at most once per 1.5s so a burst of card dismissals
  // (e.g. several event pills fading together) triggers a single tab pulse.
  const pulseNow = useCallback(() => {
    const now = Date.now();
    if (now - lastPulseAtRef.current < 1500) return;
    lastPulseAtRef.current = now;
    setNowPulse(n => n + 1);
  }, []);

  const setBlockedSet = useCallback((next: BlockedSet) => setBlockedSetRaw(next), []);

  const addBlocked = useCallback((target: { userId?: string | null; guestId?: string | null }) => {
    setBlockedSetRaw(prev => {
      const userIds  = new Set(prev.userIds);
      const guestIds = new Set(prev.guestIds);
      if (target.userId)  userIds.add(target.userId);
      if (target.guestId) guestIds.add(target.guestId);
      return { userIds, guestIds };
    });
  }, []);

  const removeBlocked = useCallback((target: { userId?: string | null; guestId?: string | null }) => {
    setBlockedSetRaw(prev => {
      const userIds  = new Set(prev.userIds);
      const guestIds = new Set(prev.guestIds);
      if (target.userId)  userIds.delete(target.userId);
      if (target.guestId) guestIds.delete(target.guestId);
      return { userIds, guestIds };
    });
  }, []);

  const setIdentity = useCallback((id: GuestIdentity) => setIdentityRaw(id), []);

  const setAccountWithLog = useCallback((u: User | null) => {
    console.log('[app-ctx] setAccount called:', u ? `id=${u.id} name=${u.display_name}` : 'null');
    setAccount(u);
  }, []);

  const setEventChatPreview = useCallback((eventId: string, preview: EventChatPreview) => {
    setEventChatPreviewsRaw(prev => ({ ...prev, [eventId]: preview }));
  }, []);

  const removeEventChatPreview = useCallback((eventId: string) => {
    setEventChatPreviewsRaw(prev => {
      if (!prev[eventId]) return prev;
      const next = { ...prev };
      delete next[eventId];
      return next;
    });
  }, []);

  const clearEventChatCounts = useCallback(() => {
    setEventChatPreviewsRaw(prev => {
      const next: Record<string, EventChatPreview> = {};
      for (const [id, p] of Object.entries(prev)) next[id] = { ...p, count: 0 };
      return next;
    });
  }, []);

  const logout = useCallback(async () => {
    track('auth_logout');
    resetAnalytics();
    // Tear down the WS first so its reconnect timer doesn't replay
    // joinRoom/joinUser against a session the server is about to reject -
    // that produces a 1006 reconnect loop after sign-out. resetPending()
    // also drops any cached pendingCity / pendingUser so a future reconnect
    // doesn't silently re-join the signed-out account's rooms.
    socket.disconnect();
    socket.resetPending();
    await unregisterPushToken().catch(() => {}); // remove device token before clearing auth
    await authLogout();
    await clearToken();
    setAccount(null);
    setUnreadDMs(0);
    setUnreadNotifications(0);
    setEventChatPreviewsRaw({});
    setBlockedSetRaw(EMPTY_BLOCKED_SET);
    // Reconnect as guest so sign-in.tsx's later joinCity isn't silently
    // dropped against a closed socket.
    socket.connect();
  }, []);

  return (
    <AppContext.Provider
      value={{
        booting, bootError, identity, sessionId, account, city, wsConnected,
        unreadDMs, unreadNotifications, eventChatPreviews, activeEventId, activeDmId,
        geoState, detectedCity, joined, onlineUsers, bootstrapData, showOnboarding, showAccountWelcome, nowPulse, blockedSet,
        setBooting, setBootError,
        setIdentity,
        setSessionId:            useCallback((id: string) => setSessionId(id), []),
        setAccount:              setAccountWithLog,
        setCity:                 useCallback((c: City) => setCity(c), []),
        setWsConnected,
        setUnreadDMs,
        setUnreadNotifications,
        setEventChatPreview,
        removeEventChatPreview,
        clearEventChatCounts,
        setActiveEventId:        useCallback((id: string | null) => setActiveEventId(id), []),
        setActiveDmId:           useCallback((id: string | null) => setActiveDmId(id), []),
        setGeoState:             useCallback((s: GeoState) => setGeoState(s), []),
        setDetectedCity:         useCallback((c: City | null) => setDetectedCity(c), []),
        setJoined:               useCallback((j: boolean) => setJoined(j), []),
        setOnlineUsers:          useCallback((u: OnlineUser[]) => setOnlineUsers(u), []),
        setBootstrapData:        useCallback((d: BootstrapData | null) => setBootstrapData(d), []),
        setShowOnboarding:       useCallback((s: boolean) => setShowOnboarding(s), []),
        setShowAccountWelcome:   useCallback((s: boolean) => setShowAccountWelcome(s), []),
        pulseNow,
        setBlockedSet,
        addBlocked,
        removeBlocked,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
