import { Text, View, StyleSheet } from 'react-native';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/** The orange "Hi" square: md in the app header, lg on the sign-up sheet, auth screens and boot. */
export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const styles = useThemedStyles(makeStyles);
  const lg = size === 'lg';
  return (
    <View style={[styles.mark, lg && styles.markLg]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.text, lg && styles.textLg]}>Hi</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  mark:   { width: 40, height: 40, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  markLg: { width: 52, height: 52, borderRadius: 16 },
  text:   { color: c.white, fontSize: 17, fontWeight: '800' },
  textLg: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
});
