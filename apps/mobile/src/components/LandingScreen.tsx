/**
 * LandingScreen - pixel-perfect port of the web onboarding card.
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
  ActivityIndicator, Platform,
  ScrollView, Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { useApp } from '@/context/AppContext';
import { bootstrapChannel } from '@/api/channels';
import { fetchCityEvents, fetchPublicCityEvents } from '@/api/events';
import { saveIdentity } from '@/lib/identity';
import { socket } from '@/lib/socket';
import { avatarGradient } from '@/lib/avatarColors';
import { track, setAnalyticsContext } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { HiladsIcon } from '@/components/HiladsIcon';
import type { HiladsEvent } from '@/types';

// ── Country code → flag emoji - mirrors web cityFlag() ───────────────────────

function cityFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '🌍';
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

// ── Random live count - mirrors web previewLiveCount ─────────────────────────

function randomLiveCount() {
  return 15 + Math.floor(Math.random() * 35);
}

// ── Event icons - mirrors web EVENT_ICONS ────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

// ── Event filtering - mirrors web preview filter ──────────────────────────────

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
  return new Date(ts * 1000).toLocaleTimeString(i18n.language, {
    hour: '2-digit', minute: '2-digit', timeZone: timezone,
  });
}

// ── Pulsing text - mirrors CSS @keyframes pulse ──────────────────────────────

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
  console.log('[landing] render');  // DIAG: if this loops but [layout] render does not, the loop is inside LandingScreen
  const router   = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation('landing');
  const {
    identity, sessionId, account,
    geoState, detectedCity,
    setIdentity, setCity, setJoined, setBootstrapData,
    setUnreadNotifications,
  } = useApp();

  const [nickname,      setNickname]      = useState(identity?.nickname ?? '');
  const [joining,       setJoining]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [showGeoEscape, setShowGeoEscape] = useState(false);
  const escapeTimerId = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [previewEvents,     setPreviewEvents]     = useState<HiladsEvent[]>([]);
  const [previewEventCount, setPreviewEventCount] = useState(0);

  const previewLiveCount = useMemo(() => randomLiveCount(), []);

  // ── Entrance animation - fade + slide up (mirrors .ob-identity-fadein) ──────
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

  // Geo escape hatch - reveal after 5s in pending/resolving
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
          // No Hilads events yet - fall back to public (Ticketmaster) events
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

  const [avatarC1, avatarC2] = avatarGradient(trimmed || 'A');
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
        // Don't seed the message badge here: boot.hasUnreadDMs is the combined
        // DM-OR-event-chat flag (server hasAnyUnread), so a joined-but-unopened
        // event chat would falsely light the DM badge. useGlobalDmNotifications
        // .joinAll() sets the accurate DM-only count.
        setCity(city);
        // joinCity is safe to call before connect - it queues the replay
        // and the socket fires it on 'connected'.
        socket.joinCity(city.channelId, sessionId, trimmed, account?.id, identity.guestId);
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
      setError(t('joinError'));
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

      {/* Background warm glow - radial(ellipse at 50% -10%) approximated as a vertical fade */}
      <LinearGradient
        colors={['rgba(194,74,56,0.12)', 'transparent']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.bgGlow}
        pointerEvents="none"
      />

      <View style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
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

            {/* ── ob-city-block ── */}
            <View style={styles.cityBlock}>
              {city ? (
                <>
                  {/* ob-city-name - gradient text approximated with accent2 */}
                  <Text style={styles.cityName} adjustsFontSizeToFit numberOfLines={1}>
                    {city.name}{' '}
                    <Text style={styles.cityFlagInline}>{cityFlag(city.country)}</Text>
                  </Text>

                  {/* ob-tagline */}
                  <Text style={styles.tagline}>Become local. Anywhere.</Text>

                  {/* ob-activity-block: people + events together */}
                  <View style={styles.activityBlock}>
                    <Text style={styles.activityLine}>
                      {t('peopleHere', { count: previewLiveCount })}
                    </Text>
                    {previewEventCount > 0 && (
                      <Text style={styles.activityLine}>
                        {t('vibesToday', { count: previewEventCount })}
                      </Text>
                    )}
                  </View>

                  {/* ob-events-preview - up to 3 items */}
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
                      {geoState === 'denied' ? t('geoOff') : t('geoUnreachable')}
                    </Text>
                  </View>
                  <Text style={styles.geoHeadline}>{t('pickCity')}</Text>
                </>
              ) : geoState === 'resolving' ? (
                <>
                  <PulsingText text={t('locating')} style={styles.locating} />
                  {showGeoEscape && (
                    <TouchableOpacity onPress={handleBrowseCities} activeOpacity={0.7} style={styles.geoEscapeBtn}>
                      <Text style={styles.geoEscapeText}>{t('chooseManually')}</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <>
                  <PulsingText text={t('requesting')} style={styles.locating} />
                  {showGeoEscape && (
                    <TouchableOpacity onPress={handleBrowseCities} activeOpacity={0.7} style={styles.geoEscapeBtn}>
                      <Text style={styles.geoEscapeText}>{t('chooseManually')}</Text>
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
                      <Text style={styles.btnText}>{t('browseCities')}</Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <Text style={styles.label}>{t('yourName')}</Text>

                  <View style={styles.inputRow}>
                    <LinearGradient colors={[avatarC1, avatarC2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatarCircle}>
                      <Text style={styles.avatarLetter}>{avatarLetter}</Text>
                    </LinearGradient>
                    <TextInput
                      style={styles.input}
                      value={nickname}
                      onChangeText={setNickname}
                      placeholder={t('namePlaceholder')}
                      placeholderTextColor={Colors.muted2}
                      maxLength={20}
                      autoCapitalize="words"
                      autoCorrect={false}
                      returnKeyType="done"
                    />
                  </View>

                  <TouchableOpacity style={styles.geoRetryBtn} activeOpacity={0.7} onPress={onRetryGeo}>
                    <Text style={styles.geoRetryText}>
                      {geoState === 'error' ? t('tryAgain') : t('useLocation')}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.label}>{t('yourName')}</Text>

                  <View style={styles.inputRow}>
                    <LinearGradient colors={[avatarC1, avatarC2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatarCircle}>
                      <Text style={styles.avatarLetter}>{avatarLetter}</Text>
                    </LinearGradient>
                    <TextInput
                      style={styles.input}
                      value={nickname}
                      onChangeText={setNickname}
                      placeholder={t('namePlaceholder')}
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
                          {city ? t('joinCity', { city: city.name }) : t('joinChat')}
                        </Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              )}

              <Text style={styles.hint}>{t('instantAccess')}</Text>
            </View>

            {/* ── jc-auth: divider + Create account / Log in + hint ── */}
            {!account && (
              <View style={styles.jcAuth}>

                {/* Divider with lines + "or keep your identity" */}
                <View style={styles.jcDivider}>
                  <View style={styles.jcDividerLine} />
                  <Text style={styles.jcDividerText}>{t('keepIdentity')}</Text>
                  <View style={styles.jcDividerLine} />
                </View>

                {/* Two buttons side by side */}
                <View style={styles.jcActions}>
                  <TouchableOpacity
                    style={styles.jcSignup}
                    onPress={() => { track('clicked_sign_up'); router.push('/sign-up'); }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.jcSignupText} numberOfLines={1}>{t('createAccount')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.jcSignin}
                    onPress={() => { track('clicked_sign_in'); router.push('/sign-in'); }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.jcSigninText} numberOfLines={1}>{t('logIn')}</Text>
                  </TouchableOpacity>
                </View>

                {/* jc-auth-hint */}
                <Text style={styles.jcHint}>{t('authHint')}</Text>

              </View>
            )}

          </Animated.View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const MONO = Platform.OS === 'ios' ? 'Courier' : 'monospace';

const styles = StyleSheet.create({

  // ── Screen - matches .ob-screen (centered, bg, radial glow approximated) ───
  screen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.bg,
    zIndex: 100,
  },
  // Top warm glow - approximate of radial-gradient ellipse at 50% -10%
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
    paddingHorizontal: 0,
    paddingVertical:   Spacing.xl,
  },

  // ── Content column ───────────────────────────────────────────────────────────
  // Native: full-bleed, no card frame - the page background is the only layer.
  // (Web keeps its centered max-width card; that lives in apps/web, untouched.)
  card: {
    width:             '100%',
    paddingTop:        28,
    paddingHorizontal: 22,
    paddingBottom:     28,
    gap:               30,
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

  // ── ob-city-block ────────────────────────────────────────────────────────────
  cityBlock: {
    alignItems:     'center',
    justifyContent: 'center',
    gap:            10,
    minHeight:      60,
  },
  // ob-city-name: 2.2rem=35px, weight 800, gradient text (approximated with accent2)
  cityName: {
    fontSize:      35,
    fontWeight:    '800',
    letterSpacing: -0.7,
    color:         '#C24A38',  // gradient start - web: linear-gradient(90deg, --accent, --accent2)
    textAlign:     'center',
    lineHeight:    38,
  },
  cityFlagInline: {
    fontSize: 28,
    color:    Colors.text,
  },
  // ob-tagline - bumped from 15/muted2 (~2.4:1) to 16/muted (~5.5:1) for
  // WCAG AA pass on the warm-near-black background. Apple G4 cited the
  // prior contrast as too low.
  tagline: {
    fontSize:   16,
    fontWeight: '400',
    color:      Colors.muted,
    textAlign:  'center',
    lineHeight: 22,
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

  // ob-events-preview: flex column, full width
  eventsPreview: {
    width:     '100%',
    gap:       10,
    marginTop: 4,
  },
  // ob-event-row: justify-between, bg:rgba(255,255,255,0.04), radius:8
  eventRow: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    gap:               8,
    paddingHorizontal: 12,
    paddingVertical:   11,
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
    // Shadow - web: box-shadow 0 4px 20px rgba(194,74,56,0.25)
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

  // Small muted sub-label under the form (sans-serif, matches the rest of the app).
  hint: {
    fontSize:      13,
    color:         Colors.muted2,
    textAlign:     'center',
  },

  // ── jc-auth: secondary auth section ──────────────────────────────────────────
  // Web: .jc-auth { gap:14, padding-top:4 }
  jcAuth: {
    gap:        14,
    paddingTop: 4,
  },

  // Divider with lines on each side - web: .jc-auth-divider with ::before/::after pseudo-elements
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

  // Two equal buttons side by side. Same shape (solid border, same width/radius);
  // "Create account" is the emphasized path - differentiated by warm fill + accent
  // text, NOT by a different border style.
  jcActions: {
    flexDirection: 'row',
    gap:           10,
  },

  // Create account - emphasized (filled, accent text)
  jcSignup: {
    flex:              1,
    minHeight:         46,
    paddingHorizontal: 12,
    borderWidth:       1,
    borderColor:       'rgba(194,74,56,0.6)',
    borderRadius:      12,
    backgroundColor:   'rgba(194,74,56,0.12)',
    alignItems:        'center',
    justifyContent:    'center',
  },
  jcSignupText: {
    color:      Colors.accent2,
    fontSize:   16,
    fontWeight: '600',
  },

  // Log in - secondary (transparent, neutral text). Identical shape to Create account.
  jcSignin: {
    flex:              1,
    minHeight:         46,
    paddingHorizontal: 12,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.14)',
    borderRadius:      12,
    backgroundColor:   'transparent',
    alignItems:        'center',
    justifyContent:    'center',
  },
  jcSigninText: {
    color:      Colors.muted,
    fontSize:   16,
    fontWeight: '600',
  },

  // jc-auth-hint: 0.68rem=11px, --muted, centered
  jcHint: {
    fontSize:      11,
    color:         Colors.muted,
    textAlign:     'center',
    letterSpacing: 0.2,
  },
});
