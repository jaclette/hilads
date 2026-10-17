import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * App-wide scope (SPEC 9.1): the current city or World, chosen in the header
 * and shared by every tab (proofs and top 3 on Today, area on Map, channel in
 * Chat).
 */
export type Scope = 'city' | 'world';

interface ScopeValue {
  scope: Scope;
  setScope: (s: Scope) => void;
}

const ScopeContext = createContext<ScopeValue | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<Scope>('city');
  const value = useMemo(() => ({ scope, setScope }), [scope]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeValue {
  const v = useContext(ScopeContext);
  if (!v) throw new Error('useScope must be used inside ScopeProvider');
  return v;
}
