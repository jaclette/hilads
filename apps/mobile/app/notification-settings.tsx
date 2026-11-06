/**
 * Notification settings (V6, from the ⚙️ of Notifications): push status at the
 * top, then one group per category (same emoji and color as the inbox) with a
 * master toggle and its toggles, each with a one-line description, and quiet
 * hours. Every change is saved at once (optimistic), with a little ✓.
 */

import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Switch, Text, View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { fetchNotificationPreferences, updateNotificationPreferences, type NotifCategory, type NotificationPreferences } from '@/api/notifications';
import { Radius, Spacing, type ThemeColors } from '@/constants';
import { Screen, ScreenHeader } from '@/ui';
import { tint } from '@/ui/joy';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { CATEGORY_EMOJI, categoryColor } from '@/features/notifications/categories';
import { usePushEnabled } from '@/features/notifications/PushOffBanner';

type Key = keyof NotificationPreferences;
/** A toggle: its label / description keys (notifications:pref.*) and the preferences it sets together. */
type Toggle = { label: string; keys: Key[] };

const GROUPS: { category: NotifCategory; toggles: Toggle[] }[] = [
  { category: 'social', toggles: [
    { label: 'comment', keys: ['comment_push'] },
    { label: 'mention', keys: ['mention_push'] },
    { label: 'like', keys: ['like_push'] },
    { label: 'friend', keys: ['friend_request_push'] },
    { label: 'vibe', keys: ['vibe_received_push'] },
    { label: 'profileView', keys: ['profile_view_push'] },
  ] },
  { category: 'game', toggles: [
    { label: 'results', keys: ['results_push'] },
    { label: 'rank', keys: ['rank_push'] },
    { label: 'stamp', keys: ['stamp_push'] },
    { label: 'reminder', keys: ['reminder_push'] },
  ] },
  { category: 'plans', toggles: [
    { label: 'planJoin', keys: ['event_join_push', 'join_request_push'] },
    { label: 'newPlans', keys: ['new_event_push', 'new_topic_push'] },
    { label: 'topicReply', keys: ['topic_reply_push'] },
  ] },
  { category: 'city', toggles: [
    { label: 'cityJoin', keys: ['city_join_push'] },
    { label: 'friendArrival', keys: ['friend_arrival_push'] },
  ] },
  { category: 'hilads', toggles: [
    { label: 'daily', keys: ['daily_challenge_push'] },
    { label: 'announce', keys: ['admin_announcement_push'] },
  ] },
];

