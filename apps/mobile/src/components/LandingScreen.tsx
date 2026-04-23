/**
 * LandingScreen — pixel-perfect port of the web onboarding card.
 *
 * Web source: apps/web/src/components/LandingPage.jsx (JoinCard)
 * Styles:     apps/web/src/index.css (.ob-*, .jc-auth-*)
 *
 * Key mappings:
 *   ob-card         → card View (rgba(22,18,16,0.9), gap:28, padding 36/28/32)
 *   ob-brand        → brand row (HiladsIcon 46px + wordmark)
 *   ob-sep          → horizontal LinearGradient fade separator
 *   ob-city-block   → cityBlock (city, tagline, live pill, event count, preview)
 *   ob-form         → form (label, input, join btn, hint)
 *   jc-auth-*       → jcAuth (divider + two side-by-side buttons + hint)
 *   ob-btn          → LinearGradient(#C24A38→#B87228) full-width CTA
 *   ob-screen bg    → top warm radial glow via LinearGradient overlay
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { bootstrapChannel } from '@/api/channels';
import { fetchCityEvents, fetchPublicCityEvents } from '@/api/events';
import { saveIdentity } from '@/lib/identity';
import { socket } from '@/lib/socket';
import { track, setAnalyticsContext } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { HiladsIcon } from '@/components/HiladsIcon';
import type { HiladsEvent } from '@/types';

// ── Avatar gradient palette — mirrors web AVATAR_PALETTES ────────────────────

const AVATAR_PALETTES: [string, string][] = [
  ['#7c6aff', '#c084fc'],
  ['#ff6a9f', '#fb7185'],
  ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'],
  ['#fb923c', '#fbbf24'],
  ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'],
  ['#2dd4bf', '#a3e635'],
];

function avatarColors(name: string): [string, string] {
  const hash = name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
}

// ── Country code → flag emoji — mirrors web cityFlag() ───────────────────────

function cityFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '🌍';
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

// ── Random live count — mirrors web previewLiveCount ─────────────────────────

function randomLiveCount() {
  return 15 + Math.floor(Math.random() * 35);
}

// ── Event icons — mirrors web EVENT_ICONS ────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

// ── Event filtering — mirrors web preview filter ──────────────────────────────

function filterTodayEvents(events: HiladsEvent[], timezone: string): HiladsEvent[] {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const now = Date.now();
  return events.filter(e => {
    const startDate = new Date(e.starts_at * 1000).toLocaleDateString('en-CA', { timeZone: timezone });
    const isLive = e.starts_at * 1000 <= now && (e.expires_at ?? e.ends_at ?? 0) * 1000 > now;
    return startDate === today || isLive;
  });
}

function filterPreviewEvents(todayEvents: HiladsEvent[]): HiladsEvent[] {
  const now = Date.now();
  return todayEvents
    .filter(e => ((e.expires_at ?? e.ends_at ?? 0) * 1000 - now) / 60_000 >= -30)
    .sort((a, b) => a.starts_at - b.starts_at)
    .slice(0, 3);
}

function formatEventTime(ts: number, timezone: string): string {
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', timeZone: timezone,
  });
}

// ── Pulsing text — mirrors CSS @keyframes pulse ──────────────────────────────

function PulsingText({ text, style }: { text: string; style?: object }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ]),
    ).start();
  }, []);
  return <Animated.Text style={[style, { opacity }]}>{text}</Animated.Text>;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function LandingScreen({ onRetryGeo }: { onRetryGeo?: () => void }) {
  const router   = useRouter();
  const pathname = usePathname();
  const {
    identity, sessionId, account,
    geoState, detectedCity,
    setIdentity, setCity, setJoined, setBootstrapData,
    setUnreadDMs, setUnreadNotifications,
  } = useApp();

  const [nickname,      setNickname]      = useState(identity?.nickname ?? '');
  const [joining,       setJoining]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [showGeoEscape, setShowGeoEscape] = useState(false);
  const escapeTimerId = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [previewEvents,     setPreviewEvents]     = useState<HiladsEvent[]>([]);
  const [previewEventCount, setPreviewEventCount] = useState(0);

  const previewLiveCount = useMemo(() => randomLiveCount(), []);

  // ── Entrance animation — fade + slide up (mirrors .ob-identity-fadein) ──────
  const entranceAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entranceAnim, {
      toValue:         1,
      duration:        420,
      delay:           40,
      useNativeDriver: true,
    }).start();
  }, []);

  // Sync nickname once identity loads
  useEffect(() => {
    if (identity?.nickname && !nickname) setNickname(identity.nickname);
  }, [identity?.nickname]);

  useEffect(() => { track('landing_viewed'); }, []);

  // Geo escape hatch — reveal after 5s in pending/resolving
  useEffect(() => {
    const inFlight = geoState === 'pending' || geoState === 'resolving';
    if (!inFlight) {
      if (escapeTimerId.current !== null) {
        clearTimeout(escapeTimerId.current);
        escapeTimerId.current = null;
      }
      setShowGeoEscape(false);
      return;
    }
    if (escapeTimerId.current !== null) return;
    escapeTimerId.current = setTimeout(() => {
      escapeTimerId.current = null;
      setShowGeoEscape(true);
    }, 5_000);
  }, [geoState]);

  // Fetch events when city detected.
  // Primary: Hilads events for today. Fallback: Ticketmaster/public events so the
  // city never looks empty on the first request of the day (before series occurrences
  // are generated by the deferred shutdown function).
  useEffect(() => {
    if (!detectedCity) return;
    const tz = detectedCity.timezone || 'UTC';
    fetchCityEvents(detectedCity.channelId)
      .then(events => {
        const todayEvents = filterTodayEvents(events, tz);
        const preview = filterPreviewEvents(todayEvents);
        if (preview.length > 0) {
          setPreviewEventCount(todayEvents.length);
          setPreviewEvents(preview);
        } else {
          // No Hilads events yet — fall back to public (Ticketmaster) events
          return fetchPublicCityEvents(detectedCity.channelId).then(pubEvents => {
            setPreviewEventCount(pubEvents.length);
            setPreviewEvents(pubEvents.slice(0, 3));
          });
        }
      })
      .catch(() => {});
  }, [detectedCity?.channelId]);

  const city    = detectedCity;
  const noGeo   = geoState === 'denied' || geoState === 'error';
  const trimmed = nickname.trim();

  const [avatarC1, avatarC2] = avatarColors(trimmed || 'A');
  const avatarLetter = (trimmed[0] || 'A').toUpperCase();

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function handleJoin() {
    if (!trimmed || !identity || !sessionId) return;
    setJoining(true);
    setError(null);
    try {
      const updated = { ...identity, nickname: trimmed, channelId: city?.channelId };
      if (city) {
        const boot = await bootstrapChannel(city.channelId, sessionId, identity.guestId, trimmed);
        setBootstrapData({
          channelId:           city.channelId,
          messages:            boot.messages,
          hasMore:             boot.hasMore,
          hasUnreadDMs:        boot.hasUnreadDMs,
          unreadNotifications: boot.unreadNotifications,
        });
        if (boot.unreadNotifications !== null) setUnreadNotifications(boot.unreadNotifications);
        if (boot.hasUnreadDMs !== null) setUnreadDMs(boot.hasUnreadDMs ? 1 : 0);
        setCity(city);
        if (socket.isConnected) {
          socket.joinCity(city.channelId, sessionId, trimmed, account?.id, identity.guestId);
        } else {
          socket.on('connected', () => socket.joinCity(city.channelId, sessionId, trimmed, account?.id));
        }
      }
      await saveIdentity(updated);
      setIdentity(updated);
      setAnalyticsContext({
        city:     city?.name ?? null,
        country:  city?.country ?? null,
        is_guest: !account,
        guest_id: identity?.guestId ?? null,
        user_id:  account?.id ?? null,
      });
      track('clicked_join_city', { city: city?.name ?? null });
      track('landing_joined', { hasCity: !!city, cityId: city?.channelId });
      if (city) router.replace('/(tabs)/chat');
      setJoined(true);
    } catch {
      setError('Could not connect. Check your connection and try again.');
      setJoining(false);
    }
  }

  function handleBrowseCities() {
    setJoined(true);
    router.replace('/switch-city' as never);
  }

  // Step aside for auth screens so they render above the overlay
  if (pathname === '/sign-up' || pathname === '/sign-in') return null;

  const canJoin = !!trimmed && !joining && geoState !== 'pending';

  return (
    <SafeAreaView style={styles.screen}>

      {/* Background warm glow — radial(ellipse at 50% -10%) approximated as a vertical fade */}
      <LinearGradient
        colors={['rgba(194,74,56,0.12)', 'transparent']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.bgGlow}
        pointerEvents="none"
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── ob-card ── */}
          <Animated.View style={[
            styles.card,
            {
              opacity: entranceAnim,
              transform: [{
                translateY: entranceAnim.interpolate({
                  inputRange:  [0, 1],
                  outputRange: [18, 0],
                }),
              }],
            },
          ]}>

            {/* ── ob-brand: Logo icon + "hilads" wordmark ── */}
            <View style={styles.brand}>
              <HiladsIcon size={46} />
              <Text style={styles.logoWordmark}>hilads</Text>
            </View>

            {/* ── ob-sep: fading horizontal rule ── */}
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.09)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.sep}
            />

            {/* ── ob-city-block ── */}
            <View style={styles.cityBlock}>
              {city ? (
                <>
                  {/* ob-city-name — gradient text approximated with accent2 */}
                  <Text style={styles.cityName} adjustsFontSizeToFit numberOfLines={1}>
                    {city.name}{' '}
                    <Text style={styles.cityFlagInline}>{cityFlag(city.country)}</Text>
                  </Text>

                  {/* ob-tagline */}
                  <Text style={styles.tagline}>Feel local. Anywhere.</Text>

                  {/* ob-activity-block: people + events together */}
                  <View style={styles.activityBlock}>
                    <Text style={styles.activityLine}>
                      🔥 {previewLiveCount} {previewLiveCount === 1 ? 'person' : 'people'} here right now
                    </Text>
                    {previewEventCount > 0 && (
                      <Text style={styles.activityLine}>
                        🔥 {previewEventCount} {previewEventCount === 1 ? 'vibe' : 'vibes'} happening today
                      </Text>
                    )}
                  </View>

                  {/* ob-events-preview — up to 3 items */}
                  {previewEvents.length > 0 && (
                    <View style={styles.eventsPreview}>
                      {previewEvents.map(e => (
                        <View key={e.id} style={styles.eventRow}>
                          <Text style={styles.eventTitle} numberOfLines={1}>
                            {EVENT_ICONS[e.event_type] ?? '📌'} {e.title}
                          </Text>
                          <Text style={styles.eventTime}>
                            {formatEventTime(e.starts_at, city.timezone || 'UTC')}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </>
              ) : noGeo ? (
                <>
                  <View style={[
                    styles.geoStatusBadge,
                    geoState === 'error' && styles.geoStatusBadgeWarn,
                  ]}>
                    <Text style={[
                      styles.geoStatusText,
                      geoState === 'error' && styles.geoStatusTextWarn,
                    ]}>
                      {geoState === 'denied' ? '📍 Location off' : '📍 Couldn\'t reach your location'}
                    </Text>
                  </View>
                  <Text style={styles.geoHeadline}>Pick a city{'\n'}and jump in</Text>
                </>
              ) : geoState === 'resolving' ? (
                <>
                  <PulsingText text="› locating..." style={styles.locating} />
                  {showGeoEscape && (
                    <TouchableOpacity onPress={handleBrowseCities} activeOpacity={0.7} style={styles.geoEscapeBtn}>
                      <Text style={styles.geoEscapeText}>Choose city manually →</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <>
                  <PulsingText text="› requesting location..." style={styles.locating} />
                  {showGeoEscape && (
                    <TouchableOpacity onPress={handleBrowseCities} activeOpacity={0.7} style={styles.geoEscapeBtn}>
                      <Text style={styles.geoEscapeText}>Choose city manually →</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>

            {/* ── ob-form ── */}
            <View style={styles.form}>

              {noGeo ? (
                <>
                  <TouchableOpacity onPress={handleBrowseCities} activeOpacity={0.85}>
                    <LinearGradient
                      colors={['#C24A38', '#B87228']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.btn}
                    >
                      <Text style={styles.btnText}>Browse cities →</Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <Text style={styles.label}>YOUR NAME</Text>

                  <View style={styles.inputRow}>
                    <LinearGradient colors={[avatarC1, avatarC2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatarCircle}>
                      <Text style={styles.avatarLetter}>{avatarLetter}</Text>
                    </LinearGradient>
                    <TextInput
                      style={styles.input}
                      value={nickname}
                      onChangeText={setNickname}
                      placeholder="Say hi as..."
                      placeholderTextColor={Colors.muted2}
                      maxLength={20}
                      autoCapitalize="words"
                      autoCorrect={false}
                      returnKeyType="done"
                    />
                  </View>

                  <TouchableOpacity style={styles.geoRetryBtn} activeOpacity={0.7} onPress={onRetryGeo}>
                    <Text style={styles.geoRetryText}>
                      {geoState === 'error' ? 'Try again' : 'Use my location instead'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.label}>YOUR NAME</Text>

                  <View style={styles.inputRow}>
                    <LinearGradient colors={[avatarC1, avatarC2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatarCircle}>
                      <Text style={styles.avatarLetter}>{avatarLetter}</Text>
                    </LinearGradient>
                    <TextInput
                      style={styles.input}
                      value={nickname}
                      onChangeText={setNickname}
                      placeholder="Say hi as..."
                      placeholderTextColor={Colors.muted2}
                      maxLength={20}
                      autoCapitalize="words"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={handleJoin}
                    />
                  </View>

                  {error ? <Text style={styles.errorText}>{error}</Text> : null}

                  <TouchableOpacity
                    onPress={handleJoin}
                    disabled={!canJoin}
                    activeOpacity={0.85}
                    style={!canJoin && styles.btnDisabled}
                  >
                    <LinearGradient
                      colors={['#C24A38', '#B87228']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.btn}
                    >
                      {joining ? (
                        <ActivityIndicator color={Colors.white} size="small" />
                      ) : (
                        <Text style={styles.btnText}>
                          {city ? `Join ${city.name} →` : 'Join Chat →'}
                        </Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              )}

              {/* ob-hint — web: "// anonymous · instant access" */}
              <Text style={styles.hint}>// anonymous · instant access</Text>
            </View>

            {/* ── jc-auth: divider + Create account / Log in + hint ── */}
            {!account && (
              <View style={styles.jcAuth}>

                {/* Divider with lines + "or keep your identity" */}
                <View style={styles.jcDivider}>
                  <View style={styles.jcDividerLine} />
                  <Text style={styles.jcDividerText}>or keep your identity</Text>
                  <View style={styles.jcDividerLine} />
                </View>

                {/* Two buttons side by side */}
                <View style={styles.jcActions}>
                  <TouchableOpacity
                    style={styles.jcSignup}
                    onPress={() => { track('clicked_sign_up'); router.push('/sign-up'); }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.jcSignupText}>✨ Create account</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.jcSignin}
                    onPress={() => { track('clicked_sign_in'); router.push('/sign-in'); }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.jcSigninText}>Log in</Text>
                  </TouchableOpacity>
                </View>

                {/* jc-auth-hint */}
                <Text style={styles.jcHint}>Save your name · unlock profiles · add friends</Text>

              </View>
            )}

          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const MONO = Platform.OS === 'ios' ? 'Courier' : 'monospace';

const styles = StyleSheet.create({

  // ── Screen — matches .ob-screen (centered, bg, radial glow approximated) ───
  screen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.bg,
    zIndex: 100,
  },
  // Top warm glow — approximate of radial-gradient ellipse at 50% -10%
  bgGlow: {
    position: 'absolute',
    top:      0,
    left:     0,
    right:    0,
    height:   '45%',
  },
  flex:   { flex: 1 },
  scroll: {
    flexGrow:          1,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.xl,
  },

  // ── ob-card ─────────────────────────────────────────────────────────────────
  // Web: gap:28, padding:36 28 32, bg:rgba(22,18,16,0.9), border:rgba(255,255,255,0.07)
  card: {
    width:           '100%',
    maxWidth:        360,
    backgroundColor: 'rgba(22,18,16,0.9)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.07)',
    borderRadius:    20,
    paddingTop:      36,
    paddingHorizontal: 28,
    paddingBottom:   32,
    gap:             28,
    // Double shadow: outer depth + subtle ring
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 24 },
    shadowOpacity:   0.55,
    shadowRadius:    32,
    elevation:       24,
  },

  // ── ob-brand ─────────────────────────────────────────────────────────────────
  // Web: flex row, centered, size="lg" → icon:46px, fontSize:1.5rem=24px, gap:11
  brand: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            11,
  },
  // Web logo-wordmark: weight 800, letter-spacing -0.03em, gradient #C24A38→#B87228
  logoWordmark: {
    fontSize:      24,
    fontWeight:    '800',
    letterSpacing: -0.72,   // -0.03 × 24
    color:         '#C24A38',
    lineHeight:    24,
  },

  // ── ob-sep: fading horizontal rule ───────────────────────────────────────────
  // Web: linear-gradient(90deg, transparent, rgba(255,255,255,0.09), transparent)
  sep: {
    height:        1,
    marginVertical: 0,   // gap handles spacing
  },

  // ── ob-city-block ────────────────────────────────────────────────────────────
  // Web: text-align center, gap:6, min-height:60, centered
  cityBlock: {
    alignItems:     'center',
    justifyContent: 'center',
    gap:            6,
    minHeight:      60,
  },
  // ob-city-name: 2.2rem=35px, weight 800, gradient text (approximated with accent2)
  cityName: {
    fontSize:      35,
    fontWeight:    '800',
    letterSpacing: -0.7,
    color:         '#C24A38',  // gradient start — web: linear-gradient(90deg, --accent, --accent2)
    textAlign:     'center',
    lineHeight:    38,
  },
  cityFlagInline: {
    fontSize: 28,
    color:    Colors.text,
  },
  // ob-tagline: 0.95rem=~15px, muted2, weight 400
  tagline: {
    fontSize:   15,
    fontWeight: '400',
    color:      Colors.muted2,
    textAlign:  'center',
    lineHeight: 21,
  },
  // ob-activity-block: single container for people + events signals
  activityBlock: {
    backgroundColor:   'rgba(255,255,255,0.04)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.09)',
    borderRadius:      14,
    paddingHorizontal: 16,
    paddingVertical:   10,
    alignItems:        'center',
    gap:               6,
  },
  activityLine: {
    fontSize:   13,   // 0.82rem
    color:      Colors.muted2,
    lineHeight: 18,
    textAlign:  'center',
  },

  // ob-events-preview: flex column, gap:5, full width
  eventsPreview: {
    width:     '100%',
    gap:       5,
    marginTop: 2,
  },
  // ob-event-row: justify-between, padding:7 10, bg:rgba(255,255,255,0.04), radius:8, font-size:0.83rem
  eventRow: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    gap:               8,
    paddingHorizontal: 10,
    paddingVertical:   7,
    backgroundColor:   'rgba(255,255,255,0.04)',
    borderRadius:      8,
  },
  // ob-event-title: var(--text), truncated
  eventTitle: {
    flex:     1,
    color:    Colors.text,
    fontSize: 13,
  },
  // ob-event-time: muted2, 0.78rem, no-wrap
  eventTime: {
    color:      Colors.muted2,
    fontSize:   12,
    flexShrink: 0,
  },

  // ── Locating state ────────────────────────────────────────────────────────────
  locating: {
    fontSize:      14,
    color:         Colors.muted2,
    fontFamily:    MONO,
    letterSpacing: 0.3,
  },

  // ── Geo denied / error ────────────────────────────────────────────────────────
  geoStatusBadge: {
    backgroundColor:   'rgba(255,255,255,0.05)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.08)',
    borderRadius:      Radius.full,
    paddingHorizontal: 10,
    paddingVertical:   4,
  },
  geoStatusBadgeWarn: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderColor:     'rgba(245,158,11,0.2)',
  },
  geoStatusText:     { fontSize: 12, color: Colors.muted2 },
  geoStatusTextWarn: { color: '#f59e0b' },
  geoHeadline: {
    fontSize:      25,
    fontWeight:    '700',
    color:         Colors.text,
    letterSpacing: -0.5,
    textAlign:     'center',
    lineHeight:    30,
    marginTop:     4,
  },

  // ── ob-form ───────────────────────────────────────────────────────────────────
  // Web: flex column, gap:12
  form: { gap: 12 },

  // ob-label: 0.72rem=12px, muted2, uppercase, letter-spacing:0.07em, weight 600
  label: {
    fontSize:      12,
    color:         Colors.muted2,
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    fontWeight:    '600',
  },

  // ob-input-row: gap:10, bg:surface, border, radius:14, padding:10 14
  inputRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    backgroundColor:   Colors.bg2,
    borderWidth:       1,
    borderColor:       Colors.border,
    borderRadius:      14,
    paddingHorizontal: 14,
    paddingVertical:   10,
  },
  // ob-avatar-preview: 34px circle, gradient bg, box-shadow
  avatarCircle: {
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
  avatarLetter: {
    color:      Colors.white,
    fontSize:   14,
    fontWeight: '700',
  },
  // ob-input: transparent, no border, text, 1rem, weight 600
  input: {
    flex:       1,
    color:      Colors.text,
    fontSize:   FontSizes.md,
    fontWeight: '600',
    padding:    0,
  },

  errorText: {
    fontSize:  FontSizes.sm,
    color:     Colors.red,
    textAlign: 'center',
  },

  // ob-btn: gradient(135deg, #C24A38→#B87228), full-width, radius:14, padding:15, weight 700
  btn: {
    width:           '100%',
    paddingVertical: 15,
    borderRadius:    14,
    alignItems:      'center',
    marginTop:       4,
    // Shadow — web: box-shadow 0 4px 20px rgba(194,74,56,0.25)
    shadowColor:     '#C24A38',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.25,
    shadowRadius:    10,
    elevation:       8,
  },
  btnDisabled: { opacity: 0.45 },
  btnText: {
    color:      Colors.white,
    fontWeight: '700',
    fontSize:   FontSizes.md,
  },

  // Geo escape / retry links
  geoEscapeBtn:  { alignItems: 'center', paddingVertical: 6, marginTop: 4 },
  geoEscapeText: {
    color:               Colors.muted,
    fontSize:            12,
    textDecorationLine:  'underline',
    textDecorationColor: Colors.muted,
  },
  geoRetryBtn:  { alignItems: 'center', paddingVertical: 4 },
  geoRetryText: {
    color:               Colors.muted2,
    fontSize:            13,
    textDecorationLine:  'underline',
    textDecorationColor: Colors.muted2,
  },

  // ob-hint: 0.72rem=12px, monospace, var(--muted)
  hint: {
    fontSize:      12,
    color:         Colors.muted,
    fontFamily:    MONO,
    letterSpacing: 0.15,
    textAlign:     'center',
  },

  // ── jc-auth: secondary auth section ──────────────────────────────────────────
  // Web: .jc-auth { gap:14, padding-top:4 }
  jcAuth: {
    gap:        14,
    paddingTop: 4,
  },

  // Divider with lines on each side — web: .jc-auth-divider with ::before/::after pseudo-elements
  jcDivider: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
  },
  jcDividerLine: {
    flex:            1,
    height:          1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  // Web: .jc-auth-divider-text { font-size:0.72rem, color:--muted, letter-spacing:0.01em }
  jcDividerText: {
    fontSize:      12,
    color:         Colors.muted,
    letterSpacing: 0.2,
  },

  // Two-button row — web: .jc-auth-actions { display:flex, gap:8 }
  jcActions: {
    flexDirection: 'row',
    gap:           8,
  },

  // Create account — web: .jc-auth-signup { flex:1, border:rgba(194,74,56,0.55), bg:rgba(194,74,56,0.08), color:--accent }
  jcSignup: {
    flex:              1,
    paddingVertical:   10,
    paddingHorizontal: 14,
    borderWidth:       1,
    borderColor:       'rgba(194,74,56,0.55)',
    borderRadius:      10,
    backgroundColor:   'rgba(194,74,56,0.08)',
    alignItems:        'center',
  },
  jcSignupText: {
    color:      Colors.accent2,   // web --accent = #C24A38
    fontSize:   14,               // 0.88rem
    fontWeight: '600',
  },

  // Log in — web: .jc-auth-signin { flex:1, border:rgba(255,255,255,0.08), bg:transparent, color:--muted2 }
  jcSignin: {
    flex:              1,
    paddingVertical:   10,
    paddingHorizontal: 14,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.08)',
    borderRadius:      10,
    backgroundColor:   'transparent',
    alignItems:        'center',
  },
  jcSigninText: {
    color:      Colors.muted2,
    fontSize:   14,
    fontWeight: '500',
  },

  // jc-auth-hint: 0.68rem=11px, --muted, centered
  jcHint: {
    fontSize:      11,
    color:         Colors.muted,
    textAlign:     'center',
    letterSpacing: 0.2,
  },
});
