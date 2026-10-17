import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

// Daily Challenge points (score_rules, role 'daily'). Keep in step with the
// migration's seeds if a value changes.
const ROWS: [string, number | string][] = [
  ['proof', 10], ['early', 5], ['streak', 2], ['vote', 2],
  ['top', '30 / 20 / 10'], ['cityBest', 15], ['twist', 15], ['proposal', 25], ['localPass', 50],
];

/** "How to earn points" (SPEC 9.2): a help sheet opened from Passport. */
export function PointsHelpSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('me');
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('passport.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>{t('points.title')}</Text>
        <Text style={styles.intro}>{t('points.intro')}</Text>
        <ScrollView style={styles.list}>
          {ROWS.map(([key, pts]) => (
            <View key={key} style={styles.row}>
              <Text style={styles.label}>{t(`points.${key}`)}</Text>
              <Text style={styles.pts}>+{pts}</Text>
            </View>
          ))}
        </ScrollView>
        <Text style={styles.note}>{t('points.weekly')}</Text>
        <TouchableOpacity style={styles.cta} onPress={onClose} accessibilityRole="button">
          <Text style={styles.ctaText}>{t('passport.gotIt')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  scrim:   { flex: 1, backgroundColor: c.scrim },
  sheet:   { maxHeight: '80%', backgroundColor: c.bg2, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: Spacing.md, paddingTop: 8, gap: 8 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: Radius.full, backgroundColor: c.line, marginBottom: 6 },
  title:   { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  intro:   { fontSize: FontSizes.sm, color: c.muted },
  list:    { flexGrow: 0 },
  row:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44, borderBottomWidth: 1, borderBottomColor: c.line },
  label:   { flex: 1, fontSize: FontSizes.sm, color: c.text },
  pts:     { fontSize: FontSizes.sm, fontWeight: '800', color: c.primaryText },
  note:    { fontSize: FontSizes.xs, color: c.muted },
  cta:     { minHeight: 48, borderRadius: 16, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  ctaText: { color: c.white, fontSize: FontSizes.md, fontWeight: '700' },
});