const DEFAULT_QUIET = { start: 23 * 60, end: 8 * 60 };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function NotificationSettingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, theme } = useTheme();
  const { t } = useTranslation('notifications');
  const push = usePushEnabled();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);

  useEffect(() => { fetchNotificationPreferences().then(setPrefs).catch(() => {}); }, []);

  // The ✓ Saved pop.
  const tick = useSharedValue(0);
  const tickStyle = useAnimatedStyle(() => ({ opacity: tick.value, transform: [{ scale: 0.8 + tick.value * 0.2 }] }));
  const saved = () => { tick.value = withSequence(withSpring(1), withDelay(900, withTiming(0, { duration: 250 }))); };

  const queue = useRef(Promise.resolve());
  const save = (patch: Partial<NotificationPreferences>) => {
    Haptics.selectionAsync().catch(() => {});
    setPrefs(p => (p ? { ...p, ...patch } : p));   // optimistic
    queue.current = queue.current
      .then(() => updateNotificationPreferences(patch))
      .then(next => { setPrefs(p => (p ? { ...p, ...next } : next)); saved(); })
      .catch(() => fetchNotificationPreferences().then(setPrefs).catch(() => {}));
  };
  const on = (keys: Key[]) => !!prefs && keys.some(k => prefs[k] !== false && prefs[k] !== undefined);
  const setAll = (keys: Key[], v: boolean) => save(Object.fromEntries(keys.map(k => [k, v])) as Partial<NotificationPreferences>);

  const quietOn = prefs?.quiet_start != null && prefs?.quiet_end != null;
  const qs = prefs?.quiet_start ?? DEFAULT_QUIET.start;
  const qe = prefs?.quiet_end ?? DEFAULT_QUIET.end;

  return (
    <Screen>
      <ScreenHeader title={t('settings.title')} testID="notification-settings" right={(
        <Animated.View style={[styles.saved, tickStyle]} pointerEvents="none"><Text style={styles.savedText}>✓ {t('settings.saved')}</Text></Animated.View>
      )} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Push status. */}
        <View style={[styles.card, styles.pushCard, push === false && { borderColor: colors.cta }]}>
          <View style={styles.flex}>
            <Text style={styles.pushTitle}>{push === false ? t('settings.pushOff') : t('settings.pushOn')}</Text>
            {push === false && <Text style={styles.sub}>{t('settings.pushOffSub')}</Text>}
          </View>
          {push === false && (
            <Pressable onPress={() => Linking.openSettings().catch(() => {})} style={styles.turnOn} accessibilityRole="button">
              <Text style={styles.turnOnText}>{t('settings.turnOn')}</Text>
            </Pressable>
          )}
        </View>

        {prefs && GROUPS.map(g => {
          const c = categoryColor(g.category, theme === 'dark');
          const allKeys = g.toggles.flatMap(x => x.keys);
          return (
            <View key={g.category} style={styles.card} testID={`prefs-${g.category}`}>
              <View style={styles.groupHead}>
                <View style={[styles.groupEmoji, { backgroundColor: tint(c.fill, 0.25) }]}><Text style={styles.emoji}>{CATEGORY_EMOJI[g.category]}</Text></View>
                <Text style={[styles.groupTitle, { color: c.text }]}>{t(`inbox.cat.${g.category}`)}</Text>
                <PrefSwitch value={on(allKeys)} onChange={v => setAll(allKeys, v)} color={c.fill} label={t(`inbox.cat.${g.category}`)} />
              </View>
              {g.toggles.map(x => (
                <View key={x.label} style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.label}>{t(`pref.${x.label}Label`)}</Text>
                    <Text style={styles.sub}>{t(`pref.${x.label}Sub`)}</Text>
                  </View>
                  <PrefSwitch value={on(x.keys)} onChange={v => setAll(x.keys, v)} color={c.fill} label={t(`pref.${x.label}Label`)} />
                </View>
              ))}
            </View>
          );
        })}

        {prefs && (
          <View style={styles.card}>
            <View style={styles.groupHead}>
              <View style={[styles.groupEmoji, { backgroundColor: colors.primaryTint }]}><Text style={styles.emoji}>🌙</Text></View>
              <View style={styles.flex}>
                <Text style={styles.groupTitle}>{t('settings.quiet')}</Text>
                <Text style={styles.sub}>{t('settings.quietSub', { from: hhmm(qs), to: hhmm(qe) })}</Text>
              </View>
              <PrefSwitch value={quietOn} color={colors.primary} label={t('settings.quiet')}
                          onChange={v => save(v ? { quiet_start: qs, quiet_end: qe } : { quiet_start: null, quiet_end: null })} />
            </View>
            {quietOn && (
              <View style={styles.quietTimes}>
                {/* A tap moves the time by an hour. */}
                <Pressable style={styles.timeChip} onPress={() => save({ quiet_start: (qs + 60) % 1440 })} accessibilityRole="button">
                  <Text style={styles.timeText}>{hhmm(qs)}</Text>
                </Pressable>
                <Text style={styles.sub}>→</Text>
                <Pressable style={styles.timeChip} onPress={() => save({ quiet_end: (qe + 60) % 1440 })} accessibilityRole="button">
                  <Text style={styles.timeText}>{hhmm(qe)}</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function PrefSwitch({ value, onChange, color, label }: { value: boolean; onChange: (v: boolean) => void; color: string; label: string }) {
  const { colors } = useTheme();
  return (
    <Switch value={value} onValueChange={onChange} accessibilityLabel={label}
            trackColor={{ false: colors.bg3, true: color }} thumbColor={colors.white} ios_backgroundColor={colors.bg3} />
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flex:       { flex: 1 },
  content:    { padding: Spacing.md, paddingBottom: Spacing.xl, gap: 14 },
  card:       { backgroundColor: c.bg2, borderRadius: Radius.card, borderWidth: 1.5, borderColor: c.line, padding: 14, gap: 4 },
  pushCard:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pushTitle:  { fontSize: 16, lineHeight: 21, fontWeight: '800', color: c.text },
  turnOn:     { paddingHorizontal: 16, height: 40, borderRadius: Radius.full, backgroundColor: c.cta, alignItems: 'center', justifyContent: 'center' },
  turnOnText: { fontSize: 14, fontWeight: '800', color: c.onCta },
  groupHead:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 6 },
  groupEmoji: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  emoji:      { fontSize: 18, lineHeight: 23 },
  groupTitle: { flex: 1, fontSize: 17, lineHeight: 22, fontWeight: '800', color: c.text },
  row:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.line },
  label:      { fontSize: 15, lineHeight: 20, fontWeight: '700', color: c.text },
  sub:        { fontSize: 13, lineHeight: 18, color: c.muted },
  quietTimes: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 },
  timeChip:   { paddingHorizontal: 16, height: 40, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  timeText:   { fontSize: 16, fontWeight: '800', color: c.primaryOnTint },
  saved:      { paddingHorizontal: 10, height: 30, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  savedText:  { fontSize: 13, fontWeight: '800', color: c.primaryOnTint },
});
