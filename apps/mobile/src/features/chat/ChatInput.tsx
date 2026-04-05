/**
 * ChatInput — faithful port of the web .input-bar.
 *
 * Web source: App.jsx form.input-bar, index.css (.upload-btn, .send-btn, .input-bar input)
 *
 * Upload button: 54×54px circle, rgba(255,255,255,0.05) bg, 1px border rgba(255,255,255,0.09)
 * Input:         pill 28px radius, min-height 56px, padding 0 20px
 * Send button:   54×54px circle, gradient accent→accent2, shadow
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  View, TextInput, TouchableOpacity, Text,
  ActivityIndicator, StyleSheet, Platform, Alert, Linking, Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Colors, FontSizes } from '@/constants';
import { AndroidCameraCapture } from './AndroidCameraCapture';
import { EmojiPanel } from './EmojiPanel';


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
  sending:          boolean;
  onSendText:       (text: string) => void;
  onSendImage:      (uri: string) => void;
  placeholder?:     string;
  /** Parent can call pickImageRef.current?.() to trigger the image picker externally (e.g. from a feed prompt CTA). */
  pickImageRef?:    React.MutableRefObject<(() => void) | null>;
  /** Typing indicator callbacks — parent wires these to WS typingStart/typingStop. */
  onTypingStart?:   () => void;
  onTypingStop?:    () => void;
}

