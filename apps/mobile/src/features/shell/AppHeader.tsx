/**
 * Shared app header - persistent across the 4 bottom tabs (MY CITY / NOW /
 * HERE / ME).
 *
 * Contains:
 *   - Left:   notification bell with unread badge (registered users only)
 *   - Center: Hilads logo + "Become local. Anywhere." tagline to its right
 *   - Right:  optional tab-specific extra(s) (e.g. Share on MY CITY),
 *             then the DM icon with unread badge (registered users only)
 *
 * Pulls unread counts + setters from AppContext to avoid prop drilling.
 * Tab-specific elements (city selector, chips, filter pills, titles) render
 * BELOW this component inside each tab's own header container.
 *
 * The "Become local. Anywhere." tagline mirrors the web persistent header
 * (`.header-tagline`): ~11px, white at 50% opacity, wrapping onto two lines at
 * maxWidth 76. Brand-locked English in every locale (same rule as the other
 * 6 locked brand terms - see [[i18n-initiative]] in memory).
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { BrandLockup } from '@/components/BrandLockup';
import { Colors } from '@/constants';

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
    <View style={styles.topBar}>

      {/* Left: notification bell (members) - or a subtle "?" for guests that
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

      {/* Center: "Hilads" lockup + tagline to its right (mirrors web header).
          The lockup turns the bare "Hi" mark into the readable brand NAME;
          the tagline stays untouched beside it. */}
      <View style={styles.topCenter}>
        <BrandLockup iconSize={36} glow />
        <Text style={styles.tagline}>{'Become local.\nAnywhere.'}</Text>
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
  // Header surface strip. No overflow:hidden here - clipping the wrapper
  // would clip the bell's notification badge (positioned top:-5/right:-5 to
  // overflow the icon).
  glowWrap: {
    // Match the page background (not the lighter bg2) so the header reads as
    // one seamless surface with the rest of the screen - no visible band/seam.
    backgroundColor: Colors.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems:    'center',
    // Breathing room below the status bar: without it the icons sit flush
    // against the safe-area edge and the bell's overflowing unread badge
    // (top:-5) clips under the (translucent) status bar.
    paddingTop:    10,
    paddingBottom: 6,
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
