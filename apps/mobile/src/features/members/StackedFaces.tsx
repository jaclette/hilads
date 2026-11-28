import { View, StyleSheet } from 'react-native';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Avatar } from '@/ui';

/** Up to 3 overlapping faces (the Hi header's members line). Decorative: the line itself is labelled. */
export function StackedFaces({ faces, size = 20 }: { faces: { photo: string | null; name: string }[]; size?: number }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {faces.slice(0, 3).map((f, i) => (
        <View key={i} style={[styles.face, { marginLeft: i === 0 ? 0 : -size * 0.35, zIndex: 3 - i, borderRadius: size }]}>
          <Avatar uri={f.photo} name={f.name || '?'} size={size} />
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row:  { flexDirection: 'row', alignItems: 'center' },
  face: { borderWidth: 1.5, borderColor: c.bg },
});
