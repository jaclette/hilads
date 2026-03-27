import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { GuestIdentity, City, User, OnlineUser } from '@/types';
import { authLogout } from '@/api/auth';
import { clearToken } from '@/services/session';

// Matches web geoState values exactly:
// 'pending'   → permission dialog showing ("› requesting location...")
// 'resolving' → coords acquired, calling /location/resolve ("› locating...")
// 'resolved'  → city known, show city card
// 'denied'    → user denied permission
// 'error'     → GPS unavailable / API failure
export type GeoState = 'pending' | 'resolving' | 'resolved' | 'denied' | 'error';

interface AppState {
  booting:      boolean;
  bootError:    string | null;
  identity:     GuestIdentity | null;
  sessionId:    string | null;   // UUID v4, per-session, not persisted
  account:      User | null;
  city:         City | null;
  wsConnected:  boolean;
  unreadDMs:    number;
  geoState:     GeoState;
  detectedCity: City | null;     // geo-resolved city, shown on landing screen
  joined:       boolean;         // true once user has joined a city (or auto-rejoined)
  onlineUsers:  OnlineUser[];    // live presence list for the current city
}

interface AppActions {
  setIdentity:     (identity: GuestIdentity) => void;
  setSessionId:    (id: string) => void;
  setAccount:      (account: User | null) => void;
  setCity:         (city: City) => void;
  setBooting:      (booting: boolean) => void;
  setBootError:    (error: string | null) => void;
  setWsConnected:  (connected: boolean) => void;
  setUnreadDMs:    (count: number) => void;
  setGeoState:     (state: GeoState) => void;
  setDetectedCity: (city: City | null) => void;
  setJoined:       (joined: boolean) => void;
  setOnlineUsers:  (users: OnlineUser[]) => void;
  logout:          () => Promise<void>;
}

const AppContext = createContext<(AppState & AppActions) | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [booting,      setBooting]      = useState(true);
  const [bootError,    setBootError]    = useState<string | null>(null);
  const [identity,     setIdentityRaw]  = useState<GuestIdentity | null>(null);
  const [sessionId,    setSessionId]    = useState<string | null>(null);
  const [account,      setAccount]      = useState<User | null>(null);
  const [city,         setCity]         = useState<City | null>(null);
  const [wsConnected,  setWsConnected]  = useState(false);
  const [unreadDMs,    setUnreadDMs]    = useState(0);
  const [geoState,     setGeoState]     = useState<GeoState>('pending');
  const [detectedCity, setDetectedCity] = useState<City | null>(null);
  const [joined,       setJoined]       = useState(false);
  const [onlineUsers,  setOnlineUsers]  = useState<OnlineUser[]>([]);

  const setIdentity = useCallback((id: GuestIdentity) => setIdentityRaw(id), []);

  const logout = useCallback(async () => {
    await authLogout();
    await clearToken();
    setAccount(null);
    setUnreadDMs(0);
  }, []);

  return (
    <AppContext.Provider
      value={{
        booting, bootError, identity, sessionId, account, city, wsConnected, unreadDMs,
        geoState, detectedCity, joined, onlineUsers,
        setBooting, setBootError,
        setIdentity,
        setSessionId: useCallback((id: string) => setSessionId(id), []),
        setAccount,
        setCity: useCallback((c: City) => setCity(c), []),
        setWsConnected,
        setUnreadDMs,
        setGeoState:     useCallback((s: GeoState) => setGeoState(s), []),
        setDetectedCity: useCallback((c: City | null) => setDetectedCity(c), []),
        setJoined:       useCallback((j: boolean) => setJoined(j), []),
        setOnlineUsers:  useCallback((u: OnlineUser[]) => setOnlineUsers(u), []),
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
