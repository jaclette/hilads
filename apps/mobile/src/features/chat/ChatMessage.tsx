/**
 * ChatMessage - faithful port of the web message rendering.
 *
 * Web source: App.jsx feed.map() + index.css (.message, .msg-*, .feed-join)
 *
 * API wire format uses camelCase (guestId, imageUrl, createdAt).
 * System messages have no content - text is generated from event+nickname.
 *
 * Types:
 *   system → centered join pill ("nickname joined") - web: .feed-join
 *   image  → photo with web-matching border-radius
 *   text   → bubble with avatar + author (grouped = avatar hidden)
 */

import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, Animated, Platform, Linking } from 'react-native';
import { ImagePreviewModal } from './ImagePreviewModal';
import { MessageImage } from './MessageImage';
import { ReactionPills } from './ReactionPills';
import { ReactionBurstOverlay } from './ReactionBurstOverlay';
import { reactionEmitter, EMOJI_TO_TYPE } from '@/lib/reactionEmitter';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import * as Haptics from 'expo-haptics';
import { Colors, FontSizes } from '@/constants';
import { Image } from 'expo-image';
import { avatarColor } from '@/lib/avatarColors';
import { thumbUrl } from '@/lib/imageThumb';
import { countryToFlag } from '@/lib/countryFlag';
import { formatSmartTime } from '@/lib/messageTime';
import type { Message, Badge } from '@/types';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { splitContentByMentions } from '@/lib/mentions';
import { linkifyText, extractFirstUrl } from '@/lib/linkify';
import { LinkPreviewCard } from '@/features/chat/LinkPreviewCard';

// ── Location message helpers ──────────────────────────────────────────────────
// Messages starting with '📍' are location shares sent by the LocationPicker.
// Format: "📍 nickname is at Place Name\nFull Address" (address line optional)

function isLocationMessage(content: string | undefined): boolean {
  return typeof content === 'string' && content.startsWith('📍');
}

function parseLocation(content: string): { line1: string; place: string; lat?: number; lng?: number; address: string } {
  const parts = content.split('\n');
  const line1 = parts[0] ?? '';
  // Extract the place name from "📍 nick is at Place" - the part after " is at "
  const isAtIdx = line1.indexOf(' is at ');
  const place = isAtIdx !== -1 ? line1.slice(isAtIdx + 7).trim() : '';
  if (parts.length >= 2) {
    const coordParts = (parts[1] ?? '').split(',');
    const lat = parseFloat(coordParts[0] ?? '');
    const lng = parseFloat(coordParts[1] ?? '');
    if (!isNaN(lat) && !isNaN(lng) && coordParts.length === 2) {
      return { line1, place, lat, lng, address: parts.slice(2).join('\n') };
    }
  }
  return { line1, place, address: parts.slice(1).join('\n') };
}

