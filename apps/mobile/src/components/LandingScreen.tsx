/**
 * LandingScreen — faithful port of the web onboarding card (.ob-card).
 *
 * Web source: apps/web/src/App.jsx (status === 'onboarding' branch)
 * Styles:     apps/web/src/index.css (.ob-*)
 *
 * Logo: apps/web/src/components/Logo.jsx
 *   SVG icon reproduced using View primitives (scaled 64→46px).
 *   Gradient text approximated with solid Colors.accent2 (no expo-linear-gradient needed).
 *
 * Geo states (matching web exactly):
 *   'pending'   → "› requesting location..."
 *   'resolving' → "› locating..."
 *   'denied'    → badge + "Pick a city / and jump in"
 *   'error'     → badge + "Pick a city / and jump in"
 *   'resolved'  → full city card (name + flag, tagline, live count, events)
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { joinChannel } from '@/api/channels';
import { fetchCityEvents } from '@/api/events';
import { saveIdentity } from '@/lib/identity';
import { socket } from '@/lib/socket';
import { track } from '@/services/analytics';
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
// Web: `useState(() => 15 + Math.floor(Math.random() * 35))` — generated once.

function randomLiveCount() {
  return 15 + Math.floor(Math.random() * 35);
}

// ── Event icons — mirrors web EVENT_ICONS ────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

// ── Today's events in a timezone — mirrors web preview filter ────────────────

function filterTodayEvents(events: HiladsEvent[], timezone: string): HiladsEvent[] {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  return events.filter(e =>
    new Date(e.starts_at * 1000).toLocaleDateString('en-CA', { timeZone: timezone }) === today,
  );
}

function filterPreviewEvents(todayEvents: HiladsEvent[]): HiladsEvent[] {
  const now = Date.now();
  return todayEvents
    .filter(e => (e.starts_at * 1000 - now) / 60_000 >= -30)
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
  const router = useRouter();
  const {
    identity, sessionId, account,
    geoState, detectedCity,
    setIdentity, setCity, setJoined,
  } = useApp();

  const [nickname,     setNickname]     = useState(identity?.nickname ?? '');
  const [joining,      setJoining]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  // Show the "browse cities" escape after a delay if geo is still pending/resolving.
  // Prevents the user from being stuck with no action available on slow/broken devices.
  const [showGeoEscape, setShowGeoEscape] = useState(false);

  // Events preview — fetched after city is detected (mirrors web startGeolocation)
  const [previewEvents,     setPreviewEvents]     = useState<HiladsEvent[]>([]);
  const [previewEventCount, setPreviewEventCount] = useState(0);

  // Live count — random 15-49, generated once on mount (mirrors web previewLiveCount)
  const previewLiveCount = useMemo(() => randomLiveCount(), []);

  // Sync nickname once identity loads
  useEffect(() => {
    if (identity?.nickname && !nickname) setNickname(identity.nickname);
  }, [identity?.nickname]);

  // Escape hatch: if still waiting for geo after 10 seconds, reveal "Browse cities"
  // so the user is never fully stuck with no action available.
  useEffect(() => {
    if (geoState !== 'pending' && geoState !== 'resolving') {
      setShowGeoEscape(false);
      return;
    }
    const timer = setTimeout(() => setShowGeoEscape(true), 10_000);
    return () => clearTimeout(timer);
  }, [geoState]);

  // Fetch events when city is detected — mirrors web's fetchEvents() after resolveLocation
  useEffect(() => {
    if (!detectedCity) return;
    const tz = detectedCity.timezone || 'UTC';
    fetchCityEvents(detectedCity.channelId)
      .then(events => {
        const todayEvents = filterTodayEvents(events, tz);
        setPreviewEventCount(todayEvents.length);
        setPreviewEvents(filterPreviewEvents(todayEvents));
      })
      .catch(() => {}); // non-fatal, preview is optional
  }, [detectedCity?.channelId]);

  const city     = detectedCity;
  const noGeo    = geoState === 'denied' || geoState === 'error';
  const trimmed  = nickname.trim();

  // Avatar: first color from palette as solid bg
  const [avatarBg] = avatarColors(trimmed || 'A');
  const avatarLetter = (trimmed[0] || 'A').toUpperCase();

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function handleJoin() {
    if (!trimmed || !identity || !sessionId) return;
    setJoining(true);
    setError(null);

    try {
      const updated = { ...identity, nickname: trimmed, channelId: city?.channelId };

      if (city) {
        await joinChannel(city.channelId, sessionId, identity.guestId, trimmed);
        setCity(city);
        if (socket.isConnected) {
          socket.joinCity(city.channelId, sessionId, trimmed, account?.id);
        } else {
          socket.on('connected', () => socket.joinCity(city.channelId, sessionId, trimmed, account?.id));
        }
      }

      await saveIdentity(updated);
      setIdentity(updated);
      track('landing_joined', { hasCity: !!city, cityId: city?.channelId });
      // Navigate to city chat first — mirrors web's setStatus('ready') which renders
      // the city channel view. setJoined(true) then removes the overlay.
      if (city) router.replace('/(tabs)/chat');
      setJoined(true);
    } catch {
      setError('Could not connect. Check your connection and try again.');
      setJoining(false);
    }
  }

  function handleBrowseCities() {
    setJoined(true);
    router.replace('/(tabs)/cities');
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const canJoin = !!trimmed && !joining && geoState !== 'pending';

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>

            {/* ── ob-brand: Logo icon + "hilads" wordmark ── */}
            <View style={styles.brand}>
              <HiladsIcon size={46} />
              <Text style={styles.logoWordmark}>hilads</Text>
            </View>

            {/* ── ob-sep ── */}
            <View style={styles.sep} />

            {/* ── ob-city-block ── */}
            <View style={styles.cityBlock}>
              {city ? (
                <>
                  {/* City name + flag — web: {city} + cityFlag(cityCountry) inline */}
                  <Text style={styles.cityName} adjustsFontSizeToFit numberOfLines={1}>
                    {city.name}{' '}
                    <Text style={styles.cityFlagInline}>{cityFlag(city.country)}</Text>
                  </Text>

                  {/* Tagline — web: "See who's around. Say hi instantly." */}
                  <Text style={styles.tagline}>See who's around. Say hi instantly.</Text>

                  {/* Live count pill — web: "🔥 N person/people hanging out right now" */}
                  <View style={styles.livePill}>
                    <Text style={styles.liveText}>
                      🔥 {previewLiveCount}{' '}
                      {previewLiveCount === 1 ? 'person' : 'people'} hanging out right now
                    </Text>
                  </View>

                  {/* Events count — web: "🔥 N event(s) happening today" */}
                  {previewEventCount > 0 && (
                    <Text style={styles.eventCountText}>
                      🔥 {previewEventCount} event{previewEventCount > 1 ? 's' : ''} happening today
                    </Text>
                  )}

                  {/* Events preview list — web: ob-events-preview, up to 3 */}
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
                  {/* Geo status badge */}
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
                  {/* Geo headline — web: "Pick a city\nand jump in" */}
                  <Text style={styles.geoHeadline}>Pick a city{'\n'}and jump in</Text>
                </>
              ) : geoState === 'resolving' ? (
                /* web: "› locating..." */
                <>
                  <PulsingText text="› locating..." style={styles.locating} />
                  {showGeoEscape && (
                    <TouchableOpacity onPress={handleBrowseCities} activeOpacity={0.7} style={styles.geoEscapeBtn}>
                      <Text style={styles.geoEscapeText}>Choose city manually →</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                /* web: "› requesting location..." (geoState = 'pending') */
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
                /* No-geo layout: CTA first, then name input (matches web) */
                <>
                  <TouchableOpacity
                    style={styles.btn}
                    onPress={handleBrowseCities}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.btnText}>Browse cities →</Text>
                  </TouchableOpacity>

                  <Text style={styles.label}>YOUR NAME</Text>

                  <View style={styles.inputRow}>
                    <View style={[styles.avatarCircle, { backgroundColor: avatarBg }]}>
                      <Text style={styles.avatarLetter}>{avatarLetter}</Text>
                    </View>
                    <TextInput
                      style={styles.input}
                      value={nickname}
                      onChangeText={setNickname}
                      placeholder="Say hi as..."
                      placeholderTextColor={Colors.muted}
                      maxLength={20}
                      autoCapitalize="words"
                      autoCorrect={false}
                      returnKeyType="done"
                    />
                  </View>

                  {/* Retry geo — web: ob-geo-retry */}
                  <TouchableOpacity style={styles.geoRetryBtn} activeOpacity={0.7} onPress={onRetryGeo}>
                    <Text style={styles.geoRetryText}>
                      {geoState === 'error' ? 'Try again' : 'Use my location instead'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                /* Normal layout: name first, join button second (matches web) */
                <>
                  <Text style={styles.label}>YOUR NAME</Text>

                  <View style={styles.inputRow}>
                    <View style={[styles.avatarCircle, { backgroundColor: avatarBg }]}>
                      <Text style={styles.avatarLetter}>{avatarLetter}</Text>
                    </View>
                    <TextInput
                      style={styles.input}
                      value={nickname}
                      onChangeText={setNickname}
                      placeholder="Say hi as..."
                      placeholderTextColor={Colors.muted}
                      maxLength={20}
                      autoCapitalize="words"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={handleJoin}
                    />
                  </View>

                  {error ? <Text style={styles.errorText}>{error}</Text> : null}

                  <TouchableOpacity
                    style={[styles.btn, !canJoin && styles.btnDisabled]}
                    onPress={handleJoin}
                    disabled={!canJoin}
                    activeOpacity={0.85}
                  >
                    {joining ? (
                      <ActivityIndicator color={Colors.white} size="small" />
                    ) : (
                      <Text style={styles.btnText}>
                        {city ? `Join ${city.name} →` : 'Join Chat →'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </>
              )}

              {/* Identity CTA — web: ob-identity-cta, only shown when !account */}
              {!account && (
                <View style={styles.identityCta}>
                  <Text style={styles.identityHint}>Don't lose your name 👇</Text>
                  <TouchableOpacity
                    style={styles.createAccountBtn}
                    onPress={() => router.push('/sign-up')}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.createAccountText}>✨ Save my identity</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* ob-hint */}
              <Text style={styles.hint}>// anonymous · no sign-up</Text>
            </View>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const MONO = Platform.OS === 'ios' ? 'Courier' : 'monospace';

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.bg,
    zIndex: 100,
  },
  flex: { flex: 1 },
  scroll: {
    flexGrow:          1,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.xl,
  },

  // ── ob-card ──────────────────────────────────────────────────────────────────
  card: {
    width:           '100%',
    maxWidth:        360,
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.07)',
    borderRadius:    20,
    padding:         Spacing.lg,
    gap:             Spacing.lg,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 12 },
    shadowOpacity:   0.55,
    shadowRadius:    32,
    elevation:       24,
  },

  // ── ob-brand ─────────────────────────────────────────────────────────────────
  brand: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            11,              // web: gap: 11 at size="lg"
  },
  // logoWordmark — web: font-weight 800, letter-spacing -0.03em, gradient #C24A38→#B87228
  // Approximated with solid Colors.accent2 (no gradient-text lib available)
  logoWordmark: {
    fontSize:      24,              // web: 1.5rem at size="lg"
    fontWeight:    '800',
    letterSpacing: -0.72,           // -0.03 * 24
    color:         '#C24A38',       // gradient start color
    lineHeight:    24,
  },

  // ── ob-sep ───────────────────────────────────────────────────────────────────
  sep: {
    height:          1,
    backgroundColor: 'rgba(255,255,255,0.09)',
    marginVertical:  -4,
  },

  // ── ob-city-block ────────────────────────────────────────────────────────────
  cityBlock: {
    alignItems:     'center',
    justifyContent: 'center',
    gap:            6,
    minHeight:      60,
  },
  // ob-city-name: 2.2rem, font-weight 800, gradient text
  // Approximated with solid accent color
  cityName: {
    fontSize:      35,
    fontWeight:    '800',
    letterSpacing: -0.7,
    color:         Colors.accent,
    textAlign:     'center',
    lineHeight:    38,
  },
  cityFlagInline: {
    fontSize: 28,
    color:    Colors.text,  // flags have no gradient
  },
  // ob-tagline
  tagline: {
    fontSize:  15,
    color:     Colors.muted2,
    textAlign: 'center',
    lineHeight: 21,
  },
  // ob-live: 0.82rem, muted2, pill bg rgba(255,255,255,0.05), border rgba(255,255,255,0.1)
  livePill: {
    backgroundColor:   'rgba(255,255,255,0.05)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.10)',
    borderRadius:      Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical:   3,
  },
  liveText: {
    fontSize:  13,
    color:     Colors.muted2,
  },
  // ob-city-sub ob-event-count
  eventCountText: {
    fontSize: 14,
    color:    Colors.muted2,
  },

  // ob-events-preview
  eventsPreview: {
    width: '100%',
    gap:   5,
    marginTop: 2,
  },
  // ob-event-row
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
  eventTitle: {
    flex:     1,
    color:    Colors.text,
    fontSize: 13,
  },
  eventTime: {
    color:     Colors.muted2,
    fontSize:  12,
    flexShrink: 0,
  },

  // ── Pulsing locating text ─────────────────────────────────────────────────
  locating: {
    fontSize:     14,
    color:        Colors.muted2,
    fontFamily:   MONO,
    letterSpacing: 0.3,
  },

  // ── Geo denied / error ────────────────────────────────────────────────────
  geoStatusBadge: {
    backgroundColor:   'rgba(255,255,255,0.05)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.08)',
    borderRadius:      Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical:   4,
  },
  geoStatusBadgeWarn: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderColor:     'rgba(245,158,11,0.2)',
  },
  geoStatusText: {
    fontSize: 12,
    color:    Colors.muted2,
  },
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

  // ── ob-form ──────────────────────────────────────────────────────────────────
  form: { gap: 12 },

  // ob-label: 0.72rem, muted2, uppercase, letter-spacing 0.07em, weight 600
  label: {
    fontSize:      12,
    color:         Colors.muted2,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight:    '600',
  },
  // ob-input-row: bg surface, border border, radius 14px, padding 10px 14px
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
  // ob-avatar-preview: 34px circle, gradient bg (solid first palette color)
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
  // ob-input: transparent bg, no border, text var(--text), 1rem, weight 600
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

  // ob-btn: gradient #C24A38→#accent, radius 14px, padding 15px, weight 700
  btn: {
    width:           '100%',
    paddingVertical: 15,
    backgroundColor: '#C24A38',         // gradient approximation
    borderRadius:    14,
    alignItems:      'center',
    marginTop:       4,
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

  // Geo escape — shown after 10s in pending/resolving so user is never stuck
  geoEscapeBtn: { alignItems: 'center', paddingVertical: 6, marginTop: 4 },
  geoEscapeText: {
    color:               Colors.muted,
    fontSize:            12,
    textDecorationLine:  'underline',
    textDecorationColor: Colors.muted,
  },

  // ob-geo-retry
  geoRetryBtn: { alignItems: 'center', paddingVertical: 4 },
  geoRetryText: {
    color:               Colors.muted2,
    fontSize:            13,
    textDecorationLine:  'underline',
    textDecorationColor: Colors.muted2,
  },

  // ob-identity-cta
  identityCta: { alignItems: 'center', gap: 6 },
  identityHint: {
    fontSize:  12,
    color:     Colors.muted2,
    textAlign: 'center',
  },
  // ob-create-account: border accent, radius 10px, padding 12px, weight 600
  createAccountBtn: {
    width:           '100%',
    backgroundColor: 'rgba(255,122,60,0.08)',
    borderWidth:     1.5,
    borderColor:     Colors.accent,
    borderRadius:    Radius.md,
    paddingVertical: 12,
    alignItems:      'center',
  },
  createAccountText: {
    color:      Colors.accent,
    fontSize:   FontSizes.md,
    fontWeight: '600',
  },

  // ob-hint: 0.72rem, muted, monospace
  hint: {
    fontSize:     12,
    color:        Colors.muted,
    fontFamily:   MONO,
    letterSpacing: 0.15,
    textAlign:    'center',
  },
});
