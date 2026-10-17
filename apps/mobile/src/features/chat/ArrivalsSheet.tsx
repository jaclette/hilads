/**
 * ArrivalsSheet - bottom-sheet list of recent arrivals.
 *
 * The shared Sheet (70% max-height). Rows reuse the chat.feedJoin.* strings already used in
 * the main feed today, so wording stays identical - only the surface moves.
 *
 * Tapping a row opens the user's profile via the same access guard the inline
 * join pill uses.
 */

import { Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { thumbUrl } from '@/lib/imageThumb';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { Message } from '@/types';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { formatSmartTime } from '@/lib/messageTime';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Avatar, EmptyState, SectionTitle, Sheet } from '@/ui';

const FEED_JOIN_VARIANTS = 5;

function joinText(m: Message): string {
  const nick = m.nickname ?? i18n.t('someone', { ns: 'common' });
  const seed = `${nick}${m.createdAt ?? ''}`
    .split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return i18n.t(`feedJoin.${seed % FEED_JOIN_VARIANTS}`, { ns: 'chat', name: nick });
}

type Props = {
  visible:  boolean;
  arrivals: Message[];   // newest-first
  onClose:  () => void;
};

export function ArrivalsSheet({ visible, arrivals, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);

  const router    = useRouter();
  const { t }     = useTranslation('chat');
  const { account } = useApp();

  function openProfile(m: Message) {
    if (m.userId) {
      if (!canAccessProfile(account)) {
        onClose();
        router.push('/auth-gate');
        return;
      }
      onClose();
      router.push({ pathname: '/user/[id]', params: { id: m.userId } });
      return;
    }
    if (m.guestId) {
      onClose();
      router.push({ pathname: '/user/guest', params: { guestId: m.guestId, nickname: m.nickname ?? '' } });
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t('close', { ns: 'common' })} style={styles.sheet}>
      <SectionTitle title={t('arrivalsBar.sheetTitle')} />
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {arrivals.length === 0 ? (
          <EmptyState body={t('arrivalsBar.empty')} />
        ) : (
          // Newest at the top → oldest at the bottom, like the chat feed.
          [...arrivals]
            .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
            .map((m, i) => {
              const tappable = !!m.userId || !!m.guestId;
              return (
                <TouchableOpacity
                  key={m.id ?? `${m.guestId ?? ''}:${m.createdAt}`}
                  style={[styles.row, i > 0 && styles.divider]}
                  onPress={tappable ? () => openProfile(m) : undefined}
                  activeOpacity={tappable ? 0.7 : 1}
                  disabled={!tappable}
                  accessibilityRole={tappable ? 'button' : undefined}
                >
                  <Avatar uri={m.thumbAvatarUrl ? thumbUrl(m.thumbAvatarUrl) : null} name={m.nickname ?? '?'} size={36} fallback="color" />
                  <Text style={styles.rowText} numberOfLines={1}>{joinText(m)}</Text>
                  <Text style={styles.rowTime}>{formatSmartTime(m.createdAt)}</Text>
                </TouchableOpacity>
              );
            })
        )}
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheet:   { maxHeight: '70%' },
  list:    { flexGrow: 0 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 },
  divider: { borderTopWidth: 1, borderTopColor: c.line },
  rowText: { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  rowTime: { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted },
});
