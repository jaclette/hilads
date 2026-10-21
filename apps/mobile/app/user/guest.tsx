/**
 * Guest profile screen - /user/guest
 *
 * Shown when a feed join-bubble is tapped for a guest who has no registered
 * account. Receives nickname + guestId as route params; shows a minimal
 * profile card with generated avatar, "Guest" label, and city context.
 * Does NOT call the /users/{id} API endpoint.
 */

import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Avatar, Button, Chip, Screen, ScreenHeader } from '@/ui';
import { ReportModal } from '@/features/profile/ReportModal';
import { ProfileActionSheet } from '@/features/profile/ProfileActionSheet';
import { fetchReportStatus, type ExistingReport } from '@/api/reports';
import { submitBlock } from '@/api/blocks';
import { formatDateLabel } from '@/lib/messageTime';
import { goBack } from '@/lib/nav';

// ── Screen ────────────────────────────────────────────────────────────────────

export default function GuestProfileScreen() {
  const styles = useThemedStyles(makeStyles);

  const router = useRouter();
  const { t } = useTranslation('publicProfile');
  const { nickname, guestId } = useLocalSearchParams<{ nickname: string; guestId: string }>();
  const { city, identity, account, addBlocked, removeBlocked } = useApp();

  const name = nickname || t('ghostName');

  const [showReportModal, setShowReportModal] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [blockBusy,       setBlockBusy]       = useState(false);
  const [existingReport,  setExistingReport]  = useState<ExistingReport | null>(null);

  function handleBlockPress() {
    if (!guestId || blockBusy) return;
    Alert.alert(
      t('blockTitle', { ns: 'dm', name }),
      t('blockBody', { ns: 'dm', name }),
      [
        { text: t('cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('blockConfirm', { ns: 'dm' }), style: 'destructive',
          onPress: async () => {
            setBlockBusy(true);
            try {
              addBlocked({ guestId });
              await submitBlock({
                targetGuestId:  guestId,
                targetNickname: name,
                guestId:        account ? undefined : identity?.guestId,
              });
              goBack();
            } catch {
              removeBlocked({ guestId });
              Alert.alert(t('blockFailTitle', { ns: 'dm' }), t('blockFailBody', { ns: 'dm' }));
            } finally {
              setBlockBusy(false);
            }
          },
        },
      ],
    );
  }

  useEffect(() => {
    if (!guestId) return;
    fetchReportStatus({
      guestId: account ? undefined : identity?.guestId ?? undefined,
      targetGuestId: guestId,
    })
      .then(r => setExistingReport(r.reported ? (r.existing ?? null) : null))
      .catch(() => {});
  }, [guestId, account, identity?.guestId]);

  return (
    <Screen>
      <ScreenHeader title={t('title')} />

      <View style={styles.hero}>
        <Avatar name={name} size={88} fallback="color" />
        <Text style={styles.displayName}>{name}</Text>
        <Chip label={t('badge.ghost', { ns: 'common' })} />
        {city ? <Text style={styles.cityLabel}>{t('visiting', { city: localizeCityName(city.name) })}</Text> : null}
      </View>

      <Text style={styles.note}>{t('ghostNote')}</Text>

      <Button variant="link" label={t('moreOptions')} onPress={() => setShowActionSheet(true)} style={styles.moreOptions} />

      <ProfileActionSheet
        visible={showActionSheet}
        title={name}
        actions={[
          {
            key:      'report',
            label:    existingReport ? t('alreadyReported') : t('reportUser'),
            icon:     'flag-outline',
            disabled: !!existingReport,
            onPress:  () => {
              if (existingReport) {
                Alert.alert(
                  t('alreadyReported'),
                  t('alreadyReportedBody', { date: formatDateLabel(existingReport.created_at) }),
                );
                return;
              }
              setShowReportModal(true);
            },
          },
          {
            key:         'block',
            label:       blockBusy ? t('blocking') : t('blockUser'),
            icon:        'ban-outline',
            destructive: true,
            disabled:    blockBusy,
            onPress:     handleBlockPress,
          },
        ]}
        onClose={() => setShowActionSheet(false)}
      />

      <ReportModal
        visible={showReportModal}
        reporterGuestId={account ? undefined : identity?.guestId}
        targetGuestId={guestId}
        targetNickname={name}
        onClose={() => setShowReportModal(false)}
      />

    </Screen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  hero:        { alignItems: 'center', paddingTop: Spacing.xl, paddingBottom: Spacing.md, gap: 12 },
  displayName: { fontSize: FontSizes.xl, fontWeight: '800', color: c.text, letterSpacing: -0.5, textAlign: 'center' },
  cityLabel:   { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted },
  note:        { textAlign: 'center', fontSize: FontSizes.sm, fontWeight: '400', color: c.muted, paddingHorizontal: Spacing.xl, marginTop: Spacing.sm },
  moreOptions: { alignSelf: 'center', marginTop: Spacing.lg },
});
