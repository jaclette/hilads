/**
 * City channel screen — faithful port of the web "ready" state.
 *
 * Web source: App.jsx (status === 'ready'), index.css (.chat-header, .messages, .input-bar)
 *
 * Header mirrors web renderCityHero() on mobile:
 *   Logo icon → city name + flag → online count pill ("N hanging out" / "live now")
 *
 * Messages mirror web feed: system pills, regular messages with avatar + author + grouped bubbles.
 * Input mirrors web .input-bar: pill input, image button, send button.
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
  TouchableOpacity, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useMessages } from '@/hooks/useMessages';
import { fetchMessages, sendMessage, sendImageMessage } from '@/api/channels';
import { socket } from '@/lib/socket';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput, getPlaceholder } from '@/features/chat/ChatInput';
import { HiladsIcon } from '@/components/HiladsIcon';
import { Colors, FontSizes, Spacing } from '@/constants';
import type { Message } from '@/types';

// ── Flag emoji — mirrors web cityFlag() ──────────────────────────────────────

function cityFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

// ── Animated pulse dot — mirrors web .online-pulse keyframe ──────────────────
// Web: background var(--accent) #C24A38, 7px circle, scale+opacity pulse 2.2s

function PulseDot() {
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1.25, duration: 1100, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1,    duration: 1100, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1,   duration: 1100, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.9, duration: 1100, useNativeDriver: true }),
        ]),
      ]),
    ).start();
  }, []);

  return (
    <Animated.View style={[styles.pulseDot, { transform: [{ scale }], opacity }]} />
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ChatTab() {
  const router  = useRouter();
  const { city, identity, sessionId, account, unreadDMs } = useApp();

  // Online count — populated by WS presenceSnapshot, fallback "live now"
  const [onlineCount, setOnlineCount] = useState<number | null>(null);

  useEffect(() => {
    const off = socket.on('presenceSnapshot', (data: { count?: number; users?: unknown[] }) => {
      if (data.count != null)          setOnlineCount(data.count);
      else if (Array.isArray(data.users)) setOnlineCount(data.users.length);
    });
    return off;
  }, []);

  const channelId = city?.channelId ?? '';

  const loadFn = useCallback(
    () => fetchMessages(channelId),
    [channelId],
  );

  const postTextFn = useCallback(
    (content: string): Promise<Message> => {
      if (!identity || !sessionId) return Promise.reject(new Error('Not ready'));
      return sendMessage(channelId, sessionId, identity.guestId, identity.nickname, content);
    },
    [channelId, identity, sessionId],
  );

  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> => {
      if (!identity || !sessionId) return Promise.reject(new Error('Not ready'));
      return sendImageMessage(channelId, sessionId, identity.guestId, identity.nickname, imageUrl);
    },
    [channelId, identity, sessionId],
  );

  const { messages, loading, sending, error, clearError, sendText, sendImage } = useMessages({
    channelId,
    loadFn,
    postTextFn,
    postImageFn,
  });

  // No city yet — prompt to pick one
  if (!city) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.noCityWrap}>
          <Text style={styles.noCityTitle}>No city selected</Text>
          <Text style={styles.noCitySubtitle}>
            We couldn't detect your location.{'\n'}Go to Cities to pick one.
          </Text>
          <TouchableOpacity
            style={styles.citiesBtn}
            onPress={() => router.push('/(tabs)/cities')}
            activeOpacity={0.8}
          >
            <Text style={styles.citiesBtnText}>Browse cities →</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const flag = cityFlag(city.country);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ── Header — web: .chat-header + renderCityHero() (mobile variant) ── */}
      {/*                                                                      */}
      {/* Web structure:                                                        */}
      {/*   .chat-header { radial-gradient bg, border-bottom }                 */}
      {/*   .header-hero { flex col, center, gap 18, min-height 148 }          */}
      {/*     Logo icon                                                         */}
      {/*     .header-hero-city                                                 */}
      {/*       .header-hero-name: flag + city name (clamp 2.15-2.65rem, 800)  */}
      {/*       .online-label: pulse dot + "N hanging out" / "live now"         */}

      <View style={styles.header}>

        {/* ── Side controls — web: .header-side-control (absolute positioned) ── */}
        {/* Only shown when account exists — mirrors web: {!activeEvent && account && ...} */}

        {/* Left: notification bell */}
        {account && (
          <TouchableOpacity
            style={styles.headerIconBtn}
            activeOpacity={0.7}
            onPress={() => router.push('/(tabs)/me')}
          >
            <Ionicons name="notifications-outline" size={22} color={Colors.muted2} />
          </TouchableOpacity>
        )}

        {/* Right: DM icon + unread dot */}
        {account && (
          <TouchableOpacity
            style={[styles.headerIconBtnRight, unreadDMs > 0 && styles.headerIconBtnUnread]}
            activeOpacity={0.7}
            onPress={() => router.push('/(tabs)/messages')}
          >
            <Ionicons
              name="chatbubble-outline"
              size={22}
              color={unreadDMs > 0 ? Colors.text : Colors.muted2}
            />
            {/* web: .header-icon-badge--dot — 9px orange circle */}
            {unreadDMs > 0 && <View style={styles.headerIconDot} />}
          </TouchableOpacity>
        )}

        {/* ── Hero: logo + city + online pill ── */}
        {/* web: .chat-header .logo svg { drop-shadow orange glow } */}
        <View style={styles.iconGlow}>
          <HiladsIcon size={40} />
        </View>
        <View style={styles.heroCity}>
          <Text style={styles.cityName} adjustsFontSizeToFit numberOfLines={1}>
            {flag ? `${flag} ` : ''}{city.name}
          </Text>
          <View style={styles.onlinePill}>
            <PulseDot />
            <Text style={styles.onlineText}>
              {onlineCount != null ? `${onlineCount} hanging out` : 'live now'}
            </Text>
          </View>
        </View>

      </View>

      {/* Error banner */}
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorBannerText}>{error} · tap to dismiss</Text>
        </TouchableOpacity>
      )}

      {/* ── Messages — web: .messages ── */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <FlatList
            data={messages}
            // Robust key: fall back to index if id is missing/duplicate
            keyExtractor={(m, idx) => (m.id ? m.id : String(idx))}
            renderItem={({ item, index }) => (
              <ChatMessage
                message={item}
                myGuestId={identity?.guestId}
                // Grouping: in inverted list, messages[index+1] is visually above.
                // Hide avatar/name if the message above is from the same sender.
                isGrouped={
                  index < messages.length - 1 &&
                  messages[index + 1]?.guestId === item.guestId &&
                  messages[index + 1]?.type !== 'system' &&
                  item.type !== 'system'
                }
              />
            )}
            inverted
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              // Web: .empty block with emoji + "People are arriving" + "Be the first to say hi 👇"
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyIcon}>🔥</Text>
                <Text style={styles.emptyTitle}>People are arriving</Text>
                <Text style={styles.emptySub}>Be the first to say hi 👇</Text>
              </View>
            }
          />
        )}

        {/* ── Input — web: .input-bar ── */}
        {/* Placeholder cycles through PLACEHOLDERS by channelId — mirrors web */}
        <ChatInput
          sending={sending}
          onSendText={sendText}
          onSendImage={sendImage}
          placeholder={getPlaceholder(channelId)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },

  // ── .chat-header ─────────────────────────────────────────────────────────
  // Web: radial-gradient(ellipse 90% 55% at 50% -10%, rgba(194,74,56,0.10), transparent), var(--surface)
  // Web: .header-hero → flex col, center, gap 18, min-height 148px, position relative
  header: {
    flexDirection:     'column',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               18,
    minHeight:         148,
    paddingTop:        18,
    paddingBottom:     16,
    paddingHorizontal: Spacing.md,
    backgroundColor:   Colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    // Approximates web radial-gradient warm glow at top
    shadowColor:     '#C24A38',
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.08,
    shadowRadius:    20,
    elevation:       3,
  },

  // ── .header-side-control — absolute icon buttons ─────────────────────────
  // Web: position absolute, top: max(18px, safe-area-inset-top), z-index 3
  // Icon btn: 48×48px, bg rgba(255,255,255,0.03), border rgba(255,255,255,0.03), radius 14px
  headerIconBtn: {
    position:        'absolute',
    left:            16,
    top:             18,
    width:           44,
    height:          44,
    borderRadius:    13,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.06)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  headerIconBtnRight: {
    position:        'absolute',
    right:           16,
    top:             18,
    width:           44,
    height:          44,
    borderRadius:    13,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.06)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  // Web: .header-icon-btn--unread — orange-tinted bg+border when has unreads
  headerIconBtnUnread: {
    backgroundColor: 'rgba(255,122,60,0.08)',
    borderColor:     'rgba(255,122,60,0.18)',
  },
  // Web: .header-icon-badge--dot — 9px orange circle, absolute top-right
  headerIconDot: {
    position:        'absolute',
    top:             5,
    right:           5,
    width:           9,
    height:          9,
    borderRadius:    4.5,
    backgroundColor: Colors.accent,
    borderWidth:     2,
    borderColor:     Colors.bg2,
  },

  // ── Logo glow — web: .chat-header .logo svg { drop-shadow orange } ─────────
  // drop-shadow(0 0 14px rgba(194,74,56,0.55)) drop-shadow(0 0 4px rgba(194,74,56,0.35))
  iconGlow: {
    shadowColor:   '#C24A38',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius:  14,
    elevation:     10,
  },

  // .header-hero-city
  heroCity: {
    alignItems: 'center',
    gap:        8,
  },

  // .header-hero-name: clamp(2.15rem, 7.8vw, 2.65rem), weight 800, letter-spacing -0.04em
  cityName: {
    fontSize:      34,      // ≈ 2.15rem at 16px base
    fontWeight:    '800',
    letterSpacing: -1.36,   // -0.04em × 34px
    color:         Colors.text,
    textAlign:     'center',
    lineHeight:    36,
  },

  // .online-label: pill, gap 8, padding 6 12, bg rgba(255,255,255,0.05), border rgba(255,255,255,0.07)
  onlinePill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    paddingHorizontal: 12,
    paddingVertical:   6,
    borderRadius:      999,
    backgroundColor:   'rgba(255,255,255,0.05)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.07)',
  },

  // .online-pulse: 7px, #C24A38
  pulseDot: {
    width:           7,
    height:          7,
    borderRadius:    3.5,
    backgroundColor: '#C24A38',
    flexShrink:      0,
  },

  // online count text: 1rem = 16px
  onlineText: {
    fontSize: 15,
    color:    Colors.text,
  },

  // ── Error banner ─────────────────────────────────────────────────────────
  errorBanner:     { backgroundColor: Colors.red, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  errorBannerText: { color: Colors.white, fontSize: FontSizes.xs, textAlign: 'center' },

  // ── Messages ─────────────────────────────────────────────────────────────
  // web: .messages { padding: 22px 18px 14px; gap: 8px }
  listContent: {
    paddingTop:    22,
    paddingBottom: 14,
  },

  // ── Empty state — web: .empty ─────────────────────────────────────────────
  emptyWrap: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    padding:        Spacing.xl,
    gap:            8,
  },
  emptyIcon:  { fontSize: 36 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center' },

  // ── No city state ─────────────────────────────────────────────────────────
  noCityWrap: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    padding:        Spacing.xl,
    gap:            8,
  },
  noCityTitle:    { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  noCitySubtitle: { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  citiesBtn: {
    marginTop:         Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    backgroundColor:   Colors.accentDim,
    borderRadius:      999,
  },
  citiesBtnText: { color: Colors.accent, fontWeight: '600', fontSize: FontSizes.sm },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
