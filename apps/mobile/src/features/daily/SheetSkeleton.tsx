import { View, StyleSheet } from 'react-native';
import { Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/**
 * Placeholders inside the challenge sheet while its photos or the Compare board
 * load (the sheet itself opens at once): a 2 x 2 grid of photo tiles, or
 * board rows. Never a full-screen loader.
 */
export function SheetSkeleton({ rows = false }: { rows?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  if (rows) {
    return (
      <View style={styles.rows} accessibilityLabel="…">
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={styles.row}>
            <View style={styles.flag} />
            <View style={[styles.line, { width: `${60 - i * 8}%` }]} />
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={styles.grid} accessibilityLabel="…">
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={styles.tile}>
          <View style={styles.photo} />
          <View style={[styles.line, { width: '70%' }]} />
          <View style={[styles.line, { width: '45%' }]} />
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  grid:  { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12, paddingTop: 4 },
  tile:  { width: '48.5%', gap: 6 },
  photo: { aspectRatio: 1, borderRadius: 16, backgroundColor: c.bg3 },
  line:  { height: 12, borderRadius: 6, backgroundColor: c.bg3 },
  rows:  { gap: 12, paddingVertical: Spacing.md },
  row:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flag:  { width: 24, height: 16, borderRadius: 3, backgroundColor: c.bg3 },
});
