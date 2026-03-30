/**
 * ChatInput — faithful port of the web .input-bar.
 *
 * Web source: App.jsx form.input-bar, index.css (.upload-btn, .send-btn, .input-bar input)
 *
 * Upload button: 54×54px circle, rgba(255,255,255,0.05) bg, 1px border rgba(255,255,255,0.09)
 * Input:         pill 28px radius, min-height 56px, padding 0 20px
 * Send button:   54×54px circle, gradient accent→accent2, shadow
 */

import { useState, useRef } from 'react';
import {
  View, TextInput, TouchableOpacity, Text,
  ActivityIndicator, StyleSheet, Platform, Alert, InteractionManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Colors, FontSizes } from '@/constants';

// ── Placeholder cycling — mirrors web PLACEHOLDERS array ─────────────────────
// Web: PLACEHOLDERS[channelId % PLACEHOLDERS.length]()

const PLACEHOLDERS = [
  'Say hi 👋',
  "Who's out tonight?",
  'Any plans? 👀',
  "What's the vibe right now?",
  'Anyone up for something? 🍻',
  'Drop a message…',
];

export function getPlaceholder(channelId: string): string {
  const n = parseInt(channelId, 10);
  const idx = isNaN(n) ? 0 : n % PLACEHOLDERS.length;
  return PLACEHOLDERS[idx];
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  sending:     boolean;
  onSendText:  (text: string) => void;
  onSendImage: (uri: string) => void;
  placeholder?: string;
}

