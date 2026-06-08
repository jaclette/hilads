/**
 * MessageActionSheet - bottom sheet that appears on message long-press.
 *
 * Shows an emoji strip (❤️ 👍 😂 😮 🔥) + a "Reply" action.
 * Highlighted emojis = already reacted by viewer.
 */

import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Reaction } from '@/types';

const EMOJIS = ['❤️', '👍', '😂', '😮', '🔥'] as const;

interface Props {
  visible:   boolean;
  reactions: Reaction[];
  onReact:   (emoji: string) => void;
  onReply?:  () => void;
  onCopy?:   () => void;
  onEdit?:   () => void;
  onDelete?: () => void;
  onClose:   () => void;
}

export function MessageActionSheet({ visible, reactions, onReact, onReply, onCopy, onEdit, onDelete, onClose }: Props) {
  const { t } = useTranslation('chat');
  const selfMap = Object.fromEntries(reactions.map(r => [r.emoji, r.self]));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <View style={styles.sheet}>
        {/* Emoji strip */}
        <View style={styles.emojiRow}>
          {EMOJIS.map(emoji => (
            <TouchableOpacity
              key={emoji}
              style={[styles.emojiBtn, selfMap[emoji] && styles.emojiBtnActive]}
              onPress={() => { onReact(emoji); onClose(); }}
              activeOpacity={0.7}
            >
              <Text style={styles.emojiText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Reply action */}
        {onReply && (
          <TouchableOpacity
            style={styles.action}
            onPress={() => { onReply(); onClose(); }}
            activeOpacity={0.75}
          >
            <Text style={styles.actionIcon}>↩️</Text>
            <Text style={styles.actionLabel}>{t('actionReply')}</Text>
          </TouchableOpacity>
        )}

        {/* Copy action - text messages only; callers pass undefined for images/locations. */}
        {onCopy && (
          <TouchableOpacity
            style={styles.action}
            onPress={() => { onCopy(); onClose(); }}
            activeOpacity={0.75}
          >
            <Text style={styles.actionIcon}>📋</Text>
            <Text style={styles.actionLabel}>{t('actionCopy')}</Text>
          </TouchableOpacity>
        )}

        {/* Edit / Delete - only present when the viewer owns the message. Callers
            pass undefined for messages they don't own, or for non-editable kinds
            (image/location). */}
        {onEdit && (
          <TouchableOpacity
            style={styles.action}
            onPress={() => { onEdit(); onClose(); }}
            activeOpacity={0.75}
          >
            <Text style={styles.actionIcon}>✏️</Text>
            <Text style={styles.actionLabel}>{t('actionEdit')}</Text>
          </TouchableOpacity>
        )}

        {onDelete && (
          <TouchableOpacity
            style={styles.action}
            onPress={() => { onDelete(); onClose(); }}
            activeOpacity={0.75}
          >
            <Text style={styles.actionIcon}>🗑️</Text>
            <Text style={[styles.actionLabel, styles.actionLabelDanger]}>{t('actionDelete')}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.cancel} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.cancelText}>{t('actionCancel')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor:   '#1a1512',
    borderTopWidth:    1,
    borderTopColor:    'rgba(255,255,255,0.08)',
    borderRadius:      20,
    paddingHorizontal: 16,
    paddingTop:        20,
    paddingBottom:     36,
    gap:               10,
  },
  emojiRow: {
    flexDirection:   'row',
    justifyContent:  'space-around',
    paddingVertical: 8,
  },
  emojiBtn: {
    width:           52,
    height:          52,
    borderRadius:    26,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  emojiBtnActive: {
    backgroundColor: 'rgba(255,122,60,0.25)',
    borderWidth:     1.5,
    borderColor:     '#FF7A3C',
  },
  emojiText: {
    fontSize: 26,
  },
  action: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            12,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  actionIcon: {
    fontSize: 20,
  },
  actionLabel: {
    fontSize:   16,
    color:      'rgba(255,255,255,0.85)',
    fontWeight: '500',
  },
  actionLabelDanger: {
    color: '#FF6B5C',
  },
  cancel: {
    alignItems:      'center',
    paddingVertical: 14,
    borderTopWidth:  1,
    borderTopColor:  'rgba(255,255,255,0.06)',
    marginTop:       2,
  },
  cancelText: {
    fontSize:   16,
    color:      'rgba(255,255,255,0.45)',
    fontWeight: '500',
  },
});
