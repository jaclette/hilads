import { useRef, useCallback, useEffect, useState } from 'react';
import { Tabs, router, useFocusEffect, useSegments } from 'expo-router';
import { View, Text, Pressable, StyleSheet, BackHandler, Platform, Keyboard } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/context/ThemeContext';
import { FontSizes } from '@/constants';
import { useSeasonalLive } from '@/features/event/seasonal';
import { PumpkinIcon, SeasonalScope, TabGhost } from '@/features/event/SeasonalArt';
import { patchNotifCounts, refreshNotifCounts, useNotifCounts } from '@/features/notifications/counts';
import { markNotificationTypesRead } from '@/api/notifications';
import { themeColor, tint } from '@/ui/joy';
import { markTabFocus, markTabPress } from '@/lib/perfProbe';

const GOLD = themeColor('sip');

// V6 tab badges: what each tab's badge counts, and the notification types its visit marks read.
const TAB_BADGE: Record<string, { key: 'chat' | 'passport' | 'ranks'; types: string[]; count: boolean }> = {
  chat:     { key: 'chat',     types: ['mention', 'city_here'],            count: true },
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

const TABS: TabDef[] = [
  { name: 'today',    label: 'tabs.today',    icon: 'flame-outline' },
  { name: 'map',      label: 'tabs.map',      icon: 'map-outline' },
  // V6: the game hub, gold when active.
  { name: 'ranks',    label: 'tabs.ranks',    icon: 'trophy-outline' },
  { name: 'chat',     label: 'tabs.chat',     icon: 'chatbubble-outline' },
  { name: 'passport', label: 'tabs.passport', icon: 'id-card-outline' },
];

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors, theme } = useTheme();
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
  // A hidden route (challenges, me...) highlights the tab it belongs to.
  const current = state.routes[state.index]?.name;
  const activeTab = current === 'me' ? 'passport'
    : current === 'challenges' ? 'today'
    : current === 'events' || current === 'here' ? 'chat'
    : current;

  // Opening a tab clears its badge (the notifications behind it are read).
  const { badges } = useNotifCounts();
  useEffect(() => {
    const b = activeTab ? TAB_BADGE[activeTab] : undefined;
    if (!b || !badges[b.key]) return;
    patchNotifCounts(c => ({ ...c, badges: { ...c.badges, [b.key]: 0 } }));
    markNotificationTypesRead(b.types).then(refreshNotifCounts);
  }, [activeTab, badges]); // eslint-disable-line react-hooks/exhaustive-deps

  if (keyboardUp) return null;

  return (
    <View style={[styles.container, {
      backgroundColor: colors.bg2,
      borderTopColor:  colors.line,
      paddingBottom:   Math.max(12, insets.bottom),
    }]}>
      {TABS.map(tab => {
        const routeIndex = state.routes.findIndex(r => r.name === tab.name);
        const focused    = activeTab === tab.name;
        const gold       = tab.name === 'ranks' && focused;
        const color      = gold ? (theme === 'dark' ? GOLD.textDark : GOLD.textLight) : focused ? colors.primaryOnTint : colors.muted;
        const label      = t(tab.label);
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="tab"
            accessibilityLabel={label}
            testID={`tab-${tab.name}`}
            accessibilityState={{ selected: focused }}
            style={[styles.tab, focused && { backgroundColor: gold ? tint(GOLD.fill, 0.22) : colors.primaryTint }]}
            onPress={() => {
              const event = navigation.emit({
                type:              'tabPress',
                target:            state.routes[routeIndex]?.key,
                canPreventDefault: true,
              });
              if (state.index !== routeIndex && !event.defaultPrevented) {
                markTabPress(tab.name);
                if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
                navigation.navigate(tab.name);
              }
            }}
          >
            {focused && <TabGhost />}
            <View>
              {halloween && tab.name === 'today' ? <PumpkinIcon size={24} color={color} />
                : <Ionicons name={gold ? 'trophy' : tab.icon} size={24} color={color} />}
              <TabBadge n={TAB_BADGE[tab.name] && !focused ? badges[TAB_BADGE[tab.name].key] : 0} count={!!TAB_BADGE[tab.name]?.count} />
            </View>
            <Text style={[styles.label, { color }, focused && styles.labelActive]} numberOfLines={1}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A tab's badge: a number (Hi: mentions) or a dot (Passport, Ranks). */
function TabBadge({ n, count }: { n: number; count: boolean }) {
  const { colors } = useTheme();
  if (n <= 0) return null;
  return count ? (
    <View style={[styles.badge, { backgroundColor: colors.cta, borderColor: colors.bg2 }]}>
      <Text style={[styles.badgeText, { color: colors.onCta }]}>{n > 9 ? '9+' : n}</Text>
    </View>
  ) : <View style={[styles.dot, { backgroundColor: colors.cta, borderColor: colors.bg2 }]} />;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection:     'row',
    gap:               6,
    borderTopWidth:    1,
    paddingTop:        8,
    paddingHorizontal: 12,
  },
  tab: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            2,
    minHeight:      56,
    borderRadius:   16,
  },
  label:       { fontSize: FontSizes.tiny + 1, fontWeight: '600' },
  badge:       { position: 'absolute', top: -5, right: -10, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9,
                 borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badgeText:   { fontSize: 10, lineHeight: 12, fontWeight: '800' },
  dot:         { position: 'absolute', top: -2, right: -4, width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
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
      initialRouteName="today"
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
