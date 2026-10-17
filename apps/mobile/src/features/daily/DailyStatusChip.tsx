import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { DailyProofStatus } from '@/types';

/** "In review" / "Published" / "Not published" / "Removed" for my proof. */
export function DailyStatusChip({ status }: { status: DailyProofStatus }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const ok = status === 'approved';
  const wait = status === 'pending';
  const color = ok ? colors.localText : wait ? colors.primaryOnTint : colors.red;
  return (
    <View style={[styles.chip, ok ? styles.ok : wait ? styles.wait : styles.bad]}>
      <Ionicons name={ok ? 'checkmark-circle-outline' : wait ? 'time-outline' : 'alert-circle-outline'} size={14} color={color} />
      <Text style={[styles.text, { color }]}>{t(`status.${status}`)}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  chip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 26, borderRadius: Radius.full, paddingHorizontal: 10 },
  ok:   { backgroundColor: c.localBg },
  wait: { backgroundColor: c.primaryTint },
  bad:  { borderWidth: 1, borderColor: c.red },
  text: { fontSize: FontSizes.xs, fontWeight: '700' },
});
