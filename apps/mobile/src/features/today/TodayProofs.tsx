import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { useScope } from '@/context/ScopeContext';
import { localizeCityName, shortCityName } from '@/i18n/cityName';
import { fetchDailyTodayProofs } from '@/api/daily';
import { ShareSheet } from '@/features/share/ShareSheet';
import { representShare, type ShareContent } from '@/features/share/content';
import { seedProofs, useVoteState } from '@/features/daily/votes';
import { DailyVoteButton } from '@/features/daily/DailyVoteButton';
import { track } from '@/services/analytics';
import { RankMedal } from '@/features/daily/RankMedal';
import { DailyStatusChip } from '@/features/daily/DailyStatusChip';
import { answerText } from '@/features/compare/format';
import type { DailyToday, DailyTodayProofs } from '@/types';
import { Card, CityName, Photo, SectionTitle } from '@/ui';
import { PickPill } from '@/features/map/PickBadge';

type StripProof = DailyTodayProofs['proofs'][number];

/** Votes per user and day (DailyVotes::MAX). */

/**
 * Today's proofs (SPEC 9.3) and Today around the world (V4 votes).
 * City scope: "Today in Saigon" (the city's approved proofs, most voted first),
 * then, once 2 countries answered, "Today around the world": one card per city
 * with its most voted answer, the cities with the most answers first. World
 * scope: "Today around the world" is the main strip (all of World's proofs
 * before 2 countries). Under each title, while voting is open: "Who gets your
 * 3 votes today?" with my votes left; each card has its vote button ("Vote
 * for Lisbon"); under the strips, what the votes do. Hidden when nobody posted.
 */
