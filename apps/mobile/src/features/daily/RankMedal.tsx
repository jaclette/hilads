import { Text, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/**
 * A rank in a round seal: #1 on gold, #2 and #3 on the primary tint, the rest
 * as a plain "#n". Replaces the 🥇🥈🥉 medals (SPEC 9.11: no emoji as chrome).
 */
export function RankMedal({ rank, size = 26, style }: { rank: number; size?: number; style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(makeStyles);
  const box = { width: size, height: size };
  if (rank > 3) {
    return <View style={[styles.center, box, style]}><Text style={styles.plain}>#{rank}</Text></View>;
  }
  return (
    <View style={[styles.center, styles.seal, box, rank === 1 ? styles.gold : styles.tint, style]} accessibilityLabel={`#${rank}`}>
      <Text style={[styles.text, rank === 1 ? styles.onGold : styles.onTint]}>{rank}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  seal:   { borderRadius: Radius.full },
  gold:   { backgroundColor: c.gold },
  tint:   { backgroundColor: c.primaryTint },
  text:   { fontSize: FontSizes.sm, fontWeight: '800' },
  onGold: { color: c.white },
  onTint: { color: c.primaryOnTint },
  plain:  { fontSize: FontSizes.sm, fontWeight: '800', color: c.muted },
});
