import { useApp } from '@/context/AppContext';

/**
 * Unread private messages, one number for every badge (the Passport tab, the
 * header's messages button, the Passport "Messages" row): the conversations
 * with something unread, exactly the rows the Messages list marks unread (a DM
 * with has_unread from the server, a plan chat with new messages).
 */
export function useUnreadMessages(): number {
  const { unreadDMs, eventChatPreviews } = useApp();
  return unreadDMs + Object.values(eventChatPreviews).filter(p => p.count > 0).length;
}

// "Ask the server again": a new DM, a DM read, the app back in the foreground.
// useGlobalDmNotifications listens and refetches the conversations (debounced).
const listeners = new Set<() => void>();
export function requestDmUnreadRefresh(): void {
  listeners.forEach(fn => { try { fn(); } catch { /* never breaks the caller */ } });
}
export function onDmUnreadRefresh(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** "3", "9+" (the badges' cap). */
export const badgeCount = (n: number): string => (n > 9 ? '9+' : String(n));