export function TodayProofs({ today, refreshKey }: { today: DailyToday | null; refreshKey: number }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const { scope } = useScope();
  const guestId = account ? null : identity?.guestId ?? null;
  const [strip, setStrip] = useState<DailyTodayProofs | null>(null);
  const [cities, setCities] = useState<DailyTodayProofs | null>(null);
  const [invite, setInvite] = useState<ShareContent | null>(null);
  const date = today?.challenge?.date ?? null;
  const cityId = scope === 'city' ? today?.city?.id ?? null : null;

  const load = useCallback(async () => {
    if (!date) { setStrip(null); setCities(null); return; }
    try {
      const [next, around] = await Promise.all([
        fetchDailyTodayProofs({ scope: cityId ? 'city' : 'world', cityId, guestId }),
        fetchDailyTodayProofs({ scope: 'cities', guestId }),
      ]);
      seedProofs([...next.proofs, ...around.proofs], true);
      setStrip(next);
      setCities(around);
    } catch { /* keep what we have */ }
  }, [date, cityId, guestId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // My own proof in review leads the strip, with its badge (only mine: others' never show before approval).
  const mine = today?.myProof && today.myProof.status === 'pending'
    && (strip?.scope === 'world' || today.myProof.city?.id === strip?.city?.id) ? today.myProof : null;
  // Players' photos first, then the Hilads suggestions (badge only, never voted on or counted).
  const items: StripProof[] = playersFirst([
    ...(mine && !strip?.proofs.some(p => p.id === mine.id) ? [{ ...mine, rank: null }] : []),
    ...(strip?.proofs ?? []),
  ]);
  const around = cities && cities.countries >= 2 && cities.proofs.length > 0 ? cities : null;
  const cityStrip = strip?.scope === 'city' && items.length > 0 ? strip : null;
  // World's strip only while fewer than 2 countries answered (else Today around the world).
  const worldStrip = !cityStrip && !around && strip && items.length > 0 ? strip : null;
  if (!cityStrip && !around && !worldStrip) return null;

  const voting = !!today?.challenge?.isActive;
  // Represent your city (SPEC 9.16), World scope: "12 cities are on today's board. Saigon isn't yet."
  // Never a zero count; my own pending proof counts for me.
  const presence = scope === 'world' ? today?.here?.presence ?? null : null;
  const myCity = today?.here?.name ? shortCityName(today.here.name) : null;
  const boardLine = !!presence && !presence.represented && presence.citiesToday > 0 && !!myCity && voting;
  const board = boardLine ? (
    <View style={styles.board}>
      <Text style={styles.boardText}>{t('represent.board', { count: presence!.citiesToday, city: myCity })}</Text>
      <TouchableOpacity onPress={() => setInvite(representShare(today!.challenge!, today!.here!))} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.boardLink}>{t('represent.invite')}</Text>
      </TouchableOpacity>
    </View>
  ) : null;
  const open = (path: string) => () => router.push(path as never);
  const openProof = (p: StripProof) => router.push(`/daily/today?proof=${p.id}` as never);

  return (
    <View style={styles.wrap}>
      {cityStrip && (
        <Strip title={t('today.inCity', { city: shortCityName(cityStrip.city?.name ?? '') })} stats={cityStrip.total > 0 ? t('today.proofs', { count: cityStrip.total }) : null}
               onOpen={open('/daily/today?tab=city&source=today_strip')} items={items} guestId={guestId} voting={voting}
               source="strip_city" onProof={openProof} footer={!around && voting} />
      )}
      {(around || worldStrip) && (
        <Strip title={t('today.aroundWorld')}
               stats={(around ?? worldStrip)!.total > 0
                 ? t('today.proofsIn', { proofs: t('today.proofs', { count: (around ?? worldStrip)!.total }),
                                         countries: t('today.countries', { count: (around ?? worldStrip)!.countries }) })
                 : null}
               onOpen={around ? open('/daily/today?tab=compare&source=world_strip') : open('/daily/today?tab=world&source=today_strip')}
               items={around ? playersFirst(around.proofs) : items} guestId={guestId} voting={voting} source="strip_world"
               onProof={openProof} footer={voting} board={board} />
      )}
      <ShareSheet content={invite} source="represent_world_strip" onClose={() => setInvite(null)} />
    </View>
  );
}

/**
 * One strip: its title and "See all" (the sheet), the vote prompt while voting
 * is open ("Who gets your 3 votes today?", my votes left, or "All your votes
 * are in"), the cards with their vote button, and what the votes do (footer).
 */
function Strip({ title, stats, onOpen, items, guestId, voting, source, onProof, footer, board = null }: {
  title: string; stats: string | null; onOpen: () => void; items: StripProof[]; guestId: string | null; voting: boolean;
  source: 'strip_city' | 'strip_world'; onProof: (p: StripProof) => void; footer: boolean; board?: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const { account } = useApp();
  const prompted = useRef(false);
  // Nothing to vote on when the strip only holds Hilads suggestions: no prompt, no note.
  const votable = voting && items.some(p => !p.suggestion);
  useEffect(() => {
    if (!votable || prompted.current) return;
    prompted.current = true;
    track('vote_prompt_shown', { source, guest: !account });
  }, [votable]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card style={styles.card}>
      {/* The title and "See all" open the challenge sheet on the strip's tab. */}
      <SectionTitle small title={title} onPress={onOpen} action={{ label: t('today.seeAll'), onPress: onOpen }} />
      {!!stats && <Text style={styles.stats}>{stats}</Text>}
      {/* No vote limit: one vote per answer, as many answers as I like. */}
      {votable && (
        <View style={styles.prompt}>
          <Text style={styles.promptText}>{t('vote.prompt')}</Text>
        </View>
      )}
      {board}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map(p => (
          <StripItem key={p.id} proof={p} guestId={guestId} source={source} onPress={() => onProof(p)} />
        ))}
      </ScrollView>
      {footer && votable && <Text style={styles.footer}>{t('vote.tourNote')}</Text>}
    </Card>
  );
}

/**
 * One card, the same structure everywhere: the photo, then a fixed-height
 * info block: the flag and city on one line, the answer (else the place or
 * the caption) on 2 reserved lines, then the vote button pinned to the
 * bottom, so buttons line up whatever the text. A Hilads pick has the
 * "★ Hilads" pill on its photo and no vote button.
 */
function StripItem({ proof, guestId, source, onPress }: { proof: StripProof; guestId: string | null; source: string; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  const state = useVoteState(proof.id, guestId);
  const city = proof.city?.name ? localizeCityName(proof.city.name) : '';
  const votes = proof.suggestion ? null : t('today.votes', { count: state?.voteCount ?? proof.voteCount });
  const title = proof.answer ? answerText(proof.answer, i18n.language) : proof.spot?.name ?? proof.place?.name ?? proof.caption ?? '';
  return (
    <TouchableOpacity style={styles.item} onPress={onPress} accessibilityRole="button"
                      accessibilityLabel={[proof.rank ? `#${proof.rank}` : null, city, title, votes].filter(Boolean).join(', ')}>
      <View style={styles.photo}>
        <Photo thumb={proof.thumbUrl} full={proof.photoUrl} style={StyleSheet.absoluteFill} contentFit="cover" />
        {proof.rank !== null && <RankMedal rank={proof.rank} size={24} style={styles.rank} />}
        {proof.status === 'pending' && <View style={styles.pending}><DailyStatusChip status="pending" /></View>}
        {proof.suggestion && <PickPill />}
      </View>
      <View style={styles.info}>
        <View style={styles.cityRow}>
          {!!proof.city?.name && <CityName name={proof.city.name} country={proof.city.country} short style={styles.city} />}
        </View>
        <Text style={styles.answer} numberOfLines={2}>{title}</Text>
        <View style={styles.bottom}>
          {!proof.suggestion && proof.status === 'approved' && (
            <DailyVoteButton proofId={proof.id} date={proof.date} cityName={proof.city?.name ?? null} cityId={proof.city?.id ?? null}
                             source={source} variant="strip" />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

/** Players' photos first, the Hilads suggestions after (stable). */
function playersFirst<T extends { suggestion?: boolean }>(list: T[]): T[] {
  return [...list.filter(p => !p.suggestion), ...list.filter(p => p.suggestion)];
}

const CARD_W = 112;
const INFO_H = 108;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:  { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  stats: { fontSize: 13, fontWeight: '500', color: c.muted, marginTop: -4 },
  row:   { gap: 10 },
  item:  { width: CARD_W },
  photo: { width: CARD_W, height: 140, borderRadius: 14, overflow: 'hidden', backgroundColor: c.bg3 },
  // Fixed height: city line (18) + 2 answer lines (2 x 17) + the bottom row (the vote button, 2 lines at most, or the badge).
  info:  { height: INFO_H, paddingTop: 6 },
  cityRow: { height: 18, flexDirection: 'row', alignItems: 'center' },
  rank:  { position: 'absolute', top: 6, left: 6, borderWidth: 2, borderColor: c.bg2 },
  city:  { fontSize: 13, fontWeight: '700', color: c.text, maxWidth: '100%' },
  answer: { height: 34, fontSize: 13, lineHeight: 17, fontWeight: '800', color: c.text },
  bottom: { marginTop: 'auto', alignItems: 'stretch' },
  pending: { position: 'absolute', left: 6, bottom: 6 },
  wrap:  { gap: 12 },
  prompt: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  promptText: { fontSize: 14, fontWeight: '700', color: c.text },
  footer: { fontSize: 12, lineHeight: 17, fontWeight: '500', color: c.muted },
  board: { gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: c.primaryTint },
  boardText: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: c.primaryOnTint },
  boardLink: { fontSize: 13, fontWeight: '700', color: c.text, textDecorationLine: 'underline' },
});
