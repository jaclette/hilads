import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, FlatList, Pressable, Text, TouchableOpacity, View, StyleSheet,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchDailyProof, fetchDailyTodayProofs } from '@/api/daily';
import { track } from '@/services/analytics';
import { localizeCityName, shortCityName } from '@/i18n/cityName';
import { canAccessProfile } from '@/lib/profileAccess';
import { goBack } from '@/lib/nav';
import { Avatar, Button, DualPhoto, IconButton, ModeLabel, Photo } from '@/ui';
import { selfieOf } from '@/features/daily/selfie';
import { Confetti, FlagSticker, onFillOf, themeColor } from '@/ui/joy';
import { AnswerChip } from '@/features/compare/AnswerChip';
import { captionRepeatsAnswer } from '@/features/compare/format';
import { seedProofs } from '@/features/daily/votes';
import { flushSeen, markSeen } from '@/features/daily/seen';
import { lastCountries } from '@/features/today/useTodayCountries';
import { rankCountryProofs } from '@/features/daily/countryOrder';
import { CommentButton } from '@/features/daily/CommentButton';
import { commentsTargetOf, PhotoCommentsHost } from '@/features/daily/PhotoCommentsSheet';
import { useCastVote } from '@/features/daily/DailyVoteButton';
import { DailyVotersSheet } from '@/features/daily/DailyVotersSheet';
import { LocalPassBadge } from '@/features/daily/LocalPassBadge';
import { proofShare, type ShareContent } from '@/features/share/content';
import { ShareSheet } from '@/features/share/ShareSheet';
import { useDailyToday, useHere } from '@/hooks/useDaily';
import type { DailyProof } from '@/types';
import { SeasonalScope } from '@/features/event/SeasonalArt';

type Tab = 'world' | 'city';
type Item = { kind: 'photo'; proof: DailyProof } | { kind: 'end' };

const LIMIT = 60;
/** Two taps closer than this are a double tap (a vote). */
const DOUBLE_TAP_MS = 280;
// Dark in both themes, like every photo viewer (fixed photo tokens).
const SHADE_TOP = ['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'] as const;
const SHADE_BOTTOM = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.9)'] as const;
// The selected tab's ink on its white fill: fixed, else a dark theme (Halloween) writes off-white on white.
const TAB_ON_INK = '#2A1C13';

/**
 * Today's photos: what everyone posted today, one full-screen photo at a
 * time, newest first; swipe up for the next. World or my city on top, today's
 * challenge as a pill under them. Each photo: its player (a tap opens the
 * profile), city and flag, answer, caption and place; a big heart to vote
 * (a double tap on the photo votes too, with a heart burst; the first vote of
 * the visit throws confetti) and Share. The end: "Your turn" when I haven't
 * played. `proof` (the new-photo and first-vote pushes) opens on that photo,
 * the others follow; `country` (Today's stories row, a mosaic tile) plays that
 * country's photos best first, then the next countries' (Today's order), like a story.
 * Each photo shown counts as seen (the story rings).
 */
// A seasonal event's live look (Halloween...) re-colors the screen.
export default function PhotosScreen() {
  return <SeasonalScope><PhotosScreenContent /></SeasonalScope>;
}