function openMaps(lat: number, lng: number, label: string) {
  const encoded = encodeURIComponent(label);
  const url = Platform.OS === 'ios'
    ? `maps://?ll=${lat},${lng}&q=${encoded}`
    : `geo:${lat},${lng}?q=${encoded}`;
  Linking.openURL(url).catch(() => {
    Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`);
  });
}

function LocationBubble({ content, isMine }: { content: string; isMine: boolean }) {
  const { line1, place, lat, lng, address } = parseLocation(content);
  const hasCoords = lat !== undefined && lng !== undefined;
  const card = (
    <View style={[locStyles.card, isMine ? locStyles.cardMine : locStyles.cardOther]}>
      <Text style={locStyles.icon}>📍</Text>
      <View style={locStyles.body}>
        <Text style={[locStyles.line1, isMine && locStyles.textMine]} numberOfLines={2}>{line1.replace('📍 ', '')}</Text>
        {!!address && <Text style={[locStyles.addr, isMine && locStyles.addrMine]} numberOfLines={2}>{address}</Text>}
        {hasCoords && <Text style={[locStyles.tapHint, isMine && locStyles.tapHintMine]}>Tap to open in maps</Text>}
      </View>
    </View>
  );
  if (hasCoords) {
    // Use place name or address as the map label - never the social display wording ("nick is at ...")
    const mapLabel = place || address;
    return (
      <TouchableOpacity activeOpacity={0.75} onPress={() => openMaps(lat!, lng!, mapLabel)}>
        {card}
      </TouchableOpacity>
    );
  }
  return card;
}

const locStyles = StyleSheet.create({
  card: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    gap:               10,
    borderRadius:      16,
    paddingHorizontal: 14,
    paddingVertical:   12,
    // minWidth is required: styles.row uses alignItems:'flex-end/start' which
    // shrinks children to content-width in React Native's yoga engine. Without a
    // known width the card's flex-row has no basis for distributing flex to body,
    // collapsing it to 0px and leaving only the pin icon visible.
    minWidth:          200,
    maxWidth:          260,
  },
  cardOther: {
    backgroundColor:     Colors.bg3,
    borderWidth:         1,
    borderColor:         'rgba(255,255,255,0.07)',
    borderTopLeftRadius: 4,
  },
  cardMine: {
    backgroundColor:      '#B87228',
    borderTopRightRadius: 4,
  },
  icon:     { fontSize: 22, lineHeight: 28, flexShrink: 0 },
  // flex:1 + flexShrink:1 + minWidth:0: expand to fill card, allow shrink, never overflow
  body:     { flex: 1, flexShrink: 1, minWidth: 0, gap: 3 },
  line1:       { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.text, lineHeight: 20 },
  addr:        { fontSize: 12, color: Colors.muted2, lineHeight: 17 },
  textMine:    { color: '#fff' },
  addrMine:    { color: 'rgba(255,255,255,0.65)' },
  // tapHint "Tap to open in maps" - bumped 11→13 and dropped opacity 0.6
  // (which used to compound on top of muted2 to ~1.4:1, well below WCAG).
  tapHint:     { fontSize: FontSizes.xs, color: Colors.muted2, marginTop: 2 },
  tapHintMine: { color: 'rgba(255,255,255,0.65)' },
});

// ── System message text - mirrors web feedJoin variants ──────────────────────
// Join/leave lines are generated per viewer (not stored), so they render in the
// viewer's own locale. A hash(nickname + createdAt) picks a stable variant.

const FEED_JOIN_VARIANTS = 5;

function systemText(message: Message): string {
  const nick = message.nickname ?? i18n.t('someone', { ns: 'common' });
  // World cross-city system messages carry structured payload; render localized.
  const p = ((message as { payload?: Record<string, string> }).payload) ?? {};
  if (message.event === 'challenge_created') return i18n.t('world.sys.challengeCreated', { ns: 'chat', nickname: nick || p.nickname || '', cityA: p.city_a || '', cityB: p.city_b || '' });
  if (message.event === 'new_user')          return i18n.t('world.sys.newUser',          { ns: 'chat', nickname: nick || p.nickname || '', city: p.city || '' });
  if (message.event === 'challenge_won')     return i18n.t('world.sys.challengeWon',     { ns: 'chat', nickname: nick || p.nickname || '', city: p.city || '', challenge: p.challenge || '' });
  if (message.event === 'join') {
    const seed = `${nick}${message.createdAt ?? ''}`
      .split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return i18n.t(`feedJoin.${seed % FEED_JOIN_VARIANTS}`, { ns: 'chat', name: nick });
  }
  if (message.event === 'leave') return i18n.t('left', { ns: 'chat', name: nick });
  return message.content ?? `${nick} (${message.event ?? 'activity'})`;
}

// ── Entry animation hook - called unconditionally at top of ChatMessage ───────
// opacity 0→1, translateY 8→0, ease-out, 200ms
// Must be called before any conditional returns to obey React hook rules.

function useEntryAnimation(duration = 200) {
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration, useNativeDriver: true }),
    ]).start();
  }, []);

  return { opacity, translateY };
}

// ── Auto-dismiss ──────────────────────────────────────────────────────────────
// Reminder cards (event/topic/prompt/ambient) auto-remove after a delay; the
// parent then drops them from the feed and the list reflows on the data change.
//
// NO dismissal animation. Every fade we tried left a black gap or crashed on the
// inverted, virtualized FlatList: an animated height collapse crashed, and a
// native-driver opacity fade left an orphaned 0-opacity native view occupying the
// cell's space when it was removed. Per our hard preference for robustness over
// polish, the card is simply removed - a clean data-driven reflow, nothing to
// orphan. (Cards still fade IN on mount via the entry animation; that's safe
// because the view is being created, not torn down.)
//
// Safety: mountedRef means the timer never calls onDismiss after unmount;
// cancelledRef (CTA tap) stops a pending removal; the timer is cleared on unmount.
// onDismiss only mutates PARENT state, safe even as this card unmounts.
const AUTO_DISMISS_MS = 6000;

function useAutoDismissFade(
  opts: { enabled: boolean; id: string; onDismiss?: (id: string) => void },
) {
  const { enabled, id, onDismiss } = opts;
  const mountedRef   = useRef(true);
  const cancelledRef = useRef(false);
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;
    cancelledRef.current = false;
    timerRef.current = setTimeout(() => {
      if (!cancelledRef.current && mountedRef.current) onDismiss?.(id);
    }, AUTO_DISMISS_MS);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // onDismiss is a stable useCallback from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, id]);

  return useCallback(() => {
    cancelledRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  message:      Message;
  myGuestId:    string | undefined;
  isGrouped?:   boolean;
  index?:       number;     // used for stagger delay on event items
  showTime?:    boolean;    // show timestamp below bubble (last in sender group)
  dateLabel?:   string;     // if set, render a date separator above this item
  onPromptCta?: (subtype: string) => void;  // called when a prompt card CTA is tapped
  onLongPress?: (msg: Message) => void;     // called on long-press; parent handles reply UI
  onReplyQuotePress?: (replyToId: string) => void;  // tap on quoted preview → scroll to parent
  isHighlighted?: boolean;                          // true = briefly flash orange highlight
  onReact?: (msg: Message, emoji: string) => void;  // called when a reaction pill is tapped
  onResolveJoinRequest?: (requestId: string, action: 'accept' | 'reject') => void; // hangout join req
  // Reminder cards only - when true, the card auto-fades after a delay and calls
  // onAutoDismiss(id) so the parent removes it from the feed. reduceMotion skips
  // the fade (instant removal).
  autoDismiss?:   boolean;
  onAutoDismiss?: (id: string) => void;
  reduceMotion?:  boolean;
  /** PR9 - Challenger / Taker pill next to the nickname on the unified
   *  challenge channel. Computed by the parent against challenge.created_by
   *  and the active acceptor, passed in per message. Mirrors the web
   *  challenge-role-badge in ChallengeChatPage.jsx.
   *  PR23 - Spectator added for posters who joined the channel but are
   *  neither the challenger nor the active taker. */
  roleBadge?:     'challenger' | 'taker' | 'spectator' | null;
  /** World channel: show the author line (name + home-flag) on own messages too. */
  worldScope?:    boolean;
}

// ── Join-request feed card (hangout request-to-join) ──────────────────────────
// Renders a `type: 'join_request'` message. content is JSON:
//   { requestId, requesterName, status, resolvedByName }
// Pending → Accept/Reject (any participant); resolved → who accepted, or a
// discreet "declined" (no shaming). The backend enforces first-write-wins, so
// the buttons just optimistically fire and reconcile on the next feed update.
function JoinRequestCard({ message, onResolve }: {
  message: Message;
  onResolve?: (requestId: string, action: 'accept' | 'reject') => void;
}) {
  const { t } = useTranslation('chat');
  let data: { requestId?: string; requesterName?: string; status?: string; resolvedByName?: string } = {};
  try { data = JSON.parse(message.content ?? '{}'); } catch { /* malformed → render nothing */ }
  const name   = data.requesterName ?? i18n.t('someone', { ns: 'common' });
  const status = data.status ?? 'pending';
  const reqId  = data.requestId;

  return (
    <View style={styles.joinReqRow}>
      <View style={styles.joinReqCard}>
        <Text style={styles.joinReqText}>
          <Text style={styles.joinReqName}>{name}</Text>
          {status === 'pending' ? t('joinReq.wantsToJoin') : status === 'accepted' ? t('joinReq.joinedHangout') : t('joinReq.askedToJoin')}
        </Text>
        {status === 'pending' ? (
          <View style={styles.joinReqBtns}>
            <TouchableOpacity
              style={[styles.joinReqBtn, styles.joinReqReject]}
              activeOpacity={0.8}
              onPress={() => reqId && onResolve?.(reqId, 'reject')}
            >
              <Text style={styles.joinReqRejectText}>{t('joinReq.decline')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.joinReqBtn, styles.joinReqAccept]}
              activeOpacity={0.85}
              onPress={() => reqId && onResolve?.(reqId, 'accept')}
            >
              <Text style={styles.joinReqAcceptText}>{t('joinReq.accept')}</Text>
            </TouchableOpacity>
          </View>
        ) : status === 'accepted' ? (
          <Text style={styles.joinReqResolved}>{data.resolvedByName ? t('joinReq.acceptedBy', { name: data.resolvedByName }) : t('joinReq.accepted')}</Text>
        ) : (
          <Text style={styles.joinReqResolvedMuted}>{t('joinReq.declined')}</Text>
        )}
      </View>
    </View>
  );
}

// ── Animated event pill - fade + slide-up on mount, staggered by index ───────

function AnimatedEventPill({
  message, index, autoDismiss = false, onAutoDismiss, reduceMotion = false,
}: {
  message: Message; index: number;
  autoDismiss?: boolean; onAutoDismiss?: (id: string) => void; reduceMotion?: boolean;
}) {
  const router  = useRouter();
  const { t }   = useTranslation('chat');
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue:         1,
        duration:        260,
        delay:           index * 50,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue:         0,
        duration:        260,
        delay:           index * 50,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const cancelDismiss = useAutoDismissFade({
    enabled: autoDismiss, id: message.id ?? '', onDismiss: onAutoDismiss,
  });

  return (
    <Animated.View style={[styles.eventRow, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.eventPill}>
        <Text style={styles.eventText}>
          {t('bannerNewEvent', { title: message.content })}
        </Text>
        <TouchableOpacity
          style={styles.eventJoinBtn}
          activeOpacity={0.8}
          onPress={() => { cancelDismiss(); if (message.eventId) router.push(`/event/${message.eventId}`); }}
        >
          <Text style={styles.eventJoinText}>{t('join')}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

// ── Date separator - centered pill between days ───────────────────────────────

function DateSeparator({ label }: { label: string }) {
  return (
    <View style={styles.dateSepRow}>
      <View style={styles.dateSepLine} />
      <Text style={styles.dateSepText}>{label}</Text>
      <View style={styles.dateSepLine} />
    </View>
  );
}

// ── Sender identity - avatar + name, always tappable ─────────────────────────
// Always renders as TouchableOpacity so the tap area exists regardless of
// whether the backend has resolved userId yet.
//
// Navigation ID priority: userId (registered account ID) → guestId (fallback).
// The backend profile endpoint accepts both - it tries findById first, then
// findByGuestId - so both forms resolve to the correct profile page.
// Guests with no account get a "User not found" screen, which is the correct
// graceful outcome. This matches DM behaviour where sender_id is always present.

// ── Badge pill ────────────────────────────────────────────────────────────────

const BADGE_CONFIG: Record<string, { bg: string; color: string }> = {
  ghost: { bg: 'rgba(255,255,255,0.06)', color: '#666' },
  fresh: { bg: 'rgba(74,222,128,0.12)',  color: '#4ade80' },
  regular: { bg: 'rgba(96,165,250,0.12)',  color: '#60a5fa' },
  local: { bg: 'rgba(52,211,153,0.12)',  color: '#34d399' },
  host:  { bg: 'rgba(251,191,36,0.15)',  color: '#fbbf24' },
};

function BadgePill({ badge }: { badge: { key: string; label: string } }) {
  const { t } = useTranslation('common');
  const cfg = BADGE_CONFIG[badge.key] ?? BADGE_CONFIG.regular;
  return (
    <View style={[badgeStyles.pill, { backgroundColor: cfg.bg }]}>
      <Text style={[badgeStyles.text, { color: cfg.color }]}>{t(`badge.${badge.key}`, { defaultValue: badge.label })}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  pill: {
    borderRadius:      20,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  text: {
    fontSize:   FontSizes.xs,  // 13 - bumped from 11 (Apple G4 floor)
    fontWeight: '600',
  },
});

// PR9 - role badge (Challenger / Taker) on unified challenge channel rows.
// Mirrors the web .challenge-role-badge tokens - orange tint for challenger
// (matches the app's brand accent), green tint for taker (the "accomplished"
// color used in the pipeline approved state).
// PR23 - Spectator added: neutral slate palette so the badge reads "just
// watching" without competing with the brand colors of the two protagonists.
const roleStyles = StyleSheet.create({
  pill: {
    borderRadius:      999,
    paddingHorizontal: 7,
    paddingVertical:   1,
    borderWidth:       1,
  },
  pillChallenger: {
    backgroundColor: 'rgba(255,122,60,0.14)',
    borderColor:     'rgba(255,122,60,0.30)',
  },
  pillTaker: {
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderColor:     'rgba(74,222,128,0.28)',
  },
  pillSpectator: {
    backgroundColor: 'rgba(148,163,184,0.10)',
    borderColor:     'rgba(148,163,184,0.24)',
  },
  text: {
    fontSize:      11,
    fontWeight:    '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  textChallenger: { color: '#FFB37A' },
  textTaker:      { color: '#4ADE80' },
  textSpectator:  { color: '#94A3B8' },
});

// ── Vibe emoji lookup ─────────────────────────────────────────────────────────

const VIBE_EMOJI: Record<string, string> = {
  party: '🔥', board_games: '🎲', coffee: '☕', music: '🎧', food: '🍜', chill: '🧘',
};

const MODE_EMOJI: Record<string, string> = {
  local: '🌍', exploring: '🧭',
};

// ── SenderMeta ────────────────────────────────────────────────────────────────

function SenderMeta({ nickname, color, initial, userId, guestId, primaryBadge, contextBadge, vibe, mode, roleBadge, isMine, worldScope, thumbAvatarUrl }: {
  nickname:     string;
  color:        string;
  initial:      string;
  userId?:      string;
  guestId?:     string;
  primaryBadge?: Badge;
  contextBadge?: Badge | null;
  vibe?:         string;
  mode?:         string;
  /** PR9 - see ChatMessage Props. */
  roleBadge?:    'challenger' | 'taker' | 'spectator' | null;
  /** World channel: show the author line on own messages too, with a home-flag. */
  isMine?:       boolean;
  worldScope?:   boolean;
  /** Other authors' small proxied avatar thumbnail (from the messages payload). */
  thumbAvatarUrl?: string | null;
}) {
  const router  = useRouter();
  const { t }   = useTranslation('common');
  const { t: tChallenge } = useTranslation('challenge');
  const { account, city } = useApp();
  // Other authors carry a proxied thumbAvatarUrl on the message; own messages
  // aren't badge-enriched, so use the account photo. Either way it's a thumbnail,
  // never the full image.
  const photoThumb = isMine
    ? thumbUrl(account?.profile_photo_url)
    : (thumbAvatarUrl ? thumbUrl(thumbAvatarUrl) : undefined);
  const flagCountry = worldScope ? (isMine ? city?.country ?? null : null) : null;

  // Navigate to a registered profile only when viewer is registered.
  // If viewer is a ghost, redirect to AuthGate instead.
  // Ghost/guest authors navigate to /user/guest (no API call) - not /user/[id].
  function handlePress() {
    if (userId) {
      if (!canAccessProfile(account)) {
        router.push('/auth-gate');
        return;
      }
      router.push({ pathname: '/user/[id]', params: { id: userId } });
    } else if (guestId) {
      // Ghost profiles are always viewable - route to the guest screen, not the
      // registered profile screen. /user/[id] calls GET /users/{id} which only
      // accepts registered user IDs and returns 404 for guestIds.
      router.push({ pathname: '/user/guest', params: { guestId, nickname } });
    }
  }

  const navId = userId ?? guestId;

  const inner = (
    <>
      {photoThumb ? (
        <Image source={{ uri: photoThumb }} style={[styles.avatar, { backgroundColor: color }]} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.avatar, { backgroundColor: color }]}>
          <Text style={styles.avatarLetter}>{initial}</Text>
        </View>
      )}
      <Text style={[styles.author, { color }]}>{nickname}</Text>
      {/* World: home-country flag instead of the local/traveler mode label. */}
      {worldScope ? (
        flagCountry ? <Text style={styles.modeLabel}>{countryToFlag(flagCountry)}</Text> : null
      ) : (() => { const m = mode || (isMine ? account?.mode : undefined) || 'exploring'; return MODE_EMOJI[m] ? (
        <Text style={[styles.modeLabel, m === 'local' ? styles.modeLabelLocal : styles.modeLabelExploring]}>
          {MODE_EMOJI[m]} {t(`mode.${m}.label`)}
        </Text>
      ) : null; })()}
      {vibe && VIBE_EMOJI[vibe] && (
        <Text style={styles.vibeLabel}>{VIBE_EMOJI[vibe]}</Text>
      )}
      {contextBadge?.key === 'host' && <BadgePill badge={contextBadge} />}
      {roleBadge && (
        <View style={[
          roleStyles.pill,
          roleBadge === 'challenger' ? roleStyles.pillChallenger
            : roleBadge === 'taker'  ? roleStyles.pillTaker
            : roleStyles.pillSpectator,
        ]}>
          <Text style={[
            roleStyles.text,
            roleBadge === 'challenger' ? roleStyles.textChallenger
              : roleBadge === 'taker'  ? roleStyles.textTaker
              : roleStyles.textSpectator,
          ]}>
            {tChallenge(`badge.${roleBadge}`)}
          </Text>
        </View>
      )}
    </>
  );

  if (navId) {
    return (
      <TouchableOpacity
        style={styles.meta}
        onPress={handlePress}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        {inner}
      </TouchableOpacity>
    );
  }
  return <View style={styles.meta}>{inner}</View>;
}

// ── Component ─────────────────────────────────────────────────────────────────

function ChatMessageInner({ message, myGuestId, isGrouped = false, index = 0, showTime = false, dateLabel, onPromptCta, onLongPress, onReplyQuotePress, isHighlighted, onReact, onResolveJoinRequest, autoDismiss = false, onAutoDismiss, reduceMotion = false, roleBadge = null, worldScope = false }: Props) {
  const router = useRouter();
  const { t } = useTranslation('chat');
  const { account } = useApp();

  // Tapping a @mention opens the mentioned user's profile (ghost viewers gated).
  function openMentionedProfile(uid: string) {
    if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
    router.push({ pathname: '/user/[id]', params: { id: uid } });
  }

  // Hook called unconditionally - React rules require this before any early return
  const { opacity, translateY } = useEntryAnimation(200);
  const animStyle = { opacity, transform: [{ translateY }] } as const;

  // Auto-dismiss fade for topic/prompt/activity cards (event is handled inside
  // AnimatedEventPill which owns its own opacity). Hook runs unconditionally;
  // `enabled` gates it. cancelDismiss() is wired into the CTAs below.
  const cancelDismiss = useAutoDismissFade({
    // The 'challenge-intro' prompt is intentionally sticky - it's an
    // explainer pill, not a transient reminder. Stays visible until the
    // user taps it (which removes it from the feed) or scrolls past.
    enabled: autoDismiss && (message.type === 'topic' || message.type === 'challenge' || message.type === 'challenge_validated' || message.type === 'activity' || (message.type === 'prompt' && (message as { subtype?: string }).subtype !== 'challenge-intro')),
    id: message.id ?? '',
    onDismiss: onAutoDismiss,
  });

  // Highlight flash when scroll-to-parent lands on this message
  const highlightAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isHighlighted) return;
    highlightAnim.setValue(0.28);
    Animated.timing(highlightAnim, { toValue: 0, duration: 1400, useNativeDriver: false }).start();
  }, [isHighlighted]);

  // Image preview state - must be declared here (before early returns) per hooks rules
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  // Inline handlers - mirrors DmRow pattern to avoid stale-closure issues.
  // onPress/onLongPress are undefined when no handler is provided so the
  // Pressable doesn't participate in the responder system unnecessarily.
  const handlePress     = onLongPress
    ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);  onLongPress(message); }
    : undefined;
  const handleLongPress = onLongPress
    ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(message); }
    : undefined;

  // ── Event feed item - web: .feed-prompt (orange pill + Join CTA) ─────────
  if (message.type === 'event') {
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <AnimatedEventPill
          message={message}
          index={index}
          autoDismiss={autoDismiss}
          onAutoDismiss={onAutoDismiss}
          reduceMotion={reduceMotion}
        />
      </>
    );
  }

  // ── Topic feed item - blue pill + "Join →" CTA ────────────────────────────
  if (message.type === 'topic') {
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <Animated.View style={[styles.eventRow, { opacity, transform: [{ translateY }] }]}>
          <View style={styles.topicPill}>
            <Text style={styles.topicText} numberOfLines={1}>
              💬 {message.content}
            </Text>
            <TouchableOpacity
              style={styles.topicJoinBtn}
              activeOpacity={0.8}
              onPress={() => { cancelDismiss(); if (message.topicId) router.push(`/topic/${message.topicId}`); }}
            >
              <Text style={styles.topicJoinText}>{t('joinArrow')}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </>
    );
  }

  // ── Challenge feed item - orange pill, "{name} défie les locaux : {title}".
  // Mirrors the web .feed-prompt--challenge layout. Tap → /challenge/{id}.
  //
  // Mode-aware copy:
  //   - International rows use a single key (no audience distinction - the
  //     locals/travelers split doesn't apply for cross-city challenges).
  //   - Local rows keep the existing locals/travelers variants.
  if (message.type === 'challenge') {
    const isIntl  = message.challengeMode === 'international';
    const textKey = isIntl
      ? 'bannerChallengeInternational'
      : message.audience === 'explorers'
        ? 'bannerChallengeExplorers'
        : 'bannerChallengeLocals';
    // PR19 - origin → target flag pair for the international banner. Falls
    // back to 🌍 when target_country is null ("anywhere" intl). The local
    // banners ignore these vars; i18next safely no-ops missing tokens.
    const fromFlag = isIntl ? countryToFlag(message.challengeCountry ?? null) || '🌐' : '';
    const toFlag   = isIntl ? countryToFlag(message.challengeTargetCountry ?? null) || '🌍' : '';
    // (Commit 1) Status sub-pill removed alongside max_participants. Commit 2
    // brings it back with 1:1 semantics (Available / In progress / Closed).
    const cEmoji: string | null = null;
    const cLabel: string | null = null;
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <Animated.View style={[styles.eventRow, { opacity, transform: [{ translateY }] }]}>
          <View style={styles.challengePill}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.challengeText} numberOfLines={2}>
                {t(textKey, {
                  name:     message.nickname,
                  title:    message.content,
                  fromFlag,
                  toFlag,
                })}
              </Text>
              {cEmoji && (
                <View style={styles.challengeStatusPill}>
                  <Text style={styles.challengeStatusPillText}>{cEmoji} {cLabel}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={styles.challengeJoinBtn}
              activeOpacity={0.8}
              onPress={() => { cancelDismiss(); if (message.challengeId) router.push(`/challenge/${message.challengeId}`); }}
            >
              <Text style={styles.challengeJoinText}>→</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </>
    );
  }

  // ── Challenge validated celebration - green pill, "🏆 Challenge done!
  // {name} validated …". Lives next to the original creation pill (both
  // are timeline events; we don't replace the older one).
  if (message.type === 'challenge_validated') {
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <Animated.View style={[styles.eventRow, { opacity, transform: [{ translateY }] }]}>
          <View style={styles.challengeValidatedPill}>
            <Text style={styles.challengeValidatedText} numberOfLines={2}>
              {t('bannerChallengeValidated', { name: message.nickname, title: message.content })}
            </Text>
            <TouchableOpacity
              style={styles.challengeValidatedBtn}
              activeOpacity={0.8}
              onPress={() => { cancelDismiss(); if (message.challengeId) router.push(`/challenge/${message.challengeId}`); }}
            >
              <Text style={styles.challengeValidatedBtnText}>→</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </>
    );
  }

  // ── Activity feed item - ambient muted text, no CTA (web: .feed-activity) ──
  if (message.type === 'activity') {
    return (
      <Animated.View style={[styles.activityRow, animStyle]}>
        <Text style={styles.activityText}>{message.content}</Text>
      </Animated.View>
    );
  }

  // ── Prompt feed item - orange card + CTA button (web: .feed-prompt) ─────────
  if (message.type === 'prompt') {
    return (
      <Animated.View style={[styles.promptRow, animStyle]}>
        <Text style={styles.promptText}>{message.content}</Text>
        <TouchableOpacity
          style={styles.promptBtn}
          activeOpacity={0.8}
          onPress={() => { cancelDismiss(); onPromptCta?.(message.subtype ?? ''); }}
        >
          <Text style={styles.promptBtnText}>{message.cta}</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  // ── Join-request feed item (hangout request-to-join) ──────────────────────
  if (message.type === 'join_request') {
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <Animated.View style={animStyle}>
          <JoinRequestCard message={message} onResolve={onResolveJoinRequest} />
        </Animated.View>
      </>
    );
  }

  // ── System / join message - web: .feed-join (centered pill) ──────────────
  if (message.type === 'system') {
    const text = systemText(message);
    const time = message.createdAt ? formatSmartTime(message.createdAt) : null;
    // Only join messages carry user identity - other system events (weather, etc.) are not tappable.
    // Distinguish registered user (userId) from guest (guestId only) to avoid routing guests
    // through the registered-user profile endpoint, which would return 404.
    const isJoin   = message.event === 'join';
    const hasUser  = isJoin && !!message.userId;
    const hasGuest = isJoin && !message.userId && !!message.guestId;
    const pill = (
      <Animated.View style={[styles.systemRow, animStyle]}>
        <Text style={styles.systemText}>{text}</Text>
        {time ? <Text style={styles.systemTime}>{time}</Text> : null}
      </Animated.View>
    );
    const handlePress = hasUser
      ? () => {
          if (!canAccessProfile(account)) {
            router.push('/auth-gate');
            return;
          }
          router.push({ pathname: '/user/[id]', params: { id: message.userId! } });
        }
      : hasGuest
        ? () => router.push({ pathname: '/user/guest', params: { guestId: message.guestId!, nickname: message.nickname ?? '' } })
        : null;
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        {handlePress ? (
          <TouchableOpacity activeOpacity={0.7} onPress={handlePress}>
            {pill}
          </TouchableOpacity>
        ) : pill}
      </>
    );
  }

  const isMine  = Boolean(myGuestId && message.guestId === myGuestId);
  const c1      = avatarColor(message.nickname ?? '?');
  const initial = (message.nickname?.[0] ?? '?').toUpperCase();
  const isSending = message.status === 'sending';
  const isFailed  = message.status === 'failed';
  const isDeleted = Boolean(message.deletedAt);
  const isEdited  = !isDeleted && Boolean(message.editedAt);

  // ── Image message ─────────────────────────────────────────────────────────
  if (message.type === 'image') {
    // Tombstoned image → render as a plain text-style "deleted" bubble (the
    // image URL was cleared server-side, and we want a single visual treatment
    // across kinds so deletions feel consistent).
    if (isDeleted) {
      return (
        <>
          {dateLabel && <DateSeparator label={dateLabel} />}
          <Animated.View style={[
            styles.row,
            isMine    ? styles.rowMine    : styles.rowOther,
            isGrouped ? styles.rowGrouped : styles.rowFirst,
            animStyle,
          ]}>
            {!isGrouped && (
              <SenderMeta
                nickname={message.nickname ?? '?'}
                color={c1}
                initial={initial}
                userId={message.userId}
                guestId={message.guestId}
                primaryBadge={message.primaryBadge}
                contextBadge={message.contextBadge}
                roleBadge={roleBadge}
                vibe={message.vibe}
                mode={message.mode} isMine={isMine} worldScope={worldScope}
                thumbAvatarUrl={message.thumbAvatarUrl}
              />
            )}
            <View style={styles.bubbleWrap}>
              <View style={[
                styles.bubble,
                isMine ? styles.bubbleMine : styles.bubbleOther,
                styles.bubbleTombstone,
              ]}>
                <Text style={styles.tombstoneText}>{t('messageDeleted')}</Text>
              </View>
              {showTime && (
                <Text style={[styles.timestamp, isMine ? styles.timestampMine : styles.timestampOther]}>
                  {formatSmartTime(message.createdAt)}
                </Text>
              )}
            </View>
          </Animated.View>
        </>
      );
    }
    if (!message.imageUrl) {
      console.warn('[msg] image message missing imageUrl:', JSON.stringify(message));
      return null;
    }
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <Animated.View style={[
          styles.row,
          isMine    ? styles.rowMine    : styles.rowOther,
          isGrouped ? styles.rowGrouped : styles.rowFirst,
          animStyle,
          isSending && styles.rowSending,
        ]}>
          {!isGrouped && (
            <SenderMeta
              nickname={message.nickname ?? '?'}
              color={c1}
              initial={initial}
              userId={message.userId}
              guestId={message.guestId}
              primaryBadge={message.primaryBadge}
              contextBadge={message.contextBadge}
              roleBadge={roleBadge}
              vibe={message.vibe}
              mode={message.mode} isMine={isMine} worldScope={worldScope}
              thumbAvatarUrl={message.thumbAvatarUrl}
            />
          )}
          {/* Wrap image + reactions so pills stay visually attached to the bubble */}
          <View>
            <MessageImage
              uri={message.imageUrl}
              isSending={isSending}
              isFailed={isFailed}
              onPress={() => setPreviewUri(message.imageUrl!)}
              onLongPress={handleLongPress}
              imageStyle={[styles.image, isMine ? styles.imageMine : styles.imageOther]}
              surface="city"
            />
            {message.reactions && message.reactions.length > 0 && onReact && (
              <ReactionPills reactions={message.reactions} onReact={e => onReact(message, e)} isMine={isMine} />
            )}
            {showTime && (
              <Text style={[styles.timestamp, isMine ? styles.timestampMine : styles.timestampOther]}>
                {formatSmartTime(message.createdAt)}
              </Text>
            )}
          </View>
        </Animated.View>

        <ImagePreviewModal uri={previewUri} onClose={() => setPreviewUri(null)} />
      </>
    );
  }

  // ── Text message ─────────────────────────────────────────────────────────
  // For deleted messages we render the tombstone bubble unconditionally -
  // server clears `content`, so the "missing content" guard below would
  // otherwise drop the row entirely.
  if (!message.content && !isDeleted) {
    console.warn('[msg] text message missing content:', JSON.stringify(message));
    return null;
  }

  return (
    <>
      {dateLabel && <DateSeparator label={dateLabel} />}
      <Animated.View style={[
        styles.row,
        isMine    ? styles.rowMine    : styles.rowOther,
        isGrouped ? styles.rowGrouped : styles.rowFirst,
        animStyle,
        isSending && styles.rowSending,
      ]}>
        {/* Highlight flash lives on its OWN node (JS-driven backgroundColor).
            It must NOT share a view with the entry animation above, which uses
            useNativeDriver: true - mixing a native-driven node with a JS-driven
            backgroundColor on the SAME node crashes ("animated node moved to
            native earlier"). Absolute overlay behind the content, taps pass through. */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: highlightAnim.interpolate({ inputRange: [0, 0.28], outputRange: ['transparent', 'rgba(255,122,60,0.18)'] }) },
          ]}
        />

        {/* ── Avatar + author - web: .msg-meta ── */}
        {!isGrouped && (
          <SenderMeta
            nickname={message.nickname ?? '?'}
            color={c1}
            initial={initial}
            userId={message.userId}
            guestId={message.guestId}
            primaryBadge={message.primaryBadge}
            contextBadge={message.contextBadge}
            roleBadge={roleBadge}
            vibe={message.vibe}
            mode={message.mode} isMine={isMine} worldScope={worldScope}
            thumbAvatarUrl={message.thumbAvatarUrl}
          />
        )}

        {/* ── Bubble + timestamp + reactions - wrapped so reactions stay attached ── */}
        <View style={styles.bubbleWrap}>
          <Pressable
            onPress={isDeleted ? undefined : handlePress}
            onLongPress={isDeleted ? undefined : handleLongPress}
            delayLongPress={350}
          >
            {isDeleted ? (
              <View style={[
                styles.bubble,
                isMine ? styles.bubbleMine : styles.bubbleOther,
                styles.bubbleTombstone,
              ]}>
                <Text style={styles.tombstoneText}>{t('messageDeleted')}</Text>
              </View>
            ) : isLocationMessage(message.content) ? (
              <LocationBubble content={message.content!} isMine={isMine} />
            ) : (
              <View style={[
                styles.bubble,
                isMine ? styles.bubbleMine : styles.bubbleOther,
                isFailed && styles.bubbleFailed,
              ]}>
                {message.replyTo && (
                  <TouchableOpacity
                    activeOpacity={message.replyTo.id && onReplyQuotePress ? 0.65 : 1}
                    onPress={message.replyTo.id && onReplyQuotePress ? () => onReplyQuotePress!(message.replyTo!.id!) : undefined}
                    disabled={!message.replyTo.id || !onReplyQuotePress}
                  >
                    <View style={[styles.replyQuote, isMine ? styles.replyQuoteMine : styles.replyQuoteOther]}>
                      <Text style={[styles.replyQuoteName, isMine && styles.replyQuoteNameMine]}>
                        {message.replyTo.nickname}
                      </Text>
                      <Text style={[styles.replyQuoteText, isMine && styles.replyQuoteTextMine]} numberOfLines={2}>
                        {message.replyTo.type === 'image' ? t('photoLabel', { ns: 'common' }) : (message.replyTo.content || t('originalUnavailable'))}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
                <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
                  {splitContentByMentions(message.content ?? '', message.mentions).map((seg, i) => (
                    seg.type === 'text'
                      ? linkifyText(seg.text, undefined, `m${i}-`)
                      // Mention = a nested <Text> with a dark highlight + white
                      // text. Stays a plain inline Text (NOT a nested <View>):
                      // inline Views inside Text can render zero-size/invisible on
                      // RN, which made mentions vanish. The dark highlight + white
                      // text is readable on the orange/red sent bubble AND the dark
                      // received bubble (white-on-fill ≥6.5:1). Narrow no-break
                      // spaces ( ) pad the chip slightly without letting the
                      // "@handle" split across a line.
                      : (
                        <Text key={i} style={seg.guestId ? [styles.mentionText, styles.mentionGuest] : styles.mentionText} onPress={seg.guestId ? undefined : () => openMentionedProfile(seg.userId!)}>
                          {` @${seg.username} `}
                        </Text>
                      )
                  ))}
                  {isEdited && (
                    <Text style={[styles.editedTag, isMine && styles.editedTagMine]}>
                      {`  ${t('edited')}`}
                    </Text>
                  )}
                </Text>
                {(() => {
                  const u = extractFirstUrl(message.content);
                  return u ? <LinkPreviewCard url={u} isMine={isMine} /> : null;
                })()}
              </View>
            )}
            {isFailed && (
              <Text style={styles.failedLabel}>{t('failedRetry')}</Text>
            )}
          </Pressable>
          {message.reactions && message.reactions.length > 0 && onReact && (
            <ReactionPills
              reactions={message.reactions}
              onReact={e => {
                if (message.id) reactionEmitter.emit(message.id, EMOJI_TO_TYPE[e] ?? 'heart');
                onReact(message, e);
              }}
              isMine={isMine}
            />
          )}
          {message.id && (
            <ReactionBurstOverlay messageId={message.id} isMine={isMine} />
          )}
          {showTime && (
            <Text style={[styles.timestamp, isMine ? styles.timestampMine : styles.timestampOther]}>
              {formatSmartTime(message.createdAt)}
            </Text>
          )}
        </View>

      </Animated.View>
    </>
  );
}

// Memoized: this row used to re-render on every parent (presence/WS) tick even
// when its own message didn't change, re-running linkify/mention regex each
// time. Shallow prop compare is correct here - the parent now passes stable
// callbacks + value props (see renderMessage in (tabs)/chat.tsx).
export const ChatMessage = memo(ChatMessageInner);

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  bubbleWrap: {
    // No `position: 'relative'` here - that would anchor the ReactionBurstOverlay
    // INSIDE this wrap, putting particles behind the bubble on Android and
    // clipping them inside the FlatList row. Matches DM's bubbleCol pattern so
    // the overlay anchors at the screen root and bursts from a fixed corner.
  },

  // ── .feed-prompt - event orange pill ─────────────────────────────────────
  // Centered column: title on top, Join button below - handles any title length cleanly
  eventRow: {
    alignItems:        'center',
    marginVertical:    4,
    paddingHorizontal: 18,
  },
  eventPill: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   'rgba(255,122,60,0.08)',
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.18)',
    borderRadius:      22,
    paddingHorizontal: 16,
    paddingVertical:   12,
    maxWidth:          '82%',
  },
  eventText: {
    flexShrink:  1,
    fontSize:    16,
    fontWeight:  '600',
    color:       Colors.text,
    lineHeight:  22,
    marginRight: 10,
    textAlign:   'center',
  },
  eventJoinBtn: {
    backgroundColor:   'rgba(255,122,60,0.55)',
    borderRadius:      12,
    paddingHorizontal: 11,
    paddingVertical:   4,
    flexShrink:        0,
  },
  eventJoinText: {
    color:      '#fff',
    fontSize:   15,
    fontWeight: '700',
  },

  // ── Topic feed pill - blue variant of event pill ─────────────────────────
  topicPill: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   'rgba(96,165,250,0.08)',
    borderWidth:       1,
    borderColor:       'rgba(96,165,250,0.18)',
    borderRadius:      22,
    paddingHorizontal: 16,
    paddingVertical:   12,
    maxWidth:          '82%',
  },
  topicText: {
    flexShrink:  1,
    fontSize:    16,
    fontWeight:  '600',
    color:       Colors.text,
    lineHeight:  22,
    marginRight: 10,
  },
  topicJoinBtn: {
    backgroundColor:   'rgba(96,165,250,0.25)',
    borderRadius:      12,
    paddingHorizontal: 11,
    paddingVertical:   4,
    flexShrink:        0,
  },
  topicJoinText: {
    color:      '#fff',
    fontSize:   15,
    fontWeight: '700',
  },

  // ── Challenge feed pill - orange brand variant, mirrors web
  //    .feed-prompt--challenge (rgba(255,122,60,0.14) bg + .30 border). ────
  challengePill: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   'rgba(255,122,60,0.14)',
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.30)',
    borderRadius:      22,
    paddingHorizontal: 16,
    paddingVertical:   12,
    maxWidth:          '82%',
  },
  challengeText: {
    flexShrink:  1,
    fontSize:    16,
    fontWeight:  '600',
    color:       Colors.text,
    lineHeight:  22,
    marginRight: 10,
  },
  challengeJoinBtn: {
    backgroundColor:   'rgba(255,122,60,0.28)',
    borderRadius:      12,
    paddingHorizontal: 11,
    paddingVertical:   4,
    flexShrink:        0,
  },
  // Status sub-pill under the challenge text. Neutral so it doesn't compete
  // with the orange challenge pill background; emoji carries the meaning.
  challengeStatusPill: {
    alignSelf:         'flex-start',
    marginTop:         6,
    backgroundColor:   'rgba(0,0,0,0.20)',
    borderRadius:      999,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.10)',
  },
  challengeStatusPillText: {
    fontSize:      10,
    fontWeight:    '700',
    color:         Colors.muted,
    letterSpacing: 0.3,
  },
  challengeJoinText: {
    color:      '#fff',
    fontSize:   15,
    fontWeight: '700',
  },

  // Validated-celebration variant - green tint (same hue as the validated
  // status badge on the détail screen) so the two challenge pills for the
  // same id read as distinct timeline events.
  challengeValidatedPill: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   'rgba(74,222,128,0.12)',
    borderWidth:       1,
    borderColor:       'rgba(74,222,128,0.30)',
    borderRadius:      22,
    paddingHorizontal: 16,
    paddingVertical:   12,
    maxWidth:          '82%',
  },
  challengeValidatedText: {
    flexShrink:  1,
    fontSize:    16,
    fontWeight:  '600',
    color:       Colors.text,
    lineHeight:  22,
    marginRight: 10,
  },
  challengeValidatedBtn: {
    backgroundColor:   'rgba(74,222,128,0.28)',
    borderRadius:      12,
    paddingHorizontal: 11,
    paddingVertical:   4,
    flexShrink:        0,
  },
  challengeValidatedBtnText: {
    color:      '#fff',
    fontSize:   15,
    fontWeight: '700',
  },

  // ── .feed-activity - ambient muted text, centered ────────────────────────
  // Web: align-self center, 0.8rem, color muted2, border-radius 20px, padding 4 14
  activityRow: {
    alignSelf:         'center',
    marginVertical:    4,
    paddingHorizontal: 14,
    paddingVertical:   4,
  },
  activityText: {
    fontSize:  13,
    color:     Colors.muted2,
    textAlign: 'center',
  },

  // ── .feed-prompt - matches event pill style exactly (web: feed-prompt) ────
  // Same tokens as eventPill so prompts feel like feed items, not buttons.
  promptRow: {
    alignSelf:         'center',
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    backgroundColor:   'rgba(255,122,60,0.08)',
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.18)',
    borderRadius:      22,
    paddingHorizontal: 16,
    paddingVertical:   10,
    marginVertical:    4,
    maxWidth:          '82%',
  },
  promptText: {
    flexShrink:  1,
    fontSize:    15,
    fontWeight:  '500',
    color:       Colors.muted,
    lineHeight:  20,
    marginRight: 10,
  },
  promptBtn: {
    backgroundColor:   'rgba(255,122,60,0.55)',
    borderRadius:      12,
    paddingHorizontal: 11,
    paddingVertical:   4,
    flexShrink:        0,
  },
  promptBtnText: {
    color:      '#fff',
    fontSize:   14,
    fontWeight: '700',
  },

  // ── .feed-join - centered pill ────────────────────────────────────────────
  // Web: font-size 0.85rem (~13.6px), font-weight 500, padding 6px 16px,
  //      margin 12px 0, border-radius 20px, bg rgba(255,255,255,0.04)
  systemRow: {
    alignItems:        'center',
    marginVertical:    6,
    paddingHorizontal: 16,
    gap:               4,
  },
  systemTime: {
    fontSize:   10,
    color:      Colors.muted2,
    opacity:    0.6,
  },
  systemText: {
    fontSize:          FontSizes.xs,   // 13 - smaller than the 15 message body
    fontStyle:         'italic',
    fontWeight:        '400',
    color:             Colors.muted2,
    backgroundColor:   'rgba(255,255,255,0.04)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.07)',
    borderRadius:      14,
    paddingHorizontal: 13,
    paddingVertical:   5,
    overflow:          'hidden',
  },

  // ── .message ─────────────────────────────────────────────────────────────
  row: {
    flexDirection: 'column',
    maxWidth:      '72%',
  },
  // alignItems shrinks children to content width so short bubbles don't stretch
  rowOther:   { alignSelf: 'flex-start', alignItems: 'flex-start', paddingLeft: 14 },
  rowMine:    { alignSelf: 'flex-end',   alignItems: 'flex-end',   paddingRight: 14 },
  rowFirst:   { marginTop: 8 },
  rowGrouped: { marginTop: 3 },
  rowSending: { opacity: 0.65 },

  // ── .msg-meta ─────────────────────────────────────────────────────────────
  meta: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    paddingLeft:   2,
    marginBottom:  4,
  },

  // ── .msg-avatar ───────────────────────────────────────────────────────────
  avatar: {
    width:          34,
    height:         34,
    borderRadius:   17,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
    shadowColor:    '#000',
    shadowOffset:   { width: 0, height: 2 },
    shadowOpacity:  0.4,
    shadowRadius:   4,
    elevation:      4,
  },
  avatarLetter: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // ── .msg-author ───────────────────────────────────────────────────────────
  author:    { fontSize: 13, fontWeight: '700', opacity: 0.9 },
  modeLabel:          { fontSize: FontSizes.xs, fontWeight: '600' },
  vibeLabel:          { fontSize: 13, opacity: 0.55 },
  modeLabelLocal:     { color: '#FF7A3C', opacity: 0.85 },
  modeLabelExploring: { color: '#60a5fa', opacity: 0.85 },

  // ── .msg-content ──────────────────────────────────────────────────────────
  bubble: {
    borderRadius:      16,
    paddingHorizontal: 10,
    paddingVertical:   6,
  },
  bubbleOther: {
    backgroundColor:     Colors.bg3,
    borderWidth:         1,
    borderColor:         'rgba(255,255,255,0.05)',
    borderTopLeftRadius: 4,
  },
  bubbleMine: {
    backgroundColor:      '#B87228',
    borderTopRightRadius: 4,
    shadowColor:          '#8a5418',
    shadowOffset:         { width: 0, height: 2 },
    shadowOpacity:        0.35,
    shadowRadius:         6,
    elevation:            4,
  },
  bubbleText:     { fontSize: 15,           color: Colors.text,  lineHeight: 20 },
  bubbleTextMine: { color: '#fff' },
  // Tombstone - keep the same bubble silhouette but flatten the fill so it
  // visually reads as inactive without losing the position-in-thread anchor.
  bubbleTombstone: {
    opacity: 0.6,
  },
  tombstoneText: {
    fontSize:   15,
    fontStyle:  'italic',
    color:      'rgba(255,255,255,0.55)',
    lineHeight: 20,
  },
  // "edited" suffix - small muted text appended after the message content. Kept
  // inline (inside the same <Text>) so it wraps naturally with the last word.
  editedTag: {
    fontSize: 11,
    color:    'rgba(255,255,255,0.45)',
  },
  editedTagMine: {
    color: 'rgba(255,255,255,0.65)',
  },
  // @mention - inline highlight on a nested <Text> (no nested <View>, which can
  // render invisible on RN). Dark fill + white bold text reads on the dark
  // received bubble AND the orange/red sent bubble (#B87228): white-on-fill
  // contrast is ≥6.5:1 (vs the old orange-on-orange ~1.5:1). borderRadius isn't
  // honored on inline text backgrounds, so this is a tight highlight, not a
  // rounded pill - but it's robust and readable everywhere.
  mentionText: {
    color:           '#fff',
    fontWeight:      '700',
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  // Online-guest mention - purple tint distinguishes it from member mentions.
  mentionGuest: {
    backgroundColor: 'rgba(139,92,246,0.30)',
  },

  // ── Join-request feed card ─────────────────────────────────────────────────
  joinReqRow:  { alignItems: 'center', marginVertical: 6, paddingHorizontal: 18 },
  joinReqCard: {
    width:           '100%',
    maxWidth:        '88%',
    backgroundColor: 'rgba(96,165,250,0.08)',
    borderWidth:     1,
    borderColor:     'rgba(96,165,250,0.20)',
    borderRadius:    16,
    paddingHorizontal: 14,
    paddingVertical:   12,
    gap:             10,
  },
  joinReqText: { fontSize: FontSizes.sm, color: Colors.text, textAlign: 'center' },
  joinReqName: { fontWeight: '700' },
  joinReqBtns: { flexDirection: 'row', gap: 10 },
  joinReqBtn:  { flex: 1, paddingVertical: 9, borderRadius: 12, alignItems: 'center' },
  joinReqAccept:     { backgroundColor: Colors.accent },
  joinReqAcceptText: { color: '#fff', fontWeight: '700', fontSize: FontSizes.sm },
  joinReqReject:     { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: Colors.border },
  joinReqRejectText: { color: Colors.muted, fontWeight: '600', fontSize: FontSizes.sm },
  joinReqResolved:      { fontSize: FontSizes.xs, color: '#4ade80', fontWeight: '600', textAlign: 'center' },
  joinReqResolvedMuted: { fontSize: FontSizes.xs, color: Colors.muted2, textAlign: 'center' },

  // Failed state
  bubbleFailed: {
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.5)',
  },
  failedLabel: {
    fontSize:   FontSizes.xs,
    color:      Colors.red,
    marginTop:  4,
    marginLeft: 4,
  },

  // ── Date separator ────────────────────────────────────────────────────────
  dateSepRow: {
    flexDirection:     'row',
    alignItems:        'center',
    marginVertical:    18,
    paddingHorizontal: 18,
    gap:               10,
  },
  dateSepLine: {
    flex:            1,
    height:          1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  dateSepText: {
    fontSize:          FontSizes.xs,  // 13 - was 11 (Apple G4 floor)
    fontWeight:        '600',
    color:             Colors.muted2,
    letterSpacing:     0.5,
    textTransform:     'uppercase',
    backgroundColor:   Colors.bg2,
    paddingHorizontal: 10,
    paddingVertical:   3,
    borderRadius:      999,
    overflow:          'hidden',
  },

  // ── Per-bubble timestamp ──────────────────────────────────────────────────
  // 13pt + new muted2 (~4.7:1) - was 11pt + #635650 (~2.4:1). Apple G4
  // cited "Yesterday · 03:29" as one of the unreadable cases.
  timestamp: {
    fontSize:   FontSizes.xs,
    marginTop:  3,
    color:      Colors.muted2,
  },
  timestampMine:  { textAlign: 'right',  paddingRight: 2 },
  timestampOther: { textAlign: 'left',   paddingLeft: 2 },

  // ── Reply quote - bleeds to bubble edges (negative margins cancel padding) ─
  // Mirrors the web bleed technique: quote spans full bubble width,
  // a bottom border acts as a visual separator before the message text.
  replyQuote: {
    // cancel bubble's own padding so the quote background spans edge-to-edge
    marginTop:    -8,   // cancel paddingVertical
    marginLeft:   -12,  // cancel paddingHorizontal
    marginRight:  -12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical:   7,
    borderLeftWidth:   3,
    borderBottomWidth: 1,
  },
  replyQuoteOther: {
    backgroundColor:  'rgba(0,0,0,0.12)',
    borderLeftColor:  'rgba(255,122,60,0.75)',
    borderBottomColor:'rgba(255,255,255,0.06)',
    borderTopLeftRadius:  4,
    borderTopRightRadius: 16,
  },
  replyQuoteMine: {
    backgroundColor:  'rgba(0,0,0,0.2)',
    borderLeftColor:  'rgba(255,255,255,0.45)',
    borderBottomColor:'rgba(255,255,255,0.1)',
    borderTopLeftRadius:  16,
    borderTopRightRadius: 4,
  },
  replyQuoteName: {
    fontSize:     FontSizes.xs,
    fontWeight:   '700',
    color:        '#FF7A3C',
    marginBottom: 2,
    lineHeight:   17,
  },
  replyQuoteNameMine: { color: 'rgba(255,255,255,0.8)' },
  replyQuoteText: {
    fontSize:   12,
    color:      Colors.muted2,
    lineHeight: 16,
  },
  replyQuoteTextMine: { color: 'rgba(255,255,255,0.55)' },

  // ── .msg-image ────────────────────────────────────────────────────────────
  image: { width: 280, height: 240, marginTop: 2 },
  imageOther: {
    borderTopLeftRadius:     4,
    borderTopRightRadius:    16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius:  16,
  },
  imageMine: {
    borderTopLeftRadius:     16,
    borderTopRightRadius:    4,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius:  16,
  },
});
