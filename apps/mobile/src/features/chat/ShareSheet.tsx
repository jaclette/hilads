/**
 * ShareSheet - the "+" menu of chat composers (bottom sheet).
 *
 * Actions:
 *   Photo           → onSnap() - parent triggers the image/camera picker
 *   Share my spot   → onSpot() - parent handles geolocation + send
 *   Create a plan   → onPlan() - city Chat only (V3-09: plan creation lives here)
 *   Hi now          → onHiNow() - city Chat only
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, Sheet } from '@/ui';
import { tint, themeColor } from '@/ui/joy';
import { getLastToday } from '@/hooks/useDaily';
import { useReducedMotion } from '@/hooks/useReducedMotion';

// Each action its own soft color (V3 polish 5): the photo in today's theme color,
// the spot in the map's tangerine, the plan in calendar caramel, Hi now in the wave's yellow.
const SPOT_COLOR = '#FF7A3D';
const PLAN_COLOR = '#C98A4B';
const HI_NOW_COLOR = '#FFC93C';

interface Props {
  visible:     boolean;
  onSnap:      () => void;
  onSpot:      () => void;
  onPlan?:     () => void;
  onHiNow?:    () => void;
  onClose:     () => void;
  spotLoading: boolean;
}

export function ShareSheet({ visible, onSnap, onSpot, onPlan, onHiNow, onClose, spotLoading }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');

  const today = getLastToday()?.challenge;
  const photoColor = themeColor(today?.special ? 'special' : today?.theme?.key).fill;
  const Action = ({ icon, label, desc, onPress, color, wave = false, loading = false }: {
    icon: React.ComponentProps<typeof Ionicons>['name']; label: string; desc: string; onPress: () => void; color: string; wave?: boolean; loading?: boolean;
  }) => (
    <TouchableOpacity style={styles.action} onPress={onPress} activeOpacity={0.75} disabled={spotLoading} accessibilityRole="button">
      <View style={[styles.actionIcon, { backgroundColor: tint(color, 0.28) }]}>
        {loading ? <ActivityIndicator size="small" color={colors.primary} />
          : wave ? <Wave visible={visible}><Ionicons name={icon} size={22} color={colors.text} /></Wave>
          : <Ionicons name={icon} size={22} color={colors.text} />}
      </View>
      <View style={styles.actionBody}>
        <Text style={styles.actionLabel}>{label}</Text>
        <Text style={styles.actionDesc}>{desc}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t('cancel')}>
      <Text style={styles.title}>{t('share.title')}</Text>
      <View style={styles.actions}>
        <Action icon="camera-outline" color={photoColor} label={t('share.snap')} desc={t('share.snapDesc')} onPress={onSnap} />
        <Action icon="location-outline" color={SPOT_COLOR} label={t('share.spot')} desc={spotLoading ? t('share.spotLoading') : t('share.spotDesc')}
                onPress={onSpot} loading={spotLoading} />
        {onPlan && <Action icon="calendar-outline" color={PLAN_COLOR} label={t('share.plan')} desc={t('share.planDesc')} onPress={onPlan} />}
        {onHiNow && <Action icon="hand-left-outline" color={HI_NOW_COLOR} wave label={t('share.hiNow')} desc={t('share.hiNowDesc')} onPress={onHiNow} />}
      </View>
      <Button variant="link" label={t('cancel')} onPress={onClose} style={styles.cancel} />
    </Sheet>
  );
}

/** Hi now's hand waves twice when the sheet opens (still with Reduce motion). */
function Wave({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible || reduced) return;
    turn.setValue(0);
    const swing = (to: number) => Animated.timing(turn, { toValue: to, duration: 140, useNativeDriver: true });
    Animated.sequence([swing(1), swing(-1), swing(1), swing(-1), swing(0)]).start();
  }, [visible, reduced, turn]);
  const rotate = turn.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] });
  return <Animated.View style={{ transform: [{ rotate }] }}>{children}</Animated.View>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  title:       { fontSize: FontSizes.sm, fontWeight: '700', color: c.muted, textAlign: 'center', marginBottom: 4 },
  actions:     { gap: 8 },
  action:      { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10,
                 borderRadius: Radius.button, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  actionIcon:  { width: 40, height: 40, borderRadius: 12, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  actionBody:  { flex: 1, gap: 2 },
  actionLabel: { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  actionDesc:  { fontSize: FontSizes.xs, color: c.muted },
  cancel:      { alignSelf: 'center', marginTop: 4 },
});
