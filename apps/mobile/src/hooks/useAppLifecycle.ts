/**
 * App lifecycle management.
 *
 * Handles foreground/background transitions:
 * - Reconnects WebSocket when app comes to foreground
 * - Re-joins city channel so presence + messages resume
 * - Fires optional callback for screen-level data refresh
 */
import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { socket } from '@/lib/socket';
import { useApp } from '@/context/AppContext';
import { joinChannel } from '@/api/channels';

export function useAppLifecycle(onForeground?: () => void): void {
  const { city, identity, sessionId, account } = useApp();
  const appState = useRef<AppStateStatus>(AppState.currentState);

  // Stable reference to the callback so the effect doesn't re-run on every render
  const onForegroundRef = useRef(onForeground);
  onForegroundRef.current = onForeground;

  const handleForeground = useCallback(() => {
    // Reconnect WS immediately if it dropped
    if (!socket.isConnected) {
      socket.reconnectNow();
    }

    // Re-join the city channel (presence may have expired while backgrounded).
    // Use the registered display name when available — falling back to the guest
    // nickname prevents spurious "GuestName just landed" feed events for users
    // whose real identity is already known.
    if (city && identity && sessionId) {
      const displayName = account?.display_name ?? identity.nickname;
      joinChannel(city.channelId, sessionId, identity.guestId, displayName)
        .catch(() => {});
      // City WS join happens automatically on 'connected' event via useAppBoot
      // but if already connected we need to rejoin manually
      if (socket.isConnected) {
        socket.joinCity(city.channelId, sessionId, displayName, account?.id);
      }
    }

    onForegroundRef.current?.();
  }, [city, identity, sessionId, account]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appState.current;
      appState.current = nextState;

      if (nextState === 'active' && prev !== 'active') {
        handleForeground();
      }
    });

    return () => sub.remove();
  }, [handleForeground]);
}
