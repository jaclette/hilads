/**
 * ValidatePresenceSheet - the challenger validates who showed up at a GROUP
 * challenge meet. A checkbox list of the joined takers (all checked by default -
 * most people come; the creator unchecks no-shows). Confirming sends the present
 * ids up to the parent, which calls validatePresence(). Present takers earn the
 * big reward; the challenger earns a base + per-head.
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
  onClose:      () => void;
  onConfirm:    (presentIds: string[]) => void;
}

export function ValidatePresenceSheet({ visible, participants, submitting, onClose, onConfirm }: Props) {
  const { t } = useTranslation('challenge');
  // All checked by default - the creator unchecks anyone who didn't show.
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (visible) {
      const init: Record<string, boolean> = {};
      participants.forEach(p => { init[p.id] = true; });
      setChecked(init);
    }
  }, [visible, participants]);

  const presentIds = participants.filter(p => checked[p.id]).map(p => p.id);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{t('group.validateTitle', { defaultValue: 'Who showed up?' })}</Text>
        <Text style={styles.sub}>
          {t('group.validateSub', { defaultValue: 'Tick everyone who came to the meet. They each earn the reward.' })}
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
                  onPress={() => setChecked(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                >
                  <View style={[styles.avatar, { backgroundColor: avatarColor(item.id) }]}>
                    {item.thumbAvatarUrl || item.avatarUrl
                      ? <Image source={{ uri: item.thumbAvatarUrl ?? item.avatarUrl ?? undefined }} style={StyleSheet.absoluteFill} cachePolicy="memory-disk" contentFit="cover" />
                      : <Text style={styles.avatarLetter}>{(item.displayName[0] ?? '?').toUpperCase()}</Text>}
                  </View>
                  <Text style={styles.name} numberOfLines={1}>{item.displayName}</Text>
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}

        <TouchableOpacity
          style={[styles.confirmBtn, (submitting || participants.length === 0) && { opacity: 0.5 }]}
          activeOpacity={0.85}
          disabled={submitting || participants.length === 0}
          onPress={() => onConfirm(presentIds)}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.confirmText}>{t('group.validateConfirm', { count: presentIds.length, defaultValue: 'Validate {{count}} present' })}</Text>}
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
  confirmBtn: {
    marginTop: 14, paddingVertical: 14, borderRadius: 14, alignItems: 'center',
    backgroundColor: 'rgba(255,122,60,0.16)', borderWidth: 1, borderColor: 'rgba(255,122,60,0.45)',
  },
  confirmText: { color: '#FF7A3C', fontSize: 15, fontWeight: '800' },
});
