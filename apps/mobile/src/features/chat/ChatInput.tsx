/**
 * ChatInput — faithful port of the web .input-bar.
 *
 * Web source: App.jsx form.input-bar, index.css (.upload-btn, .send-btn, .input-bar input)
 *
 * Upload button: 54×54px circle, rgba(255,255,255,0.05) bg, 1px border rgba(255,255,255,0.09)
 * Input:         pill 28px radius, min-height 56px, padding 0 20px
 * Send button:   54×54px circle, gradient accent→accent2, shadow
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, TextInput, TouchableOpacity, Text, Pressable,
  ActivityIndicator, StyleSheet, Platform, Alert, Linking, Keyboard,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Colors, FontSizes } from '@/constants';
import { useApp } from '@/context/AppContext';
import type { ReplyRef } from '@/types';
import { AndroidCameraCapture } from './AndroidCameraCapture';
import { EmojiPanel } from './EmojiPanel';
import { ShareSheet } from './ShareSheet';
import { LocationPicker } from './LocationPicker';


// ── Placeholder cycling — mirrors web PLACEHOLDERS array ─────────────────────
// Web: PLACEHOLDERS[channelId % PLACEHOLDERS.length]()

const PLACEHOLDERS = [
  'Say hi 👋',
  "Who's out tonight?",
  'Any plans? 👀',
  "What's happening here?",
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
  /** Activates a subtle pulse glow to signal live activity in the channel. */
  pulse?:           boolean;
  /** Parent can call pickImageRef.current?.() to trigger the image picker externally (e.g. from a feed prompt CTA). */
  pickImageRef?:    React.MutableRefObject<(() => void) | null>;
  /** Typing indicator callbacks — parent wires these to WS typingStart/typingStop. */
  onTypingStart?:   () => void;
  onTypingStop?:    () => void;
  /** Reply context — shown as a preview strip above the input until cancelled. */
  replyingTo?:      ReplyRef | null;
  onCancelReply?:   () => void;
}

