/**
 * MessageActionSheet - bottom sheet that appears on message long-press.
 *
 * Shows an emoji strip (❤️ 👍 😂 😮 🔥) + a "Reply" action.
 * Highlighted emojis = already reacted by viewer.
 */

import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback,
  StyleSheet, Share,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Reaction } from '@/types';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

const EMOJIS = ['❤️', '👍', '😂', '😮', '🔥'] as const;

// "Translate" routes the message through the OS share sheet (Android ACTION_SEND
// / iOS activity view). Picking Google Translate pre-fills the text with zero
// manual paste - unlike a translate.google.com URL, whose ?text= the Android app
// silently drops (it opened blank).
function openTranslate(text: string): void {
  Share.share({ message: text }).catch(() => {});
}

interface Props {
  visible:   boolean;
  /** Reactions strip is shown only when onReact is provided (messages, not titles). */
  reactions?: Reaction[];
  onReact?:  (emoji: string) => void;
  onReply?:  () => void;
  onCopy?:   () => void;
  /** Message text to translate; when set, a "Translate" action opens Google Translate. */
  translateText?: string;
  onEdit?:   () => void;
  onDelete?: () => void;
  onClose:   () => void;
}

export function MessageActionSheet({ visible, reactions = [], onReact, onReply, onCopy, translateText, onEdit, onDelete, onClose }: Props) {
  const { t, i18n } = useTranslation('chat');
  const styles = useThemedStyles(makeStyles);
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
        {/* Emoji strip - only for messages (onReact); titles show just Copy/Translate. */}
        {onReact && (
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
        )}

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

        {/* Translate action - text messages only. Opens Google Translate with the
            message text, target = the app's current language. */}
        {translateText && (
          <TouchableOpacity
            style={styles.action}
            onPress={() => { openTranslate(translateText); onClose(); }}
            activeOpacity={0.75}
          >
            <Text style={styles.actionIcon}>🌐</Text>
            <Text style={styles.actionLabel}>{t('actionTranslate')}</Text>
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

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: c.scrim,
  },
  sheet: {
    backgroundColor:   c.elevated,
    borderTopWidth:    1,
    borderTopColor:    c.separator,
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
    backgroundColor: c.overlay,
    alignItems:      'center',
    justifyContent:  'center',
  },
  emojiBtnActive: {
    backgroundColor: 'rgba(255,122,60,0.25)',
    borderWidth:     1.5,
    borderColor:     c.accent,
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
    borderTopColor: c.separator,
  },
  actionIcon: {
    fontSize: 20,
  },
  actionLabel: {
    fontSize:   16,
    color:      c.text,
    fontWeight: '500',
  },
  actionLabelDanger: {
    color: c.red,
  },
  cancel: {
    alignItems:      'center',
    paddingVertical: 14,
    borderTopWidth:  1,
    borderTopColor:  c.separator,
    marginTop:       2,
  },
  cancelText: {
    fontSize:   16,
    color:      c.muted,
    fontWeight: '500',
  },
});
