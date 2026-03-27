import { Tabs } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants';

// ── Web nav color tokens ──────────────────────────────────────────────────────
// Sourced from index.css: .bottom-nav-tab, .bottom-nav-tab.active

const ACTIVE_COLOR   = '#FF7A3C';                  // web: color: #FF7A3C on .active
const INACTIVE_COLOR = 'rgba(255,255,255,0.52)';   // web: color: rgba(255,255,255,0.52)
const GREEN          = '#3ddc84';                   // web: var(--green), NavIconPeople dot
const VIOLET         = '#8B5CF6';                  // web: var(--profile-dot), NavIconProfile dot

// ── Status dots — mirrors web SVG overlay circles ────────────────────────────
// Each icon in the web SVG has a small status circle. Always visible, not just active.

function Dot({ color }: { color: string }) {
  return (
    <View style={{
      position:        'absolute',
      top:             -1,
      right:           -4,
      width:           7,
      height:          7,
      borderRadius:    3.5,
      backgroundColor: color,
      borderWidth:     1.5,
      borderColor:     'rgba(20,18,16,0.96)',  // matches container bg
    }} />
  );
}

// ── Tab definitions — 4 primary tabs matching web .bottom-nav ─────────────────

type TabDef = {
  name:    string;
  label:   string;
  icon:    React.ComponentProps<typeof Ionicons>['name'];
  outline: React.ComponentProps<typeof Ionicons>['name'];
  dot:     string;
};

const TABS: TabDef[] = [
  { name: 'hot',    label: 'Hot',    icon: 'flame',  outline: 'flame-outline',  dot: ACTIVE_COLOR },
  { name: 'cities', label: 'Cities', icon: 'earth',  outline: 'earth-outline',  dot: ACTIVE_COLOR },
  { name: 'here',   label: 'Here',   icon: 'people', outline: 'people-outline', dot: GREEN },
  { name: 'me',     label: 'Me',     icon: 'person', outline: 'person-outline', dot: VIOLET },
];

// ── Custom tab bar — faithful port of web .bottom-nav ────────────────────────
//
// Web reference (index.css):
//   .bottom-nav:        bg rgba(20,18,16,0.96), border rgba(255,255,255,0.12),
//                       border-radius 22px 22px 0 0, shadow 0 -18px 40px rgba(0,0,0,0.55)
//   .bottom-nav-tab:    gap 6px, min-height 60px, padding 10px 6px 8px,
//                       border-radius 18px, color rgba(255,255,255,0.52)
//   .bottom-nav-tab.active: color #FF7A3C, bg rgba(255,122,60,0.06)
//   .bottom-nav-icon svg:   26×26px
//   .bottom-nav-label:      0.76rem (≈12px), weight 600, uppercase, letter-spacing 0.03em

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[
      styles.container,
      { paddingBottom: Math.max(10, insets.bottom) },
    ]}>
      {TABS.map(tab => {
        const routeIndex = state.routes.findIndex(r => r.name === tab.name);
        const focused    = state.index === routeIndex;
        const color      = focused ? ACTIVE_COLOR : INACTIVE_COLOR;

        return (
          <TouchableOpacity
            key={tab.name}
            style={[styles.tab, focused && styles.tabActive]}
            onPress={() => {
              const event = navigation.emit({
                type:              'tabPress',
                target:            state.routes[routeIndex]?.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(tab.name);
              }
            }}
            activeOpacity={0.85}
          >
            {/* Icon + status dot — web: .bottom-nav-icon (26×26 svg + overlay circle) */}
            <View style={styles.iconWrap}>
              <Ionicons
                name={focused ? tab.icon : tab.outline}
                size={26}
                color={color}
              />
              <Dot color={tab.dot} />
            </View>

            {/* Label — web: .bottom-nav-label */}
            <Text style={[styles.label, { color }]}>{tab.label}</Text>
          </TouchableOpacity>
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
    backgroundColor:      '#141210',  // fully opaque — rgba(20,18,16,0.96) → opaque; prevents white bleeding through rounded corners
    borderTopWidth:       1,
    borderTopColor:       'rgba(255, 255, 255, 0.12)',
    borderTopLeftRadius:  22,
    borderTopRightRadius: 22,
    paddingTop:           8,
    paddingHorizontal:    10,
    // shadow — web: box-shadow: 0 -18px 40px rgba(0,0,0,0.55)
    shadowColor:    '#000',
    shadowOffset:   { width: 0, height: -8 },
    shadowOpacity:  0.55,
    shadowRadius:   20,
    elevation:      24,
  },

  // .bottom-nav-tab
  tab: {
    flex:           1,
    flexDirection:  'column',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            6,    // web: gap: 6px
    minHeight:      60,   // web: min-height: 60px
    paddingTop:     10,   // web: padding: 10px 6px 8px
    paddingBottom:  8,
    paddingHorizontal: 6,
    borderRadius:   18,   // web: border-radius: 18px
  },

  // .bottom-nav-tab.active
  tabActive: {
    backgroundColor: 'rgba(255, 122, 60, 0.06)',
  },

  // .bottom-nav-icon (26×26 container)
  iconWrap: {
    width:          26,
    height:         26,
    alignItems:     'center',
    justifyContent: 'center',
  },

  // .bottom-nav-label: 0.76rem ≈ 12px, weight 600, uppercase, letter-spacing 0.03em
  label: {
    fontSize:      12,
    fontWeight:    '600',
    textTransform: 'uppercase',
    letterSpacing: 0.36,   // 0.03em × 12px
  },
});

// ── Layout ────────────────────────────────────────────────────────────────────

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={props => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      {/* ── 4 primary tabs ─────────────────────────────────────────────── */}
      <Tabs.Screen name="hot"    options={{ title: 'Hot' }} />
      <Tabs.Screen name="cities" options={{ title: 'Cities' }} />
      <Tabs.Screen name="here"   options={{ title: 'Here' }} />
      <Tabs.Screen name="me"     options={{ title: 'Me' }} />

      {/* ── Secondary screens — hidden from nav ────────────────────────── */}
      <Tabs.Screen name="chat"     options={{ href: null }} />
      <Tabs.Screen name="messages" options={{ href: null }} />
    </Tabs>
  );
}
