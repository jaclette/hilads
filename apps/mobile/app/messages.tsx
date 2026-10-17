import { thumbUrl } from '@/lib/imageThumb';
/**
 * Messages screen - Direct Messages + Event Chats with filter pills.
 *
 * Three filter pills at the top:
 *   All            → both sections visible (default)
 *   Direct Messages → DM section only
 *   Event Chats     → Event Chats section only
 *
 * Filtering is purely visual - no re-fetch on switch.
 * Each pill shows an orange dot when its section has unread items.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Switch,
  ActivityIndicator, RefreshControl, StyleSheet, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useConversations } from '@/hooks/useConversations';
import { fetchMyEvents } from '@/api/events';
import {
  fetchNotificationPreferences, updateNotificationPreferences,
  type NotificationPreferences,
} from '@/api/notifications';
import { UpgradePrompt } from '@/features/auth/UpgradePrompt';
import { Border, FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar, Button, EmptyState, Screen, ScreenHeader } from '@/ui';
import type { Conversation, HiladsEvent, EventChatPreview } from '@/types';

type FilterKey = 'all' | 'dms' | 'events';

// ── Relative timestamp ────────────────────────────────────────────────────────

function relativeTime(raw?: string | null): string {
  if (!raw) return '';
  let ms = Date.parse(raw);
  if (isNaN(ms)) {
    const n = Number(raw);
    if (!isNaN(n)) ms = n < 1e10 ? n * 1000 : n;
  }
  if (isNaN(ms)) return '';
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60)    return i18n.t('time.nowShort', { ns: 'common' });
  if (diffSec < 3600)  return i18n.t('time.mShort', { ns: 'common', count: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return i18n.t('time.hShort', { ns: 'common', count: Math.floor(diffSec / 3600) });
  return i18n.t('time.dShort', { ns: 'common', count: Math.floor(diffSec / 86400) });
}

// ── DM row ────────────────────────────────────────────────────────────────────

function DMRow({ convo, onPress, onDelete }: { convo: Conversation; onPress: () => void; onDelete: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t }   = useTranslation('common');
  const name    = convo.other_display_name;
  const time    = relativeTime(convo.last_message_at);
  const confirmDelete = () => Alert.alert(
    t('deleteConversationTitle', { defaultValue: 'Delete conversation?' }),
    t('deleteConversationBody', { defaultValue: 'It will be removed from your messages. It reappears if they message you again.' }),
    [
      { text: t('cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
      { text: t('delete', { defaultValue: 'Delete' }), style: 'destructive', onPress: onDelete },
    ],
  );

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} onLongPress={confirmDelete} delayLongPress={350} activeOpacity={0.7} accessibilityRole="button">
      <Avatar uri={convo.other_photo_url ? thumbUrl(convo.other_photo_url) : null} name={name} size={48} fallback="color" />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowName, convo.has_unread && styles.rowNameUnread]} numberOfLines={1}>
            {name}
          </Text>
          {time ? <Text style={styles.rowTime}>{time}</Text> : null}
        </View>
        {convo.last_message ? (
          <Text
            style={[styles.rowPreview, convo.has_unread && styles.rowPreviewUnread]}
            numberOfLines={1}
          >
            {convo.last_message}
          </Text>
        ) : null}
      </View>
      {convo.has_unread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({
  event, unread, onPress,
}: {
  event:   HiladsEvent;
  unread?: EventChatPreview;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('dm');
  const hasUnread = (unread?.count ?? 0) > 0;
  const preview   = unread?.preview
    ?? (event.city_name
      ? `${event.city_name}${event.participant_count != null ? ` · ${t('goingCount', { count: event.participant_count })}` : ''}`
      : t('eventChatFallback'));
  const time = unread?.previewAt ? relativeTime(unread.previewAt) : '';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7} accessibilityRole="button">
      <View style={styles.eventIcon}>
        <Ionicons name="calendar-outline" size={22} color={colors.primaryOnTint} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowName, hasUnread && styles.rowNameUnread]} numberOfLines={1}>
            {event.title}
          </Text>
          {time ? <Text style={styles.rowTime}>{time}</Text> : null}
        </View>
        <Text style={[styles.rowPreview, hasUnread && styles.rowPreviewUnread]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      {hasUnread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

// ── Filter pills ──────────────────────────────────────────────────────────────

const FILTERS: { key: FilterKey; labelKey: string }[] = [
  { key: 'all',    labelKey: 'filterAll' },
  { key: 'dms',    labelKey: 'filterDms' },
  { key: 'events', labelKey: 'filterEvents' },
];

function FilterBar({
  active, dmUnread, eventsUnread, onSelect,
}: {
  active:       FilterKey;
  dmUnread:     boolean;
  eventsUnread: boolean;
  onSelect:     (f: FilterKey) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('dm');
  return (
    <View style={styles.filterBar}>
      {FILTERS.map(({ key, labelKey }) => {
        const isActive  = active === key;
        const hasUnread = key === 'dms' ? dmUnread : key === 'events' ? eventsUnread : (dmUnread || eventsUnread);
        return (
          <TouchableOpacity
            key={key}
            style={[styles.pill, isActive && styles.pillActive]}
            onPress={() => onSelect(key)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <Text style={[styles.pillLabel, isActive && styles.pillLabelActive]}>{t(labelKey)}</Text>
            {hasUnread && <View style={[styles.pillDot, isActive && styles.pillDotActive]} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MessagesScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('dm');
  const { account, identity, eventChatPreviews, clearEventChatCounts, setUnreadDMs } = useApp();
  const { conversations, loading: loadingDMs, error, reload: reloadDMs, markAllRead: markDMsRead, remove: removeDM } = useConversations();

  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  const dmUnread     = conversations.some(c => c.has_unread);
  const eventsUnread = Object.values(eventChatPreviews).some(p => p.count > 0);
  const hasUnread    = dmUnread || eventsUnread;

  const markAllRead = useCallback(() => {
    markDMsRead();
    clearEventChatCounts();
  }, [markDMsRead, clearEventChatCounts]);

  // Skip refetch on initial mount - useConversations already loads on mount.
  // On subsequent focuses (returning from a DM) refetch so has_unread flags reflect
  // what the user has actually read.
  const hasMountedRef = useRef(false);
  useFocusEffect(useCallback(() => {
    clearEventChatCounts();
    setUnreadDMs(0);
    if (hasMountedRef.current) {
      reloadDMs();
    }
    hasMountedRef.current = true;
  }, [reloadDMs, clearEventChatCounts, setUnreadDMs]));

  const [events,      setEvents]      = useState<HiladsEvent[]>([]);
  const [loadingEvts, setLoadingEvts] = useState(false);

  const loadEvents = useCallback(async () => {
    if (!account || !identity?.guestId) return;
    setLoadingEvts(true);
    try {
      const evts = await fetchMyEvents(identity.guestId);
      setEvents(evts);
    } catch { /* silent */ }
    finally { setLoadingEvts(false); }
  }, [account, identity?.guestId]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // ── Envelope-scoped notification preferences ─────────────────────────────
  // Three toggles: DMs, event-chat, city-chat - mirroring the three notification
  // types that route to the envelope icon. Other prefs live on the bell screen.
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  useEffect(() => {
    if (!account) return;
    fetchNotificationPreferences().then(setPrefs).catch(() => {});
  }, [account]);

  const togglePref = useCallback((key: keyof NotificationPreferences, value: boolean) => {
    if (!prefs) return;
    const prev = prefs;
    setPrefs({ ...prefs, [key]: value });
    updateNotificationPreferences({ [key]: value }).catch(() => setPrefs(prev));
  }, [prefs]);

  const reload = useCallback(() => { reloadDMs(); loadEvents(); }, [reloadDMs, loadEvents]);
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/chat'));

  if (!account) {
    return (
      <Screen>
        <ScreenHeader title={t('messages', { ns: 'common' })} onBack={goBack} />
        <UpgradePrompt title={t('upgradeTitle')} subtitle={t('upgradeSub')} />
      </Screen>
    );
  }

  const initialLoading = loadingDMs && conversations.length === 0 && events.length === 0;

  // Which sections to show based on active filter
  const showDMs    = activeFilter === 'all' || activeFilter === 'dms';
  const showEvents = activeFilter === 'all' || activeFilter === 'events';

  // Empty state: nothing to show for the current filter
  const filteredEmpty =
    !initialLoading && !error &&
    (showDMs    ? conversations.length === 0 : true) &&
    (showEvents ? events.length === 0        : true);

  return (
    <Screen>
      <ScreenHeader title={t('messages', { ns: 'common' })} onBack={goBack}
                    right={hasUnread ? <Button variant="link" label={t('markAllRead')} onPress={markAllRead} /> : undefined} />

      {/* Filter pills */}
      <FilterBar
        active={activeFilter}
        dmUnread={dmUnread}
        eventsUnread={eventsUnread}
        onSelect={setActiveFilter}
      />

      {/* Content */}
      {initialLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <EmptyState icon="cloud-offline-outline" body={error}
                      action={<Button variant="secondary" label={t('retry', { ns: 'common' })} onPress={reload} />} />
        </View>
      ) : filteredEmpty ? (
        <View style={styles.center}>
          <EmptyState
            icon={activeFilter === 'events' ? 'calendar-outline' : 'chatbubbles-outline'}
            title={activeFilter === 'events' ? t('emptyEventsTitle') : t('emptyDmsTitle')}
            body={activeFilter === 'events' ? t('emptyEventsSub') : t('emptyDmsSub')}
          />
        </View>
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={loadingDMs || loadingEvts}
              onRefresh={reload}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={styles.listContent}
        >
          {/* Direct Messages section */}
          {showDMs && conversations.length > 0 && (
            <>
              {activeFilter === 'all' && <SectionHeader title={t('sectionDms')} />}
              {conversations.map(convo => (
                <DMRow
                  key={convo.id}
                  convo={convo}
                  onPress={() => router.push({
                    pathname: '/dm/[id]',
                    params: { id: convo.other_user_id, name: convo.other_display_name },
                  })}
                  onDelete={() => removeDM(convo.id)}
                />
              ))}
            </>
          )}

          {/* Event Chats section */}
          {showEvents && (
            loadingEvts && events.length === 0 ? (
              <View style={styles.sectionLoader}>
                <ActivityIndicator color={colors.primary} size="small" />
              </View>
            ) : events.length > 0 ? (
              <>
                {activeFilter === 'all' && <SectionHeader title={t('sectionEvents')} />}
                {events.map(event => (
                  <EventRow
                    key={event.id}
                    event={event}
                    unread={eventChatPreviews[event.id]}
                    onPress={() => router.push({
                      pathname: '/event/[id]',
                      params: { id: event.id },
                    })}
                  />
                ))}
              </>
            ) : activeFilter === 'events' ? null : null
          )}

          {/* ── Notification preferences (envelope-scoped) ────────────────── */}
          {prefs && (
            <View style={styles.prefSection}>
              <Text style={styles.prefSectionTitle}>{t('prefTitle')}</Text>
              <View style={styles.prefCard}>
                <PrefRow
                  label={t('pref.dmLabel')}
                  subtitle={t('pref.dmSub')}
                  value={prefs.dm_push}
                  onChange={v => togglePref('dm_push', v)}
                />
                <View style={styles.prefDivider} />
                <PrefRow
                  label={t('pref.eventLabel')}
                  subtitle={t('pref.eventSub')}
                  value={prefs.event_message_push}
                  onChange={v => togglePref('event_message_push', v)}
                />
                <View style={styles.prefDivider} />
                <PrefRow
                  label={t('pref.cityLabel')}
                  subtitle={t('pref.citySub')}
                  value={prefs.channel_message_push}
                  onChange={v => togglePref('channel_message_push', v)}
                />
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

// ── Preference toggle row (local - same shape as the bell screen's PrefRow) ──

function PrefRow({
  label, subtitle, value, onChange,
}: { label: string; subtitle: string; value: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.prefRow}>
      <View style={styles.prefText}>
        <Text style={styles.prefLabel}>{label}</Text>
        <Text style={styles.prefSub}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.line, true: colors.primary }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.line}
        accessibilityLabel={label}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  listContent: { paddingBottom: Spacing.xl },

  filterBar:       { flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.md, paddingTop: 4, paddingBottom: 10 },
  pill:            { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: Radius.full,
                     borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  pillActive:      { backgroundColor: c.primary, borderColor: c.primary },
  pillLabel:       { fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  pillLabelActive: { fontWeight: '700', color: c.white },
  pillDot:         { width: 7, height: 7, borderRadius: Radius.full, backgroundColor: c.primary },
  pillDotActive:   { backgroundColor: c.white },

  sectionHeader: { paddingHorizontal: Spacing.md, paddingTop: 14, paddingBottom: 6 },
  sectionTitle:  { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  sectionLoader: { paddingVertical: Spacing.md, alignItems: 'center' },

  row:              { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  eventIcon:        { width: 48, height: 48, borderRadius: 14, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  rowBody:          { flex: 1, minWidth: 0, gap: 2 },
  rowTop:           { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName:          { flex: 1, fontSize: 15, fontWeight: '600', color: c.text },
  rowNameUnread:    { fontWeight: '800' },
  rowTime:          { fontSize: 12, fontWeight: '400', color: c.muted },
  rowPreview:       { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted },
  rowPreviewUnread: { fontWeight: '600', color: c.text },
  unreadDot:        { width: 10, height: 10, borderRadius: Radius.full, backgroundColor: c.primary },

  prefSection:      { paddingHorizontal: Spacing.md, paddingTop: Spacing.lg, gap: 8 },
  prefSectionTitle: { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  prefCard:         { borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2, paddingHorizontal: 14 },
  prefDivider:      { height: 1, backgroundColor: c.line },
  prefRow:          { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10 },
  prefText:         { flex: 1, gap: 2 },
  prefLabel:        { fontSize: 15, fontWeight: '700', color: c.text },
  prefSub:          { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted },
});
