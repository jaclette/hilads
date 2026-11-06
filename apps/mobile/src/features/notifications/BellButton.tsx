import { useEffect, useRef } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Border, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useNotifCounts } from './counts';

/**
 * The header bell (V6): quiet and neutral when everything is read; with
 * something new it turns orange, shows the count ("3", "9+") and rings (a
 * short wiggle) when the app opens and each time the count goes up.
 */
export function BellButton({ onPress }: { onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const { total } = useNotifCounts();
  const reduced = useReducedMotion();
  const angle = useSharedValue(0);
  const prev = useRef(0);

  useEffect(() => {
    if (total > prev.current && !reduced) {
      const swing = (d: number) => withTiming(d, { duration: 90 });
      angle.value = withDelay(400, withSequence(swing(16), swing(-14), swing(10), swing(-8), swing(4), swing(0)));
    }
    prev.current = total;
  }, [total, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  // Swings from its top, like a bell.
  const ring = useAnimatedStyle(() => ({
    transform: [{ translateY: -8 }, { rotate: `${angle.value}deg` }, { translateY: 8 }],
  }));

  const on = total > 0;
  return (
    <Pressable onPress={onPress} style={[styles.round, on && styles.on]} accessibilityRole="button" testID="header-bell"
               accessibilityLabel={on ? t('notificationsUnread', { count: total }) : t('notifications')}>
      <Animated.View style={ring}>
        <Ionicons name={on ? 'notifications' : 'notifications-outline'} size={21} color={on ? colors.onCta : colors.text} />
      </Animated.View>
      {on && (
        <View style={styles.badge}>
          <Text style={styles.badgeText} numberOfLines={1}>{total > 9 ? '9+' : total}</Text>
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  round:     { width: 44, height: 44, borderRadius: Radius.full, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2,
               alignItems: 'center', justifyContent: 'center' },
  on:        { backgroundColor: c.cta, borderColor: c.cta },
  badge:     { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10,
               backgroundColor: c.text, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: c.bg },
});
