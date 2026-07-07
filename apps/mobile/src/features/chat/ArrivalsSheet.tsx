/**
 * ArrivalsSheet - bottom-sheet list of recent arrivals.
 *
 * Mirrors MembersSheet shape (Modal animationType="slide", 70% max-height,
 * draggable handle). Rows reuse the chat.feedJoin.* strings already used in
 * the main feed today, so wording stays identical - only the surface moves.
 *
 * Tapping a row opens the user's profile via the same access guard the inline
 * join pill uses.
 */

import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { thumbUrl } from '@/lib/imageThumb';
import { avatarColor } from '@/lib/avatarColors';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { Message } from '@/types';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { formatSmartTime } from '@/lib/messageTime';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>{t('arrivalsBar.sheetTitle')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {arrivals.length === 0 ? (
            <Text style={styles.empty}>{t('arrivalsBar.empty')}</Text>
          ) : (
            // Newest at the top → oldest at the bottom. Mirrors the
            // chat feed's reading order so a user scanning recent
            // activity sees the most relevant rows first.
            [...arrivals]
              .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
              .map(m => {
              const tappable = !!m.userId || !!m.guestId;
              return (
                <TouchableOpacity
                  key={m.id ?? `${m.guestId ?? ''}:${m.createdAt}`}
                  style={styles.row}
                  onPress={tappable ? () => openProfile(m) : undefined}
                  activeOpacity={tappable ? 0.7 : 1}
                  disabled={!tappable}
                >
                  {m.thumbAvatarUrl ? (
                    <Image source={{ uri: thumbUrl(m.thumbAvatarUrl) }} style={styles.rowAvatar} contentFit="cover" cachePolicy="memory-disk" />
                  ) : (
                    <View style={[styles.rowAvatar, styles.rowAvatarLetterWrap, { backgroundColor: avatarColor(m.nickname ?? '') }]}>
                      <Text style={styles.rowAvatarLetter}>{(m.nickname ?? '?')[0].toUpperCase()}</Text>
                    </View>
                  )}
                  <Text style={styles.rowText} numberOfLines={1}>{joinText(m)}</Text>
                  <Text style={styles.rowTime}>{formatSmartTime(m.createdAt)}</Text>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '70%',
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.xl,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 8, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  title: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text },
  close: { fontSize: 18, color: Colors.muted, fontWeight: '700' },
  list: { paddingHorizontal: Spacing.md },
  listContent: { paddingBottom: Spacing.md },
  empty: { color: Colors.muted, textAlign: 'center', marginVertical: Spacing.lg, fontSize: FontSizes.sm },
  row: {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
    paddingVertical:  10,
    paddingHorizontal: Spacing.sm,
    gap:              10,
  },
  rowAvatar: { width: 30, height: 30, borderRadius: 15 },
  rowAvatarLetterWrap: { alignItems: 'center', justifyContent: 'center' },
  rowAvatarLetter: { color: '#fff', fontWeight: '700', fontSize: 13 },
  rowText: { flex: 1, color: Colors.text, fontSize: FontSizes.sm, fontWeight: '600' },
  rowTime: { color: Colors.muted2, fontSize: FontSizes.xs },
});
