import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

/**
 * Pan handlers for a sheet: a downward swipe (80 pt, or a quick flick) calls
 * `onClose`, the same close as the button, the scrim and Android back.
 * `capture`: the drag may start on one of the sheet's buttons (a sheet with
 * nothing to scroll); without it, only from its non-touchable parts, so a
 * list inside the sheet keeps scrolling back up.
 */
export function useSwipeDown(onClose: () => void, { capture = false }: { capture?: boolean } = {}) {
  const close = useRef(onClose);
  close.current = onClose;
  return useMemo(() => {
    const downward = (_: unknown, g: { dy: number; dx: number }) => g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5;
    return PanResponder.create({
      onMoveShouldSetPanResponder: downward,
      onMoveShouldSetPanResponderCapture: capture ? downward : undefined,
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_, g) => { if (g.dy > 80 || g.vy > 1.2) close.current(); },
    }).panHandlers;
  }, [capture]);
}
