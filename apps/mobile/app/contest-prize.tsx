import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Gutter, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Button } from '@/ui';
import { contestDate, fetchContest, notifyContest, type ContestMeNotJoined, type ContestOverview } from '@/features/contest/contest';
import { CountdownBoard, countdownTarget, shortLeft, useNow } from '@/features/contest/Countdown';
import { PrizePhotos } from '@/features/contest/PrizePhotos';
import { LS } from '@/features/contest/HalongArt';
import { useContestShare } from '@/features/contest/useContestShare';
import { SouvenirLine } from '@/features/contest/SouvenirLine';
import { setContestOverview } from '@/features/contest/useContestTab';
import { HowToWin } from '@/features/contest/HowToWin';
import { FounderWord, SampleItinerary } from '@/features/contest/PrizeTrip';
import { track } from '@/services/analytics';

/**
 * The Launch Season's prize, the screen that sells the dream: the season's real photos (Admin ›
 * Launch Season › Photos) full width, the prize and its description (Admin › Prize), the
 * countdown, the dates, "our launch gift, the game stays the same", the rules, Share; a sticky
 * "Join the Launch Season" (or "You're in", to my score). Opened from the Today card and the home.
 */
export default function ContestPrizeScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { t, i18n } = useTranslation('me');
  const { account } = useApp();
  const [data, setData] = useState<ContestOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const share = useContestShare(data);

  useFocusEffect(useCallback(() => {
    setFailed(false);
    fetchContest(i18n.language).then(setData).catch(() => setFailed(true));
    track('contest_prize_viewed', {});
  }, [i18n.language]));

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/(tabs)/trip' as never));
  const s = data?.season;
  const me = data?.me;
  const joined = me?.joined === true;
  const target = s ? countdownTarget(s) : null;
  const final = s?.phase === 'final' || s?.phase === 'over';

  // The Upcoming phase (teaser): nothing playable for the contest yet, "Notify me" instead of Join.
  const upcoming = s?.phase === 'upcoming';
  const notified = me?.joined === true || !!(me && (me as ContestMeNotJoined).notified);
  const [busy, setBusy] = useState(false);
  const now = useNow(60_000);
  const notify = () => {
    if (!s || notified || busy) return;
    setBusy(true);
    notifyContest(s.id, i18n.language).then(d => { setData(d); setContestOverview(d); }).catch(() => {}).finally(() => setBusy(false));
  };
  const cta = upcoming
    ? !account ? { label: t('contest.notifyMe'), go: () => router.push('/auth-gate?reason=contest&returnTo=%2Ftrip' as never) }
      : { label: t(notified ? 'contest.notifyOn' : 'contest.notifyMe'), go: notify }
    : !account
    ? { label: t('contest.join'), go: () => router.push('/auth-gate?reason=contest&returnTo=%2Ftrip' as never) }
    : joined ? { label: t('contest.prizeYoureIn'), go: () => router.navigate('/(tabs)/trip' as never) }
    : me && me.joined === false && me.canJoin ? { label: t('contest.join'), go: () => router.push('/contest-join' as never) }
    : null;

  return (
    <View style={styles.screen}>
      {!s ? (
        <View style={[styles.center, { paddingTop: insets.top }]}>
          {failed ? <Text style={styles.muted}>{t('contest.error')}</Text> : data ? <Text style={styles.muted}>{t('contest.closed')}</Text>
            : <ActivityIndicator color={colors.muted} />}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} testID="contest-prize">
          <PrizePhotos photos={s.photos ?? []} height={Math.min(560, Math.round(height * 0.58))} zoomable>
            <Text style={styles.kicker}>{upcoming ? t('contest.teaserTitle') : s.name}</Text>
            <Text style={styles.title} accessibilityRole="header">{s.prize?.title || s.name}</Text>
            <Text style={styles.winLine}>🏆 {t('contest.winLine')}</Text>
          </PrizePhotos>
          <View style={styles.body}>
            {!!s.prize?.subtitle && <Text style={styles.sub}>{s.prize.subtitle}</Text>}
            {!!s.prize?.description && <Text style={styles.text}>{s.prize.description}</Text>}
            <SouvenirLine souvenir={s.souvenir} />
            {target && <CountdownBoard target={target} />}
            {upcoming && target && (
              <View style={styles.warmCard}>
                <View style={styles.warmHead}>
                  <Ionicons name="barbell-outline" size={IconSize.md} color={colors.primaryText} />
                  <Text style={styles.howTitle}>{t('contest.teaserTrainTitle')}</Text>
                </View>
                <Text style={styles.text}>{t('contest.teaserTraining', { time: shortLeft(target.at - now, t) })}</Text>
                <Pressable onPress={() => router.push('/(tabs)/ranks' as never)} accessibilityRole="link" hitSlop={8} style={styles.link} testID="contest-teaser-ranks">
                  <Text style={styles.linkText}>{t('contest.teaserRanks')}</Text>
                  <Ionicons name="chevron-forward" size={IconSize.sm} color={colors.primaryText} />
                </Pressable>
              </View>
            )}
            <View style={styles.meta}>
              <View style={styles.metaCol}><Text style={styles.metaLabel}>{t('contest.passFinal')}</Text>
                <Text style={styles.metaValue}>{final ? t('contest.passNow') : contestDate(s.finalWeekStart, i18n.language)}</Text></View>
              <View style={styles.metaCol}><Text style={styles.metaLabel}>{t('contest.passEnds')}</Text>
                <Text style={styles.metaValue}>{contestDate(s.endDate, i18n.language)}</Text></View>
            </View>
            {/* Dates and conditions, in plain words, then the whole Rules section of the Trip tab. */}
            <View style={styles.howCard}>
              <Text style={styles.howTitle} accessibilityRole="header">{t('trip.prize.conditionsTitle')}</Text>
              {[
                t('trip.rules.final1', { date: contestDate(s.finalWeekStart, i18n.language) }),
                t('trip.rules.how3'),
                data?.counter ? t('trip.rules.goalText', { players: data.counter.threshold, photos: data.counter.photos }) : null,
                t('trip.rules.fallbackText', { date: contestDate(s.endDate, i18n.language), prize: s.fallbackPrize ?? '' }),
                `${t('trip.rules.who1')} ${t('trip.rules.who2')} ${t('trip.rules.who3')}`,
              ].filter(Boolean).map((line, i) => (
                <View key={i} style={styles.condRow}>
                  <Ionicons name="checkmark" size={IconSize.sm} color={colors.green} />
                  <Text style={[styles.text, { flex: 1 }]}>{line}</Text>
                </View>
              ))}
              <Pressable onPress={() => { track('trip_cta', { cta: 'prize_rules', section: 'prize', phase: s.phase }); router.navigate({ pathname: '/(tabs)/trip', params: { section: 'rules' } } as never); }}
                         accessibilityRole="link" hitSlop={8} style={[styles.link, { paddingBottom: Space.md }]} testID="prize-rules">
                <Text style={styles.linkText}>{t('trip.prize.rulesLink')}</Text>
                <Ionicons name="chevron-forward" size={IconSize.sm} color={colors.primaryText} />
              </Pressable>
            </View>
            <View style={styles.howCard}>
              <Text style={styles.howTitle} accessibilityRole="header">{t('contest.howWinTitle')}</Text>
              <HowToWin season={s} />
            </View>
            <SampleItinerary days={s.itinerary ?? []} />
            {s.founder && <FounderWord founder={s.founder} />}
            <View style={styles.gift}>
              <Ionicons name="gift-outline" size={IconSize.md} color={colors.primaryText} />
              <Text style={[styles.muted, { flex: 1, color: colors.primaryOnTint }]}>{t('contest.launchGift')}</Text>
            </View>
            <View style={styles.links}>
              <Pressable onPress={() => Linking.openURL(s.rulesUrl)} accessibilityRole="link" hitSlop={8} style={styles.link}>
                <Text style={styles.linkText}>{t('contest.rules')}</Text>
                <Ionicons name="open-outline" size={IconSize.sm} color={colors.primaryText} />
              </Pressable>
              <Pressable onPress={() => share.open()} accessibilityRole="button" hitSlop={8} style={styles.link} testID="contest-share">
                <Ionicons name="share-outline" size={IconSize.sm} color={colors.primaryText} />
                <Text style={styles.linkText}>{t('contest.share')}</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      )}

      {/* Over the photo: back, and TEST while it is a test season. */}
      <View style={[styles.top, { top: insets.top + Space.xs }]} pointerEvents="box-none">
        <Pressable onPress={back} style={styles.back} accessibilityRole="button" accessibilityLabel={t('back', { ns: 'common' })} hitSlop={8}>
          <Ionicons name="chevron-back" size={IconSize.md} color="#FFFFFF" />
        </Pressable>
        {s?.isTest && <Text style={styles.test}>{t('contest.test')}</Text>}
      </View>

      {s && cta && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + Space.sm }]}>
          <Button icon={upcoming ? (notified ? 'checkmark-circle-outline' : 'notifications-outline') : joined ? 'trophy-outline' : 'rocket-outline'}
                  variant={upcoming && notified ? 'secondary' : undefined} label={cta.label} onPress={cta.go} testID="contest-prize-cta" />
        </View>
      )}
      {share.sheet}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  screen:    { flex: 1, backgroundColor: c.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  kicker:    { ...Type.caption, fontWeight: '800', color: LS.mango },
  title:     { ...Type.display, fontSize: 34, lineHeight: 39, letterSpacing: -0.6, color: '#FFFFFF' },
  body:      { paddingHorizontal: Gutter, paddingTop: Space.md, gap: Space.sm },
  sub:       { ...Type.label, color: c.primaryText },
  winLine:   { ...Type.label, fontWeight: '800', color: '#FFFFFF' },
  warmCard:  { padding: Space.md, borderRadius: Radius.card, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.line, gap: Space.xs, marginTop: Space.xs },
  warmHead:  { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  howCard:   { padding: Space.md, paddingBottom: 0, borderRadius: Radius.card, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.line, gap: Space.sm, marginTop: Space.xs },
  howTitle:  { ...Type.title, color: c.text },
  condRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
  text:      { ...Type.body, fontSize: 16, lineHeight: 24, color: c.text },
  muted:     { ...Type.caption, color: c.muted },
  meta:      { flexDirection: 'row', gap: Space.sm, marginTop: Space.xs },
  metaCol:   { flex: 1, padding: Space.sm, borderRadius: Radius.control, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.line, alignItems: 'center' },
  metaLabel: { ...Type.caption, color: c.muted },
  metaValue: { ...Type.label, color: c.text },
  gift:      { flexDirection: 'row', gap: Space.sm, alignItems: 'center', padding: Space.sm, borderRadius: Radius.card, backgroundColor: c.primaryTint },
  links:     { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: Space.sm },
  link:      { flexDirection: 'row', alignItems: 'center', gap: Space.xs, minHeight: 44 },
  linkText:  { ...Type.label, fontWeight: '800', color: c.primaryText },
  top:       { position: 'absolute', left: Gutter, right: Gutter, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back:      { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(12,8,5,0.45)', alignItems: 'center', justifyContent: 'center' },
  test:      { ...Type.caption, fontSize: 11, lineHeight: 15, fontWeight: '800', color: '#FFFFFF', backgroundColor: LS.lantern, borderRadius: Radius.control,
               paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  footer:    { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Gutter, paddingTop: Space.sm, backgroundColor: c.bg,
               borderTopWidth: 1, borderTopColor: c.line },
});
