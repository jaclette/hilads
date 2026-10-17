/**
 * ShareSheet - the "+" menu of chat composers (bottom sheet).
 *
 * Actions:
 *   Photo           → onSnap() - parent triggers the image/camera picker
 *   Share my spot   → onSpot() - parent handles geolocation + send
 *   Create a plan   → onPlan() - city Chat only (V3-09: plan creation lives here)
 *   Hi now          → onHiNow() - city Chat only
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, Sheet } from '@/ui';

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

  const Action = ({ icon, label, desc, onPress, loading = false }: {
    icon: React.ComponentProps<typeof Ionicons>['name']; label: string; desc: string; onPress: () => void; loading?: boolean;
  }) => (
    <TouchableOpacity style={styles.action} onPress={onPress} activeOpacity={0.75} disabled={spotLoading} accessibilityRole="button">
      <View style={styles.actionIcon}>
        {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name={icon} size={22} color={colors.primaryOnTint} />}
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
        <Action icon="camera-outline" label={t('share.snap')} desc={t('share.snapDesc')} onPress={onSnap} />
        <Action icon="location-outline" label={t('share.spot')} desc={spotLoading ? t('share.spotLoading') : t('share.spotDesc')}
                onPress={onSpot} loading={spotLoading} />
        {onPlan && <Action icon="calendar-outline" label={t('share.plan')} desc={t('share.planDesc')} onPress={onPlan} />}
        {onHiNow && <Action icon="hand-left-outline" label={t('share.hiNow')} desc={t('share.hiNowDesc')} onPress={onHiNow} />}
      </View>
      <Button variant="link" label={t('cancel')} onPress={onClose} style={styles.cancel} />
    </Sheet>
  );
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
