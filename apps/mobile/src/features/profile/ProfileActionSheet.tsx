/**
 * ProfileActionSheet - bottom sheet with moderation actions on a user profile
 * (and a future "View profile" entry from the DM header).
 *
 * Apple Guideline 1.2 requires Block + Report to be obvious from any surface
 * where another user appears. This sheet is the canonical container.
 */

import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSizes, Radius, Spacing } from '@/constants';

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
        {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}

        {actions.map((a, idx) => (
          <TouchableOpacity
            key={a.key}
            style={[
              styles.action,
              idx === 0 && !title ? null : styles.actionDivider,
              a.disabled ? styles.actionDisabled : null,
            ]}
            onPress={() => { if (!a.disabled) { a.onPress(); onClose(); } }}
            disabled={a.disabled}
            activeOpacity={0.75}
          >
            <Ionicons
              name={a.icon}
              size={20}
              color={a.destructive ? Colors.red : Colors.text}
            />
            <Text style={[
              styles.actionLabel,
              a.destructive ? styles.actionLabelDestructive : null,
              a.disabled ? styles.actionLabelDisabled : null,
            ]}>
              {a.label}
            </Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity style={styles.cancel} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.cancelText}>Cancel</Text>
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
    backgroundColor:   Colors.bg2,
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
    borderTopLeftRadius:  Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.xl,
    gap:               4,
  },
  title: {
    fontSize:      FontSizes.sm,
    color:         Colors.muted,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    fontWeight:    '600',
  },
  action: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            14,
    paddingVertical: 14,
    paddingHorizontal: Spacing.xs,
  },
  actionDivider: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  actionLabel: {
    fontSize:   FontSizes.md,
    color:      Colors.text,
    fontWeight: '500',
  },
  actionLabelDestructive: {
    color: Colors.red,
  },
  actionLabelDisabled: {
    color: Colors.muted2,
  },
  cancel: {
    alignItems:      'center',
    paddingVertical: 14,
    marginTop:       Spacing.sm,
    backgroundColor: Colors.bg3,
    borderRadius:    Radius.md,
  },
  cancelText: {
    fontSize:   FontSizes.md,
    color:      Colors.text,
    fontWeight: '600',
  },
});
