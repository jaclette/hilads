import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Space, Gutter, Radius, Type, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Button, Card, Screen, ScreenHeader } from '@/ui';
import { ACCENTS, tint } from '@/ui/joy';
import { RankMedal } from '@/features/daily/RankMedal';
import { useScoringPoints, seasonEnd, seasonStart } from '@/features/scoring/points';
import { useDailyToday } from '@/hooks/useDaily';
import { track } from '@/services/analytics';

/**
 * How Hilads works (docs/mockups/hilads_how_it_works_mockup.html), opened from World's
 * "How it works" button: a real screen. Scoring v2 ("Play, Win, Invite"): the points are
 * the server's config (GET /daily/points), until they arrive the values it ships with.
 * Play (+10), Win (the World top 3), Perfect week, Invite friends; likes give no points,
 * they decide the top 3. Seasons: the ranking starts over every month, all time stays.
 */

export default function HowItWorksScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t, i18n } = useTranslation('daily');
  const { account, city } = useApp();
  const today = useDailyToday(city?.channelId);
  const pts = useScoringPoints();

  useEffect(() => { track('how_it_works_viewed'); }, []);

  const played = !!today.data?.hasProof;
  const play = () => {
    track('how_it_works_cta', { played });
    if (played) router.push('/daily/photos?source=how_it_works' as never);
    else router.push((account ? '/daily/proof' : '/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof') as never);
  };
  const plus = (n: number) => t('rules.plus', { count: n });

  const earn = [
    // A card with a destination is tappable (chevron): Play → Today, Win → this season's players,
    // Perfect week → the week on the Passport, Invite → "Bring your crew". The others have none.
    { emoji: '📸', title: t('rules.earn.photoTitle'), text: t('rules.earn.photoText'), value: plus(pts.proof), places: null, to: '/(tabs)/today' },
    // The top 3: one line per place (medal, 1st / 2nd / 3rd, its points), not one pill.
    { emoji: '👑', title: t('rules.earn.topTitle'), text: t('rules.earn.topText', { count: pts.minVotesToWin }), value: null,
      places: pts.top.map((n, i) => ({ rank: i + 1, label: t(`rules.earn.place${i + 1}`), value: plus(n) })), to: '/ranks?tab=players&period=season' },
    { emoji: '🔥', title: t('rules.earn.weekTitle'), text: t('rules.earn.weekText'), value: plus(pts.perfectWeek ?? 30), places: null, to: '/(tabs)/passport?focus=week' },
    { emoji: '🤝', title: t('rules.earn.inviteTitle'),
      text: t('rules.earn.inviteText', { count: pts.invitesPerSeason ?? 5, crew: pts.crewBonus ?? 50 }), value: plus(pts.friendJoined ?? 10), places: null, to: '/invite' },
    { emoji: '❤️', title: t('rules.earn.likesTitle'), text: t('rules.earn.likesText'), value: null, places: null, to: null },
  ];
  const open = (to: string, card: string) => { track('how_it_works_card', { card }); router.push(to as never); };
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
            <Pressable accessible style={({ pressed }) => [styles.ruleCol, pressed && !!r.to && styles.pressed]} disabled={!r.to}
                  onPress={() => { if (r.to) open(r.to, r.to); }} accessibilityRole={r.to ? 'button' : undefined}
                  testID={r.to ? `how-it-works-card-${i}` : undefined}
                  accessibilityLabel={[r.title, r.text, r.value, ...(r.places ?? []).map(p => `${p.label} ${p.value}`)].filter(Boolean).join('. ')}>
              <View style={styles.ruleRow}>
                <View style={[styles.bubble, { backgroundColor: tint(ACCENTS[i % ACCENTS.length], 0.22) }]}><Text style={styles.bubbleEmoji}>{r.emoji}</Text></View>
                <View style={styles.ruleBody}>
                  <Text style={styles.ruleTitle}>{r.title}</Text>
                  <Text style={styles.ruleText}>{r.text}</Text>
                </View>
                {!!r.value && <View style={styles.pill}><Text style={styles.pillText}>{r.value}</Text></View>}
                {!!r.to && <Ionicons name="chevron-forward" size={18} color={colors.muted} />}
              </View>
              {/* The podium's places, the podium's medals (gold, silver, bronze). */}
              {!!r.places && (
                <View style={styles.places}>
                  {r.places.map(p => (
                    <View key={p.rank} style={styles.place}>
                      <RankMedal rank={p.rank} podium size={32} />
                      <Text style={styles.placeLabel} numberOfLines={1}>{p.label}</Text>
                      <View style={styles.pill}><Text style={styles.pillText}>{p.value}</Text></View>
                    </View>
                  ))}
                </View>
              )}
            </Pressable>
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

        {/* Seasons: the ranking starts over every month; all time is for the glory. */}
        <Text style={styles.section} accessibilityRole="header">{t('rules.seasonsTitle')}</Text>
        <Card style={styles.rule}>
          <View accessible style={styles.ruleRow}>
            <View style={[styles.bubble, { backgroundColor: tint(ACCENTS[1], 0.22) }]}><Text style={styles.bubbleEmoji}>🏁</Text></View>
            <View style={styles.ruleBody}>
              <Text style={styles.ruleTitle}>{t('rules.seasons.title')}</Text>
              <Text style={styles.ruleText}>{t('rules.seasons.text')}</Text>
              {!!pts.season && (
                <Text style={styles.seasonEnd}>
                  {pts.season.pre
                    ? t('rules.seasons.pre', { date: seasonStart(pts.season, i18n.language) })
                    : t('rules.seasons.ends', { date: seasonEnd(pts.season, i18n.language) })}
                </Text>
              )}
            </View>
          </View>
        </Card>

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
  ruleCol:     { gap: Space.md },
  pressed:     { opacity: 0.6 },
  ruleRow:     { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  // The top 3's lines, under the text, aligned with it (the bubble's width + the gap).
  places:      { gap: Space.sm, paddingLeft: 48 + Space.md },
  place:       { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 36 },
  placeLabel:  { flex: 1, ...Type.label, color: c.text },
  bubble:      { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  bubbleEmoji: { fontSize: 24, lineHeight: 30 },
  ruleBody:    { flex: 1, gap: Space.xxs },
  ruleTitle:   { ...Type.label, color: c.text },
  ruleText:    { ...Type.body, color: c.muted },
  seasonEnd:   { ...Type.caption, fontWeight: '700', color: c.text, marginTop: Space.xxs },
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
