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
import { MEDALS } from './DailyProofTile';
import { useVoteState } from './votes';
import { OriginalToggle, useOriginal } from './OriginalToggle';
import type { DailyPerson, DailyTwist, Message } from '@/types';

type TopProof = {
  rank: number; proofId: string; thumbUrl: string | null; user: DailyPerson;
  city: { id: number; name: string } | null; isLocal: boolean; voteCount: number;
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
  user: DailyPerson; isLocal: boolean; city: { id: number; name: string } | null;
  photoUrl: string; thumbUrl: string | null; caption: string | null;
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
 *   daily_proof     - an approved proof: photo, author with Local/Traveler, city,
 *                     caption, live vote count / my vote / local badge (votes store)
 * Tap opens the challenge sheet; long-press opens the usual action sheet
 * (react, reply); reactions show under the card like on any message.
 */
export function DailyChannelCard({ message, isLive, onLongPress, onReact }: Props) {
  const styles = useThemedStyles(makeStyles);
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
          <Text style={styles.kicker}>🔥 {t('kicker')}</Text>
          <Text style={styles.challengeText}>{tr?.text ?? p.text}</Text>
          {!!p.context && <Text style={styles.context} numberOfLines={3}>{tr?.context ?? p.context}</Text>}
          <OriginalToggle translated={translated} showingOriginal={showOriginal} onPress={toggleOriginal} />
          {p.proposedBy && <ProposedBy credit={p.proposedBy} />}
          {isLive && p.twist && (
            <View style={styles.twist}>
              <Text style={styles.twistLabel}>📍 {t('twistIn', { city: localizeCityName(city?.name ?? '') })}</Text>
              <Text style={styles.twistText}>{tr?.twist ?? p.twist.text}</Text>
            </View>
          )}
          <View style={styles.cta}><Text style={styles.ctaText}>{t('cta')}</Text></View>
          {p.yesterday && p.yesterdayTop3 && p.yesterdayTop3.length > 0 && (
            <View style={styles.top3}>
              <Text style={styles.top3Title}>🏆 {t('results.yesterdayTop3')}</Text>
              {p.yesterdayTop3.map(r => (
                <TouchableOpacity key={r.proofId} style={styles.topRow} onPress={() => router.push(`/daily/${p.yesterday!.date}?proof=${r.proofId}` as never)} accessibilityRole="button">
                  <Text style={styles.topMedal}>{MEDALS[r.rank - 1] ?? `${r.rank}`}</Text>
                  {r.thumbUrl ? <Image source={{ uri: r.thumbUrl }} style={styles.topThumb} contentFit="cover" /> : <View style={[styles.topThumb, styles.avatarEmpty]} />}
                  <Text style={styles.topName} numberOfLines={1}>
                    {r.user.displayName || r.user.username}
                    {r.city ? <Text style={styles.sub}> · {localizeCityName(r.city.name)}</Text> : null}
                  </Text>
                  <Text style={styles.topVotes}>♥ {r.voteCount}</Text>
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

  return <ProofCard message={message} reactions={reactions} time={time} longPress={longPress} />;
}

/** "Proposed by <name> · <city>" (V2-05); the name opens the author's profile. */
export function ProposedBy({ credit }: { credit: NonNullable<ChallengePayload['proposedBy']> }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account } = useApp();
  const name = credit.user.displayName || credit.user.username || '';
  const open = () => {
    if (!canAccessProfile(account)) { router.push('/auth-gate?reason=view_profile' as never); return; }
    router.push(`/user/${credit.user.id}` as never);
  };
  return (
    <TouchableOpacity onPress={open} hitSlop={6} accessibilityRole="button" style={styles.proposedBy}>
      <Text style={styles.proposedByText} numberOfLines={1}>
        💡 {credit.city?.name
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
                {p.user?.localPass && <LocalPassBadge />}
              </View>
              <Text style={styles.sub} numberOfLines={1}>
                {p.isLocal ? `🌍 ${t('local')}` : `🧭 ${t('traveler')}`}
                {p.city ? ` · ${localizeCityName(p.city.name)}` : ''}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={report} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('report.title')}>
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} />
          </TouchableOpacity>
        </View>
        <Image source={{ uri: p.thumbUrl ?? p.photoUrl }} style={styles.photo} contentFit="cover" transition={150} />
        {!!p.caption && <Text style={styles.caption}>{p.caption}</Text>}
        <View style={styles.voteRow}>
          <DailyVoteButton proofId={p.proofId} date={p.date} cityName={p.city?.name ?? null} />
          {vote?.validatedByLocal && <Text style={styles.badge} numberOfLines={1}>✓ {t('validatedByLocal')}</Text>}
        </View>
        <Text style={styles.proofOf} numberOfLines={1}>🔥 {t('kicker')} · {p.challengeText}</Text>
      </TouchableOpacity>
      {reactions}
      {time && <Text style={styles.time}>{time}</Text>}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:          { paddingHorizontal: 12, marginVertical: 6, alignItems: 'stretch' },
  flex:          { flex: 1 },
  card:          { backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: 12, gap: 8 },
  challengeCard: { borderColor: 'rgba(255,122,60,0.45)' },
  kicker:        { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: c.accentText },
  challengeText: { fontSize: FontSizes.md, fontWeight: '800', color: c.text, lineHeight: 22 },
  context:       { fontSize: FontSizes.xs, color: c.muted },
  twist:         { backgroundColor: c.bg3, borderRadius: Radius.md, padding: 8, gap: 2 },
  twistLabel:    { fontSize: 11, fontWeight: '800', color: c.accentText, textTransform: 'uppercase', letterSpacing: 0.4 },
  twistText:     { fontSize: FontSizes.sm, color: c.text },
  cta:           { alignSelf: 'flex-start', backgroundColor: c.accent, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8 },
  ctaText:       { color: c.white, fontSize: FontSizes.xs, fontWeight: '800' },
  authorRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  author:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar:        { width: 30, height: 30, borderRadius: 15 },
  avatarEmpty:   { backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' },
  avatarLetter:  { fontSize: FontSizes.xs, fontWeight: '800', color: c.text },
  nameRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name:          { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  sub:           { fontSize: 11, color: c.muted },
  photo:         { width: '100%', aspectRatio: 4 / 3, borderRadius: Radius.md, backgroundColor: c.bg3 },
  caption:       { fontSize: FontSizes.sm, color: c.text },
  proofOf:       { fontSize: 11, color: c.muted },
  time:          { fontSize: 11, color: c.muted, marginTop: 4, alignSelf: 'flex-start' },
  voteRow:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge:         { flexShrink: 1, fontSize: 12, fontWeight: '700', color: c.green },
  proposedBy:    { alignSelf: 'flex-start' },
  proposedByText:{ fontSize: 12, fontWeight: '700', color: c.accentText },
  top3:          { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8, gap: 6 },
  top3Title:     { fontSize: 11, fontWeight: '800', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  topRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topMedal:      { fontSize: 18, width: 24 },
  topThumb:      { width: 32, height: 32, borderRadius: Radius.sm, backgroundColor: c.bg3 },
  topName:       { flex: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  topVotes:      { fontSize: FontSizes.xs, fontWeight: '700', color: c.muted },
});
