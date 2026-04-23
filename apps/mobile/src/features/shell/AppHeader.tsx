/**
 * Shared app header — persistent across the 4 bottom tabs (MY CITY / NOW /
 * HERE / ME).
 *
 * Contains:
 *   - Left:   notification bell with unread badge (registered users only)
 *   - Center: Hilads logo + "Feel local. Anywhere." tagline
 *   - Right:  optional tab-specific extra(s) (e.g. Share on MY CITY),
 *             then the DM icon with unread badge (registered users only)
 *
 * Pulls unread counts + setters from AppContext to avoid prop drilling.
 * Tab-specific elements (city selector, chips, filter pills, titles) render
 * BELOW this component inside each tab's own header container.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { HiladsIcon } from '@/components/HiladsIcon';
import { Colors } from '@/constants';

interface Props {
  /** Optional nodes injected immediately to the left of the DM icon. */
  rightExtra?: React.ReactNode;
}

export function AppHeader({ rightExtra }: Props) {
  const router = useRouter();
  const {
    account,
    unreadDMs, setUnreadDMs,
    unreadNotifications,
    clearEventChatCounts,
  } = useApp();

  return (
    <View style={styles.topBar}>

      {/* Left: notification bell */}
      <View style={styles.topLeft}>
        {account && (
          <TouchableOpacity
            style={[styles.iconBtn, unreadNotifications > 0 && styles.iconBtnUnread]}
            activeOpacity={0.65}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            onPress={() => router.push('/notifications' as never)}
            accessibilityLabel="Notifications"
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
        )}
      </View>

      {/* Center: logo + tagline */}
      <View style={styles.topCenter}>
        <View style={styles.iconGlow}>
          <HiladsIcon size={36} />
        </View>
        <Text style={styles.headerTagline}>Feel local. Anywhere.</Text>
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
            accessibilityLabel="Messages"
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
  );
}

// Styles mirror chat.tsx's header top-bar so MY CITY and the other tabs match
// pixel-for-pixel. Do not change these without updating the MY CITY context
// sections below this component (city row, chips) which sit on the same rhythm.
const styles = StyleSheet.create({
  topBar: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  topLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    minWidth:      36,
  },
  topCenter: {
    flex:             1,
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'center',
    gap:              8,
    paddingHorizontal: 8,
  },
  topRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  iconBtn: {
    // Bumped from 36 to match web's visual weight — Ionicons outline and
    // Feather strokes render lighter than the web SVGs (stroke 2.1), so
    // container + glyph both need a hair more room. hitSlop on each pressable
    // brings the effective touch to 48pt (exceeds Apple HIG 44pt, Android 48dp).
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  iconBtnUnread: {
    backgroundColor: 'rgba(255,122,60,0.08)',
    borderColor:     'rgba(255,122,60,0.18)',
  },
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
  headerTagline: {
    fontSize:      11,
    lineHeight:    14,
    color:         'rgba(255,255,255,0.5)',
    fontWeight:    '400',
    letterSpacing: 0.2,
    maxWidth:      72,
  },
  iconGlow: {
    shadowColor:   '#C24A38',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius:  14,
    elevation:     10,
  },
});
