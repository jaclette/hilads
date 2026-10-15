import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import type { DailyProofStatus } from '@/types';

/** "In review" / "Published" / "Not published" / "Removed" for my proof. */
export function DailyStatusChip({ status }: { status: DailyProofStatus }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const tone = status === 'approved' ? styles.ok : status === 'pending' ? styles.wait : styles.bad;
  const icon = status === 'approved' ? '✅' : status === 'pending' ? '⏳' : '⚠️';
  return (
    <View style={[styles.chip, tone]}>
      <Text style={styles.text}>{icon} {t(`status.${status}`)}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  chip: { alignSelf: 'flex-start', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  ok:   { backgroundColor: c.bg3, borderColor: c.green },
  wait: { backgroundColor: c.bg3, borderColor: c.accent },
  bad:  { backgroundColor: c.bg3, borderColor: c.red },
  text: { fontSize: FontSizes.xs, fontWeight: '700', color: c.text },
});
