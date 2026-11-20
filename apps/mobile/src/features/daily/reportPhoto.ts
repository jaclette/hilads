import { Alert } from 'react-native';
import i18n from '@/i18n';
import { ApiError } from '@/api/client';
import { reportDailyProof, type DailyReportReason } from '@/api/daily';
import { reportChatPhoto } from '@/api/reports';
import { track } from '@/services/analytics';

const REASONS: DailyReportReason[] = ['inappropriate', 'person_without_consent', 'dangerous', 'spam', 'other'];

/**
 * Report a photo: the reasons as a native sheet, then a thank-you. A Daily photo (the photo feed)
 * or a chat photo (the message long-press). Three reports from different people hide it until
 * the team decides; Back office › Photos shows it at the top.
 */
export function askReportPhoto(kind: 'daily' | 'chat', id: string, guestId: string | null | undefined): void {
  const t = (key: string) => i18n.t(key, { ns: 'daily' });
  Alert.alert(t('report.title'), t('report.body'), [
    ...REASONS.map(reason => ({
      text: t(`report.reasons.${reason}`),
      onPress: () => {
        const send = kind === 'daily' ? reportDailyProof(id, reason, guestId) : reportChatPhoto(id, reason, guestId);
        send
          .then(() => { track('photo_reported', { kind, reason }); Alert.alert(t('report.thanks')); })
          .catch(err => {
            const already = err instanceof ApiError && (err.status === 409 || err.body?.code === 'already_reported');
            Alert.alert(already ? t('report.already') : t('errors.generic'));
          });
      },
    })),
    { text: t('cancel'), style: 'cancel' as const },
  ]);
}
