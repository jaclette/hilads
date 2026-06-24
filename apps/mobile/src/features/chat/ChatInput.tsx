/**
 * ChatInput - faithful port of the web .input-bar.
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
import { useTranslation } from 'react-i18next';
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
import { MentionSuggestions } from './MentionSuggestions';
import { fetchMentionSuggestions, type MentionContext, type MentionSuggestion } from '@/api/mentions';
import { buildMentionsFromText, detectActiveMention, type SelectedMention, type MentionRef } from '@/lib/mentions';


// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  sending:          boolean;
  onSendText:       (text: string, mentions?: MentionRef[]) => void;
  onSendImage:      (uri: string) => void;
  placeholder?:     string;
  /** Enables @mention autocomplete. Both must be set. channelId: city numeric id, or event/topic hex id. */
  mentionContext?:   MentionContext;
  mentionChannelId?: string;
  /** Activates a subtle pulse glow to signal live activity in the channel. */
  pulse?:           boolean;
  /** Parent can call pickImageRef.current?.() to trigger the image picker externally (e.g. from a feed prompt CTA). */
  pickImageRef?:    React.MutableRefObject<(() => void) | null>;
  /** Typing indicator callbacks - parent wires these to WS typingStart/typingStop. */
  onTypingStart?:   () => void;
  onTypingStop?:    () => void;
  /** Reply context - shown as a preview strip above the input until cancelled. */
  replyingTo?:      ReplyRef | null;
  onCancelReply?:   () => void;
  /** Edit mode - when set, the composer pre-fills with content and Send saves
      the edit via onSubmitEdit instead of sending a new message. Parents must
      clear `editing` after onSubmitEdit resolves. Reply and edit are mutually
      exclusive - parent should not set both. */
  editing?:         { id: string; content: string } | null;
  onSubmitEdit?:    (text: string) => void;
  onCancelEdit?:    () => void;
  /** Forwarded to the underlying TextInput. Parent can use this to react to
      the keyboard opening (e.g. collapse a header block to give the chat
      more vertical space). */
  onFocus?:         () => void;
  /** Fires when the TextInput blurs. Mirror of onFocus - parents can use it
      to restore collapsed state when the keyboard closes. */
  onBlur?:          () => void;
  /** When true, the keyboard is dismissed after a successful text send. Used
      by the challenge thread chat so the header re-expands on send. Defaults
      to false (city/event chats keep the keyboard up for rapid replies). */
  dismissOnSend?:   boolean;
}

