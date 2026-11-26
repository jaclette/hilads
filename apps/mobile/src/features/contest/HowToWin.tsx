import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { contestDate, type ContestSeason } from './contest';

/**
 * "How to win", the three steps of the campaign (it is a ranking, never a draw): the regular
 * Hilads points, the head start of the top N, the final week whose #1 wins. Every number and date
 * comes from the season (GET /contest).
 */
export function HowToWin({ season: s }: { season: ContestSeason }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('me');
  const r = s.rules;
  const steps = [
    { icon: 'camera-outline' as const, title: t('contest.step1Title', { date: contestDate(s.finalWeekStart, i18n.language) }),
      text: t('trip.rules.how1') },
    { icon: 'podium-outline' as const, title: t('contest.step2Title', { count: r.headstartTopN }),
      text: t('trip.rules.how2', { count: r.headstartTopN, date: contestDate(s.finalWeekStart, i18n.language) }) },
    { icon: 'trophy-outline' as const, title: t('contest.step3Title'),
      text: t('trip.rules.how3', { date: contestDate(s.endDate, i18n.language) }) },
  ];
  return (
    <View style={styles.wrap}>
      {steps.map((st, i) => (
        <View key={i} style={styles.step} accessible accessibilityLabel={`${i + 1}. ${st.title}. ${st.text}`}>
          <View style={styles.rail}>
            <View style={[styles.num, i === 2 && styles.numWin]}><Text style={[styles.numText, i === 2 && styles.numTextWin]}>{i + 1}</Text></View>
            {i < steps.length - 1 && <View style={styles.line} />}
          </View>
          <View style={styles.body}>
            <View style={styles.head}>
              <Ionicons name={st.icon} size={IconSize.sm} color={colors.primaryText} />
              <Text style={styles.title}>{st.title}</Text>
            </View>
            <Text style={styles.text}>{st.text}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:       { gap: 0 },
  step:       { flexDirection: 'row', gap: Space.sm },
  rail:       { alignItems: 'center', width: 32 },
  num:        { width: 30, height: 30, borderRadius: 15, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  numWin:     { backgroundColor: c.medalGold },
  numText:    { ...Type.label, fontWeight: '900', color: c.primaryOnTint },
  numTextWin: { color: c.onMedal },
  line:       { flex: 1, width: 2, backgroundColor: c.line, marginVertical: 2, minHeight: 12 },
  body:       { flex: 1, paddingBottom: Space.md, gap: 2 },
  head:       { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30 },
  title:      { ...Type.label, fontWeight: '800', color: c.text, flexShrink: 1 },
  text:       { ...Type.body, color: c.text },
});
