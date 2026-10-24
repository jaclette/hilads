import { useEffect, useState } from 'react';
import { setStatusBarStyle } from 'expo-status-bar';
import { useTheme } from '@/context/ThemeContext';

/**
 * Light status bar icons over a dark full-screen Modal (camera, photo viewer),
 * the theme's again once it closes. Android copies the app's status bar style
 * into a Modal only when the Modal opens, so the style changes first and the
 * Modal opens one frame later: pass the returned value as the Modal's
 * `visible`. `light` false (e.g. a themed permission screen) keeps the theme's.
 */
export function useModalStatusBar(open: boolean, light = true): boolean {
  const { theme } = useTheme();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    if (!light) {
      setShown(true);
      return;
    }
    setStatusBarStyle('light');
    setShown(true);
    return () => setStatusBarStyle(theme === 'dark' ? 'light' : 'dark');
  }, [open, light, theme]);
  return open && shown;
}