export function ChatInput({ sending, onSendText, onSendImage, placeholder, pulse = false, pickImageRef, onTypingStart, onTypingStop, replyingTo, onCancelReply, editing, onSubmitEdit, onCancelEdit, mentionContext, mentionChannelId, onFocus, onBlur, dismissOnSend = false }: Props) {
  const { t } = useTranslation('common');
  const { account, identity, onlineUsers } = useApp();
  // Presence mirror - read at suggest time so a guest joining/leaving doesn't
  // re-fire the debounced fetch on every keystroke.
  const onlineUsersRef = useRef(onlineUsers);
  onlineUsersRef.current = onlineUsers;
  const [text,          setText]        = useState('');
  const textRef         = useRef('');
  // @mention autocomplete state
  const [mentionQuery,  setMentionQuery]  = useState<string | null>(null);
  const [suggestions,   setSuggestions]   = useState<MentionSuggestion[]>([]);
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);
  const mentionAnchor   = useRef(0);  // index of the active '@'
  const mentionsEnabled = !!(mentionContext && mentionChannelId);
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

  // Seed composer text when entering edit mode. We key on editing?.id so
  // switching from edit-msg-A to edit-msg-B (rare, but possible if the user
  // long-presses another own-message while already editing) re-seeds the
  // textbox. Exiting edit mode clears the box.
  useEffect(() => {
    if (editing) {
      setText(editing.content);
      textRef.current = editing.content;
      // Focus + place cursor at end on the next tick so the platform finishes
      // mounting the field before we ask for focus.
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // Exiting edit mode: clear so the next normal message starts blank.
      // (If a parent toggles `editing` off after successful save, this also
      // resets the textbox.)
      setText('');
      textRef.current = '';
      setSelectedMentions([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

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
    textRef.current = val;
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
      // Input cleared (e.g. after send) - stop immediately
      clearTypingTimer();
      if (isTypingRef.current) {
        isTypingRef.current = false;
        onTypingStop?.();
      }
    }
  }

  // ── @mention autocomplete ────────────────────────────────────────────────
  function detectMention(cursor: number) {
    if (!mentionsEnabled) return;
    const found = detectActiveMention(textRef.current.slice(0, cursor));
    if (found) { mentionAnchor.current = found.at; setMentionQuery(found.query); }
    else       { setMentionQuery(null); }
  }

  useEffect(() => {
    if (!mentionsEnabled || mentionQuery === null) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      const members = await fetchMentionSuggestions(mentionContext!, String(mentionChannelId), mentionQuery);
      // City context: merge currently-online GUESTS (live-only mentionability),
      // anchored on the stable guestId; exclude self + registered users.
      let guests: MentionSuggestion[] = [];
      if (mentionContext === 'city') {
        const q = (mentionQuery ?? '').toLowerCase();
        const myGuestId = identity?.guestId;
        guests = (onlineUsersRef.current ?? [])
          .filter(u => !u.isRegistered && u.guestId && u.guestId !== myGuestId && (u.nickname || '').toLowerCase().startsWith(q))
          .slice(0, 6)
          .map(u => ({ guestId: u.guestId, username: u.nickname, displayName: u.nickname, avatarUrl: null, isGuest: true }));
      }
      setSuggestions([...members, ...guests]);
    }, 250);
    return () => clearTimeout(t);
  }, [mentionQuery, mentionsEnabled, mentionContext, mentionChannelId]);

  function onSelectMention(s: MentionSuggestion) {
    const cursor = lastSel.current.end;
    const before = textRef.current.slice(0, mentionAnchor.current);
    const after  = textRef.current.slice(cursor);
    const next   = before + '@' + s.username + ' ' + after;
    setText(next);
    textRef.current = next;
    // "@here" is a plain-text broadcast token, not a per-user mention - the
    // backend detects it from the message content and fans out to the city. So
    // insert the text but DON'T add a structured mention (it has no userId).
    if (!s.isHere) {
      setSelectedMentions(prev => {
        const key = s.userId || s.guestId;
        if (prev.some(m => (m.userId || m.guestId) === key)) return prev;
        return [...prev, s.userId ? { userId: s.userId, username: s.username } : { guestId: s.guestId!, username: s.username }];
      });
    }
    setMentionQuery(null);
    setSuggestions([]);
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
    // Edit mode: short-circuit normal send. We don't dirty mentions/offsets
    // because edits are content-only - keeping the original mentions would
    // require re-resolving offsets, which we don't want for v1 (the backend
    // also doesn't currently accept mentions on edit).
    if (editing && onSubmitEdit) {
      // No-op when content unchanged - avoid round-trip + needless WS echo.
      if (trimmed === editing.content) { onCancelEdit?.(); return; }
      onSubmitEdit(trimmed);
      // Parent clears `editing` after the request resolves, which triggers the
      // useEffect above to wipe text.
      return;
    }
    // Re-derive mention offsets against the final text - tokens the user deleted
    // are dropped, so only intact, explicitly-selected @mentions are sent.
    const built = mentionsEnabled ? buildMentionsFromText(trimmed, selectedMentions) : [];
    onSendText(trimmed, built.length ? built : undefined);
    setText('');
    textRef.current = '';
    setSelectedMentions([]);
    setMentionQuery(null);
    setSuggestions([]);
    // Parents that want the keyboard down on send (e.g. the challenge thread
    // chat, so a collapsed header can re-expand) opt in via the prop. Other
    // chats keep the keyboard up for rapid replies.
    if (dismissOnSend) Keyboard.dismiss();
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
      Alert.alert(t('composer.photoPermTitle'), t('composer.photoPermBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]?.uri) await launchWithUri(result.assets[0].uri);
  }

  // ── Android: open in-app camera modal (bypasses ActivityResultLauncher) ──────
  // expo-image-picker's launchCameraAsync() hangs on Android 14 + singleTask
  // MainActivity because the ActivityResultLauncher callback is never delivered
  // across task boundaries. AndroidCameraCapture uses expo-camera's CameraView
  // entirely within the app process - no ActivityResultLauncher involved.
  function openCameraAndroid() {
    console.log('[camera] Android path - opening in-app camera modal');
    setAndroidCamera(true);
  }

  // ── iOS: use expo-image-picker as normal (works correctly on iOS) ─────────
  async function openCameraIOS() {
    console.log('[camera] iOS path - using launchCameraAsync');
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
              t('composer.cameraPermTitle'),
              t('composer.cameraPermSettings'),
              [
                { text: t('cancel'), style: 'cancel' },
                { text: t('openSettings'), onPress: () => Linking.openSettings() },
              ],
            );
          } else {
            console.log('[camera] permission denied');
            Alert.alert(t('composer.cameraPermTitle'), t('composer.cameraPermBody'));
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
      Alert.alert(t('composer.cameraUnavailTitle'), t('composer.cameraUnavailBody'));
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
    Alert.alert(t('composer.sendPhotoTitle'), undefined, [
      { text: t('composer.takePhoto'),     onPress: () => setTimeout(openCamera, 0) },
      { text: t('composer.chooseLibrary'), onPress: () => setTimeout(openLibrary, 0) },
      { text: t('cancel'), style: 'cancel' },
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
          t('composer.locPermTitle'),
          t('composer.locPermSettings'),
          [
            { text: t('cancel'), style: 'cancel' },
            { text: t('openSettings'), onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
      const result = await Location.requestForegroundPermissionsAsync();
      granted = result.status === 'granted';
      if (!granted) {
        Alert.alert(t('composer.locNeededTitle'), t('composer.locNeededBody'));
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
    // Posted message content (broadcast to all viewers) - kept in English so
    // every recipient sees the same text regardless of the sender's UI locale.
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

    {/* ── @mention suggestions - appear above composer while typing "@" ── */}
    {mentionQuery !== null && <MentionSuggestions suggestions={suggestions} onSelect={onSelectMention} />}

    {/* ── Emoji panel - appears above composer when emoji mode is active ── */}
    {showEmoji && <EmojiPanel onSelect={insertEmoji} />}

    {/* ── Reply preview strip ── */}
    {replyingTo && !editing && (
      <View style={replyStyles.strip}>
        <View style={replyStyles.body}>
          <Text style={replyStyles.name}>{replyingTo.nickname}</Text>
          <Text style={replyStyles.preview} numberOfLines={1}>
            {replyingTo.type === 'image' ? t('photoLabel') : replyingTo.content}
          </Text>
        </View>
        <TouchableOpacity onPress={onCancelReply} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={replyStyles.close}>✕</Text>
        </TouchableOpacity>
      </View>
    )}

    {/* ── Edit preview strip - visible while the user is editing one of their
        own messages. Same chrome as the reply strip so the cancel affordance
        feels familiar. */}
    {editing && (
      <View style={editStyles.strip}>
        <View style={editStyles.body}>
          <Text style={editStyles.name}>{t('editingBanner', { ns: 'chat' })}</Text>
          <Text style={editStyles.preview} numberOfLines={1}>{editing.content}</Text>
        </View>
        <TouchableOpacity onPress={onCancelEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={editStyles.close}>✕</Text>
        </TouchableOpacity>
      </View>
    )}

    <View style={styles.container}>

      {/* ── Vibe button ── */}
      {/* Hidden while editing: edit mode is text-only - exposing the photo/spot
          attach affordance would imply you can change a text message into an
          image, which the backend doesn't support. */}
      <Animated.View style={[
        styles.vibeBtnGlow,
        { transform: [{ scale: vibScale }] },
        (busy || !!editing) && styles.btnDisabled,
        pulse && !editing && {
          shadowOpacity: vibGlow.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.75] }),
        },
      ]}>
        <Pressable
          onPress={handleShare}
          onPressIn={vibePressIn}
          onPressOut={vibePressOut}
          disabled={busy || !!editing}
          accessibilityRole="button"
          accessibilityLabel={t('composer.attach')}
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
              <Ionicons name="add" size={24} color="#fff" />
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

      {/* ── Input - web: border-radius 28px, min-height 56px, padding 0 20px ── */}
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={text}
        onChangeText={handleChangeText}
        onSelectionChange={({ nativeEvent: { selection } }) => { lastSel.current = selection; detectMention(selection.end); }}
        placeholder={placeholder ?? t('composer.placeholderDefault')}
        placeholderTextColor={Colors.muted2}
        multiline
        maxLength={1000}
        returnKeyType="send"
        blurOnSubmit={Platform.OS !== 'ios'}
        onSubmitEditing={Platform.OS !== 'ios' ? handleSend : undefined}
        editable={!busy}
        onFocus={() => { setShowEmoji(false); onFocus?.(); }}
        onBlur={() => { clearTypingTimer(); if (isTypingRef.current) { isTypingRef.current = false; onTypingStop?.(); } onBlur?.(); }}
      />

      {/* ── Send button - web: .send-btn (54×54, gradient #C24A38→#B87228, shadow) ── */}
      {/* Gradient approximated with #B87228 (accent2 - warm amber end of gradient)  */}
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

  // ── Composer container - aligned with the DM composer's compact rhythm
  // (apps/mobile/app/dm/[id].tsx). Single source of truth for City + Event +
  // Topic chats; shrinking values here propagates to all three.
  container: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 14,
    paddingVertical:   12,
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
    backgroundColor:   'rgba(22, 18, 16, 0.99)',
    gap:               10,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: -5 },
    shadowOpacity:     0.28,
    shadowRadius:      12,
    elevation:         30, // must exceed tab bar (elevation: 24) to render above its upward shadow
  },

  // ── Vibe ("+") button - 48px to match DM ──────────────────────────────────
  vibeBtnGlow: {
    flexShrink:    0,
    borderRadius:  24,
    shadowColor:   '#C24A38',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius:  14,
    elevation:     10,
  },
  vibeBtn: {
    width:          48,
    height:         48,
    borderRadius:   24,
    alignItems:     'center',
    justifyContent: 'center',
  },

  // ── Text input - 48px min, FontSizes.sm to match DM ───────────────────────
  input: {
    flex:              1,
    flexShrink:        1,
    minWidth:          0,
    minHeight:         48,
    maxHeight:         130,
    backgroundColor:   Colors.bg,
    borderRadius:      999,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: 20,
    paddingVertical:   13,
    color:             Colors.text,
    fontSize:          FontSizes.sm,
    lineHeight:        20,
  },

  // ── Send button - 48px to match DM ────────────────────────────────────────
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
    width:           48,
    height:          48,
    borderRadius:    24,
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
    width:           36,
    height:          36,
    flexShrink:      0,
    alignItems:      'center',
    justifyContent:  'center',
    borderRadius:    18,
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
    fontSize:   18,
    lineHeight: 22,
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

const editStyles = StyleSheet.create({
  strip: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingVertical:   8,
    backgroundColor:   'rgba(255,122,60,0.10)',
    borderTopWidth:    1,
    borderTopColor:    'rgba(255,122,60,0.22)',
    gap:               10,
  },
  body:    { flex: 1, minWidth: 0 },
  name:    { fontSize: 12, fontWeight: '700', color: '#FF7A3C', marginBottom: 2 },
  preview: { fontSize: 12, color: Colors.muted2 },
  close:   { fontSize: 16, color: Colors.muted2, fontWeight: '600' },
});
