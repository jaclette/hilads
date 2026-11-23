import { useEffect, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Space, Gutter, Radius, Type, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Button, Card, Screen, ScreenHeader } from '@/ui';
import { ACCENTS, tint } from '@/ui/joy';
import { fetchDailyPoints, type DailyPoints } from '@/api/daily';
import { useDailyToday } from '@/hooks/useDaily';
import { track } from '@/services/analytics';

/**
 * How Hilads works (docs/mockups/hilads_how_it_works_mockup.html), opened from World's
 * "How it works" button: a real screen. The points are the server's (GET /daily/points:
 * score_rules, the kinds that still earn since 2026-10-22: a photo, voting, the World top 3);
 * until they arrive, the values the server seeds. Likes rank the photos, they earn nothing
 * themselves; the streak, the stamps and the Local Pass are collected, without points.
 */
const SEED: DailyPoints = { proof: 10, vote: 2, top: [30, 20, 10], minVotesToWin: 1 };
let cached: DailyPoints | null = null;

export default function HowItWorksScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t } = useTranslation('daily');
  const { account, city } = useApp();
  const today = useDailyToday(city?.channelId);
  const [pts, setPts] = useState<DailyPoints>(cached ?? SEED);

  useEffect(() => {
    track('how_it_works_viewed');
    fetchDailyPoints().then(p => {
      if (!p || typeof p.proof !== 'number' || !Array.isArray(p.top)) return;
      cached = p;
      setPts(p);
    }).catch(() => {});
  }, []);

  const played = !!today.data?.hasProof;
  const play = () => {
    track('how_it_works_cta', { played });
    if (played) router.push('/daily/photos?source=how_it_works' as never);
    else router.push((account ? '/daily/proof' : '/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof') as never);
  };
  const plus = (n: number) => t('rules.plus', { count: n });

  const earn = [
    { emoji: '📸', title: t('rules.earn.photoTitle'), text: t('rules.earn.photoText'), value: plus(pts.proof) },
    { emoji: '🗳️', title: t('rules.earn.voteTitle'), text: t('rules.earn.voteText'), value: plus(pts.vote) },
    { emoji: '👑', title: t('rules.earn.topTitle'), text: t('rules.earn.topText', { count: pts.minVotesToWin }),
      value: pts.top.map(n => plus(n)).join(' / ') },
    { emoji: '❤️', title: t('rules.earn.likesTitle'), text: t('rules.earn.likesText'), value: null },
  ];
  const collect = [
    { emoji: '🔥', title: t('rules.collect.streakTitle'), text: t('rules.collect.streakText') },
    { emoji: '🛂', title: t('rules.collect.passTitle'), text: t('rules.collect.passText') },
  ];
  const race = [
    { emoji: '🌅', title: t('rules.race.dropTitle'), text: t('rules.race.dropText') },
    { emoji: '📸', title: t('rules.race.playTitle'), text: t('rules.race.playText') },
    { emoji: '❤️', title: t('rules.race.voteTitle'), text: t('rules.race.voteText') },
    { emoji: '🏆', title: t('rules.race.resultsTitle'), text: t('rules.race.resultsText') },
  ];

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={t('rules.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/ranks' as never))} testID="how-it-works" />
      <ScrollView contentContainerStyle={styles.body}>
        {/* The promise: one challenge a day, the world compares. */}
        <Card variant="tint" style={styles.intro}>
          <Text style={styles.introEmoji} accessibilityElementsHidden importantForAccessibility="no">📸🌍</Text>
          <Text style={styles.introTitle} accessibilityRole="header">{t('rules.introTitle')}</Text>
          <Text style={styles.introText}>{t('rules.introText')}</Text>
        </Card>

        <Text style={styles.section} accessibilityRole="header">{t('rules.earnTitle')}</Text>
        {earn.map((r, i) => (
          <Card key={r.title} style={styles.rule}>
            <View accessible accessibilityLabel={[r.title, r.text, r.value].filter(Boolean).join('. ')} style={styles.ruleRow}>
              <View style={[styles.bubble, { backgroundColor: tint(ACCENTS[i % ACCENTS.length], 0.22) }]}><Text style={styles.bubbleEmoji}>{r.emoji}</Text></View>
              <View style={styles.ruleBody}>
                <Text style={styles.ruleTitle}>{r.title}</Text>
                <Text style={styles.ruleText}>{r.text}</Text>
              </View>
              {!!r.value && <View style={styles.pill}><Text style={styles.pillText}>{r.value}</Text></View>}
            </View>
          </Card>
        ))}

        <Text style={styles.section} accessibilityRole="header">{t('rules.collectTitle')}</Text>
        {collect.map((r, i) => (
          <Card key={r.title} style={styles.rule}>
            <View accessible accessibilityLabel={`${r.title}. ${r.text}`} style={styles.ruleRow}>
              <View style={[styles.bubble, { backgroundColor: tint(ACCENTS[(i + 3) % ACCENTS.length], 0.22) }]}><Text style={styles.bubbleEmoji}>{r.emoji}</Text></View>
              <View style={styles.ruleBody}>
                <Text style={styles.ruleTitle}>{r.title}</Text>
                <Text style={styles.ruleText}>{r.text}</Text>
              </View>
            </View>
          </Card>
        ))}

        <Text style={styles.section} accessibilityRole="header">{t('rules.raceTitle')}</Text>
        <Card style={styles.race}>
          {race.map((s, i) => (
            <View key={s.title} style={styles.step} accessible accessibilityLabel={`${i + 1}. ${s.title}. ${s.text}`}>
              {/* The timeline: a dot per step, joined by a line. */}
              <View style={styles.rail}>
                <View style={styles.dot}><Text style={styles.dotEmoji}>{s.emoji}</Text></View>
                {i < race.length - 1 && <View style={styles.line} />}
              </View>
              <View style={styles.stepBody}>
                <Text style={styles.ruleTitle}>{s.title}</Text>
                <Text style={styles.ruleText}>{s.text}</Text>
              </View>
            </View>
          ))}
        </Card>

        <Button label={played ? t('rules.ctaPlayed') : t('rules.cta')} onPress={play} style={styles.cta} testID="how-it-works-cta" />
        <Text style={styles.foot}>{t('rules.foot')}</Text>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  body:        { paddingHorizontal: Gutter, paddingBottom: Space.xl, gap: Space.md },
  intro:       { padding: Space.lg, alignItems: 'center', gap: Space.sm, marginTop: Space.sm },
  introEmoji:  { fontSize: 36, lineHeight: 44 },
  introTitle:  { ...Type.title, color: c.text, textAlign: 'center' },
  introText:   { ...Type.body, color: c.text, textAlign: 'center' },
  section:     { ...Type.title, color: c.text, marginTop: Space.md },
  rule:        { padding: Space.md },
  ruleRow:     { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  bubble:      { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  bubbleEmoji: { fontSize: 24, lineHeight: 30 },
  ruleBody:    { flex: 1, gap: Space.xxs },
  ruleTitle:   { ...Type.label, color: c.text },
  ruleText:    { ...Type.body, color: c.muted },
  pill:        { paddingHorizontal: Space.md, minHeight: 32, borderRadius: Radius.control, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center', maxWidth: 120 },
  pillText:    { ...Type.caption, fontWeight: '800', color: c.primaryOnTint, textAlign: 'center' },
  race:        { padding: Space.md },
  step:        { flexDirection: 'row', gap: Space.md },
  rail:        { alignItems: 'center', width: 44 },
  dot:         { width: 44, height: 44, borderRadius: 22, backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' },
  dotEmoji:    { fontSize: 20, lineHeight: 26 },
  line:        { flex: 1, width: 2, minHeight: Space.lg, backgroundColor: c.line, marginVertical: Space.xxs },
  stepBody:    { flex: 1, gap: Space.xxs, paddingBottom: Space.lg, paddingTop: Space.xs },
  cta:         { marginTop: Space.lg },
  foot:        { ...Type.caption, color: c.muted, textAlign: 'center' },
});
