import type { ReactNode } from 'react';
import { Alert, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { canAccessProfile } from '@/lib/profileAccess';
import { formatSmartTime } from '@/lib/messageTime';
import { track } from '@/services/analytics';
import { dailyErrorCode, reportDailyProof, type DailyReportReason } from '@/api/daily';
import { ReactionPills } from '@/features/chat/ReactionPills';
import { DailyVoteButton } from './DailyVoteButton';
import { LocalPassBadge } from './LocalPassBadge';
import { EarlyBadge } from './EarlyBadge';
import { RankMedal } from './RankMedal';
import { CityFlag, CityName } from '@/ui';
import { useVoteState } from './votes';
import { OriginalToggle, useOriginal } from './OriginalToggle';
import { THEME_ICON } from '@/features/today/format';
import type { DailyPerson, DailyThemeKey, DailyTwist, Message } from '@/types';
import { themeName } from '@/features/daily/themes';

type TopProof = {
  rank: number; proofId: string; thumbUrl: string | null; user: DailyPerson;
  city: { id: number; name: string; country?: string | null } | null; isLocal: boolean; voteCount: number;
};
type ChallengePayload = {
  challengeId: string; date: string; text: string; context: string | null;
  twist: DailyTwist | null;
  yesterday?: { date: string; text: string } | null;   // World card only
  yesterdayTop3?: TopProof[];
  /** The founder's translations by locale (English is text/context/twist). */
  translations?: Record<string, { text?: string; context?: string; twist?: string }>;
  /** The user whose proposal became this challenge (V2-05). */
  proposedBy?: { user: DailyPerson; city: { id: number; name: string | null } | null } | null;
};
type ProofPayload = {
  proofId: string; challengeId: string; date: string; challengeText: string;
  user: DailyPerson; isLocal: boolean; city: { id: number; name: string; country?: string | null } | null;
  photoUrl: string; thumbUrl: string | null; caption: string | null;
  isEarly?: boolean;
  /** V3-09 (absent on older cards). */
  theme?: { key: DailyThemeKey; name: string } | null;
  spot?:  { id: string; name: string } | null;
};

const REPORT_REASONS: DailyReportReason[] = ['inappropriate', 'person_without_consent', 'dangerous', 'spam', 'other'];

interface Props {
  message:      Message;
  isLive:       boolean;   // city channel of a live city (shows the twist)
  onLongPress?: (msg: Message) => void;
  onReact?:     (msg: Message, emoji: string) => void;
}

/**
 * Daily Challenge cards in World and city chats (system messages):
 *   daily_challenge - the day's challenge (+ the Local Twist in live cities;
 *                     yesterday's top 3 on the World card)
 *   daily_proof_group - flood control (V2-08): the hour's extra proofs in one card
 *                     (photo strip, count, cities), opening a gallery of exactly those
 *   daily_proof     - an approved proof: photo, author with Local/Traveler, city,
 *                     caption, live vote count / my vote / local badge (votes store)
 * Tap opens the challenge sheet; long-press opens the usual action sheet
 * (react, reply); reactions show under the card like on any message.
 */
export function DailyChannelCard({ message, isLive, onLongPress, onReact }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { city } = useApp();
  const [showOriginal, toggleOriginal] = useOriginal();
  const time = message.createdAt ? formatSmartTime(message.createdAt) : null;
  const longPress = onLongPress ? () => onLongPress(message) : undefined;
  const reactions = message.reactions && message.reactions.length > 0 && onReact
    ? <ReactionPills reactions={message.reactions} onReact={e => onReact(message, e)} isMine={false} />
    : null;

  if (message.event === 'daily_challenge') {
    const p = (message.payload ?? {}) as Partial<ChallengePayload>;
    if (!p.date || !p.text) return null;
    const tr = showOriginal ? undefined : p.translations?.[i18n.language];
    const translated = !!p.translations?.[i18n.language];
    const open = () => {
      track('daily_challenge_viewed', { source: 'channel_card', challenge_date: p.date ?? null, city: city?.name ?? null });
      router.push(`/daily/${p.date}` as never);
    };
    return (
      <View style={styles.wrap}>
        <TouchableOpacity style={[styles.card, styles.challengeCard]} onPress={open} onLongPress={longPress} activeOpacity={0.85} accessibilityRole="button">
          <View style={styles.kickerRow}>
            <Ionicons name="flame-outline" size={16} color={colors.primaryText} />
            <Text style={styles.kicker}>{t('kicker')}</Text>
          </View>
          <Text style={styles.challengeText}>{tr?.text ?? p.text}</Text>
          {!!p.context && <Text style={styles.context} numberOfLines={3}>{tr?.context ?? p.context}</Text>}
          <OriginalToggle translated={translated} showingOriginal={showOriginal} onPress={toggleOriginal} />
          {p.proposedBy && <ProposedBy credit={p.proposedBy} />}
          {isLive && p.twist && (
            <View style={styles.twist}>
              <View style={styles.twistHead}>
                <CityFlag country={city?.country} />
                <Text style={styles.twistLabel}>{t('twistIn', { city: localizeCityName(city?.name ?? '') })}</Text>
              </View>
              <Text style={styles.twistText}>{tr?.twist ?? p.twist.text}</Text>
            </View>
          )}
          <View style={styles.cta}><Text style={styles.ctaText}>{t('cta')}</Text></View>
          {p.yesterday && p.yesterdayTop3 && p.yesterdayTop3.length > 0 && (
            <View style={styles.top3}>
              <View style={styles.top3Head}>
                <Ionicons name="trophy-outline" size={14} color={colors.muted} />
                <Text style={styles.top3Title}>{t('results.yesterdayTop3')}</Text>
              </View>
              {p.yesterdayTop3.map(r => (
                <TouchableOpacity key={r.proofId} style={styles.topRow} onPress={() => router.push(`/daily/${p.yesterday!.date}?proof=${r.proofId}` as never)} accessibilityRole="button">
                  <RankMedal rank={r.rank} size={24} />
                  {r.thumbUrl ? <Image source={{ uri: r.thumbUrl }} style={styles.topThumb} contentFit="cover" /> : <View style={[styles.topThumb, styles.avatarEmpty]} />}
                  <View style={styles.topWho}>
                    <Text style={styles.topName} numberOfLines={1}>{r.user.displayName || r.user.username}</Text>
                    {r.city && <CityName name={r.city.name} country={r.city.country} short style={styles.sub} size={14} />}
                  </View>
                  <View style={styles.topVotesRow}>
                    <Ionicons name="heart" size={12} color={colors.muted} />
                    <Text style={styles.topVotes}>{r.voteCount}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </TouchableOpacity>
        {reactions}
        {time && <Text style={styles.time}>{time}</Text>}
      </View>
    );
  }

  if (message.event === 'daily_proof_group') {
    return <GroupCard message={message} reactions={reactions} time={time} longPress={longPress} />;
  }

  return <ProofCard message={message} reactions={reactions} time={time} longPress={longPress} />;
}

type GroupPayload = {
  hour: string; proofIds: string[]; count: number; cities: string[];
  countries?: (string | null)[];   // same order as cities
  proofs: { proofId: string; date: string; thumbUrl: string | null; city: { id: number; name: string } | null }[];
};

/** The hour's extra proofs of a busy channel (V2-08): a photo strip, the count and cities; opens their gallery. */
function GroupCard({ message, reactions, time, longPress }: {
  message: Message; reactions: ReactNode; time: string | null; longPress?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const p = (message.payload ?? {}) as Partial<GroupPayload>;
  if (!p.proofIds?.length || !p.proofs?.length) return null;
  const count  = p.count ?? p.proofIds.length;
  const cities = (p.cities ?? []).map(c => localizeCityName(c));
  // Same rule as the server's fallback line: two cities, then "and N more" proofs.
  const named  = cities.slice(0, 2);
  const more   = count - named.length;
  const where  = named.length === 0 ? '' : more > 0 ? t('group.citiesMore', { cities: named.join(', '), n: more }) : named.join(', ');
  const shown  = p.proofs.slice(0, 4);
  const open = () => router.push(`/daily/gallery?ids=${p.proofIds!.join(',')}&date=${p.proofs![0].date}` as never);
  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.card} onPress={open} onLongPress={longPress} activeOpacity={0.9} accessibilityRole="button"
        accessibilityLabel={`${t('group.title', { n: count })}. ${where}`}>
        <View style={styles.kickerRow}>
          <Ionicons name="images-outline" size={15} color={colors.primaryText} />
          <Text style={styles.kicker}>{t('group.title', { n: count })}</Text>
        </View>
        {!!where && (
          <View style={styles.whereRow}>
            {(p.countries ?? []).slice(0, named.length).map((cc, i) => <CityFlag key={i} country={cc} size={14} />)}
            <Text style={[styles.sub, styles.flexShrink]} numberOfLines={1}>{where}</Text>
          </View>
        )}
        <View style={styles.strip}>
          {shown.map((e, i) => (
            <View key={e.proofId} style={styles.stripCell}>
              {e.thumbUrl ? <Image source={{ uri: e.thumbUrl }} style={styles.stripPhoto} contentFit="cover" transition={150} /> : <View style={styles.stripPhoto} />}
              {i === shown.length - 1 && count > shown.length && (
                <View style={styles.stripMore}><Text style={styles.stripMoreText}>+{count - shown.length + 1}</Text></View>
              )}
            </View>
          ))}
        </View>
      </TouchableOpacity>
      {reactions}
      {time && <Text style={styles.time}>{time}</Text>}
    </View>
  );
}

/** "Proposed by <name> · <city>" (V2-05); the name opens the author's profile. ink: in the text colour (Today's card keeps orange for its button only). */
export function ProposedBy({ credit, ink = false }: { credit: NonNullable<ChallengePayload['proposedBy']>; ink?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account } = useApp();
  const name = credit.user.displayName || credit.user.username || '';
  const open = () => {
    if (!canAccessProfile(account)) { router.push('/auth-gate?reason=view_profile' as never); return; }
    router.push(`/user/${credit.user.id}` as never);
  };
  return (
    <TouchableOpacity onPress={open} hitSlop={{ top: 14, bottom: 14, left: 6, right: 6 }} accessibilityRole="button" style={styles.proposedBy}>
      <Ionicons name="bulb-outline" size={14} color={ink ? colors.text : colors.primaryText} />
      <Text style={[styles.proposedByText, ink && { color: colors.text }]} numberOfLines={1}>
        {credit.city?.name
          ? t('propose.proposedByCity', { name, city: localizeCityName(credit.city.name) })
          : t('propose.proposedBy', { name })}
      </Text>
    </TouchableOpacity>
  );
}

function ProofCard({ message, reactions, time, longPress }: {
  message: Message; reactions: ReactNode; time: string | null; longPress?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const p = (message.payload ?? {}) as Partial<ProofPayload>;
  const vote = useVoteState(p.proofId, account ? null : identity?.guestId ?? null);
  if (!p.date || !p.proofId || !p.photoUrl) return null;
  const name = p.user?.displayName || p.user?.username || message.nickname || '';
  const open = () => router.push(`/daily/${p.date}?proof=${p.proofId}` as never);
  const openAuthor = () => {
    if (!p.user?.id) return;
    if (!canAccessProfile(account)) { router.push('/auth-gate?reason=view_profile' as never); return; }
    router.push(`/user/${p.user.id}` as never);
  };
  const report = () => {
    Alert.alert(t('report.title'), t('report.body'), [
      ...REPORT_REASONS.map(r => ({
        text: t(`report.reasons.${r}`),
        onPress: () => {
          reportDailyProof(p.proofId!, r, account ? null : identity?.guestId)
            .then(() => Alert.alert(t('report.thanks')))
            .catch(err => Alert.alert(dailyErrorCode(err) === 'already_reported' ? t('report.already') : t('errors.generic')));
        },
      })),
      { text: t('cancel'), style: 'cancel' as const },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.card} onPress={open} onLongPress={longPress} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel={`${name}: ${p.caption ?? p.challengeText ?? ''}`}>
        <View style={styles.authorRow}>
          <TouchableOpacity style={styles.author} onPress={openAuthor} accessibilityRole="button">
            {p.user?.photoUrl
              ? <Image source={{ uri: p.user.photoUrl }} style={styles.avatar} />
              : <View style={[styles.avatar, styles.avatarEmpty]}><Text style={styles.avatarLetter}>{name.slice(0, 1).toUpperCase()}</Text></View>}
            <View style={styles.flex}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>{name}</Text>
                <View style={[styles.modeChip, p.isLocal ? styles.modeLocal : styles.modeTraveler]}>
                  <Text style={[styles.modeText, p.isLocal ? styles.modeLocalText : styles.modeTravelerText]}>{p.isLocal ? t('local') : t('traveler')}</Text>
                </View>
                {p.user?.localPass && <LocalPassBadge />}
              </View>
              {!!p.city && <CityName name={p.city.name} country={p.city.country} style={styles.sub} size={14} />}
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.more} onPress={report} accessibilityRole="button" accessibilityLabel={t('report.title')}>
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} />
          </TouchableOpacity>
        </View>
        <Image source={{ uri: p.thumbUrl ?? p.photoUrl }} style={styles.photo} contentFit="cover" transition={150} />
        {!!p.caption && <Text style={styles.caption}>{p.caption}</Text>}
        {!!p.spot && (
          <TouchableOpacity style={styles.spot} onPress={() => router.push(`/(tabs)/map?spot=${p.spot!.id}&source=chat` as never)} accessibilityRole="button" hitSlop={{ top: 13, bottom: 13, left: 6, right: 6 }}>
            <Ionicons name="location-outline" size={14} color={colors.primaryText} />
            <Text style={styles.spotText} numberOfLines={1}>{p.spot.name}</Text>
          </TouchableOpacity>
        )}
        <View style={styles.voteRow}>
          {p.theme ? (
            <View style={styles.themeChip}>
              <Ionicons name={THEME_ICON[p.theme.key] ?? 'pricetag-outline'} size={13} color={colors.primaryOnTint} />
              <Text style={styles.themeText}>{themeName(p.theme.key)}</Text>
            </View>
          ) : <View />}
          <View style={styles.voteRight}>
            {vote?.validatedByLocal && <Ionicons name="checkmark-circle" size={18} color={colors.localText} accessibilityLabel={t('validatedByLocal')} />}
            {p.isEarly && <EarlyBadge />}
            <DailyVoteButton proofId={p.proofId} date={p.date} cityName={p.city?.name ?? null} />
          </View>
        </View>
        <Text style={styles.proofOf} numberOfLines={1}>{t('kicker')} · {p.challengeText}</Text>
      </TouchableOpacity>
      {reactions}
      {time && <Text style={styles.time}>{time}</Text>}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:          { paddingHorizontal: 12, marginVertical: 6, alignItems: 'stretch' },
  flex:          { flex: 1 },
  card:          { backgroundColor: c.bg2, borderRadius: 20, borderWidth: 1.5, borderColor: c.line, padding: 12, gap: 8 },
  challengeCard: { borderColor: c.ticketLine },
  kickerRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kicker:        { fontSize: FontSizes.xs, fontWeight: '700', color: c.primaryText },
  challengeText: { fontSize: FontSizes.md, fontWeight: '800', color: c.text, lineHeight: 22 },
  context:       { fontSize: FontSizes.xs, color: c.muted },
  twist:         { backgroundColor: c.bg3, borderRadius: Radius.md, padding: 8, gap: 2 },
  twistHead:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  twistLabel:    { fontSize: 12, fontWeight: '700', color: c.muted },
  twistText:     { fontSize: FontSizes.sm, color: c.text },
  cta:           { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', backgroundColor: c.primary, borderRadius: 14, paddingHorizontal: 16 },
  ctaText:       { color: c.white, fontSize: FontSizes.sm, fontWeight: '700' },
  authorRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  author:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar:        { width: 30, height: 30, borderRadius: 15 },
  avatarEmpty:   { backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' },
  avatarLetter:  { fontSize: FontSizes.xs, fontWeight: '800', color: c.text },
  nameRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name:          { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  sub:           { fontSize: 11, color: c.muted },
  photo:         { width: '100%', aspectRatio: 4 / 3, borderRadius: 14, backgroundColor: c.bg3 },
  modeChip:      { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  modeLocal:     { backgroundColor: c.primaryTint },
  modeTraveler:  { backgroundColor: c.travelerBg },
  modeText:      { fontSize: 12, fontWeight: '700' },
  modeLocalText: { color: c.primaryOnTint },
  modeTravelerText: { color: c.travelerText },
  spot:          { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4 },
  spotText:      { fontSize: FontSizes.xs, fontWeight: '700', color: c.primaryText },
  themeChip:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 3, borderRadius: Radius.full, backgroundColor: c.primaryTint },
  themeText:     { fontSize: 12, fontWeight: '700', color: c.primaryOnTint },
  voteRight:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  caption:       { fontSize: FontSizes.sm, color: c.text },
  proofOf:       { fontSize: 11, color: c.muted },
  time:          { fontSize: 11, color: c.muted, marginTop: 4, alignSelf: 'flex-start' },
  voteRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  badge:         { flexShrink: 1, fontSize: 12, fontWeight: '700', color: c.green },
  strip:         { flexDirection: 'row', gap: 6 },
  stripCell:     { flex: 1, aspectRatio: 1 },
  stripPhoto:    { width: '100%', height: '100%', borderRadius: Radius.md, backgroundColor: c.bg3 },
  stripMore:     { ...StyleSheet.absoluteFillObject, borderRadius: Radius.md, backgroundColor: c.scrim, alignItems: 'center', justifyContent: 'center' },
  stripMoreText: { color: c.white, fontSize: FontSizes.md, fontWeight: '900' },
  proposedBy:    { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4 },
  proposedByText:{ flexShrink: 1, fontSize: 12, fontWeight: '700', color: c.primaryText },
  top3:          { borderTopWidth: 1, borderTopColor: c.line, paddingTop: 8, gap: 6 },
  top3Head:      { flexDirection: 'row', alignItems: 'center', gap: 5 },
  topVotesRow:   { flexDirection: 'row', alignItems: 'center', gap: 3 },
  more:          { width: 44, height: 44, marginRight: -10, marginTop: -10, alignItems: 'center', justifyContent: 'center' },
  top3Title:     { fontSize: 11, fontWeight: '800', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  topRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topThumb:      { width: 32, height: 32, borderRadius: Radius.sm, backgroundColor: c.bg3 },
  topWho:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  topName:       { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  whereRow:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flexShrink:    { flexShrink: 1 },
  topVotes:      { fontSize: FontSizes.xs, fontWeight: '700', color: c.muted },
});
