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
import type { DailyPerson, DailyTwist, Message } from '@/types';

type ChallengePayload = {
  challengeId: string; date: string; text: string; context: string | null;
  twist: DailyTwist | null;
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
 *   daily_challenge - the day's challenge (+ the Local Twist in live cities)
 *   daily_proof     - an approved proof: photo, author with Local/Traveler, city, caption
 * Tap opens the challenge sheet; long-press opens the usual action sheet
 * (react, reply); reactions show under the card like on any message.
 */
export function DailyChannelCard({ message, isLive, onLongPress, onReact }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, city, identity } = useApp();
  const time = message.createdAt ? formatSmartTime(message.createdAt) : null;
  const longPress = onLongPress ? () => onLongPress(message) : undefined;
  const reactions = message.reactions && message.reactions.length > 0 && onReact
    ? <ReactionPills reactions={message.reactions} onReact={e => onReact(message, e)} isMine={false} />
    : null;

  if (message.event === 'daily_challenge') {
    const p = (message.payload ?? {}) as Partial<ChallengePayload>;
    if (!p.date || !p.text) return null;
    const open = () => {
      track('daily_challenge_viewed', { source: 'channel_card', challenge_date: p.date ?? null, city: city?.name ?? null });
      router.push(`/daily/${p.date}` as never);
    };
    return (
      <View style={styles.wrap}>
        <TouchableOpacity style={[styles.card, styles.challengeCard]} onPress={open} onLongPress={longPress} activeOpacity={0.85} accessibilityRole="button">
          <Text style={styles.kicker}>🔥 {t('kicker')}</Text>
          <Text style={styles.challengeText}>{p.text}</Text>
          {!!p.context && <Text style={styles.context} numberOfLines={3}>{p.context}</Text>}
          {isLive && p.twist && (
            <View style={styles.twist}>
              <Text style={styles.twistLabel}>📍 {t('twistIn', { city: localizeCityName(city?.name ?? '') })}</Text>
              <Text style={styles.twistText}>{p.twist.text}</Text>
            </View>
          )}
          <View style={styles.cta}><Text style={styles.ctaText}>{t('cta')}</Text></View>
        </TouchableOpacity>
        {reactions}
        {time && <Text style={styles.time}>{time}</Text>}
      </View>
    );
  }

  const p = (message.payload ?? {}) as Partial<ProofPayload>;
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
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
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
  name:          { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  sub:           { fontSize: 11, color: c.muted },
  photo:         { width: '100%', aspectRatio: 4 / 3, borderRadius: Radius.md, backgroundColor: c.bg3 },
  caption:       { fontSize: FontSizes.sm, color: c.text },
  proofOf:       { fontSize: 11, color: c.muted },
  time:          { fontSize: 11, color: c.muted, marginTop: 4, alignSelf: 'flex-start' },
});