export function ChatInput({ sending, onSendText, onSendImage, placeholder = 'Drop a message…' }: Props) {
  const [text,      setText]      = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSendText(trimmed);
    setText('');
  }

  async function launchWithUri(uri: string) {
    setUploading(true);
    try {
      await onSendImage(uri);
    } catch (err) {
      console.error('[picker] upload failed:', String(err));
    } finally {
      setUploading(false);
    }
  }

  async function openLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to share images in chat.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]?.uri) await launchWithUri(result.assets[0].uri);
  }

  async function openCamera() {
    console.log('[camera] openCamera called');
    try {
      console.log('[camera] requesting permission...');
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      console.log('[camera] permission status:', status);
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow camera access to take photos in chat.');
        return;
      }
      console.log('[camera] launching camera...');
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
      console.log('[camera] result canceled:', result.canceled);
      if (!result.canceled && result.assets[0]?.uri) await launchWithUri(result.assets[0].uri);
    } catch (err) {
      console.error('[camera] launch failed:', String(err));
      Alert.alert('Camera unavailable', 'Could not open the camera. Please try again.');
    }
  }

  function handlePickImage() {
    if (sending || uploading) return;
    console.log('[camera] handlePickImage called');
    // Use InteractionManager.runAfterInteractions instead of a fixed setTimeout.
    // The iOS action sheet dismiss animation takes ~300-400ms; a fixed 100ms delay
    // is too short. runAfterInteractions waits for ALL active animations to finish
    // before presenting the camera/picker, so iOS never silently drops the modal.
    Alert.alert('Send a photo', undefined, [
      { text: 'Take Photo',          onPress: () => { console.log('[camera] Take Photo tapped'); InteractionManager.runAfterInteractions(() => openCamera()); } },
      { text: 'Choose from Library', onPress: () => InteractionManager.runAfterInteractions(() => openLibrary()) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const busy       = sending || uploading;
  const canSend    = !!text.trim() && !busy;

  return (
    <View style={styles.container}>

      {/* ── Upload button — web: .upload-btn (54×54, rgba bg, border, image SVG) ── */}
      <TouchableOpacity
        style={[styles.uploadBtn, busy && styles.btnDisabled]}
        onPress={handlePickImage}
        activeOpacity={0.7}
        disabled={busy}
      >
        {uploading ? (
          <ActivityIndicator size="small" color={Colors.accent} />
        ) : (
          // Web: ImageIcon SVG 22px — Ionicons 'image-outline' is visually equivalent
          <Ionicons name="image-outline" size={22} color={Colors.text} />
        )}
      </TouchableOpacity>

      {/* ── Input — web: border-radius 28px, min-height 56px, padding 0 20px ── */}
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={Colors.muted2}
        multiline
        maxLength={1000}
        returnKeyType="send"
        blurOnSubmit={Platform.OS !== 'ios'}
        onSubmitEditing={Platform.OS !== 'ios' ? handleSend : undefined}
        editable={!busy}
      />

      {/* ── Send button — web: .send-btn (54×54, gradient #C24A38→#B87228, shadow) ── */}
      {/* Gradient approximated with #B87228 (accent2 — warm amber end of gradient)  */}
      {/* Web: disabled = opacity 0.3 on the same gradient (not a different bg)      */}
      <TouchableOpacity
        style={[styles.sendBtnWrap, !canSend && styles.sendBtnDisabled]}
        onPress={handleSend}
        activeOpacity={0.8}
        disabled={!canSend}
      >
        <View style={styles.sendBtn}>
          {sending ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            // Web: SendIcon SVG 20×20px, strokeWidth 2.5, color: #fff
            <Ionicons name="send" size={20} color="#fff" />
          )}
        </View>
      </TouchableOpacity>

    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  // ── .input-bar ─────────────────────────────────────────────────────────────
  // Web: gap 12px; padding 16px; border-top 1px var(--border);
  //      gradient rgba(30,24,18,0.96)→rgba(22,18,16,0.99);
  //      box-shadow 0 -10px 28px rgba(0,0,0,0.28)
  container: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingVertical:   18,
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
    backgroundColor:   'rgba(22, 18, 16, 0.99)',
    gap:               12,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: -5 },
    shadowOpacity:     0.28,
    shadowRadius:      12,
    elevation:         30, // must exceed tab bar (elevation: 24) to render above its upward shadow
  },

  // ── .upload-btn ────────────────────────────────────────────────────────────
  // Web: 54×54px; bg rgba(255,255,255,0.05); border 1px rgba(255,255,255,0.09);
  //      border-radius 50%; icon 22px
  uploadBtn: {
    width:           60,
    height:          60,
    flexShrink:      0,
    alignItems:      'center',
    justifyContent:  'center',
    borderRadius:    30,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth:     1,
    borderColor:     'rgba(255, 255, 255, 0.09)',
  },

  // ── .input-bar input ───────────────────────────────────────────────────────
  // Web: border-radius 28px; min-height 56px; padding 0 20px; font-size 1.04rem
  input: {
    flex:              1,
    minHeight:         62,
    maxHeight:         130,
    backgroundColor:   Colors.bg,
    borderRadius:      31,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: 22,
    paddingVertical:   14,
    color:             Colors.text,
    fontSize:          FontSizes.md,
    lineHeight:        24,
  },

  // ── .send-btn ──────────────────────────────────────────────────────────────
  // Web: 54×54px; gradient linear-gradient(135deg, #C24A38, #B87228);
  //      border-radius 50%; box-shadow 0 6px 18px rgba(194,74,56,0.32)
  //      disabled: opacity 0.3 (same gradient, just faded)
  // Gradient approximated with #B87228 (accent2 — the warm amber end).
  sendBtnWrap: {
    flexShrink:    0,
    shadowColor:   '#C24A38',
    shadowOffset:  { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius:  12,
    elevation:     8,
  },
  sendBtn: {
    width:           60,
    height:          60,
    borderRadius:    30,
    backgroundColor: '#B87228',   // web gradient approximation (warm amber end)
    alignItems:      'center',
    justifyContent:  'center',
  },
  sendBtnDisabled: {
    opacity:       0.3,
    shadowOpacity: 0,
    elevation:     0,
  },

  btnDisabled: { opacity: 0.35 },
});
