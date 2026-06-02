/**
 * Shared app header — persistent across the 4 bottom tabs (MY CITY / NOW /
 * HERE / ME).
 *
 * Contains:
 *   - Left:   notification bell with unread badge (registered users only)
 *   - Center: Hilads logo + "Challenge the city." tagline to its right
 *   - Right:  optional tab-specific extra(s) (e.g. Share on MY CITY),
 *             then the DM icon with unread badge (registered users only)
 *
 * Pulls unread counts + setters from AppContext to avoid prop drilling.
 * Tab-specific elements (city selector, chips, filter pills, titles) render
 * BELOW this component inside each tab's own header container.
 *
 * The "Challenge the city." tagline mirrors the web persistent header
 * (`.header-tagline`): ~11px, white at 50% opacity, wrapping onto two lines at
 * maxWidth 76. (Previously dropped over an Apple Guideline 4 "microscopic text"
 * note; restored at product request for parity with the web header.)
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { HiladsIcon } from '@/components/HiladsIcon';
import { Colors } from '@/constants';

// Direct port of the web `.chat-header` background:
//   radial-gradient(ellipse 90% 55% at 50% -10%,
//                   rgba(194,74,56,0.10) 0%, transparent 60%), var(--surface)
// react-native-svg can render real radial gradients (expo-linear-gradient
// can't), so we lay one absolute-fill SVG behind the topBar row. The bg
// fallback color on glowWrap (#161210) covers any subpixel gap.
function HeaderRadialGlow() {
  return (
    <Svg
      style={StyleSheet.absoluteFillObject}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      pointerEvents="none"
    >
      <Defs>
        <RadialGradient
          id="appHeaderGlow"
          cx="50%"
          cy="-10%"
          rx="90%"
          ry="55%"
          fx="50%"
          fy="-10%"
        >
          <Stop offset="0%"  stopColor="#C24A38" stopOpacity={0.10} />
          <Stop offset="60%" stopColor="#C24A38" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#appHeaderGlow)" />
    </Svg>
  );
}

interface Props {
  /** Optional nodes injected immediately to the left of the DM icon. */
  rightExtra?: React.ReactNode;
}

export function AppHeader({ rightExtra }: Props) {
  const router = useRouter();
  const { t } = useTranslation('common');
  const {
    account,
    unreadDMs, setUnreadDMs,
    unreadNotifications,
    clearEventChatCounts,
    setShowOnboarding,
  } = useApp();

  return (
    <View style={styles.glowWrap}>
    <HeaderRadialGlow />
    <View style={styles.topBar}>

      {/* Left: notification bell (members) — or a subtle "?" for guests that
          re-opens the intro carousel on demand. */}
      <View style={styles.topLeft}>
        {account ? (
          <TouchableOpacity
            style={[styles.iconBtn, unreadNotifications > 0 && styles.iconBtnUnread]}
            activeOpacity={0.65}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            onPress={() => router.push('/notifications' as never)}
            accessibilityLabel={t('notifications')}
          >
            <Ionicons name="notifications-outline" size={22} color={Colors.text} />
            {unreadNotifications > 0 && (
              <View style={styles.iconBadge}>
                <Text style={styles.iconBadgeText}>
                  {unreadNotifications > 9 ? '9+' : String(unreadNotifications)}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.65}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            onPress={() => setShowOnboarding(true)}
            accessibilityLabel={t('howItWorks')}
          >
            <Ionicons name="help-circle-outline" size={23} color={Colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Center: logo + tagline to its right (mirrors web persistent header) */}
      <View style={styles.topCenter}>
        <View style={styles.iconGlow}>
          <HiladsIcon size={36} />
        </View>
        <Text style={styles.tagline}>{'Challenge\nthe city.'}</Text>
      </View>

      {/* Right: tab-specific extras + DM icon */}
      <View style={styles.topRight}>
        {rightExtra}
        {account && (
          <TouchableOpacity
            style={[styles.iconBtn, unreadDMs > 0 && styles.iconBtnUnread]}
            activeOpacity={0.65}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            onPress={() => {
              setUnreadDMs(0);
              clearEventChatCounts();
              router.push('/messages');
            }}
            accessibilityLabel={t('messages')}
          >
            <Feather name="message-square" size={20} color={Colors.text} />
            {unreadDMs > 0 && (
              <View style={styles.iconBadge}>
                <Text style={styles.iconBadgeText}>
                  {unreadDMs > 9 ? '9+' : String(unreadDMs)}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      </View>

    </View>
    </View>
  );
}

// Styles mirror chat.tsx's header top-bar so MY CITY and the other tabs match
// pixel-for-pixel. Do not change these without updating the MY CITY context
// sections below this component (city row, chips) which sit on the same rhythm.
const styles = StyleSheet.create({
  // Header surface strip. The radial orange ellipse rendered by
  // <HeaderRadialGlow /> sits behind topBar via absoluteFillObject. No
  // overflow:hidden here — the SVG is bounded to its own Rect (100% × 100%)
  // so it can't bleed, and clipping the wrapper would clip the bell's
  // notification badge (positioned top:-5/right:-5 to overflow the icon).
  glowWrap: {
    backgroundColor: Colors.bg2,
  },
  topBar: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  // Equal-flex side rails keep the center block geometrically centered
  // regardless of how many action buttons sit on either side (e.g. MY CITY's
  // extra Share button). Mirrors the web grid-template-columns: 1fr auto 1fr.
  topLeft: {
    flex:             1,
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'flex-start',
  },
  topCenter: {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'center',
    gap:              8,
    paddingHorizontal: 8,
  },
  topRight: {
    flex:             1,
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'flex-end',
    gap:              8,
  },
  iconBtn: {
    // Flat icon container (no bg, no border) so the header reads as simple
    // icons, matching MY CITY's look across all tabs. The 40×40 size remains
    // to ensure a comfortable tap area; hitSlop brings the effective touch
    // target to 48pt (exceeds Apple HIG 44pt and Android Material 48dp).
    // The red notification badge (.iconBadge) stays positioned relative to
    // this box, so badge placement is unchanged.
    width:           40,
    height:          40,
    borderRadius:    12,
    alignItems:      'center',
    justifyContent:  'center',
  },
  // Retained as a no-op so the conditional style array at call sites keeps
  // working without touching the JSX. The red badge is the unread cue now.
  iconBtnUnread: {},
  iconBadge: {
    position:          'absolute',
    top:               -5,
    right:             -5,
    minWidth:          16,
    height:            16,
    borderRadius:      8,
    backgroundColor:   '#ef4444',
    borderWidth:       1.5,
    borderColor:       Colors.bg,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 3,
  },
  iconBadgeText: {
    color:      Colors.white,
    fontSize:   9,
    fontWeight: '700',
    lineHeight: 11,
  },
  iconGlow: {
    shadowColor:   '#C24A38',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius:  14,
    elevation:     10,
  },
  // Mirrors the web `.header-tagline` (index.css): ~11px, white at 50% opacity,
  // stacked on 2 explicit lines ("Challenge" / "the city.") via embedded \n.
  // maxWidth bumped to 90 so the longest line breathes.
  tagline: {
    fontSize:      11,
    lineHeight:    14,
    color:         'rgba(255,255,255,0.5)',
    fontWeight:    '400',
    letterSpacing: 0.2,
    maxWidth:      90,
  },
});
