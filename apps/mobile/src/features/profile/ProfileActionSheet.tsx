/**
 * ProfileActionSheet - bottom sheet with moderation actions on a user profile
 * (and a future "View profile" entry from the DM header).
 *
 * Apple Guideline 1.2 requires Block + Report to be obvious from any surface
 * where another user appears. This sheet is the canonical container.
 */

import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, Sheet } from '@/ui';

export interface ProfileSheetAction {
  key:          string;
  label:        string;
  icon:         keyof typeof Ionicons.glyphMap;
  /** Visual emphasis for destructive items (Block). */
  destructive?: boolean;
  disabled?:    boolean;
  onPress:      () => void;
}

interface Props {
  visible:  boolean;
  title?:   string;
  actions:  ProfileSheetAction[];
  onClose:  () => void;
}

export function ProfileActionSheet({ visible, title, actions, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t('cancel')}>
      {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}

      {actions.map((a, idx) => (
        <TouchableOpacity
          key={a.key}
          style={[styles.action, (idx > 0 || !!title) && styles.actionDivider, a.disabled && styles.actionDisabled]}
          onPress={() => { if (!a.disabled) { a.onPress(); onClose(); } }}
          disabled={a.disabled}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!a.disabled }}
        >
          <Ionicons name={a.icon} size={22} color={a.destructive ? colors.red : colors.text} />
          <Text style={[styles.actionLabel, a.destructive && styles.actionLabelDestructive]}>{a.label}</Text>
        </TouchableOpacity>
      ))}

      <Button variant="secondary" label={t('cancel')} onPress={onClose} style={styles.cancel} />
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  title:                  { fontSize: FontSizes.sm, fontWeight: '700', color: c.muted, paddingBottom: 4 },
  action:                 { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52 },
  actionDivider:          { borderTopWidth: 1, borderTopColor: c.line },
  actionDisabled:         { opacity: 0.4 },
  actionLabel:            { fontSize: FontSizes.md, fontWeight: '600', color: c.text },
  actionLabelDestructive: { color: c.red },
  cancel:                 { marginTop: 6 },
});
