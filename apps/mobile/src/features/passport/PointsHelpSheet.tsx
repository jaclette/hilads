import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Button, Sheet, SheetScrollView } from '@/ui';

// The three ways to earn Daily Challenge points (DailyPoints::EARNING_KINDS,
// values in score_rules). Keep in step if a value changes.
const ROWS: [string, number | string][] = [['proof', 10], ['vote', 2], ['top', '30 / 20 / 10']];

/** "How to earn points" (SPEC 9.2): a help sheet opened from Passport. */
export function PointsHelpSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('me');
  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t('passport.close')} style={styles.sheet}>
      <Text style={styles.title}>{t('points.title')}</Text>
      <Text style={styles.intro}>{t('points.intro')}</Text>
      <SheetScrollView style={styles.list}>
        {ROWS.map(([key, pts]) => (
          <View key={key} style={styles.row}>
            <Text style={styles.label}>{t(`points.${key}`)}</Text>
            <Text style={styles.pts}>+{pts}</Text>
          </View>
        ))}
      </SheetScrollView>
      <Text style={styles.note}>{t('points.weekly')}</Text>
      <Button label={t('passport.gotIt')} onPress={onClose} style={styles.cta} />
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheet:   { maxHeight: '80%' },
  title:   { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  intro:   { fontSize: FontSizes.sm, color: c.muted },
  list:    { flexGrow: 0 },
  row:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44, borderBottomWidth: 1, borderBottomColor: c.line },
  label:   { flex: 1, fontSize: FontSizes.sm, color: c.text },
  pts:     { fontSize: FontSizes.sm, fontWeight: '800', color: c.primaryText },
  note:    { fontSize: FontSizes.xs, color: c.muted },
  cta:     { marginTop: 4 },
});
