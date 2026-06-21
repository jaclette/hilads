import { thumbUrl } from '@/lib/imageThumb';
/**
 * ValidatePresenceSheet - the challenger resolves a GROUP challenge.
 *
 *   mode='presence' (MEET): a checkbox list of joined takers, all checked by
 *     default (most people come; the creator unchecks no-shows). Confirm sends
 *     every present id → validatePresence(). Present takers earn the big reward.
 *
 *   mode='winner' (PHOTO-PROOF): a single-select radio list, none checked by
 *     default. Confirm sends the one winner id → pickWinner(). The winner earns
 *     the +40 bonus. The backend rejects a pick with no submission.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, Modal, Pressable, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { avatarColor } from '@/lib/avatarColors';
import type { UserDTO } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

interface Props {
  visible:      boolean;
  participants: UserDTO[];
  submitting?:  boolean;
  /** 'presence' (meet, multi-select) | 'winner' (photo-proof, single-select). */
  mode?:        'presence' | 'winner';
  onClose:      () => void;
  /** rating is the challenger's 1-5 star of the meet (presence mode only). */
  onConfirm:    (selectedIds: string[], rating: number | null) => void;
}

export function ValidatePresenceSheet({ visible, participants, submitting, mode = 'presence', onClose, onConfirm }: Props) {
  const { t } = useTranslation('challenge');
  const isWinner = mode === 'winner';
  // Presence: all checked by default (uncheck no-shows). Winner: none checked.
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // Meet rating (presence mode) - required before validating.
  const [rating, setRating] = useState(0);

  useEffect(() => {
    if (visible) {
      const init: Record<string, boolean> = {};
      if (!isWinner) participants.forEach(p => { init[p.id] = true; });
      setChecked(init);
      setRating(0);
    }
  }, [visible, participants, isWinner]);

  const toggle = (id: string) =>
    setChecked(prev => (isWinner ? { [id]: !prev[id] } : { ...prev, [id]: !prev[id] }));

  const selectedIds = participants.filter(p => checked[p.id]).map(p => p.id);
  // Presence mode requires a rating; winner mode never rates.
  const ratingOk    = isWinner || rating > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>
          {isWinner
            ? t('group.winnerTitle', { defaultValue: 'Pick the winner' })
            : t('group.validateTitle', { defaultValue: 'Who showed up?' })}
        </Text>
        <Text style={styles.sub}>
          {isWinner
            ? t('group.winnerSub', { defaultValue: 'Choose the best photo. The winner earns the big reward.' })
            : t('group.validateSub', { defaultValue: 'Tick everyone who came to the meet. They each earn the reward.' })}
        </Text>

        {participants.length === 0 ? (
          <Text style={styles.empty}>{t('group.noParticipants', { defaultValue: 'Nobody has joined yet.' })}</Text>
        ) : (
          <FlatList
            data={participants}
            keyExtractor={p => p.id}
            style={styles.list}
            renderItem={({ item }) => {
              const on = !!checked[item.id];
              return (
                <TouchableOpacity
                  style={styles.row}
                  activeOpacity={0.7}
                  onPress={() => toggle(item.id)}
                >
                  <View style={[styles.avatar, { backgroundColor: avatarColor(item.id) }]}>
                    {item.thumbAvatarUrl || item.avatarUrl
                      ? <Image source={{ uri: thumbUrl(item.thumbAvatarUrl ?? item.avatarUrl ?? undefined) }} style={StyleSheet.absoluteFill} cachePolicy="memory-disk" contentFit="cover" />
                      : <Text style={styles.avatarLetter}>{(item.displayName[0] ?? '?').toUpperCase()}</Text>}
                  </View>
                  <Text style={styles.name} numberOfLines={1}>{item.displayName}</Text>
                  <View style={[isWinner ? styles.radio : styles.check, on && (isWinner ? styles.radioOn : styles.checkOn)]}>
                    {on ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}

        {/* Meet rating - required before validating (presence mode only). */}
        {!isWinner ? (
          <View style={styles.rateBlock}>
            <Text style={styles.rateLabel}>{t('group.rateMeet', { defaultValue: 'How was the meet?' })}</Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity key={n} onPress={() => setRating(n)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                  <Ionicons
                    name={n <= rating ? 'star' : 'star-outline'}
                    size={32}
                    color={n <= rating ? '#FFC93C' : Colors.border}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.confirmBtn, (submitting || selectedIds.length === 0 || !ratingOk || (isWinner && selectedIds.length !== 1)) && { opacity: 0.5 }]}
          activeOpacity={0.85}
          disabled={submitting || selectedIds.length === 0 || !ratingOk || (isWinner && selectedIds.length !== 1)}
          onPress={() => onConfirm(selectedIds, isWinner ? null : rating)}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.confirmText}>
                {isWinner
                  ? t('group.winnerConfirm', { defaultValue: 'Crown the winner' })
                  : t('group.validateConfirm', { count: selectedIds.length, defaultValue: 'Validate {{count}} present' })}
              </Text>}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: Spacing.lg, paddingTop: 10, paddingBottom: 34, maxHeight: '80%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginBottom: 12 },
  title: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text },
  sub:   { fontSize: FontSizes.sm, color: Colors.muted, marginTop: 4, marginBottom: 12 },
  empty: { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', paddingVertical: 24 },
  list:  { maxHeight: 360 },
  row:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarLetter: { color: '#fff', fontWeight: '700', fontSize: 15 },
  name:  { flex: 1, fontSize: FontSizes.md, fontWeight: '600', color: Colors.text },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#3DDC84', borderColor: '#3DDC84' },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: '#FFC93C', borderColor: '#FFC93C' },
  rateBlock: { marginTop: 14, alignItems: 'center', gap: 8 },
  rateLabel: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.text },
  stars:     { flexDirection: 'row', gap: 8 },
  confirmBtn: {
    // Solid fill - reads as a primary action, not an already-done state.
    marginTop: 14, paddingVertical: 14, borderRadius: 14, alignItems: 'center',
    backgroundColor: '#FF7A3C',
  },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
