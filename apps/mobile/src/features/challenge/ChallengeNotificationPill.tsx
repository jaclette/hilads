import { useCallback, useEffect, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchMyChallengeParticipation,
  setChallengeNotificationPreference,
} from '@/api/challenges';
import { Colors, FontSizes, Radius } from '@/constants';

/**
 * Compact on/off notifications pill for the challenge channel - mirrors
 * the web .challenge-notif-toggle. Maps the binary toggle to the
 * three-state backend preference (on → 'milestones', off → 'off');
 * 'all' (every message) is reachable from future advanced settings.
 */
export function ChallengeNotificationPill({
  challengeId,
  currentUserId,
}: {
  challengeId:   string;
  currentUserId: string | null;
}) {
  const { t } = useTranslation('challenge');
  const [pref, setPref] = useState<'milestones' | 'all' | 'off' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!challengeId || !currentUserId) return;
    const res = await fetchMyChallengeParticipation(challengeId);
    setPref((res?.notificationPreference as 'milestones' | 'all' | 'off') ?? 'milestones');
  }, [challengeId, currentUserId]);

  useEffect(() => { load(); }, [load]);

  if (!currentUserId || pref === null) return null;

  const isOn = pref !== 'off';

  async function handleToggle() {
    if (busy) return;
    const next = isOn ? 'off' : 'milestones';
    const previous = pref;
    setBusy(true);
    setPref(next); // optimistic
    try {
      await setChallengeNotificationPreference(challengeId, next);
    } catch {
      setPref(previous);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TouchableOpacity
      style={[styles.pill, isOn && styles.pillOn]}
      onPress={handleToggle}
      disabled={busy}
      activeOpacity={0.75}
      accessibilityRole="switch"
      accessibilityState={{ checked: isOn }}
    >
      {busy
        ? <ActivityIndicator size="small" color={isOn ? '#FFB37A' : Colors.muted} />
        : <Ionicons
            name={isOn ? 'notifications-outline' : 'notifications-off-outline'}
            size={14}
            color={isOn ? '#FFB37A' : Colors.muted}
          />}
      <Text style={[styles.label, isOn && styles.labelOn]} numberOfLines={1}>
        {t(isOn ? 'notif.on' : 'notif.off')}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             5,
    paddingHorizontal: 10,
    paddingVertical:   6,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.10)',
    backgroundColor:   'transparent',
  },
  pillOn: {
    backgroundColor: 'rgba(255,122,60,0.10)',
    borderColor:     'rgba(255,122,60,0.42)',
  },
  label:   { fontSize: 11, fontWeight: '700', color: Colors.muted, letterSpacing: 0.2 },
  labelOn: { color: '#FFB37A' },
});
