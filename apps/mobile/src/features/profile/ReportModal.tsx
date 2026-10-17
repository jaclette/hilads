/**
 * ReportModal - lightweight report sheet for registered and ghost user profiles.
 *
 * Shown by a discreet "Report" link on user/guest profile screens.
 * Validates reason length (min 10 chars) before submitting.
 */

import React, { useState } from 'react';
import { Text, StyleSheet, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { submitReport, DuplicateReportError } from '@/api/reports';
import { formatDateLabel } from '@/lib/messageTime';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Button, Sheet, TextField } from '@/ui';

interface Props {
  visible:         boolean;
  reporterGuestId?: string | null;
  targetUserId?:   string | null;
  targetGuestId?:  string | null;
  targetNickname?: string | null;
  onClose:         () => void;
}

export function ReportModal({ visible, reporterGuestId, targetUserId, targetGuestId, targetNickname, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('common');
  const [reason,  setReason]  = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = reason.trim().length >= 10 && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await submitReport({
        reason: reason.trim(),
        guestId: reporterGuestId,
        targetUserId,
        targetGuestId,
        targetNickname,
      });
      setReason('');
      onClose();
      Alert.alert(t('report.sentTitle'), t('report.sentBody'));
    } catch (err: any) {
      if (err instanceof DuplicateReportError) {
        const when = formatDateLabel(err.existing.created_at);
        setReason('');
        onClose();
        Alert.alert(t('report.dupTitle'), t('report.dupBody', { date: when }));
      } else {
        Alert.alert(t('report.errorTitle'), err?.message ?? t('report.errorBody'));
      }
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (loading) return;
    setReason('');
    onClose();
  }

  return (
    <Sheet visible={visible} onClose={handleClose} closeLabel={t('cancel')}>
      <Text style={styles.title} accessibilityRole="header">{t('report.title')}</Text>
      <Text style={styles.subtitle}>
        {targetNickname ? t('report.subtitle', { name: `@${targetNickname}` }) : t('report.subtitleAnon')}
      </Text>

      <TextField
        placeholder={t('report.placeholder')}
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={500}
        editable={!loading}
        returnKeyType="default"
      />
      <Text style={styles.charCount}>{reason.trim().length} / 500</Text>

      <Button label={t('report.submit')} onPress={handleSubmit} disabled={!canSubmit} loading={loading} />
      <Button variant="link" label={t('cancel')} onPress={handleClose} disabled={loading} style={styles.cancel} />
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  title:     { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  subtitle:  { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted, lineHeight: 18 },
  charCount: { fontSize: 11, fontWeight: '400', color: c.mutedDim, textAlign: 'right', marginTop: -4 },
  cancel:    { alignSelf: 'center' },
});
