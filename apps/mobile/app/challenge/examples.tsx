import { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { fetchChallengeExamples, type ChallengeExample, type ChallengeExampleLine } from '@/api/challenges';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

const LINE_ICON: Record<ChallengeExampleLine['kind'], string> = {
  created: '🎯', winner: '🏆', present: '✅', submission: '📸', host: '👑',
};

/**
 * "See 3 real examples" - real resolved challenges with a simple who-earned-what
 * point breakdown. Reached from the ScoringInfoModal CTA; teaches the scoring by
 * example instead of dumping the user on the showcase.
 */
export default function ChallengeExamplesScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('challenge');
  const [examples, setExamples] = useState<ChallengeExample[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    let alive = true;
    fetchChallengeExamples().then((ex) => { if (alive) { setExamples(ex); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  const lineLabel = (l: ChallengeExampleLine): string => {
    const opts = { name: l.name ?? '', count: l.count ?? 0 };
    switch (l.kind) {
      case 'created':    return t('pointExamples.line.created',    { ...opts, defaultValue: `${opts.name} created it` });
      case 'winner':     return t('pointExamples.line.winner',     { ...opts, defaultValue: `${opts.name} won` });
      case 'present':    return t('pointExamples.line.present',    { ...opts, defaultValue: `${opts.count} showed up` });
      case 'submission': return t('pointExamples.line.submission', { ...opts, defaultValue: `${opts.count} submitted a photo` });
      case 'host':       return t('pointExamples.line.host',       { ...opts, defaultValue: `${opts.name} hosted` });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.backPill} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={18} color={colors.text} />
          <Text style={styles.backPillText}>{t('back', { ns: 'common' })}</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>✨ {t('pointExamples.title', { defaultValue: '3 real examples' })}</Text>
        <View style={{ width: 70 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.muted} style={{ marginTop: Spacing.xl }} />
      ) : examples.length === 0 ? (
        <Text style={styles.empty}>{t('pointExamples.empty', { defaultValue: 'No examples yet — be the first to run a challenge!' })}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.intro}>{t('pointExamples.intro', { defaultValue: 'How real challenges paid out — who earned what.' })}</Text>
          {examples.map((ex) => (
            <View key={ex.id} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={ex.format === 'photo' ? styles.fmtPhoto : styles.fmtMeet}>
                  <Text style={ex.format === 'photo' ? styles.fmtPhotoText : styles.fmtMeetText}>
                    {ex.format === 'photo' ? `📸 ${t('card.photoBadge', { defaultValue: 'Photo proof' })}` : `📍 ${t('card.meetBadge', { defaultValue: 'Meet' })}`}
                  </Text>
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>{ex.title}</Text>
              </View>
              {ex.lines.map((l, i) => (
                <View key={i} style={styles.line}>
                  <Text style={styles.lineIcon}>{LINE_ICON[l.kind]}</Text>
                  <Text style={styles.lineLabel} numberOfLines={1}>{lineLabel(l)}</Text>
                  <Text style={styles.linePoints}>
                    +{l.points}{l.per ? ` ${t('pointExamples.each', { defaultValue: 'each' })}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  nav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  backPill:     { flexDirection: 'row', alignItems: 'center', width: 70 },
  backPillText: { fontSize: FontSizes.sm, color: c.text, fontWeight: '600' },
  navTitle: { flex: 1, textAlign: 'center', fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  empty: { textAlign: 'center', color: c.muted, marginTop: Spacing.xl, paddingHorizontal: Spacing.lg },
  scroll: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xl },
  intro: { fontSize: FontSizes.sm, color: c.muted, marginBottom: 2 },
  card: { backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: Spacing.md, gap: 6 },
  cardHead: { gap: 6, marginBottom: 4 },
  cardTitle: { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  fmtMeet:  { alignSelf: 'flex-start', backgroundColor: 'rgba(96,165,250,0.14)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  fmtMeetText:  { fontSize: 11, fontWeight: '800', color: '#60a5fa' },
  fmtPhoto: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,201,60,0.14)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  fmtPhotoText: { fontSize: 11, fontWeight: '800', color: '#FFC93C' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineIcon: { fontSize: FontSizes.md },
  lineLabel: { flex: 1, fontSize: FontSizes.sm, color: c.text, fontWeight: '600' },
  linePoints: { fontSize: FontSizes.sm, fontWeight: '800', color: '#FF7A3C' },
});
