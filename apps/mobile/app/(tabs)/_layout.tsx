import { useRef, useCallback, useEffect, useState } from 'react';
import { Tabs, router, useFocusEffect, useSegments } from 'expo-router';
import { View, Text, Pressable, StyleSheet, BackHandler, Platform, Keyboard, Animated, Easing, AppState, AccessibilityInfo } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/context/ThemeContext';
import { Space, FontSizes, IconSize } from '@/constants';
import { useSeasonalLive } from '@/features/event/seasonal';
import { PumpkinIcon, SeasonalScope, TabGhost } from '@/features/event/SeasonalArt';
import { patchNotifCounts, refreshNotifCounts, useNotifCounts } from '@/features/notifications/counts';
import { markNotificationTypesRead } from '@/api/notifications';
import { markTabFocus, markTabPress } from '@/lib/perfProbe';
import { track } from '@/services/analytics';
import { useContestTab } from '@/features/contest/useContestTab';

// V6 tab badges: what each tab's badge counts, and the notification types its visit marks read.
// (Hi is no longer a tab: its mentions reach the bell and the inbox.)
const TAB_BADGE: Record<string, { key: 'passport' | 'ranks'; types: string[]; count: boolean }> = {
  passport: { key: 'passport', types: ['daily_local_pass', 'daily_season_result'], count: false },
  ranks:    { key: 'ranks',    types: ['daily_result', 'daily_rank'],      count: false },
};

// ── Tabs (V3, SPEC 9.1 and the mockups): stroke icons with a label; the
// active tab sits on a primary-tint pill. ─────────────────────────────────────

type TabDef = {
  name:  string;
  label: string;   // common.json tabs.*
  icon:  React.ComponentProps<typeof Ionicons>['name'];
};

// Four tabs (UX audit option B, 2026-11): play (Today), compare (World: the ranks route, its
// photos, players, cities and the Index), where (Map: spots and plans), me (Passport: inbox,
// settings). Hi is a screen of the city, opened from Today, not a tab.
const TABS: TabDef[] = [
  { name: 'today',    label: 'tabs.today',    icon: 'flame-outline' },
  { name: 'ranks',    label: 'scope.world',   icon: 'earth-outline' },
  { name: 'map',      label: 'tabs.map',      icon: 'map-outline' },
  { name: 'passport', label: 'tabs.passport', icon: 'id-card-outline' },
];

// The campaign's temporary tab (the "trip" route), in the middle; its label and icon come from the
// server (Admin › Launch Season), else "Trip" and a plane.
const TRIP_TAB: TabDef = { name: 'trip', label: 'tabs.trip', icon: 'airplane' };

// expo-router 58: the first tab is set here (Tabs no longer takes initialRouteName).
export const unstable_settings = { initialRouteName: 'today' };

function CustomTabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  // A seasonal event's live day: Today wears its icon (Halloween: a pumpkin) and a ghost peeks over the active tab.
  const halloween = useSeasonalLive()?.key === 'halloween';

  // Hide the bar entirely while the keyboard is up so typing in chat gets a
  // focused, gap-free conversation. We UNMOUNT (return null) rather than just
  // translate it: the tab bar otherwise keeps reserving its height as the
  // scene's bottom inset, leaving a gap between the composer and the keyboard.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvt, () => setKeyboardUp(true));
    const onHide = Keyboard.addListener(hideEvt, () => setKeyboardUp(false));
    return () => { onShow.remove(); onHide.remove(); };
  }, []);
  // A hidden route (challenges, me, Hi and its lists...) highlights the tab it belongs to.
  const current = state.routes[state.index]?.name;
  const activeTab = current === 'me' ? 'passport'
    : current === 'challenges' || current === 'chat' || current === 'events' || current === 'here' ? 'today'
    : current;

  // Opening a tab clears its badge (the notifications behind it are read).
  const { badges } = useNotifCounts();
  useEffect(() => {
    const b = activeTab ? TAB_BADGE[activeTab] : undefined;
    if (!b || !badges[b.key]) return;
    patchNotifCounts(c => ({ ...c, badges: { ...c.badges, [b.key]: 0 } }));
    markNotificationTypesRead(b.types).then(refreshNotifCounts);
  }, [activeTab, badges]);  

  // The campaign (temporary 5th tab in the middle, highlighted): a real destination while a campaign
  // is on (and a few days after it ends, for the winner); gone afterwards.
  const contest = useContestTab();
  const tabs: TabDef[] = contest ? [...TABS.slice(0, 2), TRIP_TAB, ...TABS.slice(2)] : TABS;

  if (keyboardUp) return null;

  return (
    <View style={[styles.container, contest && styles.containerFive, {
      backgroundColor: colors.bg2,
      borderTopColor:  colors.line,
      paddingBottom:   Math.max(12, insets.bottom),
    }]}>
      {tabs.map(tab => {
        if (tab.name === TRIP_TAB.name && contest) {
          const label = contest.label ?? t(tab.label);
          const focused = activeTab === 'trip';
          const icon = (focused ? contest.icon : `${contest.icon}-outline`) as TabDef['icon'];
          return (
            <Pressable key={tab.name} accessibilityRole="tab" testID="tab-trip" accessibilityState={{ selected: focused }}
                       accessibilityLabel={`${label}${contest.isTest ? ' (TEST)' : ''}${contest.isNew ? `, ${t('tabs.new')}` : ''}`}
                       style={styles.tab}
                       onPress={() => {
                         contest.markSeen();
                         markSeasonTabOpened();
                         const routeIndex = state.routes.findIndex(r => r.name === 'trip');
                         const route = state.routes[routeIndex];
                         if (!route || state.index === routeIndex) return;
                         markTabPress('trip');
                         track('tab_pressed', { from: activeTab ?? null, to: 'trip' });
                         if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
                         navigateToTab(route.key);
                       }}>
              {/* Raised gold pill (gold = prizes): it stands out from the four tabs, focused or not. */}
              <View style={[styles.tripPill, { backgroundColor: colors.medalGold, shadowColor: colors.shadow }, focused && styles.tripPillOn]}>
                <SeasonPlane icon={icon} color={colors.onMedal} />
                {contest.isTest
                  ? <Text style={[styles.test, { color: '#FFFFFF', backgroundColor: colors.red, borderColor: colors.bg2 }]} maxFontSizeMultiplier={1.2}>TEST</Text>
                  : contest.isNew && !focused && <View style={[styles.dot, { backgroundColor: colors.red, borderColor: colors.bg2 }]} />}
              </View>
              <Text style={[styles.label, styles.labelActive, { color: colors.text }]} numberOfLines={1} maxFontSizeMultiplier={1.4} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
            </Pressable>
          );
        }
        const routeIndex = state.routes.findIndex(r => r.name === tab.name);
        const focused    = activeTab === tab.name;
        // One selected state for every tab (design pass): the shared peach. Gold is for prizes only.
        const color      = focused ? colors.onSelected : colors.muted;
        const label      = t(tab.label);
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="tab"
            accessibilityLabel={label}
            testID={`tab-${tab.name}`}
            accessibilityState={{ selected: focused }}
            style={[styles.tab, focused && { backgroundColor: colors.selected }]}
            onPress={() => {
              const route = state.routes[routeIndex];
              // expo-router 58: the bar gets an emitter and navigateToTab (no navigation object).
              const event = emitter.emit({
                type:              'tabPress',
                target:            state.routes[routeIndex]?.key,
                canPreventDefault: true,
              });
              if (state.index !== routeIndex && !event.defaultPrevented) {
                markTabPress(tab.name);
                track('tab_pressed', { from: activeTab ?? null, to: tab.name });
                if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
                if (route) navigateToTab(route.key);
              }
            }}
          >
            {focused && <TabGhost />}
            <View>
              {halloween && tab.name === 'today' ? <PumpkinIcon size={24} color={color} />
                : <Ionicons name={tab.icon} size={IconSize.lg} color={color} />}
              {/* A dot for the tab's own news (Passport: a new stamp, a Local Pass, a season medal), cleared when it's opened.
                  Unread notifications and messages are the header's bell and messages button, on every tab. */}
              <TabBadge n={TAB_BADGE[tab.name] && !focused ? badges[TAB_BADGE[tab.name].key] : 0} count={!!TAB_BADGE[tab.name]?.count} />
            </View>
            <Text style={[styles.label, { color }, focused && styles.labelActive]} numberOfLines={1} maxFontSizeMultiplier={1.4} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── The Boarding tab's plane: a one-time takeoff glide ───────────────────────
// Once per app open (launch, or back from the background), never again once the tab was opened
// (remembered on the device), never with reduce motion. A 1.3 s native-driver animation, so no
// cost while idle; the bar remounting (keyboard) doesn't replay it in the same session.
const OPENED_KEY = 'contest_tab_opened';
let openedMem: boolean | null = null;
let playedThisOpen = false;
AppState.addEventListener('change', st => { if (st === 'background') playedThisOpen = false; });

function markSeasonTabOpened() {
  if (openedMem) return;
  openedMem = true;
  AsyncStorage.setItem(OPENED_KEY, '1').catch(() => {});
}

function SeasonPlane({ icon, color }: { icon: TabDef['icon']; color: string }) {
  const t = useRef(new Animated.Value(1)).current;     // 1 = at rest
  const [opened, setOpened] = useState<boolean | null>(openedMem);
  useEffect(() => {
    if (openedMem !== null) return;
    AsyncStorage.getItem(OPENED_KEY).then(v => { openedMem = v === '1'; setOpened(openedMem); }).catch(() => { openedMem = true; setOpened(true); });
  }, []);
  useEffect(() => {
    if (opened !== false) return;
    const play = () => {
      if (playedThisOpen || openedMem) return;
      AccessibilityInfo.isReduceMotionEnabled().then(still => {
        if (still) { playedThisOpen = true; return; }
        t.setValue(0);
        // Counted as played only once it finished on screen: a tab bar mounted and replaced during
        // the start-up redirect (its glide cut short) doesn't use up the one glide of this open.
        Animated.timing(t, { toValue: 1, duration: 1300, delay: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true })
          .start(({ finished }) => { if (finished) playedThisOpen = true; });
      }).catch(() => {});
    };
    play();
    const sub = AppState.addEventListener('change', st => { if (st === 'active') play(); });
    return () => { sub.remove(); t.stopAnimation(); };
  }, [opened, t]);
  const style = {
    opacity: t.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 1] }),
    transform: [
      { translateX: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [-16, 5, 0] }) },
      { translateY: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [4, -3, 0] }) },
      { rotate: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: ['8deg', '-12deg', '0deg'] }) },
    ],
  };
  return (
    <Animated.View style={style}>
      <Ionicons name={icon} size={IconSize.lg} color={color} />
    </Animated.View>
  );
}

