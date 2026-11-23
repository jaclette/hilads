import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar } from '@/ui';
import { fetchEventParticipants, toggleEventParticipation } from '@/api/events';
import { api } from '@/api/client';
import { track } from '@/services/analytics';
import type { EventParticipant, HiladsEvent, Message } from '@/types';

/**
 * The Hi chat's own rows (docs/mockups/hilads_hi_chat_mockup.html): the question of the day
 * (a dashed card posted by Hilads, "Answer" replies to it), the "🎉 maxime created a plan"
 * line, the unread marker, the next plan in one row, and the scroll-to-latest button.
 */

/** The question of the day: answers count and an Answer button (a reply to it, composer focused). */
export function QuestionCard({ message, world, onAnswer }: { message: Message; world: boolean; onAnswer: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('chat');
  const answers = Number((message.payload as { answers?: number } | null)?.answers ?? 0);
  return (
    <View style={styles.question} accessible accessibilityLabel={`${t('hi.question')}. ${message.content ?? ''}. ${answers > 0 ? t('hi.answers', { count: answers }) : t('hi.firstAnswer')}`}>
      <Text style={styles.questionKicker}>{world ? '🌍' : '☕'} {t('hi.question')}</Text>
      <Text style={styles.questionText}>{message.content}</Text>
      <View style={styles.questionRow}>
        <Text style={styles.questionCount}>💬 {answers > 0 ? t('hi.answers', { count: answers }) : t('hi.firstAnswer')}</Text>
        <Pressable onPress={onAnswer} style={styles.answerBtn} accessibilityRole="button" accessibilityLabel={t('hi.answer')} hitSlop={6}>
          <Text style={styles.answerText}>{t('hi.answer')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** "🎉 maxime created a plan · Coffee at Cheo Leo, Sat 10:00", opening the plan. */
export function PlanLine({ message }: { message: Message }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('chat');
  const router = useRouter();
  const p = (message.payload ?? {}) as { eventId?: string; title?: string; startsAt?: number };
  const when = p.startsAt ? new Date(p.startsAt * 1000).toLocaleString(i18n.language, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const text = t('hi.planCreated', { name: message.nickname, title: p.title ?? message.content ?? '', when });
  return (
    <Pressable style={styles.planLine} disabled={!p.eventId} accessibilityRole="button" accessibilityLabel={text}
               onPress={() => { if (p.eventId) { track('plan_opened', { source: 'hi_line' }); router.push({ pathname: '/event/[id]', params: { id: p.eventId } }); } }}>
      <Text style={styles.planLineText} numberOfLines={2}>🎉 {text}</Text>
    </Pressable>
  );
}

/** "New messages": where the unread ones start. */
export function UnreadMarker({ count }: { count: number }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('chat');
  return (
    <View style={styles.marker} accessibilityRole="header">
      <View style={styles.markerLine} />
      <Text style={styles.markerText}>{t('hi.unread', { count })}</Text>
      <View style={styles.markerLine} />
    </View>
  );
}

/** Back to the latest messages (shown once scrolled up), with the count of new ones. */
export function ScrollToLatest({ count, onPress }: { count: number; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('chat');
  return (
    <Pressable style={styles.latest} onPress={onPress} accessibilityRole="button"
               accessibilityLabel={count > 0 ? t('hi.newBelow', { count }) : t('hi.latest')} hitSlop={8}>
      <Ionicons name="arrow-down" size={IconSize.md} color={colors.text} />
      {count > 0 && <View style={styles.latestBadge}><Text style={styles.latestBadgeText}>{count > 9 ? '9+' : count}</Text></View>}
    </Pressable>
  );
}

/** The next plan in one row (stacked avatars, title, date, "22 going", Join) and "+N more" to the plans list. */
export function NextPlanRow({ channelId, guestId, nickname }: { channelId: string; guestId: string | null; nickname: string }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('chat');
  const router = useRouter();
  const [plans, setPlans] = useState<HiladsEvent[] | null>(null);
  const [people, setPeople] = useState<EventParticipant[]>([]);
  const [going, setGoing] = useState<{ count: number; isIn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    // The city's plans of the next 7 days (not only today's).
    api.get<{ events: HiladsEvent[] }>(`/channels/${channelId}/events/upcoming`).then(r => r.events ?? []).then(evs => {
      const now = Date.now() / 1000;
      const next = evs.filter(e => (e.ends_at ?? e.starts_at + 3 * 3600) > now).sort((a, b) => a.starts_at - b.starts_at);
      setPlans(next);
      const first = next[0];
      if (first) {
        setGoing({ count: first.participant_count ?? 0, isIn: !!first.is_participating });
        fetchEventParticipants(first.id, guestId ?? undefined).then(r => { setPeople(r.participants.slice(0, 3)); setGoing({ count: r.count, isIn: !!r.isIn }); });
      }
    }).catch(() => setPlans([]));
  }, [channelId, guestId]);
  useEffect(() => { load(); }, [load]);

  const first = plans?.[0];
  if (!first) return null;
  const more = (plans?.length ?? 1) - 1;
  const when = new Date(first.starts_at * 1000).toLocaleString(i18n.language, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const join = async () => {
    if (!guestId || busy) return;
    setBusy(true);
    try { const r = await toggleEventParticipation(first.id, guestId, nickname); setGoing(r); track('plan_opened', { source: 'hi_join' }); }
    catch { /* unchanged */ } finally { setBusy(false); }
  };
  return (
    <View style={styles.plan}>
      <Pressable style={styles.planMain} accessibilityRole="button" onPress={() => router.push({ pathname: '/event/[id]', params: { id: first.id } })}
                 accessibilityLabel={`${first.title}, ${when}${going && going.count > 0 ? `, ${t('hi.going', { count: going.count })}` : ''}`}>
        <View style={styles.stack}>
          {people.length > 0 ? people.map((p, i) => (
            <View key={p.id ?? i} style={[styles.stackItem, { marginLeft: i === 0 ? 0 : -10, zIndex: 3 - i }]}>
              <Avatar uri={p.thumbAvatarUrl ?? p.avatarUrl ?? null} name={p.displayName ?? ''} size={26} />
            </View>
          )) : <Ionicons name="calendar-outline" size={IconSize.md} color={styles.planMeta.color as string} />}
        </View>
        <View style={styles.planBody}>
          <Text style={styles.planTitle} numberOfLines={1}>{first.title}</Text>
          <Text style={styles.planMeta} numberOfLines={1}>
            {when}{going && going.count > 0 ? ` · ${t('hi.going', { count: going.count })}` : ''}
            {more > 0 ? ` · ${t('hi.morePlans', { count: more })}` : ''}
          </Text>
        </View>
      </Pressable>
      {more > 0 && (
        <Pressable onPress={() => router.push('/(tabs)/events' as never)} accessibilityRole="button" accessibilityLabel={t('hi.morePlans', { count: more })} hitSlop={6}>
          <Text style={styles.planMore}>+{more}</Text>
        </Pressable>
      )}
      <Pressable onPress={join} disabled={busy || !guestId} style={[styles.joinBtn, going?.isIn && styles.joinBtnOn]} accessibilityRole="button"
                 accessibilityState={{ selected: !!going?.isIn }} accessibilityLabel={going?.isIn ? t('hi.going', { count: going.count }) : t('hi.join')}>
        <Text style={[styles.joinText, going?.isIn && styles.joinTextOn]}>{going?.isIn ? '✓' : t('hi.join')}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  question:      { marginVertical: Space.sm, marginHorizontal: Space.xs, padding: Space.md, borderRadius: Radius.card, borderWidth: 2, borderStyle: 'dashed',
                   borderColor: c.cta, backgroundColor: c.primaryTint, gap: Space.xs },
  questionKicker:{ ...Type.caption, fontWeight: '800', color: c.primaryOnTint },
  questionText:  { ...Type.label, color: c.text },
  questionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  questionCount: { ...Type.caption, color: c.muted, flexShrink: 1 },
  answerBtn:     { backgroundColor: c.cta, borderRadius: Radius.control, paddingHorizontal: Space.md, minHeight: 36, justifyContent: 'center' },
  answerText:    { ...Type.caption, fontWeight: '900', color: c.onCta },
  planLine:      { alignSelf: 'center', maxWidth: '92%', backgroundColor: c.goldTint, borderRadius: Radius.control, paddingHorizontal: Space.md, paddingVertical: Space.xs, marginVertical: Space.xs, minHeight: 32, justifyContent: 'center' },
  planLineText:  { ...Type.caption, fontWeight: '700', color: c.onGold, textAlign: 'center' },
  marker:        { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginVertical: Space.sm, paddingHorizontal: Space.sm },
  markerLine:    { flex: 1, height: 1, backgroundColor: c.red },
  markerText:    { ...Type.caption, fontWeight: '800', color: c.red },
  latest:        { position: 'absolute', right: Space.md, bottom: Space.md, width: 44, height: 44, borderRadius: 22, backgroundColor: c.bg2,
                   borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center', elevation: 3,
                   shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  latestBadge:   { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  latestBadgeText: { fontSize: 11, fontWeight: '800', color: c.white },
  plan:          { flexDirection: 'row', alignItems: 'center', gap: Space.sm, backgroundColor: c.bg2, borderRadius: Radius.card, borderWidth: 1, borderColor: c.line,
                   paddingHorizontal: Space.md, paddingVertical: Space.sm, minHeight: 52 },
  planMain:      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  stack:         { flexDirection: 'row', alignItems: 'center', minWidth: 26 },
  stackItem:     { borderWidth: 2, borderColor: c.bg2, borderRadius: 15 },
  planBody:      { flex: 1 },
  planTitle:     { ...Type.caption, fontWeight: '800', color: c.text },
  planMeta:      { ...Type.caption, color: c.muted },
  planMore:      { ...Type.caption, fontWeight: '800', color: c.primaryText },
  joinBtn:       { backgroundColor: c.cta, borderRadius: Radius.control, paddingHorizontal: Space.md, minHeight: 36, minWidth: 56, alignItems: 'center', justifyContent: 'center' },
  joinBtnOn:     { backgroundColor: c.primaryTint },
  joinText:      { ...Type.caption, fontWeight: '900', color: c.onCta },
  joinTextOn:    { color: c.primaryOnTint },
});
