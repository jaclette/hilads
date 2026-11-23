import { useCallback, useState } from 'react';
import { Share, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar, Button, Card } from '@/ui';
import { RankMedal } from '@/features/daily/RankMedal';
import { fetchCrew, type Crew } from '@/features/invites/invite';
import { seasonName } from '@/features/scoring/points';
import { track } from '@/services/analytics';
import type { DailyUserStats } from '@/types';

/**
 * Scoring v2 on the Passport (docs/scoring-v2-audit.md): this week's Perfect week (7 dots,
 * Monday to Sunday, and its +30), the "Bring your crew" card (3 / 5 friends, the invite
 * button, the friends who joined) and the season medals.
 */

type Week = NonNullable<DailyUserStats['week']>;

/** This week's 7 days: done (filled), today to play (ringed), missed (crossed), to come (empty). */
export function WeekCard({ week }: { week: Week }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  const days = t('week.days').split(',');
  const status = week.earned ? t('week.earned', { points: week.points })
    : week.missed > 0 ? t('week.missed')
    : t('week.left', { count: week.left, points: week.points });
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">{t('week.title')}</Text>
        <View style={[styles.pill, week.earned && { backgroundColor: colors.goldTint }]}>
          <Text style={[styles.pillText, week.earned && { color: colors.onGold }]}>{t('week.points', { points: week.points })}</Text>
        </View>
      </View>
      <View style={styles.dots} accessible accessibilityLabel={t('week.a11y', { done: week.done, total: week.total })}>
        {week.days.map((d, i) => (
          <View key={i} style={styles.day}>
            <View style={[styles.dot,
              d === 'done' && { backgroundColor: colors.cta, borderColor: colors.cta },
              d === 'today' && { borderColor: colors.cta, borderWidth: 2 },
              d === 'missed' && { borderColor: colors.line, backgroundColor: colors.bg3 },
              d === 'off' && { opacity: 0.4 }]}>
              {d === 'done' && <Ionicons name="checkmark" size={IconSize.sm} color={colors.onCta} />}
              {d === 'missed' && <Ionicons name="close" size={IconSize.sm} color={colors.muted} />}
            </View>
            <Text style={styles.dayLabel} maxFontSizeMultiplier={1.3}>{days[i] ?? ''}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.sub}>{status}</Text>
    </Card>
  );
}

/** "Bring your crew": this season's friends (3 / 5), the invite link, who joined. */
export function CrewCard() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  const [crew, setCrew] = useState<Crew | null>(null);
  useFocusEffect(useCallback(() => {
    let alive = true;
    fetchCrew().then(c => { if (alive) setCrew(c); }).catch(() => {});
    return () => { alive = false; };
  }, []));
  if (!crew) return null;
  const invite = async () => {
    track('share_started', { content_type: 'invite', source: 'passport_crew' });
    try {
      const r = await Share.share({ message: t('crew.shareText', { link: crew.link }), url: crew.link });
      if (r.action === Share.sharedAction) track('share_completed', { content_type: 'invite', channel: r.activityType ?? 'system' });
    } catch { /* cancelled */ }
  };
  const progress = Math.min(1, crew.count / Math.max(1, crew.max));
  const joined = crew.friends.slice(0, 8);
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">{t('crew.title')}</Text>
        <Text style={styles.count} accessibilityLabel={t('crew.a11y', { count: crew.count, max: crew.max })}>{crew.count} / {crew.max}</Text>
      </View>
      <Text style={styles.sub}>
        {crew.bonus ? t('crew.done', { points: crew.points.crew })
          : t('crew.text', { friend: crew.points.friend, crew: crew.points.crew, max: crew.max })}
      </Text>
      <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.barFill, { width: `${progress * 100}%`, backgroundColor: crew.bonus ? colors.gold : colors.cta }]} />
      </View>
      {joined.length > 0 && (
        <View style={styles.friends}>
          {joined.map(f => (
            <View key={f.id} style={styles.friend} accessible
                  accessibilityLabel={`${f.username ? '@' + f.username : f.displayName ?? ''}${f.credited ? '' : `, ${t('crew.pending')}`}`}>
              <View style={[styles.avatarRing, { borderColor: f.credited ? colors.cta : colors.line }]}>
                <Avatar uri={f.photoUrl} name={f.displayName ?? f.username ?? ''} size={40} />
              </View>
              <Text style={styles.friendName} numberOfLines={1} maxFontSizeMultiplier={1.3}>{f.username ? '@' + f.username : f.displayName}</Text>
            </View>
          ))}
        </View>
      )}
      {joined.some(f => !f.credited) && <Text style={styles.hint}>{t('crew.pendingHint')}</Text>}
      <Button icon="person-add-outline" label={t('crew.invite')} onPress={invite} testID="passport-crew-invite" />
    </Card>
  );
}

/** Season medals: "🥇 November 2026", newest first. */
export function SeasonMedals({ medals }: { medals: NonNullable<DailyUserStats['seasonMedals']> }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('me');
  if (medals.length === 0) return null;
  return (
    <Card style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">{t('seasons.medals')}</Text>
      <View style={styles.medals}>
        {medals.map(m => (
          <View key={m.season} style={styles.medal} accessible
                accessibilityLabel={t('seasons.medalA11y', { rank: m.rank, season: seasonName(m.season, i18n.language), points: m.points })}>
            <RankMedal rank={m.rank} podium size={36} />
            <Text style={styles.medalText} numberOfLines={1}>{seasonName(m.season, i18n.language)}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** "Invited by @minh". */
export function InvitedBy({ by }: { by: NonNullable<DailyUserStats['invitedBy']> }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('me');
  return (
    <View style={styles.invited}>
      <Avatar uri={by.photoUrl} name={by.displayName ?? by.username ?? ''} size={24} />
      <Text style={styles.invitedText}>{t('crew.invitedBy', { name: by.username ? '@' + by.username : by.displayName ?? '' })}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:       { padding: Space.md, gap: Space.sm },
  head:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  title:      { ...Type.label, color: c.text, flexShrink: 1 },
  count:      { ...Type.label, color: c.primaryText },
  sub:        { ...Type.body, color: c.muted },
  hint:       { ...Type.caption, color: c.muted },
  pill:       { paddingHorizontal: Space.md, minHeight: 28, borderRadius: Radius.control, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  pillText:   { ...Type.caption, fontWeight: '800', color: c.primaryOnTint },
  dots:       { flexDirection: 'row', justifyContent: 'space-between' },
  day:        { alignItems: 'center', gap: Space.xxs, flex: 1 },
  dot:        { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' },
  dayLabel:   { ...Type.caption, color: c.muted },
  bar:        { height: 8, borderRadius: 4, backgroundColor: c.bg3, overflow: 'hidden' },
  barFill:    { height: 8, borderRadius: 4 },
  friends:    { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  friend:     { alignItems: 'center', gap: Space.xxs, width: 64 },
  avatarRing: { borderWidth: 2, borderRadius: 24, padding: 1 },
  friendName: { ...Type.caption, color: c.text, maxWidth: 64 },
  medals:     { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  medal:      { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingRight: Space.sm },
  medalText:  { ...Type.caption, color: c.text },
  invited:    { flexDirection: 'row', alignItems: 'center', gap: Space.sm, alignSelf: 'center' },
  invitedText:{ ...Type.caption, color: c.muted },
});