export function ChatInput({ sending, onSendText, onSendImage, placeholder = 'Drop a message…', pickImageRef, onTypingStart, onTypingStop }: Props) {
  const [text,          setText]        = useState('');
  const [uploading,     setUploading]   = useState(false);
  const [androidCamera, setAndroidCamera] = useState(false);
  const [showEmoji,     setShowEmoji]   = useState(false);
  const inputRef        = useRef<TextInput>(null);
  const lastSel         = useRef({ start: 0, end: 0 });
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTypingTimer = useCallback(() => {
    if (typingStopTimer.current !== null) {
      clearTimeout(typingStopTimer.current);
      typingStopTimer.current = null;
    }
  }, []);

  function handleChangeText(val: string) {
    setText(val);
    if (val.length > 0) {
      onTypingStart?.();
      clearTypingTimer();
      typingStopTimer.current = setTimeout(() => {
        onTypingStop?.();
        typingStopTimer.current = null;
      }, 1500);
    } else {
      // Input cleared (e.g. after send) — stop immediately
      clearTypingTimer();
      onTypingStop?.();
    }
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearTypingTimer();
    onTypingStop?.();
    onSendText(trimmed);
    setText('');
  }

  function insertEmoji(emoji: string) {
    const { start, end } = lastSel.current;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    const pos = start + emoji.length;
    lastSel.current = { start: pos, end: pos };
  }

  function handleEmojiToggle() {
    if (!showEmoji) Keyboard.dismiss();
    setShowEmoji(p => !p);
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

  // ── Android: open in-app camera modal (bypasses ActivityResultLauncher) ──────
  // expo-image-picker's launchCameraAsync() hangs on Android 14 + singleTask
  // MainActivity because the ActivityResultLauncher callback is never delivered
  // across task boundaries. AndroidCameraCapture uses expo-camera's CameraView
  // entirely within the app process — no ActivityResultLauncher involved.
  function openCameraAndroid() {
    console.log('[camera] Android path — opening in-app camera modal');
    setAndroidCamera(true);
  }

  // ── iOS: use expo-image-picker as normal (works correctly on iOS) ─────────
  async function openCameraIOS() {
    console.log('[camera] iOS path — using launchCameraAsync');
    try {
      console.log('[camera] checking current permission...');
      const current = await ImagePicker.getCameraPermissionsAsync();
      console.log('[camera] current permission:', JSON.stringify(current));

      if (!current.granted) {
        console.log('[camera] requesting permission...');
        const requested = await ImagePicker.requestCameraPermissionsAsync();
        console.log('[camera] requested permission result:', JSON.stringify(requested));
        if (!requested.granted) {
          if (requested.canAskAgain === false) {
            console.log('[camera] permission blocked, open settings');
            Alert.alert(
              'Camera permission required',
              'Please allow camera access in Settings → Hilads → Camera.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ],
            );
          } else {
            console.log('[camera] permission denied');
            Alert.alert('Camera permission required', 'Camera access is needed to take photos.');
          }
          return;
        }
      }

      console.log('[camera] permission granted, calling launchCameraAsync...');
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
      console.log('[camera] launchCameraAsync resolved:', JSON.stringify(res));
      if (!res.canceled && res.assets?.[0]?.uri) await launchWithUri(res.assets[0].uri);
    } catch (e) {
      console.error('[camera] iOS error:', e);
      Alert.alert('Camera unavailable', 'Could not open the camera. Please try again.');
    }
  }

  function openCamera() {
    console.log('[camera] openCamera called, platform:', Platform.OS);
    if (Platform.OS === 'android') {
      openCameraAndroid();
    } else {
      openCameraIOS();
    }
  }

  function handlePickImage() {
    if (sending || uploading) return;
    console.log('[camera] handlePickImage called');
    Alert.alert('Send a photo', undefined, [
      // On Android, setTimeout(fn, 0) lets the Alert dialog fully dismiss before
      // launching the camera. InteractionManager.runAfterInteractions blocks
      // indefinitely on Android when screen/tab animations are registered.
      // On iOS, the action sheet dismiss animation (~300ms) is also safely covered
      // by the JS event loop flush that setTimeout(fn, 0) provides.
      { text: 'Take Photo',          onPress: () => setTimeout(openCamera, 0) },
      { text: 'Choose from Library', onPress: () => setTimeout(openLibrary, 0) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // Expose handlePickImage to parent so prompt CTAs can trigger the same flow
  if (pickImageRef) pickImageRef.current = handlePickImage;

  const busy       = sending || uploading;
  const canSend    = !!text.trim() && !busy;

  return (
    <>
    {/* ── Android in-app camera (bypasses ActivityResultLauncher hang) ──── */}
    {Platform.OS === 'android' && (
      <AndroidCameraCapture
        visible={androidCamera}
        onCapture={(uri) => {
          console.log('[camera] Android capture received uri:', uri);
          setAndroidCamera(false);
          launchWithUri(uri);
        }}
        onClose={() => {
          console.log('[camera] Android camera modal closed');
          setAndroidCamera(false);
        }}
      />
    )}

    {/* ── Emoji panel — appears above composer when emoji mode is active ── */}
    {showEmoji && <EmojiPanel onSelect={insertEmoji} />}

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

      {/* ── Emoji button ── */}
      <TouchableOpacity
        style={[styles.emojiBtn, showEmoji && styles.emojiBtnActive]}
        onPress={handleEmojiToggle}
        activeOpacity={0.7}
      >
        <Text style={styles.emojiBtnIcon}>😊</Text>
      </TouchableOpacity>

      {/* ── Input — web: border-radius 28px, min-height 56px, padding 0 20px ── */}
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={text}
        onChangeText={handleChangeText}
        onSelectionChange={({ nativeEvent: { selection } }) => { lastSel.current = selection; }}
        placeholder={placeholder}
        placeholderTextColor={Colors.muted2}
        multiline
        maxLength={1000}
        returnKeyType="send"
        blurOnSubmit={Platform.OS !== 'ios'}
        onSubmitEditing={Platform.OS !== 'ios' ? handleSend : undefined}
        editable={!busy}
        onFocus={() => setShowEmoji(false)}
        onBlur={() => { clearTypingTimer(); onTypingStop?.(); }}
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
    </>
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
    flexShrink:        1,
    minWidth:          0,
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
    flexGrow:      0,
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

  emojiBtn: {
    width:           44,
    height:          44,
    flexShrink:      0,
    alignItems:      'center',
    justifyContent:  'center',
    borderRadius:    22,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth:     1,
    borderColor:     'rgba(255, 255, 255, 0.09)',
    opacity:         0.6,
  },
  emojiBtnActive: {
    opacity:         1,
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
  },
  emojiBtnIcon: {
    fontSize:   20,
    lineHeight: 24,
  },
});
