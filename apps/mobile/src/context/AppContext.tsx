import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { GuestIdentity, City, User } from '@/types';

// ── App state ─────────────────────────────────────────────────────────────────

interface AppState {
  // Boot
  booting: boolean;
  bootError: string | null;

  // Identity
  identity: GuestIdentity | null;

  // Auth (registered user, optional)
  account: User | null;

  // Current city
  city: City | null;

  // WebSocket connection
  wsConnected: boolean;
}

interface AppActions {
  setIdentity: (identity: GuestIdentity) => void;
  setAccount:  (account: User | null) => void;
  setCity:     (city: City) => void;
  setBooting:  (booting: boolean) => void;
  setBootError:(error: string | null) => void;
  setWsConnected: (connected: boolean) => void;
}

const AppContext = createContext<(AppState & AppActions) | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }) {
  const [booting,     setBooting]     = useState(true);
  const [bootError,   setBootError]   = useState<string | null>(null);
  const [identity,    setIdentity]    = useState<GuestIdentity | null>(null);
  const [account,     setAccount]     = useState<User | null>(null);
  const [city,        setCity]        = useState<City | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const handleSetCity = useCallback((c: City) => setCity(c), []);
  const handleSetIdentity = useCallback((id: GuestIdentity) => setIdentity(id), []);

  return (
    <AppContext.Provider
      value={{
        booting,
        bootError,
        identity,
        account,
        city,
        wsConnected,
        setBooting,
        setBootError,
        setIdentity: handleSetIdentity,
        setAccount,
        setCity: handleSetCity,
        setWsConnected,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
