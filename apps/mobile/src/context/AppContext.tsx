import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { GuestIdentity, City, User } from '@/types';

interface AppState {
  booting:     boolean;
  bootError:   string | null;
  identity:    GuestIdentity | null;
  sessionId:   string | null;   // UUID v4, per-session, not persisted
  account:     User | null;
  city:        City | null;
  wsConnected: boolean;
}

interface AppActions {
  setIdentity:    (identity: GuestIdentity) => void;
  setSessionId:   (id: string) => void;
  setAccount:     (account: User | null) => void;
  setCity:        (city: City) => void;
  setBooting:     (booting: boolean) => void;
  setBootError:   (error: string | null) => void;
  setWsConnected: (connected: boolean) => void;
}

const AppContext = createContext<(AppState & AppActions) | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [booting,     setBooting]     = useState(true);
  const [bootError,   setBootError]   = useState<string | null>(null);
  const [identity,    setIdentity]    = useState<GuestIdentity | null>(null);
  const [sessionId,   setSessionId]   = useState<string | null>(null);
  const [account,     setAccount]     = useState<User | null>(null);
  const [city,        setCity]        = useState<City | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  return (
    <AppContext.Provider
      value={{
        booting, bootError, identity, sessionId, account, city, wsConnected,
        setBooting, setBootError,
        setIdentity: useCallback((id: GuestIdentity) => setIdentity(id), []),
        setSessionId: useCallback((id: string) => setSessionId(id), []),
        setAccount,
        setCity: useCallback((c: City) => setCity(c), []),
        setWsConnected,
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
