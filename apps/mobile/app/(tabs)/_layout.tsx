import { useRef, useCallback, useEffect, useState } from 'react';
import { Tabs, useFocusEffect } from 'expo-router';
import { View, Pressable, StyleSheet, BackHandler, ToastAndroid, Platform, Keyboard } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import { Gradients } from '@/constants';
import { OnboardingCarousel } from '@/features/onboarding/OnboardingCarousel';
import { localizeCityName } from '@/i18n/cityName';
import { markOnboardingSeen } from '@/lib/onboarding';

// ── Web parity constants ──────────────────────────────────────────────────────
// Sourced from apps/web/src/index.css .bottom-nav / .bottom-nav-tab.
// Keep these in sync with the web CSS - they're the canonical source.

const ACTIVE_COLOR   = '#FF7A3C';                 // .bottom-nav-tab.active color (energy orange, reads on both themes)
// Inactive tab color + bar bg now come from the theme (colors.muted / colors.bg2)
// so the bar is white on light and near-black on dark instead of a fixed dark.
const BAR_BG         = '#141210';                 // static fallback base; overridden inline per-theme
const BAR_BG_SOLID   = '#0d0b09';                 // --bg, matches the dot ring on web

// Dot colors - --hot-dot / --green / --profile-dot
const DOT_HOT     = '#FF7A3C';
const DOT_GREEN   = '#3DDC84';
const DOT_PROFILE = '#8B5CF6';

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
  { name: 'chat',       label: 'My city',    icon: 'home',   outline: 'home-outline',    dot: null },
  { name: 'challenges', label: 'Challenges', icon: 'flame',  outline: 'flame-outline',   dot: null },
  { name: 'events',     label: 'Events',     icon: 'balloon', outline: 'balloon-outline', dot: null },
  { name: 'me',         label: 'Me',         icon: 'person', outline: 'person-outline',  dot: null },
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

// ── EVENTS tab icon - party popper, ported 1:1 from the web NavIconParty SVG
// so it matches (Ionicons has no party-popper). Tints with the active color
// like every other tab icon. ──────────────────────────────────────────────────

function NavIconParty({ color, size = 30 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      {/* Cone */}
      <Path d="M3 21 8.5 8l7.5 7.5z" />
      {/* Streamers */}
      <Path d="M14 6c1.2-1.2 3-1.2 4 0" strokeWidth={1.4} />
      <Path d="M16.5 3.5c.9-.9 2.4-.9 3.3 0" strokeWidth={1.4} />
      <Path d="M19 9c1-.3 1.8.5 1.5 1.5" strokeWidth={1.4} />
      {/* Confetti dots */}
      <Circle cx={13} cy={12} r={0.7} fill={color} stroke="none" />
      <Circle cx={20} cy={14} r={0.7} fill={color} stroke="none" />
      <Circle cx={17.5} cy={18} r={0.7} fill={color} stroke="none" />
    </Svg>
  );
}

// ── Custom tab bar - faithful port of web .bottom-nav ─────────────────────────

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors, theme } = useTheme(); // bar bg + inactive icon follow the theme

  // Hide the bar entirely while the keyboard is up so typing in chat gets a
  // focused, gap-free conversation. We UNMOUNT (return null) rather than just
  // translate it: the tab bar otherwise keeps reserving its height as the
  // scene's bottom inset, leaving a dark gap between the composer and the
  // keyboard. Android needs keyboardDidShow/Hide; iOS fires the smoother
  // will* events.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvt, () => setKeyboardUp(true));
    const onHide = Keyboard.addListener(hideEvt, () => setKeyboardUp(false));
    return () => { onShow.remove(); onHide.remove(); };
  }, []);
  if (keyboardUp) return null;

  // Scale + flame-glow pulse on the NOW icon was removed: the city chat's
  // ephemeral activity cards (which fired pulseNow on dismissal) are
  // gone, and the user found the bump distracting. The persistent
  // "activity counter" pill inside the chat now carries that signal.

  return (
    <View style={[styles.container, {
      backgroundColor: colors.bg2,               // white on light, near-black on dark
      borderTopColor:  colors.separator,
      shadowOpacity:   theme === 'dark' ? 0.5 : 0.08, // heavy dark bleed only makes sense on dark
      paddingBottom:   Math.max(10, insets.bottom),
    }]}>
      {TABS.map(tab => {
        const routeIndex = state.routes.findIndex(r => r.name === tab.name);
        const focused    = state.index === routeIndex;
        const color      = focused ? ACTIVE_COLOR : colors.muted;

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

            {/* Icon - web: .bottom-nav-icon (26×26). Plain static icon - no
                pulse, no glow overlay (removed alongside the noisy city-chat
                activity pills). */}
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
              {tab.name === 'events'
                ? <NavIconParty color={color} size={30} />
                : <Ionicons name={focused ? tab.icon : tab.outline} size={30} color={color} />}
              <TabDot kind={tab.dot} />
            </View>
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
        initialRouteName={joined ? 'chat' : 'events'}
        tabBar={props => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        {/* ── 4 primary tabs (MY CITY · CHALLENGES · EVENTS · ME) ─────────── */}
        <Tabs.Screen name="chat"       options={{ title: 'My city' }} />
        <Tabs.Screen name="challenges" options={{ title: 'Challenges' }} />
        <Tabs.Screen name="events"     options={{ title: 'Events' }} />
        <Tabs.Screen name="me"         options={{ title: 'Me' }} />
        {/* HERE is off the bar but still a route - reached via the city
            "nearby" pill (chat.tsx). Not in TABS, so no bottom-bar button. */}
        <Tabs.Screen name="here" options={{ title: 'Here' }} />
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
