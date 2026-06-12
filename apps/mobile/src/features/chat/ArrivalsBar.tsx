/**
 * ArrivalsBar - fixed-height strip below the city pill row.
 *
 * Two visual states inside the same fixed-height container:
 *   - default: a neutral "Recent arrivals" label + chevron, tap → opens sheet
 *   - live:    "{name} just landed" (existing feedJoin variant), tap → opens profile
 *
 * The container height never changes - only the inner content crossfades.
 * This is intentional: prior animation work on the chat feed (height-collapse /
 * LayoutAnimation) caused gaps + crashes, so we keep layout stable and only
 * touch opacity.
 *
 * Queue: an arrival is shown for 3s. New arrivals queue (cap 3). If a 4th
 * arrives the OLDEST queued item is dropped - never the one on screen.
 */

import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { Message } from '@/types';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

const FEED_JOIN_VARIANTS = 5;
const LIVE_DURATION_MS   = 3000;
const QUEUE_MAX          = 3;
const FADE_MS            = 220;

function joinText(m: Message): string {
  const nick = m.nickname ?? i18n.t('someone', { ns: 'common' });
  const seed = `${nick}${m.createdAt ?? ''}`
    .split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return i18n.t(`feedJoin.${seed % FEED_JOIN_VARIANTS}`, { ns: 'chat', name: nick });
}

type Props = {
  arrivals:       Message[];   // all join messages, newest-first (same source as the feed)
  onOpenSheet:    () => void;
  style?:         StyleProp<ViewStyle>;   // lets the parent flex it inline next to a sibling pill
};

export function ArrivalsBar({ arrivals, onOpenSheet, style }: Props) {
  const router    = useRouter();
  const { t }     = useTranslation('chat');
  const { account } = useApp();

  // Track which arrival ids we've already processed so a re-render of the
  // same list doesn't replay them.
  const seenRef = useRef<Set<string>>(new Set());

  // Mount time in seconds (matches msg.createdAt). Only arrivals stamped
  // AFTER we mounted count as "live" - historical join messages from the
  // initial fetch (or from a WS catchup batch on reconnect) are seeded
  // silently so the bar stays in its default "Recent arrivals" state
  // until somebody actually arrives in real time. Same threshold used
  // by /(tabs)/chat to gate live-feed effects.
  const mountedAtRef = useRef(Date.now() / 1000);

  // Queue of arrivals waiting to display (oldest-first inside the queue).
  // `current` is the one being displayed (null = default state).
  const [current, setCurrent] = useState<Message | null>(null);
  const queueRef              = useRef<Message[]>([]);
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect new arrivals on every render of the arrivals list. The dedup
  // set + createdAt threshold together guarantee historical messages
  // never trigger the live banner.
  useEffect(() => {
    // arrivals are newest-first - walk from oldest-new to newest-new to preserve order
    const fresh: Message[] = [];
    for (let i = arrivals.length - 1; i >= 0; i--) {
      const m = arrivals[i];
      const key = arrivalKey(m);
      if (seenRef.current.has(key)) continue;
      seenRef.current.add(key);
      const ts = typeof m.createdAt === 'number' ? m.createdAt : 0;
      if (ts >= mountedAtRef.current) fresh.push(m);
    }
    if (fresh.length === 0) return;

    if (current === null) {
      // Show the first fresh immediately, queue the rest.
      const [head, ...rest] = fresh;
      queueRef.current = capQueue([...queueRef.current, ...rest]);
      setCurrent(head);
    } else {
      // Already showing one - append to queue, capped.
      queueRef.current = capQueue([...queueRef.current, ...fresh]);
    }
  }, [arrivals]); // current intentionally omitted - guarded above

  // Tick: when current is set, schedule the swap.
  useEffect(() => {
    if (current === null) return;
    timerRef.current = setTimeout(() => {
      const [next, ...rest] = queueRef.current;
      queueRef.current = rest;
      setCurrent(next ?? null);
    }, LIVE_DURATION_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [current]);

  // Crossfade between default and live content. We render both layers; opacity
  // animates 0↔1 over FADE_MS. No layout change, no native view churn.
  const liveOpacity    = useRef(new Animated.Value(0)).current;
  const defaultOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const toLive = current !== null;
    Animated.parallel([
      Animated.timing(liveOpacity,    { toValue: toLive ? 1 : 0, duration: FADE_MS, useNativeDriver: true }),
      Animated.timing(defaultOpacity, { toValue: toLive ? 0 : 1, duration: FADE_MS, useNativeDriver: true }),
    ]).start();
  }, [current]);

  function openProfile(m: Message) {
    if (m.userId) {
      if (!canAccessProfile(account)) {
        router.push('/auth-gate');
        return;
      }
      router.push({ pathname: '/user/[id]', params: { id: m.userId } });
      return;
    }
    if (m.guestId) {
      router.push({ pathname: '/user/guest', params: { guestId: m.guestId, nickname: m.nickname ?? '' } });
    }
  }

  // Tap handler: in live state → profile; in default state → open sheet.
  const handlePress = () => {
    if (current) openProfile(current);
    else onOpenSheet();
  };

  return (
    <TouchableOpacity
      style={[styles.bar, style]}
      activeOpacity={0.75}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={current ? joinText(current) : t('arrivalsBar.label')}
      accessibilityLiveRegion="polite"
    >
      <Animated.View style={[styles.layer, { opacity: defaultOpacity }]} pointerEvents="none">
        <Text style={styles.defaultText} numberOfLines={1}>{t('arrivalsBar.label')}</Text>
        <Ionicons name="chevron-forward" size={14} color={Colors.muted2} />
      </Animated.View>
      <Animated.View style={[styles.layer, { opacity: liveOpacity }]} pointerEvents="none">
        <Text style={styles.liveText} numberOfLines={1}>
          {current ? joinText(current) : ''}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

function arrivalKey(m: Message): string {
  return m.id ?? `${m.guestId ?? ''}:${m.createdAt}`;
}

function capQueue(q: Message[]): Message[] {
  return q.length > QUEUE_MAX ? q.slice(q.length - QUEUE_MAX) : q;
}

const BAR_HEIGHT = 32;

const styles = StyleSheet.create({
  bar: {
    height:            BAR_HEIGHT,
    marginHorizontal:  Spacing.md,
    marginTop:         Spacing.xs,
    marginBottom:      Spacing.xs,
    borderRadius:      Radius.md,
    backgroundColor:   Colors.bg2,
    borderWidth:       1,
    borderColor:       Colors.border,
    overflow:          'hidden',
    justifyContent:    'center',
  },
  // Both layers absolute-fill so the bar height is fixed by the container.
  layer: {
    position:        'absolute',
    left:            Spacing.md,
    right:           Spacing.md,
    top:             0,
    bottom:          0,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    gap:             8,
  },
  defaultText: {
    flex:        1,
    color:       Colors.muted,
    fontSize:    FontSizes.xs,
    fontWeight:  '600',
  },
  liveText: {
    flex:        1,
    color:       Colors.text,
    fontSize:    FontSizes.xs,
    fontWeight:  '600',
    textAlign:   'center',
  },
});
