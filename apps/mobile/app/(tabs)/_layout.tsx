import { useRef, useCallback, useEffect, useState } from 'react';
import { Tabs, useFocusEffect } from 'expo-router';
import { View, Text, Pressable, StyleSheet, BackHandler, ToastAndroid, Platform, Keyboard } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import { FontSizes } from '@/constants';
import { OnboardingCarousel } from '@/features/onboarding/OnboardingCarousel';
import { localizeCityName } from '@/i18n/cityName';
import { markOnboardingSeen } from '@/lib/onboarding';

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
  { name: 'chat',     label: 'tabs.chat',     icon: 'chatbubble-outline' },
  { name: 'passport', label: 'tabs.passport', icon: 'id-card-outline' },
];

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation('common');

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
  if (keyboardUp) return null;

  // A hidden route (challenges, me...) highlights the tab it belongs to.
  const current = state.routes[state.index]?.name;
  const activeTab = current === 'me' ? 'passport'
    : current === 'challenges' ? 'today'
    : current === 'events' || current === 'here' ? 'chat'
    : current;

  return (
    <View style={[styles.container, {
      backgroundColor: colors.bg2,
      borderTopColor:  colors.line,
      paddingBottom:   Math.max(12, insets.bottom),
    }]}>
      {TABS.map(tab => {
        const routeIndex = state.routes.findIndex(r => r.name === tab.name);
        const focused    = activeTab === tab.name;
        const color      = focused ? colors.primaryOnTint : colors.muted;
        const label      = t(tab.label);
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: focused }}
            style={[styles.tab, focused && { backgroundColor: colors.primaryTint }]}
            onPress={() => {
              const event = navigation.emit({
                type:              'tabPress',
                target:            state.routes[routeIndex]?.key,
                canPreventDefault: true,
              });
              if (state.index !== routeIndex && !event.defaultPrevented) {
                if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
                navigation.navigate(tab.name);
              }
            }}
          >
            <Ionicons name={tab.icon} size={24} color={color} />
            <Text style={[styles.label, { color }, focused && styles.labelActive]} numberOfLines={1}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
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
  labelActive: { fontWeight: '700' },
});

// ── Layout ────────────────────────────────────────────────────────────────────

export default function TabsLayout() {
  const { city, showOnboarding, setShowOnboarding } = useApp();

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

  // V3 (SPEC 9.1): Today is the home for everyone.
  return (
    <>
      <Tabs
        initialRouteName="today"
        tabBar={props => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        {/* ── 4 tabs: TODAY · MAP · CHAT · PASSPORT ───────────────────────── */}
        <Tabs.Screen name="today"    options={{ title: 'Today' }} />
        <Tabs.Screen name="map"      options={{ title: 'Map' }} />
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

      {/* First-time guest onboarding (auto-shown from chat.tsx; "?" reopens it). */}
      <OnboardingCarousel
        visible={showOnboarding}
        city={localizeCityName(city?.name)}
        onClose={() => { markOnboardingSeen(); setShowOnboarding(false); }}
      />
    </>
  );
}
