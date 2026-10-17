/**
 * MessageActionSheet - bottom sheet that appears on message long-press.
 *
 * An emoji strip (❤️ 👍 😂 😮 🔥), then Reply / Copy / Translate / Edit / Delete.
 * Highlighted emojis = already reacted by viewer.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { Reaction } from '@/types';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, Sheet } from '@/ui';

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
  const { t } = useTranslation('chat');
  const styles = useThemedStyles(makeStyles);
  const selfMap = Object.fromEntries(reactions.map(r => [r.emoji, r.self]));
  const run = (fn: () => void) => () => { fn(); onClose(); };

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t('actionCancel')}>
      {/* Emoji strip - only for messages (onReact); titles show just Copy/Translate. */}
      {onReact && (
        <View style={styles.emojiRow}>
          {EMOJIS.map(emoji => (
            <TouchableOpacity
              key={emoji}
              style={[styles.emojiBtn, selfMap[emoji] && styles.emojiBtnActive]}
              onPress={run(() => onReact(emoji))}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={emoji}
              accessibilityState={{ selected: !!selfMap[emoji] }}
            >
              <Text style={styles.emojiText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.actions}>
        {onReply && <Action icon="arrow-undo-outline" label={t('actionReply')} onPress={run(onReply)} />}
        {/* Copy - text messages only; callers pass undefined for images/locations. */}
        {onCopy && <Action icon="copy-outline" label={t('actionCopy')} onPress={run(onCopy)} />}
        {/* Translate - text messages only, through the OS share sheet. */}
        {translateText && <Action icon="language-outline" label={t('actionTranslate')} onPress={run(() => openTranslate(translateText))} />}
        {/* Edit / Delete - only when the viewer owns the message (callers pass undefined otherwise). */}
        {onEdit && <Action icon="create-outline" label={t('actionEdit')} onPress={run(onEdit)} />}
        {onDelete && <Action icon="trash-outline" label={t('actionDelete')} onPress={run(onDelete)} danger />}
      </View>

      <Button variant="link" label={t('actionCancel')} onPress={onClose} style={styles.cancel} />
    </Sheet>
  );
}

function Action({ icon, label, onPress, danger = false }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; danger?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const color = danger ? colors.red : colors.text;
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} activeOpacity={0.75} accessibilityRole="button">
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  emojiRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 6 },
  emojiBtn:       { width: 52, height: 52, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center',
                    borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  emojiBtnActive: { borderColor: c.primary, backgroundColor: c.primaryTint },
  emojiText:      { fontSize: 26 },
  actions:        { borderTopWidth: 1, borderTopColor: c.line },
  action:         { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, borderBottomWidth: 1, borderBottomColor: c.line },
  actionLabel:    { fontSize: FontSizes.md, fontWeight: '600' },
  cancel:         { alignSelf: 'center', marginTop: 4 },
});
