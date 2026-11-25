import { useRef, useCallback, useEffect, useState } from 'react';
import { Tabs, router, useFocusEffect, useSegments } from 'expo-router';
import { View, Text, Pressable, StyleSheet, BackHandler, Platform, Keyboard } from 'react-native';
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
import { useApp } from '@/context/AppContext';
import { badgeCount, useUnreadMessages } from '@/features/messages/unread';
import { useContestTab } from '@/features/contest/useContestTab';

// V6 tab badges: what each tab's badge counts, and the notification types its visit marks read.
// (Hi is no longer a tab: its mentions reach the bell and the inbox.)
const TAB_BADGE: Record<string, { key: 'passport' | 'ranks'; types: string[]; count: boolean }> = {
  passport: { key: 'passport', types: ['daily_local_pass'],                count: false },
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

// The Launch Season's temporary tab (not a route: it opens the contest screens).
const SEASON_TAB: TabDef = { name: 'season', label: 'tabs.season', icon: 'airplane-outline' };

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
  const { badges, total: unreadNotifs } = useNotifCounts();
  const { account } = useApp();
  const unreadMessages = useUnreadMessages();
  // The Passport tab: everything unread behind its rows (Messages, Notifications), the same numbers as those rows.
  const passportCount = account ? unreadMessages + unreadNotifs : 0;
  useEffect(() => {
    const b = activeTab ? TAB_BADGE[activeTab] : undefined;
    if (!b || !badges[b.key]) return;
    patchNotifCounts(c => ({ ...c, badges: { ...c.badges, [b.key]: 0 } }));
    markNotificationTypesRead(b.types).then(refreshNotifCounts);
  }, [activeTab, badges]);  

  // The Launch Season (temporary 5th tab, a plane in the middle): only while a season is Upcoming
  // or Running; a launcher to the teaser / Prize screen or my contest home. Gone when it ends.
  const contest = useContestTab();
  const tabs: TabDef[] = contest ? [...TABS.slice(0, 2), SEASON_TAB, ...TABS.slice(2)] : TABS;

  if (keyboardUp) return null;

  return (
    <View style={[styles.container, contest && styles.containerFive, {
      backgroundColor: colors.bg2,
      borderTopColor:  colors.line,
      paddingBottom:   Math.max(12, insets.bottom),
    }]}>
      {tabs.map(tab => {
        if (tab.name === SEASON_TAB.name && contest) {
          const label = t(tab.label);
          return (
            <Pressable key={tab.name} accessibilityRole="button" testID="tab-season"
                       accessibilityLabel={`${label}${contest.isTest ? ' (TEST)' : ''}${contest.isNew ? `, ${t('tabs.new')}` : ''}`}
                       style={styles.tab}
                       onPress={() => {
                         track('tab_pressed', { from: activeTab ?? null, to: 'season' });
                         if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
                         contest.markSeen();
                         router.push(contest.route as never);
                       }}>
              <View>
                <Ionicons name={tab.icon} size={IconSize.lg} color={colors.primaryText} />
                {contest.isTest
                  ? <Text style={[styles.test, { color: '#FFFFFF', backgroundColor: colors.red, borderColor: colors.bg2 }]} maxFontSizeMultiplier={1.2}>TEST</Text>
                  : contest.isNew && <View style={[styles.dot, { backgroundColor: colors.cta, borderColor: colors.bg2 }]} />}
                {contest.isTest && contest.isNew && <View style={[styles.dot, styles.dotLeft, { backgroundColor: colors.cta, borderColor: colors.bg2 }]} />}
              </View>
              <Text style={[styles.label, styles.labelActive, { color: colors.primaryText }]} numberOfLines={1} maxFontSizeMultiplier={1.4} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
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
              {tab.name === 'passport' && passportCount > 0
                // Passport: what's unread inside it (messages + notifications), a red count from every screen.
                ? <CountBadge n={passportCount} />
                : <TabBadge n={TAB_BADGE[tab.name] && !focused ? badges[TAB_BADGE[tab.name].key] : 0} count={!!TAB_BADGE[tab.name]?.count} />}
            </View>
            <Text style={[styles.label, { color }, focused && styles.labelActive]} numberOfLines={1} maxFontSizeMultiplier={1.4} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The Passport tab's red count ("3", "9+"): unread messages and notifications, the same red as the messages button. */
function CountBadge({ n }: { n: number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: colors.red, borderColor: colors.bg2 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.badgeText, { color: colors.bg }]} maxFontSizeMultiplier={1.3}>{badgeCount(n)}</Text>
    </View>
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
