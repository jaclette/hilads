import { Text, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { FontSizes, Radius, Space, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/**
 * The one count pip (design pass): unread counts, "new". primary = white on primary,
 * soft = the selected peach. 99+ / 9+ caps with `max`.
 */
export function Badge({ value, tone = 'primary', max = 99, style }: {
  value: number | string;
  tone?: 'primary' | 'soft';
  max?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const text = typeof value === 'number' && value > max ? `${max}+` : String(value);
  return (
    <View style={[styles.pip, tone === 'soft' && styles.soft, style]}>
      <Text style={[styles.text, tone === 'soft' && styles.softText]}>{text}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  pip:      { minWidth: 20, height: 20, borderRadius: Radius.full, paddingHorizontal: Space.xs + 2, backgroundColor: c.primary,
              alignItems: 'center', justifyContent: 'center' },
  soft:     { backgroundColor: c.selected },
  text:     { fontSize: FontSizes.tiny, fontWeight: '800', color: c.onPrimary },
  softText: { color: c.onSelected },
});
