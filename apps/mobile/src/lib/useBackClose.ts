import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

/**
 * Android back closes an in-screen layer (a drill-down, a selected card) before
 * the screen itself (the navigation rule). Active only while `active` and the
 * screen is focused; removed when the layer closes.
 */
export function useBackClose(active: boolean, close: () => void): void {
  const ref = useRef(close);
  ref.current = close;
  const focused = useIsFocused();
  useEffect(() => {
    if (!active || !focused || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { ref.current(); return true; });
    return () => sub.remove();
  }, [active, focused]);
}