export function ChatInput({ sending, onSendText, onSendImage, placeholder = 'Drop a message…', pulse = false, pickImageRef, onTypingStart, onTypingStop, replyingTo, onCancelReply }: Props) {
  const { account, identity } = useApp();
  const [text,          setText]        = useState('');
  const [uploading,     setUploading]   = useState(false);
  const [androidCamera, setAndroidCamera] = useState(false);
  const [showEmoji,     setShowEmoji]   = useState(false);
  const [showShareSheet,   setShowShareSheet]   = useState(false);
  const [locationCoords,   setLocationCoords]   = useState<{ lat: number; lng: number } | null>(null);
  const inputRef        = useRef<TextInput>(null);

  // ── Vibe button animations ─────────────────────────────────────────────────
  const vibScale  = useRef(new Animated.Value(1)).current;
  const vibGlow   = useRef(new Animated.Value(0)).current; // 0 = resting, 1 = full pulse

  function vibePressIn() {
    Animated.timing(vibScale, { toValue: 1.1, duration: 150, useNativeDriver: true }).start();
  }
  function vibePressOut() {
    Animated.timing(vibScale, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }

  // Pulse loop when channel has live activity
  useEffect(() => {
    if (!pulse) { vibGlow.stopAnimation(); vibGlow.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(vibGlow, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(vibGlow, { toValue: 0, duration: 1200, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const lastSel         = useRef({ start: 0, end: 0 });
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef     = useRef(false); // true while typingStart has been emitted

  const clearTypingTimer = useCallback(() => {
    if (typingStopTimer.current !== null) {
      clearTimeout(typingStopTimer.current);
      typingStopTimer.current = null;
    }
  }, []);

  function handleChangeText(val: string) {
    setText(val);
    if (val.length > 0) {
      // Only emit typingStart once per typing session (matches web isTypingRef pattern)
      if (!isTypingRef.current) {
        isTypingRef.current = true;
        onTypingStart?.();
      }
      clearTypingTimer();
      typingStopTimer.current = setTimeout(() => {
        isTypingRef.current = false;
        onTypingStop?.();
        typingStopTimer.current = null;
      }, 1500);
    } else {
      // Input cleared (e.g. after send) — stop immediately
      clearTypingTimer();
      if (isTypingRef.current) {
        isTypingRef.current = false;
        onTypingStop?.();
      }
    }
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    clearTypingTimer();
    if (isTypingRef.current) {
      isTypingRef.current = false;
      onTypingStop?.();
    }
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
    Alert.alert('Send a photo', undefined, [
      { text: 'Take Photo',          onPress: () => setTimeout(openCamera, 0) },
      { text: 'Choose from Library', onPress: () => setTimeout(openLibrary, 0) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleMySpot() {
    setShowShareSheet(false);

    // Permission check (fast if already granted on boot; shows dialog only on first use)
    const existing = await Location.getForegroundPermissionsAsync();
    let granted = existing.status === 'granted';
    if (!granted) {
      if (!existing.canAskAgain) {
        Alert.alert(
          'Location access required',
          'Please enable location in Settings → Hilads → Location.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
      const result = await Location.requestForegroundPermissionsAsync();
      granted = result.status === 'granted';
      if (!granted) {
        Alert.alert('Location needed', 'Allow location access to share your spot.');
        return;
      }
    }

    // Use last known position (instant cache lookup) to open the picker immediately.
    // LocationPicker will refine to accurate GPS internally via injectJavaScript.
    let lat = 0, lng = 0;
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (last) { lat = last.coords.latitude; lng = last.coords.longitude; }
    } catch {}

    setLocationCoords({ lat, lng });
  }

  function handleLocationConfirm({ place, address, lat, lng }: { place: string; address: string; lat: number; lng: number }) {
    setLocationCoords(null);
    const nickname = account?.display_name ?? identity?.nickname ?? 'Someone';
    const label = place || 'somewhere';
    const coordLine = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    const text = address
      ? `📍 ${nickname} is at ${label}\n${coordLine}\n${address}`
      : `📍 ${nickname} is at ${label}\n${coordLine}`;
    onSendText(text);
  }

  function handleShare() {
    if (sending || uploading) return;
    setShowShareSheet(true);
  }

  // Expose handleShare to parent so prompt CTAs can trigger the share sheet
  if (pickImageRef) pickImageRef.current = handleShare;

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

    {/* ── Location picker ── */}
    {locationCoords && (
      <LocationPicker
        visible={!!locationCoords}
        initialLat={locationCoords.lat}
        initialLng={locationCoords.lng}
        onConfirm={handleLocationConfirm}
        onClose={() => setLocationCoords(null)}
      />
    )}

    {/* ── Share sheet ── */}
    <ShareSheet
      visible={showShareSheet}
      onSnap={() => { setShowShareSheet(false); setTimeout(handlePickImage, 0); }}
      onSpot={handleMySpot}
      onClose={() => setShowShareSheet(false)}
      spotLoading={false}
    />

    {/* ── Emoji panel — appears above composer when emoji mode is active ── */}
    {showEmoji && <EmojiPanel onSelect={insertEmoji} />}

    {/* ── Reply preview strip ── */}
    {replyingTo && (
      <View style={replyStyles.strip}>
        <View style={replyStyles.body}>
          <Text style={replyStyles.name}>{replyingTo.nickname}</Text>
          <Text style={replyStyles.preview} numberOfLines={1}>
            {replyingTo.type === 'image' ? '📷 Photo' : replyingTo.content}
          </Text>
        </View>
        <TouchableOpacity onPress={onCancelReply} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={replyStyles.close}>✕</Text>
        </TouchableOpacity>
      </View>
    )}

    <View style={styles.container}>

      {/* ── Vibe button ── */}
      <Animated.View style={[
        styles.vibeBtnGlow,
        { transform: [{ scale: vibScale }] },
        busy && styles.btnDisabled,
        pulse && {
          shadowOpacity: vibGlow.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.75] }),
        },
      ]}>
        <Pressable
          onPress={handleShare}
          onPressIn={vibePressIn}
          onPressOut={vibePressOut}
          disabled={busy}
        >
          <LinearGradient
            colors={['#C24A38', '#B87228']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.vibeBtn}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.vibeBtnIcon}>✨</Text>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>

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
        onBlur={() => { clearTypingTimer(); if (isTypingRef.current) { isTypingRef.current = false; onTypingStop?.(); } }}
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

  // ── Vibe button ────────────────────────────────────────────────────────────
  // Glow wrapper — shadow lives here so it's unclipped by LinearGradient
  vibeBtnGlow: {
    flexShrink:    0,
    borderRadius:  30,
    shadowColor:   '#C24A38',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius:  14,
    elevation:     10,
  },
  // Gradient pill — clips the corners
  vibeBtn: {
    width:          60,
    height:         60,
    borderRadius:   30,
    alignItems:     'center',
    justifyContent: 'center',
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

  vibeBtnIcon: {
    fontSize:   22,
    lineHeight: 26,
    color:      '#fff',
  },

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

const replyStyles = StyleSheet.create({
  strip: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingVertical:   8,
    backgroundColor:   'rgba(255,255,255,0.04)',
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
    gap:               10,
  },
  body:    { flex: 1, minWidth: 0 },
  name:    { fontSize: 12, fontWeight: '700', color: Colors.accent, marginBottom: 2 },
  preview: { fontSize: 12, color: Colors.muted2 },
  close:   { fontSize: 16, color: Colors.muted2, fontWeight: '600' },
});
