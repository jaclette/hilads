import { Text, View, StyleSheet } from 'react-native';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/** The Local / Traveler label (SPEC 9.11): primary tint for locals, blue for travelers. */
export function ModeLabel({ mode, label }: { mode: 'local' | 'traveler'; label: string }) {
  const styles = useThemedStyles(makeStyles);
  const local = mode === 'local';
  return (
    <View style={[styles.pill, local ? styles.local : styles.traveler]}>
      <Text style={[styles.text, local ? styles.localText : styles.travelerText]}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  pill:         { flexDirection: 'row', alignItems: 'center', height: 26, paddingHorizontal: 10, borderRadius: Radius.full },
  text:         { fontSize: 12, fontWeight: '700' },
  local:        { backgroundColor: c.primaryTint },
  localText:    { color: c.primaryOnTint },
  traveler:     { backgroundColor: c.travelerBg },
  travelerText: { color: c.travelerText },
});
