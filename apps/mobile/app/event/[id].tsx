import { useCallback } from 'react';
import {
  View, Text, FlatList, ActivityIndicator,
  TouchableOpacity, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useEventDetail } from '@/hooks/useEventDetail';
import { useMessages } from '@/hooks/useMessages';
import { fetchEventMessages, sendEventMessage, sendEventImageMessage } from '@/api/events';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { HiladsEvent, Message } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

// ── Event header ──────────────────────────────────────────────────────────────

function EventHeader({
  event,
  isOwner,
  toggling,
  onToggle,
}: {
  event: HiladsEvent;
  isOwner: boolean;
  toggling: boolean;
  onToggle: () => void;
}) {
  const now    = Date.now() / 1000;
  const isLive = event.starts_at <= now && event.expires_at > now;
  const icon   = EVENT_ICONS[event.event_type] ?? '📌';

  return (
    <View style={styles.eventHeader}>
      <View style={styles.eventIconRow}>
        <Text style={styles.eventIcon}>{icon}</Text>
        <View style={styles.badges}>
          {isLive && (
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>Live</Text>
            </View>
          )}
          {isOwner && (
            <View style={styles.ownerBadge}>
              <Text style={styles.ownerBadgeText}>Your event</Text>
            </View>
          )}
          {event.recurrence_label && (
            <View style={styles.recurBadge}>
              <Text style={styles.recurBadgeText}>↻ {event.recurrence_label}</Text>
            </View>
          )}
        </View>
      </View>

      <Text style={styles.eventTitle}>{event.title}</Text>

      {(event.location ?? event.venue) && (
        <Text style={styles.eventLocation}>
          📍 {event.location ?? event.venue}
        </Text>
      )}

      <Text style={styles.eventTime}>
        {formatDate(event.starts_at)} · {formatTime(event.starts_at)}
        {event.ends_at ? ` → ${formatTime(event.ends_at)}` : ''}
      </Text>

      <View style={styles.actionRow}>
        {event.participant_count !== undefined && (
          <Text style={styles.participantCount}>
            {event.participant_count} going
          </Text>
        )}

        <TouchableOpacity
          style={[
            styles.joinBtn,
            event.is_participating && styles.joinBtnActive,
          ]}
          onPress={onToggle}
          disabled={toggling}
          activeOpacity={0.8}
        >
          {toggling ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.joinBtnText}>
              {event.is_participating ? '✓ Going' : 'I\'m going'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function EventDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { identity } = useApp();

  const {
    event, loading: eventLoading, error: eventError,
    toggling, isOwner, toggleParticipation,
  } = useEventDetail(id);

  // Event chat uses event.id as channelId for WS filtering
  const channelId = event?.id ?? id;

  const loadFn = useCallback(
    () => fetchEventMessages(id),
    [id],
  );

  const postTextFn = useCallback(
    (content: string): Promise<Message> => {
      if (!identity) return Promise.reject(new Error('Not ready'));
      return sendEventMessage(id, identity.guestId, identity.nickname, content);
    },
    [id, identity],
  );

  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> => {
      if (!identity) return Promise.reject(new Error('Not ready'));
      return sendEventImageMessage(id, identity.guestId, identity.nickname, imageUrl);
    },
    [id, identity],
  );

  const { messages, loading: msgsLoading, sending, error: msgError, clearError, sendText, sendImage } = useMessages({
    channelId,
    loadFn,
    postTextFn,
    postImageFn,
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.screenHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Event</Text>
      </View>

      {/* Error banner */}
      {msgError && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorBannerText}>{msgError} · tap to dismiss</Text>
        </TouchableOpacity>
      )}

      {/* Body */}
      {eventLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : eventError || !event ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{eventError ?? 'Event not found'}</Text>
        </View>
      ) : (
        <>
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => (
              <ChatMessage message={item} myGuestId={identity?.guestId} />
            )}
            inverted
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              msgsLoading ? (
                <View style={styles.msgsLoading}>
                  <ActivityIndicator color={Colors.muted} />
                </View>
              ) : null
            }
            ListFooterComponent={
              <EventHeader
                event={event}
                isOwner={isOwner}
                toggling={toggling}
                onToggle={toggleParticipation}
              />
            }
            ListEmptyComponent={
              msgsLoading ? null : (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText}>No messages yet. Start the conversation!</Text>
                </View>
              )
            }
          />

          <ChatInput
            sending={sending}
            onSendText={sendText}
            onSendImage={sendImage}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.bg },

  screenHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               12,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn:      { padding: 4 },
  backIcon:     { fontSize: 22, color: Colors.text },
  screenTitle:  { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },

  errorBanner:     { backgroundColor: Colors.red, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  errorBannerText: { color: Colors.white, fontSize: FontSizes.xs, textAlign: 'center' },

  center:       { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText:    { color: Colors.red, fontSize: FontSizes.sm },
  listContent:  { paddingVertical: Spacing.sm },
  msgsLoading:  { paddingVertical: Spacing.md, alignItems: 'center' },
  emptyWrap:    { paddingHorizontal: Spacing.md, paddingVertical: Spacing.lg, alignItems: 'center' },
  emptyText:    { color: Colors.muted, fontSize: FontSizes.sm, textAlign: 'center' },

  // Event header card
  eventHeader: {
    margin:          Spacing.md,
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.md,
    gap:             Spacing.xs,
  },
  eventIconRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  eventIcon:    { fontSize: 24 },
  badges:       { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap', flex: 1 },

  liveBadge:     { backgroundColor: 'rgba(255,122,60,0.18)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  liveBadgeText: { color: Colors.accent, fontSize: FontSizes.xs, fontWeight: '700' },

  ownerBadge:     { backgroundColor: 'rgba(74,222,128,0.15)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  ownerBadgeText: { color: Colors.green, fontSize: FontSizes.xs, fontWeight: '600' },

  recurBadge:     { backgroundColor: 'rgba(167,139,250,0.15)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  recurBadgeText: { color: Colors.violet, fontSize: FontSizes.xs, fontWeight: '600' },

  eventTitle:    { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text },
  eventLocation: { fontSize: FontSizes.sm, color: Colors.muted },
  eventTime:     { fontSize: FontSizes.xs, color: Colors.muted2 },

  actionRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginTop:      Spacing.sm,
  },
  participantCount: { fontSize: FontSizes.sm, color: Colors.muted },

  joinBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderRadius:      Radius.full,
    backgroundColor:   Colors.bg3,
    minWidth:          100,
    alignItems:        'center',
  },
  joinBtnActive: {
    backgroundColor: Colors.accent,
  },
  joinBtnText: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.text,
  },
});