/** A tab's badge: a number (Hi: mentions) or a dot (Passport, Ranks). */
function TabBadge({ n, count }: { n: number; count: boolean }) {
  const { colors } = useTheme();
  if (n <= 0) return null;
  return count ? (
    <View style={[styles.badge, { backgroundColor: colors.cta, borderColor: colors.bg2 }]}>
      <Text style={[styles.badgeText, { color: colors.onCta }]} maxFontSizeMultiplier={1.3}>{n > 9 ? '9+' : n}</Text>
    </View>
  ) : <View style={[styles.dot, { backgroundColor: colors.cta, borderColor: colors.bg2 }]} />;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection:     'row',
    gap:               Space.sm,
    borderTopWidth:    1,
    paddingTop:        Space.sm,
    paddingHorizontal: Space.md,
  },
  // Five tabs (a Launch Season is on): a little tighter so every label still fits a small phone.
  containerFive: { gap: Space.xs, paddingHorizontal: Space.sm },
  tab: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            Space.xxs,
    minHeight:      56,
    borderRadius:   16,
  },
  label:       { fontSize: FontSizes.xs, fontWeight: '600' },
  badge:       { position: 'absolute', top: -5, right: -10, minWidth: 18, height: 18, paddingHorizontal: Space.xs, borderRadius: 9,
                 borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badgeText:   { fontSize: FontSizes.tiny, lineHeight: 14, fontWeight: '800' },
  dot:         { position: 'absolute', top: -2, right: -4, width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
  dotLeft:     { right: undefined, left: -4 },
  test:        { position: 'absolute', top: -6, right: -16, fontSize: 8, lineHeight: 11, fontWeight: '900', paddingHorizontal: 3,
                 borderRadius: 4, borderWidth: 1, overflow: 'hidden' },
  labelActive: { fontWeight: '700' },
  tripPill:    { width: 52, height: 40, marginTop: -14, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                 shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  tripPillOn:  { transform: [{ scale: 1.06 }] },
});

// ── Layout ────────────────────────────────────────────────────────────────────

export default function TabsLayout() {
  // ── Android hardware back (navigation rule) ───────────────────────────────
  // Back closes the top layer; from another tab's root it goes to Today, and
  // only Today with nothing open leaves the app. backBehavior="firstRoute" does
  // the tabs part; this handler sends the off-bar screens (Hi Local, nearby,
  // me) back to the tab they belong to. useFocusEffect scopes it to when the
  // tab group is focused: a pushed screen (event, DM, sheet...) handles its own.
  const segments = useSegments();
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const tab = segmentsRef.current[1];
        const owner = tab === 'events' || tab === 'here' ? 'chat' : tab === 'me' ? 'passport' : null;
        if (!owner) return false;
        router.navigate(`/(tabs)/${owner}` as never);
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  // V3 (SPEC 9.1): Today is the home for everyone. A seasonal event's live
  // day colors the whole tab bar and every tab (SeasonalScope).
  return (
    <SeasonalScope>
    <Tabs
      backBehavior="firstRoute"
      tabBar={props => <CustomTabBar {...props} />}
      // A tab you left stops rendering (frozen) until you come back: context ticks, presence,
      // countdowns and data arriving no longer re-render every tab visited so far.
      screenOptions={{ headerShown: false, freezeOnBlur: true }}
      screenListeners={({ route }) => ({ focus: () => markTabFocus(route.name) })}
    >
      {/* ── 4 tabs: TODAY · MAP · CHAT · PASSPORT ───────────────────────── */}
      <Tabs.Screen name="today"    options={{ title: 'Today' }} />
      <Tabs.Screen name="map"      options={{ title: 'Map' }} />
      <Tabs.Screen name="ranks"    options={{ title: 'Ranks' }} />
      <Tabs.Screen name="chat"     options={{ title: 'Chat' }} />
      <Tabs.Screen name="passport" options={{ title: 'Passport' }} />
      {/* The campaign's destination: on the bar only while a campaign is on (useContestTab). */}
      <Tabs.Screen name="trip"     options={{ title: 'Trip' }} />
      {/* Off the bar, still routes so every push and link keeps working:
          challenges → redirects to Today; events (Hi Local) until V3-09;
          me (?tab=…) until V3-10; here from the Chat "nearby" pill. */}
      <Tabs.Screen name="challenges" options={{ title: 'Challenges' }} />
      <Tabs.Screen name="events"     options={{ title: 'Events' }} />
      <Tabs.Screen name="me"         options={{ title: 'Me' }} />
      <Tabs.Screen name="here"       options={{ title: 'Here' }} />
    </Tabs>
    </SeasonalScope>
  );
}
