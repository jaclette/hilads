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
import { DailyChannelCard } from '@/features/daily/DailyChannelCard';
import { isDailyCard } from '@/lib/dailyEvents';
import { ReactionBurstOverlay } from './ReactionBurstOverlay';
import { reactionEmitter, EMOJI_TO_TYPE } from '@/lib/reactionEmitter';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LocalPassBadge } from '@/features/daily/LocalPassBadge';
import i18n from '@/i18n';
import * as Haptics from 'expo-haptics';
import { Border, FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { Ionicons } from '@expo/vector-icons';
import { Avatar, Button } from '@/ui';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
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
import { parseSharedHiladsLink, sharedLinkRoute } from '@/lib/sharedLink';
import { fetchShowcaseItem, type ShowcaseItem } from '@/api/challenges';
import { ShowcasePreviewSheet } from '@/features/challenges/ShowcasePreviewSheet';

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
    // No maps app answered: OpenStreetMap in the browser (never Google, SPEC 9.5).
    Linking.openURL(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`);
  });
}

function LocationBubble({ content, isMine }: { content: string; isMine: boolean }) {
  const locStyles = useThemedStyles(makeLocStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('chat');
  const { line1, place, lat, lng, address } = parseLocation(content);
  const hasCoords = lat !== undefined && lng !== undefined;
  const card = (
    <View style={[locStyles.card, isMine ? locStyles.cardMine : locStyles.cardOther]}>
      <Ionicons name="location" size={22} color={isMine ? colors.white : colors.primary} style={locStyles.icon} />
      <View style={locStyles.body}>
        <Text style={[locStyles.line1, isMine && locStyles.textMine]} numberOfLines={2}>{line1.replace('📍 ', '')}</Text>
        {!!address && <Text style={[locStyles.addr, isMine && locStyles.addrMine]} numberOfLines={2}>{address}</Text>}
        {hasCoords && <Text style={[locStyles.tapHint, isMine && locStyles.tapHintMine]}>{t('tapToOpenMaps')}</Text>}
      </View>
    </View>
  );
  if (hasCoords) {
    // Use place name or address as the map label - never the social display wording ("nick is at ...")
    const mapLabel = place || address;
    return (
      <TouchableOpacity activeOpacity={0.75} onPress={() => openMaps(lat!, lng!, mapLabel)} accessibilityRole="link">
        {card}
      </TouchableOpacity>
    );
  }
  return card;
}

const makeLocStyles = (c: ThemeColors) => StyleSheet.create({
  // minWidth is required: the row shrinks children to content width, which
  // would collapse the flex body and leave only the pin visible.
  card:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12,
                 minWidth: 200, maxWidth: 260 },
  cardOther:   { backgroundColor: c.bg3, borderTopLeftRadius: 6 },
  cardMine:    { backgroundColor: c.caramel, borderTopRightRadius: 6 },
  icon:        { marginTop: 1, flexShrink: 0 },
  body:        { flex: 1, flexShrink: 1, minWidth: 0, gap: 3 },
  line1:       { fontSize: FontSizes.sm, fontWeight: '700', color: c.text, lineHeight: 20 },
  addr:        { fontSize: 12, fontWeight: '400', color: c.muted, lineHeight: 17 },
  textMine:    { color: c.white },
  addrMine:    { color: c.onCaramelMuted },
  tapHint:     { fontSize: FontSizes.xs, fontWeight: '600', color: c.primaryText, marginTop: 2 },
  tapHintMine: { color: c.onCaramelMuted },
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
  /** City channel of a live city: Daily Challenge cards show the Local Twist. */
  dailyLive?:     boolean;
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
  const styles = useThemedStyles(makeStyles);
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
            <Button variant="secondary" size="sm" label={t('joinReq.decline')} onPress={() => reqId && onResolve?.(reqId, 'reject')} style={styles.joinReqBtn} />
            <Button size="sm" label={t('joinReq.accept')} onPress={() => reqId && onResolve?.(reqId, 'accept')} style={styles.joinReqBtn} />
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
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
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
      <View style={styles.feedCard}>
        <Ionicons name="calendar-outline" size={20} color={colors.primaryText} />
        <Text style={styles.feedText}>
          {t('bannerNewEvent', { title: message.content })}
        </Text>
        <Button size="sm" label={t('join')} onPress={() => { cancelDismiss(); if (message.eventId) router.push(`/event/${message.eventId}`); }} />
      </View>
    </Animated.View>
  );
}

// ── Date separator - centered pill between days ───────────────────────────────

function DateSeparator({ label }: { label: string }) {
  const styles = useThemedStyles(makeStyles);
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

// Only the host badge is shown in the feed: a gold label (Local Pass family).
function BadgePill({ badge }: { badge: { key: string; label: string } }) {
  const badgeStyles = useThemedStyles(makeBadgeStyles);
  const { t } = useTranslation('common');
  return (
    <View style={badgeStyles.pill}>
      <Text style={badgeStyles.text}>{t(`badge.${badge.key}`, { defaultValue: badge.label })}</Text>
    </View>
  );
}

const makeBadgeStyles = (c: ThemeColors) => StyleSheet.create({
  pill: { height: 20, justifyContent: 'center', borderRadius: Radius.full, paddingHorizontal: 7, backgroundColor: c.bg3 },
  text: { fontSize: 11, fontWeight: '700', color: c.gold },
});

// PR9 - role badge (Challenger / Taker) on unified challenge channel rows.
// Mirrors the web .challenge-role-badge tokens - orange tint for challenger
// (matches the app's brand accent), green tint for taker (the "accomplished"
// color used in the pipeline approved state).
// PR23 - Spectator added: neutral slate palette so the badge reads "just
// watching" without competing with the brand colors of the two protagonists.
const makeRoleStyles = (c: ThemeColors) => StyleSheet.create({
  pill:           { height: 20, justifyContent: 'center', borderRadius: Radius.full, paddingHorizontal: 7 },
  pillChallenger: { backgroundColor: c.primaryTint },
  pillTaker:      { backgroundColor: c.localBg },
  pillSpectator:  { backgroundColor: c.bg3 },
  text:           { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  textChallenger: { color: c.primaryOnTint },
  textTaker:      { color: c.localText },
  textSpectator:  { color: c.muted },
});

// ── Vibe emoji lookup ─────────────────────────────────────────────────────────

const MODE_EMOJI: Record<string, string> = {
  local: '🌍', exploring: '🧭',
};

// ── SenderMeta ────────────────────────────────────────────────────────────────

function SenderMeta({ nickname, color, initial, userId, guestId, primaryBadge, contextBadge, vibe, mode, roleBadge, isMine, worldScope, thumbAvatarUrl, country, localPass = false }: {
  localPass?:   boolean;
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
  /** Other authors' home-country ISO-2 (World only) - drives the flag. */
  country?:      string | null;
}) {
  const roleStyles = useThemedStyles(makeRoleStyles);
  const styles = useThemedStyles(makeStyles);
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
  // World: own flag from current city; other authors' flag from their home country.
  const flagCountry = worldScope ? (isMine ? city?.country ?? null : (country ?? null)) : null;

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
  // chat.html: own messages carry no author line in a city (World keeps it, with the flag).
  if (isMine && !worldScope) return null;

  const inner = (
    <>
      <Avatar uri={photoThumb ?? null} name={nickname || initial} size={30} fallback="color" />
      <Text style={styles.author}>{nickname}</Text>
      {/* World: home-country flag instead of the local/traveler mode label. */}
      {worldScope ? (
        flagCountry ? <Text style={styles.modeFlag}>{countryToFlag(flagCountry)}</Text> : null
      ) : (() => { const m = mode || (isMine ? account?.mode : undefined) || 'exploring'; return MODE_EMOJI[m] ? (
        <Text style={[styles.modeLabel, m === 'local' ? styles.modeLabelLocal : styles.modeLabelExploring]}>
          {t(`mode.${m}.label`)}
        </Text>
      ) : null; })()}
      {contextBadge?.key === 'host' && <BadgePill badge={contextBadge} />}
      {/* Holds this city's Daily Challenge Local Pass (city chats only). */}
      {localPass && <LocalPassBadge />}
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
        hitSlop={{ top: 7, bottom: 7, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={nickname}
      >
        {inner}
      </TouchableOpacity>
    );
  }
  return <View style={styles.meta}>{inner}</View>;
}

// Round "open" arrow at the end of a feed card (challenge rows).
function FeedArrow({ onPress }: { onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  return (
    <TouchableOpacity style={styles.feedArrow} onPress={onPress} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t('open')}>
      <Ionicons name="arrow-forward" size={20} color={colors.white} />
    </TouchableOpacity>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

function ChatMessageInner({ message, myGuestId, isGrouped = false, index = 0, showTime = false, dateLabel, onPromptCta, onLongPress, onReplyQuotePress, isHighlighted, onReact, onResolveJoinRequest, autoDismiss = false, onAutoDismiss, reduceMotion = false, roleBadge = null, worldScope = false, dailyLive = false }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
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
  // Success preview for a World "X won the challenge Y" row (same hooks rule).
  const [wonItem, setWonItem] = useState<ShowcaseItem | null>(null);

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
          <View style={styles.feedCard}>
            <Ionicons name="hand-left-outline" size={20} color={colors.primaryText} />
            <Text style={styles.feedText} numberOfLines={1}>{message.content}</Text>
            <Button size="sm" label={t('join')} onPress={() => { cancelDismiss(); if (message.topicId) router.push(`/topic/${message.topicId}`); }} />
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
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <Animated.View style={[styles.eventRow, { opacity, transform: [{ translateY }] }]}>
          <View style={styles.feedCard}>
            <Ionicons name="flame-outline" size={20} color={colors.primaryText} />
            <View style={styles.feedBody}>
              <Text style={styles.feedText} numberOfLines={2}>
                {t(textKey, {
                  name:     message.nickname,
                  title:    message.content,
                  fromFlag,
                  toFlag,
                })}
              </Text>
            </View>
            <FeedArrow onPress={() => { cancelDismiss(); if (message.challengeId) router.push(`/challenge/${message.challengeId}`); }} />
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
          <View style={styles.feedCard}>
            <Ionicons name="trophy-outline" size={20} color={colors.localText} />
            <Text style={styles.feedText} numberOfLines={2}>
              {t('bannerChallengeValidated', { name: message.nickname, title: message.content })}
            </Text>
            <FeedArrow onPress={() => { cancelDismiss(); if (message.challengeId) router.push(`/challenge/${message.challengeId}`); }} />
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
      <Animated.View style={[styles.eventRow, animStyle]}>
        <View style={styles.feedCard}>
          <Text style={styles.feedText}>{message.content}</Text>
          {!!message.cta && <Button size="sm" label={message.cta} onPress={() => { cancelDismiss(); onPromptCta?.(message.subtype ?? ''); }} />}
        </View>
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

  // ── Daily Challenge cards (system + daily_challenge / daily_proof) ─────────
  if (isDailyCard(message)) {
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <DailyChannelCard message={message} isLive={dailyLive} onLongPress={onLongPress} onReact={onReact} />
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
    // A World win announces a real success story - open the same preview the
    // Success-challenges carousel shows (photo, challenger, taker, their notes).
    const wonId = message.event === 'challenge_won'
      ? (((message as { payload?: Record<string, string> }).payload ?? {}).challenge_id ?? null)
      : null;
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
        : wonId
          ? () => {
              // Not every win is showcase-eligible (private, or no approved
              // proof yet) - fall back to the challenge so the row is never a
              // dead tap.
              fetchShowcaseItem(wonId)
                .then(item => {
                  if (item) setWonItem(item);
                  else router.push({ pathname: '/challenge/[id]', params: { id: wonId } });
                })
                .catch(() => router.push({ pathname: '/challenge/[id]', params: { id: wonId } }));
            }
          : null;
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        {handlePress ? (
          <TouchableOpacity activeOpacity={0.7} onPress={handlePress}>
            {pill}
          </TouchableOpacity>
        ) : pill}
        <ShowcasePreviewSheet
          item={wonItem}
          onClose={() => setWonItem(null)}
          onAvatar={(uid) => {
            setWonItem(null);
            if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
            router.push({ pathname: '/user/[id]', params: { id: uid } });
          }}
        />
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
  // Shared internal Hilads link (challenge / Hi plan / Hi now / leaderboard):
  // hide the raw URL in the bubble text and render a fun CTA that opens it in-app.
  const sharedLink    = parseSharedHiladsLink(message.content);
  const bubbleContent = sharedLink ? (message.content ?? '').replace(sharedLink.url, '').trimEnd() : (message.content ?? '');

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
                thumbAvatarUrl={message.thumbAvatarUrl} country={message.country}
                localPass={!worldScope && !!message.localPass}
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
              thumbAvatarUrl={message.thumbAvatarUrl} country={message.country}
              localPass={!worldScope && !!message.localPass}
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
            { backgroundColor: highlightAnim.interpolate({ inputRange: [0, 0.28], outputRange: ['transparent', colors.primaryTint] }) },
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
            thumbAvatarUrl={message.thumbAvatarUrl} country={message.country}
            localPass={!worldScope && !!message.localPass}
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
                    <View style={[styles.replyQuote, isMine ? styles.replyQuoteMine : styles.replyQuoteOther]} accessibilityRole="button">
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
                  {splitContentByMentions(bubbleContent, message.mentions).map((seg, i) => (
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
                        <Text key={i} style={[styles.mentionText, isMine && styles.mentionMine, !!seg.guestId && styles.mentionGuest]} onPress={seg.guestId ? undefined : () => openMentionedProfile(seg.userId!)}>
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
                {sharedLink ? (() => {
                  const isCampaign = sharedLink.kind === 'challenge' && !!sharedLink.campaign;
                  const pill = isCampaign
                    ? (sharedLink.scope === 'global' ? t('campaignAllCities') : sharedLink.scope === 'world' ? t('campaignWorld') : null)
                    : null;
                  return (
                    <View>
                      {pill ? (
                        <View style={styles.campaignScopePill}>
                          <Ionicons name="globe-outline" size={12} color={colors.white} />
                          <Text style={styles.campaignScopePillText}>{pill}</Text>
                        </View>
                      ) : null}
                      <TouchableOpacity
                        style={[styles.sharedLinkCta, isCampaign && styles.sharedLinkCtaCampaign]}
                        onPress={() => router.push(sharedLinkRoute(sharedLink) as never)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                      >
                        <Text style={styles.sharedLinkCtaText} numberOfLines={2}>
                          {isCampaign
                            ? t('campaignCta')
                            : t(`shareCta.${sharedLink.kind}`, { ns: 'common' })}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })() : (() => {
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

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  bubbleWrap: {},

  // ── Feed cards: plans, Hi now, challenges, prompts (chat.html card look) ──
  eventRow:  { alignItems: 'center', marginVertical: 6, paddingHorizontal: Spacing.md },
  feedCard:  { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingLeft: 14, paddingRight: 8,
               paddingVertical: 8, borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  feedBody:  { flex: 1, minWidth: 0 },
  feedText:  { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: c.text, lineHeight: 20 },
  feedArrow: { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },

  activityRow:  { alignSelf: 'center', marginVertical: 4, paddingHorizontal: 14, paddingVertical: 4 },
  activityText: { fontSize: 12, fontWeight: '600', color: c.muted, textAlign: 'center' },

  // ── System line (chat.html): small, muted, centred ──
  systemRow:  { alignItems: 'center', marginVertical: 6, paddingHorizontal: Spacing.md, gap: 2 },
  systemText: { fontSize: 12, fontWeight: '600', color: c.muted, textAlign: 'center' },
  systemTime: { fontSize: 11, fontWeight: '400', color: c.mutedDim },

  row:        { flexDirection: 'column', maxWidth: '78%' },
  rowOther:   { alignSelf: 'flex-start', alignItems: 'flex-start', paddingLeft: Spacing.md },
  rowMine:    { alignSelf: 'flex-end', alignItems: 'flex-end', paddingRight: Spacing.md },
  rowFirst:   { marginTop: 10 },
  rowGrouped: { marginTop: 3 },
  rowSending: { opacity: 0.65 },

  meta:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  author: { fontSize: 13, fontWeight: '700', color: c.text },
  modeLabel:          { fontSize: 11, fontWeight: '700', paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.full, overflow: 'hidden' },
  modeLabelLocal:     { color: c.primaryOnTint, backgroundColor: c.primaryTint },
  modeLabelExploring: { color: c.travelerText, backgroundColor: c.travelerBg },
  modeFlag:           { fontSize: FontSizes.xs },

  // ── Bubbles (chat.html): others on the warm grey, mine on caramel ──
  bubble:         { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleOther:    { backgroundColor: c.bg3, borderTopLeftRadius: 6 },
  bubbleMine:     { backgroundColor: c.caramel, borderTopRightRadius: 6 },
  bubbleText:     { fontSize: FontSizes.sm, fontWeight: '400', color: c.text, lineHeight: 20 },
  bubbleTextMine: { color: c.white },
  sharedLinkCta:  { alignSelf: 'flex-start', marginTop: 8, minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: Radius.full, backgroundColor: c.gold },
  sharedLinkCtaText:     { fontSize: FontSizes.xs, fontWeight: '800', color: c.white },
  sharedLinkCtaCampaign: { alignSelf: 'stretch', alignItems: 'center' },
  campaignScopePill:     { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, marginBottom: 6,
                           paddingHorizontal: 9, height: 22, borderRadius: Radius.full, backgroundColor: c.gold },
  campaignScopePillText: { fontSize: 11, fontWeight: '800', color: c.white },
  bubbleTombstone: { opacity: 0.7 },
  tombstoneText:   { fontSize: FontSizes.sm, fontWeight: '400', fontStyle: 'italic', color: c.muted, lineHeight: 20 },
  editedTag:       { fontSize: 11, fontWeight: '400', color: c.muted },
  editedTagMine:   { color: c.onCaramelMuted },
  mentionText:     { fontWeight: '700', color: c.primaryText },
  mentionMine:     { color: c.white, textDecorationLine: 'underline' },
  mentionGuest:    { color: c.travelerText },

  joinReqRow:  { alignItems: 'center', marginVertical: 6, paddingHorizontal: Spacing.md },
  joinReqCard: { alignSelf: 'stretch', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: Radius.card,
                 borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  joinReqText: { fontSize: FontSizes.sm, fontWeight: '400', color: c.text, textAlign: 'center' },
  joinReqName: { fontWeight: '700' },
  joinReqBtns: { flexDirection: 'row', gap: 10 },
  joinReqBtn:  { flex: 1 },
  joinReqResolved:      { fontSize: FontSizes.xs, fontWeight: '600', color: c.localText, textAlign: 'center' },
  joinReqResolvedMuted: { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted, textAlign: 'center' },

  bubbleFailed: { borderWidth: Border, borderColor: c.red },
  failedLabel:  { fontSize: FontSizes.xs, fontWeight: '600', color: c.red, marginTop: 4, marginLeft: 4 },

  dateSepRow:  { flexDirection: 'row', alignItems: 'center', marginVertical: 16, paddingHorizontal: Spacing.md, gap: 10 },
  dateSepLine: { flex: 1, height: 1, backgroundColor: c.line },
  dateSepText: { fontSize: 12, fontWeight: '700', color: c.muted },

  timestamp:      { fontSize: 11, fontWeight: '400', marginTop: 3, color: c.mutedDim },
  timestampMine:  { textAlign: 'right', paddingRight: 2 },
  timestampOther: { textAlign: 'left', paddingLeft: 2 },

  // Quote of the replied message: a left rule inside the bubble.
  replyQuote:         { marginBottom: 6, paddingLeft: 8, paddingVertical: 2, borderLeftWidth: 3 },
  replyQuoteOther:    { borderLeftColor: c.primary },
  replyQuoteMine:     { borderLeftColor: c.onCaramelMuted },
  replyQuoteName:     { fontSize: 12, fontWeight: '700', color: c.primaryText, lineHeight: 16 },
  replyQuoteNameMine: { color: c.white },
  replyQuoteText:     { fontSize: 12, fontWeight: '400', color: c.muted, lineHeight: 16 },
  replyQuoteTextMine: { color: c.onCaramelMuted },

  image:      { width: 260, height: 220, marginTop: 2 },
  imageOther: { borderRadius: 18, borderTopLeftRadius: 6 },
  imageMine:  { borderRadius: 18, borderTopRightRadius: 6 },
});