function PhotosScreenContent() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity, city } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const { proof: pinnedId, source, tab: tabParam, country } = useLocalSearchParams<{ proof?: string; source?: string; tab?: string; country?: string }>();
  const today = useDailyToday(city?.channelId).data;
  const here = useHere();
  const challenge = today?.challenge ?? null;
  const cityId = today?.city?.id ?? null;
  const cityName = today?.city?.name ? shortCityName(today.city.name) : null;

  const [tab, setTab] = useState<Tab>(tabParam === 'city' ? 'city' : 'world');
  const [proofs, setProofs] = useState<DailyProof[] | null>(null);
  const [pinned, setPinned] = useState<DailyProof | null>(null);
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState(0);
  const [index, setIndex] = useState(0);
  const [share, setShare] = useState<ShareContent | null>(null);
  const [votersOf, setVotersOf] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(false);
  const voted = useRef(false);
  const list = useRef<FlatList<Item>>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    track('daily_photos_opened', { source: source ?? 'today', pinned: !!pinnedId, country: country ?? null });
    return () => flushSeen();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The push's photo leads; one from another day opens on its own challenge instead.
  useEffect(() => {
    if (!pinnedId) return;
    fetchDailyProof(pinnedId).then(p => {
      if (challenge && p.date !== challenge.date) {
        router.replace(`/daily/${p.date}?source=push&proof=${encodeURIComponent(p.id)}` as never);
        return;
      }
      seedProofs([p], true);
      setPinned(p);
    }).catch(() => {});
  }, [pinnedId, challenge?.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetchDailyTodayProofs({ scope: tab, cityId: tab === 'city' ? cityId : null, guestId, order: 'new', limit: LIMIT });
      // A city with no photo yet falls back to World on the server: here it's an empty city.
      const items = tab === 'city' && res.scope !== 'city' ? [] : res.proofs.filter(p => !p.suggestion);
      seedProofs(items, challenge?.isActive ?? true);
      setProofs(items);
    } catch {
      setFailed(true);
    }
  }, [tab, cityId, guestId, challenge?.isActive]);
  useEffect(() => { setProofs(null); load(); }, [load]);

  // A country's story (Today's stories row, a mosaic tile): its photos best first (its top photo
  // leading, rankCountryProofs), then the next countries' the same way, in Today's order.
  const story = useMemo(() => {
    const groups = country ? lastCountries()?.items ?? [] : [];
    const at = groups.findIndex(g => g.country === country);
    if (at < 0 || !proofs) return null;
    const byId = new Map(proofs.map(p => [p.id, p]));
    const ids = [...groups.slice(at), ...groups.slice(0, at)].flatMap(g =>
      rankCountryProofs(g.ids.map(id => byId.get(id)).filter((p): p is DailyProof => !!p), g.top.id).map(p => p.id));
    return new Map(ids.map((id, i) => [id, i]));
  }, [country, proofs]);

  const items: Item[] = useMemo(() => {
    if (story && tab === 'world') {
      // Photos posted since Today loaded follow the story.
      const ordered = [...(proofs ?? [])].sort((a, b) => (story.get(a.id) ?? 1e9) - (story.get(b.id) ?? 1e9));
      return [...ordered.map(p => ({ kind: 'photo' as const, proof: p })), { kind: 'end' as const }];
    }
    const rest = (proofs ?? []).filter(p => p.id !== pinned?.id);
    const photos = pinned && tab === 'world' ? [pinned, ...rest] : pinned && pinned.city?.id === cityId ? [pinned, ...rest] : rest;
    return [...photos.map(p => ({ kind: 'photo' as const, proof: p })), { kind: 'end' as const }];
  }, [proofs, pinned, tab, cityId, story]);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    track('daily_photos_tab', { tab: next });
    setTab(next);
    setIndex(0);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<Item>[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setIndex(first.index);
  }).current;

  // Tracking each photo once, and preloading the next two.
  useEffect(() => {
    const item = items[index];
    if (item?.kind === 'photo' && !seen.current.has(item.proof.id)) {
      seen.current.add(item.proof.id);
      markSeen(item.proof.id, !!account);   // Today's story ring turns neutral once a country is all seen
      track('daily_photos_viewed', { index, city: item.proof.city?.name ?? null, tab });
    }
    const next = items.slice(index + 1, index + 3).flatMap(i => (i.kind === 'photo' ? [i.proof.photoUrl] : []));
    if (next.length) Image.prefetch(next).catch(() => {});
  }, [index, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const openProfile = (userId: string) => {
    if (!canAccessProfile(account)) { router.push('/auth-gate?reason=view_profile' as never); return; }
    router.push(`/user/${userId}` as never);
  };
  const onVoted = () => {
    if (voted.current) return;
    voted.current = true;
    setConfetti(true);
    setTimeout(() => setConfetti(false), 1600);
  };
  const play = () => {
    goBack();
    router.push((account ? '/daily/proof' : '/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof') as never);
  };

  const pill = challenge ? themeColor(challenge.special ? 'special' : challenge.theme?.key) : null;
  const canPlay = !!challenge?.isActive && !today?.myProof;
  const photoCount = items.length - 1;

  return (
    <View style={styles.wrap} onLayout={e => setHeight(e.nativeEvent.layout.height)} testID="daily-photos">
      {height > 0 && proofs !== null && (
        <FlatList
          ref={list}
          data={items}
          keyExtractor={(it, i) => (it.kind === 'photo' ? it.proof.id : `end-${i}`)}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          renderItem={({ item, index: i }) => item.kind === 'photo' ? (
            <Slide proof={item.proof} height={height} first={i === 0 && photoCount > 1} insetBottom={insets.bottom}
                   onProfile={openProfile} onVoted={onVoted}
                   onShare={challenge && item.proof.challengeId === challenge.id ? () => setShare(proofShare(item.proof, challenge)) : null}
                   onVoters={() => setVotersOf(item.proof.id)} />
          ) : (
            <End height={height} empty={photoCount === 0} tab={tab} cityName={cityName}
                 playLabel={canPlay ? (here?.name ? t('ctaAnswer', { city: shortCityName(here.name) }) : t('ctaAnswerNoCity')) : null}
                 onPlay={play} onClose={goBack} />
          )}
        />
      )}
      {(proofs === null || height === 0) && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          {failed ? (
            <View style={styles.centerBox}>
              <Text style={styles.endBody}>{t('loadFailed')}</Text>
              <Button label={t('place.retry')} onPress={load} />
            </View>
          ) : <ActivityIndicator color={colors.white} />}
        </View>
      )}

      {/* On top: close, World / my city, and today's challenge as a pill. */}
      <LinearGradient colors={SHADE_TOP} style={styles.shadeTop} pointerEvents="none" />
      <View style={[styles.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
        <View style={styles.head}>
          <IconButton icon="close" tone="onPhoto" onPress={goBack} label={t('back')} testID="photos-close" />
          <View style={styles.tabs}>
            <TabPill label={t('feed.world')} icon="earth" on={tab === 'world'} onPress={() => switchTab('world')} />
            {!!cityName && (
              <TabPill label={cityName} country={today?.city?.country ?? null} on={tab === 'city'} onPress={() => switchTab('city')} />
            )}
          </View>
          <View style={styles.headSide} />
        </View>
        {challenge && pill && (
          <TouchableOpacity style={[styles.pill, { backgroundColor: pill.fill }]} activeOpacity={0.85} accessibilityRole="button"
                            onPress={() => { track('daily_photos_challenge_opened', {}); router.push('/daily/today?source=photos' as never); }}>
            <Text style={[styles.pillText, { color: onFillOf(pill.fill) }]} numberOfLines={1}>
              {challenge.compare?.question ?? challenge.text}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={onFillOf(pill.fill)} />
          </TouchableOpacity>
        )}
      </View>

      <Confetti run={confetti} count={36} />
      <DailyVotersSheet proofId={votersOf} onClose={() => setVotersOf(null)}
                        onOpenUser={id => { setVotersOf(null); openProfile(id); }} />
      <ShareSheet content={share} source="photos" onClose={() => setShare(null)} />
      {/* A native full-screen modal: comments open in its own layer. */}
      <PhotoCommentsHost />
    </View>
  );
}

function TabPill({ label, icon, country, on, onPress }: {
  label: string; icon?: keyof typeof Ionicons.glyphMap; country?: string | null; on: boolean; onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={[styles.tab, on && styles.tabOn]} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      {icon ? <Ionicons name={icon} size={15} color={on ? TAB_ON_INK : colors.white} /> : <FlagSticker country={country} size={16} />}
      <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

/** One photo, full screen: the photo (blurred around it), its player and answer, the heart and Share. */
function Slide({ proof, height, first, insetBottom, onProfile, onVoted, onShare, onVoters }: {
  proof: DailyProof; height: number; first: boolean; insetBottom: number;
  onProfile: (id: string) => void; onVoted: () => void; onShare: (() => void) | null; onVoters: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  // The selfie inset sits below the feed's tabs.
  const insetTop = useSafeAreaInsets().top + 64;
  const { state, canVote, voteLabel, press } = useCastVote({
    proofId: proof.id, date: proof.date, cityName: proof.city?.name ?? null, cityId: proof.city?.id ?? null, source: 'photos',
  });
  const lastTap = useRef(0);
  const burst = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const name = proof.user.displayName || proof.user.username || '';
  const title = proof.spot?.name ?? proof.place?.name ?? null;

  const celebrate = () => {
    burst.setValue(0);
    Animated.timing(burst, { toValue: 1, duration: 750, useNativeDriver: true }).start();
    pop.setValue(0.6);
    Animated.spring(pop, { toValue: 1, friction: 3, useNativeDriver: true }).start();
  };
  const vote = async (withdraw: boolean) => {
    if (state?.isMine) { if (state.voteCount > 0) onVoters(); return; }
    const wasVoted = !!state?.myVote;
    if (!wasVoted) celebrate();
    const ok = await press({ withdraw });
    if (ok && !wasVoted) onVoted();
  };
  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (canVote && !state?.myVote) vote(false);
      else if (state?.myVote) celebrate();
      return;
    }
    lastTap.current = now;
  };

  return (
    <View style={{ height }}>
      <Photo thumb={proof.thumbUrl} full={proof.photoUrl} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
      <View style={[StyleSheet.absoluteFill, styles.blurShade]} />
      <Pressable style={StyleSheet.absoluteFill} onPress={onTap} accessibilityRole="image"
                 accessibilityLabel={[name, proof.city?.name, title].filter(Boolean).join(', ')} accessibilityHint={t('feed.doubleTap')}>
        <DualPhoto main={{ uri: proof.photoUrl, thumb: proof.thumbUrl }} selfie={selfieOf(proof)} style={StyleSheet.absoluteFill}
                   contentFit="contain" insetTop={insetTop} />
      </Pressable>
      <Animated.View pointerEvents="none" style={[styles.burst, {
        opacity: burst.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
        transform: [{ scale: burst.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.15, 1.35] }) }],
      }]}>
        <Ionicons name="heart" size={120} color={colors.primary} />
      </Animated.View>
      <LinearGradient colors={SHADE_BOTTOM} style={styles.shadeBottom} pointerEvents="none" />

      <View style={[styles.bottom, { paddingBottom: insetBottom + 18 }]} pointerEvents="box-none">
        <View style={styles.info} pointerEvents="box-none">
          <TouchableOpacity style={styles.who} onPress={() => onProfile(proof.user.id)} accessibilityRole="button" hitSlop={6}>
            <Avatar uri={proof.user.photoUrl} name={name} size={40} ring />
            <View style={styles.flex}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>{name}</Text>
                {proof.user.localPass && <LocalPassBadge onDark />}
              </View>
              {!!proof.city?.name && (
                <View style={styles.cityRow}>
                  <FlagSticker country={proof.city.country} size={16} />
                  <Text style={styles.city} numberOfLines={1}>{localizeCityName(proof.city.name)}</Text>
                  <ModeLabel mode={proof.isLocal ? 'local' : 'traveler'} label={proof.isLocal ? t('local') : t('traveler')} />
                </View>
              )}
            </View>
          </TouchableOpacity>
          {proof.answer && !proof.backHome && <AnswerChip answer={proof.answer} onDark />}
          {!!proof.caption && !captionRepeatsAnswer(proof.caption, proof.backHome ? null : proof.answer, i18n.language) && (
            <Text style={styles.caption} numberOfLines={3}>{proof.caption}</Text>
          )}
          {!!title && (
            <View style={styles.placeRow}>
              <Ionicons name="location" size={14} color={colors.white} />
              <Text style={styles.place} numberOfLines={1}>{title}</Text>
            </View>
          )}
          {first && (
            <View style={styles.hint}>
              <Ionicons name="chevron-up" size={16} color={colors.white} />
              <Text style={styles.hintText}>{t('feed.swipe')}</Text>
            </View>
          )}
        </View>

        {/* The actions column: the heart (with its count), the comments and Share. */}
        <View style={styles.actions}>
          {proof.status === 'approved' && (
            <TouchableOpacity onPress={() => vote(true)} accessibilityRole="button" testID="photos-vote"
                              disabled={!state || (!!state && !canVote && !state.isMine)}
                              accessibilityState={{ selected: !!state?.myVote }}
                              accessibilityLabel={state?.isMine ? t('vote.votersTitle') : state?.myVote ? t('vote.withdraw') : voteLabel}>
              <Animated.View style={[styles.heart, state?.myVote && styles.heartOn, { transform: [{ scale: pop }] }]}>
                <Ionicons name={state?.myVote || state?.isMine ? 'heart' : 'heart-outline'} size={30}
                          color={state?.myVote ? colors.white : colors.white} />
              </Animated.View>
              <Text style={styles.count}>{state?.voteCount ?? proof.voteCount}</Text>
            </TouchableOpacity>
          )}
          {proof.status === 'approved' && <CommentButton target={commentsTargetOf(proof)} variant="side" />}
          {onShare && (
            <TouchableOpacity onPress={onShare} accessibilityRole="button" accessibilityLabel={t('share.shareProof')}>
              <View style={styles.heart}><Ionicons name="paper-plane" size={24} color={colors.white} /></View>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

/** The last page: everyone seen (or nobody yet), then "Your turn" when I haven't played. */
function End({ height, empty, tab, cityName, playLabel, onPlay, onClose }: {
  height: number; empty: boolean; tab: Tab; cityName: string | null; playLabel: string | null; onPlay: () => void; onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const title = empty
    ? (tab === 'city' && cityName ? t('feed.emptyCity', { city: cityName }) : t('feed.emptyWorld'))
    : t('feed.endTitle');
  return (
    <View style={[styles.end, { height }]}>
      <Text style={styles.endEmoji}>{empty ? '📸' : '🎉'}</Text>
      <Text style={styles.endTitle}>{title}</Text>
      <Text style={styles.endBody}>{playLabel ? t('feed.endPlay') : t('feed.endBody')}</Text>
      <View style={styles.endActions}>
        {playLabel && <Button icon="camera-outline" label={playLabel} onPress={onPlay} />}
        <Button variant="secondary" label={t('feed.backToday')} onPress={onClose} />
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:        { flex: 1, backgroundColor: c.photoScrim },
  flex:        { flex: 1 },
  center:      { alignItems: 'center', justifyContent: 'center' },
  centerBox:   { alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  shadeTop:    { position: 'absolute', top: 0, left: 0, right: 0, height: 170 },
  shadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%' },
  blurShade:   { backgroundColor: c.photoBlurShade },
  top:         { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 10 },
  head:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headSide:    { width: 44 },
  tabs:        { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 8 },
  tab:         { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 160, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: c.photoControl },
  tabOn:       { backgroundColor: c.white },
  tabText:     { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '800', color: c.white },
  tabTextOn:   { color: TAB_ON_INK },
  pill:        { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '92%', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  pillText:    { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '800' },
  burst:       { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  bottom:      { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: 16 },
  info:        { flex: 1, gap: 8 },
  who:         { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name:        { flexShrink: 1, fontSize: FontSizes.lg, fontWeight: '800', color: c.white },
  cityRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  city:        { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.white },
  caption:     { fontSize: FontSizes.md, fontWeight: '500', color: c.white },
  placeRow:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  place:       { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.white },
  hint:        { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center', marginTop: 4 },
  hintText:    { fontSize: FontSizes.xs, fontWeight: '700', color: c.onCaramelMuted },
  actions:     { alignItems: 'center', gap: 18, paddingBottom: 6 },
  heart:       { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: c.photoControl },
  heartOn:     { backgroundColor: c.primary },
  count:       { marginTop: 4, textAlign: 'center', fontSize: FontSizes.sm, fontWeight: '800', color: c.white },
  end:         { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 10 },
  endEmoji:    { fontSize: 56 },
  endTitle:    { fontSize: FontSizes.xxl, fontWeight: '800', color: c.white, textAlign: 'center' },
  endBody:     { fontSize: FontSizes.md, fontWeight: '500', color: c.onCaramelMuted, textAlign: 'center' },
  endActions:  { alignSelf: 'stretch', gap: 6, marginTop: 14 },
});
