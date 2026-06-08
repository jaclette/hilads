import { useRef, useCallback, useEffect } from 'react';
import { Tabs, useFocusEffect } from 'expo-router';
import { View, Pressable, StyleSheet, BackHandler, ToastAndroid, Platform, Animated } from 'react-native';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useApp } from '@/context/AppContext';
import { Gradients } from '@/constants';
import { OnboardingCarousel } from '@/features/onboarding/OnboardingCarousel';
import { localizeCityName } from '@/i18n/cityName';
import { markOnboardingSeen } from '@/lib/onboarding';

// ── Web parity constants ──────────────────────────────────────────────────────
// Sourced from apps/web/src/index.css .bottom-nav / .bottom-nav-tab.
// Keep these in sync with the web CSS - they're the canonical source.

const ACTIVE_COLOR   = '#FF7A3C';                 // .bottom-nav-tab.active color
const INACTIVE_COLOR = 'rgba(255,255,255,0.52)';  // .bottom-nav-tab color
const BAR_BG         = '#141210';                 // opaque variant of rgba(20,18,16,0.96)
const BAR_BG_SOLID   = '#0d0b09';                 // --bg, matches the dot ring on web

// Dot colors - --hot-dot / --green / --profile-dot
const DOT_HOT     = '#FF7A3C';
const DOT_GREEN   = '#3DDC84';
const DOT_PROFILE = '#8B5CF6';

// Neon flash for the NOW tab when a feed bump lands - a bright, hot amber flame
// that fades in over the dim base icon so the dismissal is hard to miss.
const NOW_NEON = '#FFC400';

// ── Tab definitions - 4 primary tabs matching web .bottom-nav ─────────────────

type DotKind = 'hot' | 'green' | 'profile' | null;

type TabDef = {
  name:    string;
  label:   string;
  icon:    React.ComponentProps<typeof Ionicons>['name'];
  outline: React.ComponentProps<typeof Ionicons>['name'];
  dot:     DotKind;
};

const TABS: TabDef[] = [
  { name: 'now',  label: 'Now',     icon: 'flame',  outline: 'flame-outline',  dot: 'hot'     },
  { name: 'chat', label: 'My city', icon: 'business', outline: 'business-outline', dot: null      },
  { name: 'here', label: 'Here',    icon: 'people', outline: 'people-outline', dot: 'green'   },
  { name: 'me',   label: 'Me',      icon: 'person', outline: 'person-outline', dot: 'profile' },
];

// ── Notification dot - absolute-positioned, top-right of icon box ─────────────

function TabDot({ kind }: { kind: DotKind }) {
  if (!kind) return null;
  if (kind === 'green') {
    // Green "presence" dot has a bg-colored ring on the web (stroke="var(--bg)").
    return <View style={[styles.dot, styles.dotGreen]} />;
  }
  return (
    <View
      style={[
        styles.dot,
        kind === 'hot' ? styles.dotHot : styles.dotProfile,
      ]}
    />
  );
}

// ── Active-pill gradient wrapper ─────────────────────────────────────────────
// Web uses a pseudo-element with linear-gradient(180deg, rgba(255,122,60,0.16),
// rgba(255,122,60,0.06)) + box-shadow: 0 0 20px rgba(255,122,60,0.18). We
// split that into:
//   1. glow  - iOS colored shadow on the container (Android doesn't render
//              colored shadows, so we use a subtle oversized tinted View
//              behind the pill as a faux glow).
//   2. pill  - LinearGradient with the exact web stops + a 1-px top hairline
//              faking the web's `inset 0 1px 0 rgba(255,255,255,0.08)`.

function ActivePill() {
  // Android-only "glow" View was removed: RN can't render colored blur, so
  // the tinted rectangle showed as a hard outline + 2 px vertical bars at the
  // tab edges. iOS keeps the real colored shadow via styles.tabActiveShadow;
  // Android conveys the active state through the gradient pill + accent icon
  // + bold orange label.
  //
  // The web's `inset 0 1px 0 rgba(255,255,255,0.08)` top highlight does NOT
  // translate to RN - a 1px white View renders as a crisp visible line on
  // Android (no anti-aliasing), reading as an unwanted divider above the
  // active tab. Skipped here.
  return (
    <LinearGradient
      pointerEvents="none"
      colors={Gradients.activePill.colors}
      start={Gradients.activePill.start}
      end={Gradients.activePill.end}
      style={styles.pill}
    />
  );
}

