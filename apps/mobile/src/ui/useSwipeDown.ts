import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

/**
 * Pan handlers for a sheet: a downward swipe (80 pt, or a quick flick) calls
 * `onClose`, the same close as the button, the scrim and Android back.
 */
export function useSwipeDown(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  return useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
    onPanResponderRelease: (_, g) => { if (g.dy > 80 || g.vy > 1.2) close.current(); },
  }).panHandlers, []);
}
