/**
 * ThemeContext — native light/dark theming.
 *
 * React Native has no runtime CSS variables, so themed screens read their colors
 * from here (via useTheme() / useThemedStyles()) instead of the static `Colors`
 * import. Changing the theme re-renders consumers and re-runs their style
 * factories → an instant toggle, no reload.
 *
 * DEFAULT is 'dark' during the screen-by-screen migration: the app keeps its
 * original look until every StyleSheet is converted, then this flips to 'light'
 * (same staged approach as the web migration). The Me-screen toggle is not
 * surfaced until the flip.
 */
import React, {
  createContext, useContext, useState, useEffect, useMemo, useCallback,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Themes, type ThemeColors, type ThemeName } from '@/constants';

const STORAGE_KEY = 'hilads_theme';
const DEFAULT_THEME: ThemeName = 'dark'; // flip to 'light' once migration completes

interface ThemeCtx {
  theme:       ThemeName;
  colors:      ThemeColors;
  setTheme:    (t: ThemeName) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);

  // Hydrate the saved preference (async). DEFAULT_THEME shows until it resolves.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(v => { if (v === 'light' || v === 'dark') setThemeState(v); })
      .catch(() => {});
  }, []);

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    AsyncStorage.setItem(STORAGE_KEY, t).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next: ThemeName = prev === 'dark' ? 'light' : 'dark';
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<ThemeCtx>(
    () => ({ theme, colors: Themes[theme], setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/**
 * Memoized themed styles. Pass a factory that builds a StyleSheet from colors:
 *
 *   const styles = useThemedStyles(c => StyleSheet.create({
 *     box: { backgroundColor: c.bg, borderColor: c.separator },
 *   }));
 *
 * Re-runs only when the theme changes.
 */
export function useThemedStyles<T>(factory: (c: ThemeColors) => T): T {
  const { colors } = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => factory(colors), [colors]);
}
