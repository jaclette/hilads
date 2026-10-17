import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import type { ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/** A screen on the ground color, inside the top safe area. */
export function Screen({ edges = ['top'], children }: { edges?: Edge[]; children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return <SafeAreaView style={styles.screen} edges={edges}>{children}</SafeAreaView>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
});