// ── Custom tab bar - faithful port of web .bottom-nav ─────────────────────────

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { nowPulse } = useApp();
  const reduceMotion = useReducedMotion();

  // One-shot scale pulse on the NOW icon when a chat reminder dismisses. Driven
  // by the throttled `nowPulse` counter; a ref guards against firing on mount or
  // looping. Reduce-motion → no pulse (the NOW tab's permanent dot is the cue).
  const nowScale     = useRef(new Animated.Value(1)).current;
  // Opacity of the neon flame overlay (0→1→0, twice). Opacity is native-driver
  // safe; animating a vector-icon color prop is not (it crashed).
  const nowGlow      = useRef(new Animated.Value(0)).current;
  const lastPulseRef = useRef(0);
  useEffect(() => {
    if (nowPulse === lastPulseRef.current) return;
    lastPulseRef.current = nowPulse;
    if (nowPulse === 0 || reduceMotion) return;
    Animated.parallel([
      Animated.sequence([
        Animated.timing(nowScale, { toValue: 1.14, duration: 140, useNativeDriver: true }),
        Animated.timing(nowScale, { toValue: 1,    duration: 140, useNativeDriver: true }),
        Animated.timing(nowScale, { toValue: 1.14, duration: 140, useNativeDriver: true }),
        Animated.timing(nowScale, { toValue: 1,    duration: 140, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(nowGlow, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(nowGlow, { toValue: 0, duration: 140, useNativeDriver: true }),
        Animated.timing(nowGlow, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.timing(nowGlow, { toValue: 0, duration: 140, useNativeDriver: true }),
      ]),
    ]).start();
  }, [nowPulse, reduceMotion, nowScale, nowGlow]);

  return (
    <View style={[styles.container, { paddingBottom: Math.max(10, insets.bottom) }]}>
      {TABS.map(tab => {
        const routeIndex = state.routes.findIndex(r => r.name === tab.name);
        const focused    = state.index === routeIndex;
        const color      = focused ? ACTIVE_COLOR : INACTIVE_COLOR;

        const isNow = tab.name === 'now';

        return (
          <Pressable
            key={tab.name}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: focused }}
            style={[styles.tab, focused && styles.tabActiveShadow]}
            onPress={() => {
              const event = navigation.emit({
                type:              'tabPress',
                target:            state.routes[routeIndex]?.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                if (Platform.OS !== 'web') {
                  Haptics.selectionAsync().catch(() => {});
                }
                navigation.navigate(tab.name);
              }
            }}
          >
            {focused && <ActivePill />}

            {/* Icon - web: .bottom-nav-icon (26×26 with optional glow). The NOW
                tab's wrapper carries the dismissal pulse scale. */}
            <Animated.View
              style={[
                styles.iconWrap,
                focused && styles.iconWrapActive,
                tab.name === 'now' && { transform: [{ scale: nowScale }] },
              ]}
            >
              <Ionicons
                name={focused ? tab.icon : tab.outline}
                size={30}
                color={color}
              />
              {/* Neon flame that ignites over the base icon on a feed bump. */}
              {isNow && (
                <Animated.View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, styles.nowGlow, { opacity: nowGlow }]}
                >
                  <Ionicons name="flame" size={30} color={NOW_NEON} />
                </Animated.View>
              )}
              <TabDot kind={tab.dot} />
            </Animated.View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // .bottom-nav
  container: {
    flexDirection:        'row',
    backgroundColor:      BAR_BG,
    borderTopWidth:       1,
    borderTopColor:       'rgba(255,255,255,0.12)',
    borderTopLeftRadius:  22,
    borderTopRightRadius: 22,
    paddingTop:           8,
    paddingHorizontal:    10,
    // Web: box-shadow: 0 -18px 40px rgba(0,0,0,0.55) - dark bleed upward.
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: -18 },
    shadowOpacity: 0.55,
    shadowRadius:  40,
    elevation:     24,
  },

  // .bottom-nav-tab (baseline)
  tab: {
    flex:             1,
    flexDirection:    'column',
    alignItems:       'center',
    justifyContent:   'center',
    gap:              6,
    minHeight:        60,
    paddingTop:       10,
    paddingBottom:    8,
    paddingHorizontal: 6,
    borderRadius:     18,
    overflow:         'visible',
    position:         'relative',
  },

  // Active-pill colored shadow - iOS only. Android can't render colored
  // shadows in RN, so the active state relies on the pill gradient + icon
  // glow without a faux outline.
  // Web: 0 0 20px rgba(255,122,60,0.18) - isotropic orange glow.
  tabActiveShadow: Platform.select({
    ios: {
      shadowColor:   '#FF7A3C',
      shadowOffset:  { width: 0, height: 0 },
      shadowOpacity: 0.18,
      shadowRadius:  20,
    },
    default: {},
  }) as object,

  // ── Active pill ────────────────────────────────────────────────────────────
  pill: {
    position: 'absolute',
    top:      2,
    left:     4,
    right:    4,
    bottom:   2,
    borderRadius: 18,
  },
  // ── Icon ───────────────────────────────────────────────────────────────────
  iconWrap: {
    width:          32,
    height:         32,
    alignItems:     'center',
    justifyContent: 'center',
  },
  // Neon flame overlay - centered over the base icon, opacity-flashed on a bump.
  nowGlow: {
    alignItems:     'center',
    justifyContent: 'center',
  },
  iconWrapActive: Platform.select({
    // Web: filter: drop-shadow(0 0 9px rgba(255,122,60,0.42)) on active icon.
    ios: {
      shadowColor:   '#FF7A3C',
      shadowOffset:  { width: 0, height: 0 },
      shadowOpacity: 0.42,
      shadowRadius:  9,
    },
    default: {},
  }) as object,

  // ── Notification dots ──────────────────────────────────────────────────────
  // Web SVG coords put the dot near the top-right of a 24×24 icon box. Scaled
  // to our 28×28 iconWrap: ~top: -1, right: 1.
  dot: {
    position:     'absolute',
    top:          -1,
    right:        0,
    width:        6,
    height:       6,
    borderRadius: 3,
  },
  dotHot:     { backgroundColor: DOT_HOT },
  dotProfile: { backgroundColor: DOT_PROFILE },
  dotGreen: {
    width:        8,
    height:       8,
    borderRadius: 4,
    top:          -2,
    right:        -1,
    backgroundColor: DOT_GREEN,
    // Web uses stroke="var(--bg)" 1px ring around the green dot.
    borderWidth:  1,
    borderColor:  BAR_BG_SOLID,
  },
});

// ── Layout ────────────────────────────────────────────────────────────────────

export default function TabsLayout() {
  const { joined, city, showOnboarding, setShowOnboarding } = useApp();

  // ── Android hardware back - double-press to exit ───────────────────────────
  // useFocusEffect scopes this handler to when the tab group is focused.
  // It auto-cleans up when a root-stack screen (event, DM, etc.) gains focus,
  // so back navigation on those screens is unaffected.
  const lastBackPressRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const now = Date.now();
        if (now - lastBackPressRef.current < 2000) {
          return false; // second press → let the OS exit
        }
        lastBackPressRef.current = now;
        ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT);
        return true; // first press → show toast, block exit
      });
      return () => sub.remove();
    }, []),
  );

  // initialRouteName is only read at first mount. Since useAppBoot delays
  // setBooting(false) until after setJoined(true) for returning users, joined
  // is already true when this navigator first mounts - so it opens on 'chat'
  // directly without ever rendering the 'hot' tab first.
  return (
    <>
      <Tabs
        initialRouteName={joined ? 'chat' : 'now'}
        tabBar={props => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        {/* ── 4 primary tabs ─────────────────────────────────────────────── */}
        <Tabs.Screen name="now"  options={{ title: 'Now' }} />
        <Tabs.Screen name="chat" options={{ title: 'My city' }} />
        <Tabs.Screen name="here" options={{ title: 'Here' }} />
        <Tabs.Screen name="me"   options={{ title: 'Me' }} />
      </Tabs>

      {/* First-time guest onboarding (auto-shown from chat.tsx; "?" reopens it). */}
      <OnboardingCarousel
        visible={showOnboarding}
        city={localizeCityName(city?.name)}
        onClose={() => { markOnboardingSeen(); setShowOnboarding(false); }}
      />
    </>
  );
}
