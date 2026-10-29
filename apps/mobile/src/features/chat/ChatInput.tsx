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
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { Border, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
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
  /** "+" menu extras (city Chat, V3-09): create a Hi plan / start a Hi now. */
  onCreatePlan?:    () => void;
  onHiNow?:         () => void;
  /** A quick-start chip's text: fills the composer (a new `key` each tap) and focuses it. */
  prefill?:         { text: string; key: number } | null;
}

export function ChatInput({ sending, onSendText, onSendImage, placeholder, pulse = false, pickImageRef, onTypingStart, onTypingStop, replyingTo, onCancelReply, editing, onSubmitEdit, onCancelEdit, mentionContext, mentionChannelId, onFocus, onBlur, dismissOnSend = false, onCreatePlan, onHiNow, prefill }: Props) {
  const styles      = useThemedStyles(makeStyles);
  const replyStyles = useThemedStyles(makeReplyStyles);
  const editStyles  = useThemedStyles(makeEditStyles);
  const { colors }  = useTheme();
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

  useEffect(() => {
    if (!prefill) return;
    setText(prefill.text);
    textRef.current = prefill.text;
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [prefill?.key]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Request GPS at the moment of sharing (reuses granted silently; the util
    // emits the share_spot permission funnel). Degrade gracefully on denial.
    const geo = await requestFeatureLocation('share_spot');
    if (!geo.ok) {
      if (geo.permanentlyDenied) {
        Alert.alert(t('composer.locPermTitle'), t('composer.locPermSettings'), [
          { text: t('cancel'), style: 'cancel' },
          { text: t('openSettings'), onPress: () => Linking.openSettings() },
        ]);
      } else if (geo.reason === 'denied') {
        Alert.alert(t('composer.locNeededTitle'), t('composer.locNeededBody'));
      }
      return;
    }
    // LocationPicker refines to accurate GPS internally via injectJavaScript.
    setLocationCoords(geo.coords ?? { lat: 0, lng: 0 });
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
      onPlan={onCreatePlan ? () => { setShowShareSheet(false); onCreatePlan(); } : undefined}
      onHiNow={onHiNow ? () => { setShowShareSheet(false); onHiNow(); } : undefined}
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
        <TouchableOpacity style={replyStyles.close} onPress={onCancelReply} accessibilityRole="button" accessibilityLabel={t('close')}>
          <Ionicons name="close" size={20} color={colors.muted} />
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
        <TouchableOpacity style={replyStyles.close} onPress={onCancelEdit} accessibilityRole="button" accessibilityLabel={t('close')}>
          <Ionicons name="close" size={20} color={colors.muted} />
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
          <View style={styles.vibeBtn}>
            {uploading ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Ionicons name="add" size={24} color={colors.white} />
            )}
          </View>
        </Pressable>
      </Animated.View>

      {/* ── Emoji button ── */}
      <TouchableOpacity
        style={[styles.emojiBtn, showEmoji && styles.emojiBtnActive]}
        onPress={handleEmojiToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t('composer.emoji')}
        accessibilityState={{ selected: showEmoji }}
      >
        <Ionicons name="happy-outline" size={24} color={showEmoji ? colors.primaryOnTint : colors.muted} />
      </TouchableOpacity>

      {/* ── Input - web: border-radius 28px, min-height 56px, padding 0 20px ── */}
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={text}
        testID="chat-input"
        onChangeText={handleChangeText}
        onSelectionChange={({ nativeEvent: { selection } }) => { lastSel.current = selection; detectMention(selection.end); }}
        placeholder={placeholder ?? t('composer.placeholderDefault')}
        placeholderTextColor={colors.mutedDim}
        multiline
        maxLength={1000}
        returnKeyType="send"
        blurOnSubmit={Platform.OS !== 'ios'}
        onSubmitEditing={Platform.OS !== 'ios' ? handleSend : undefined}
        editable={!busy}
        onFocus={() => { setShowEmoji(false); onFocus?.(); }}
        onBlur={() => { clearTypingTimer(); if (isTypingRef.current) { isTypingRef.current = false; onTypingStop?.(); } onBlur?.(); }}
      />

      {/* ── Send button (chat.html): round, primary; dimmed while there's nothing to send. ── */}
      <TouchableOpacity
        style={[styles.sendBtnWrap, !canSend && styles.sendBtnDisabled]}
        onPress={handleSend}
        activeOpacity={0.8}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel={t('composer.send')}
      >
        <View style={styles.sendBtn}>
          {sending ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Ionicons name="send" size={19} color={colors.white} />
          )}
        </View>
      </TouchableOpacity>

    </View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // ── Composer (chat.html): single source of truth for City, Event, Topic and
  // Challenge chats; the DM composer is its own (app/dm/[id].tsx).
  container: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   10,
    borderTopWidth:    1,
    borderTopColor:    c.line,
    backgroundColor:   c.bg,
    gap:               8,
  },
  // "+" (attach, plan, Hi now): round, primary.
  vibeBtnGlow: {
    flexShrink:    0,
    borderRadius:  Radius.full,
    shadowColor:   c.primary,
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius:  12,
  },
  vibeBtn:  { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex:              1,
    flexShrink:        1,
    minWidth:          0,
    minHeight:         44,
    maxHeight:         130,
    backgroundColor:   c.bg2,
    borderRadius:      22,
    borderWidth:       Border,
    borderColor:       c.line,
    paddingHorizontal: 16,
    paddingVertical:   11,
    color:             c.text,
    fontSize:          15,
    fontWeight:        '400',
    lineHeight:        20,
  },
  sendBtnWrap:     { flexShrink: 0, flexGrow: 0 },
  sendBtn:         { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.35 },
  btnDisabled:     { opacity: 0.35 },
  emojiBtn:        { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full, marginHorizontal: -4 },
  emojiBtnActive:  { backgroundColor: c.primaryTint },
});

const makeReplyStyles = (c: ThemeColors) => StyleSheet.create({
  strip:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: Spacing.md, paddingRight: 6, paddingVertical: 4,
             backgroundColor: c.bg2, borderTopWidth: 1, borderTopColor: c.line, borderLeftWidth: 3, borderLeftColor: c.primary },
  body:    { flex: 1, minWidth: 0 },
  name:    { fontSize: 12, fontWeight: '700', color: c.primaryText, marginBottom: 2 },
  preview: { fontSize: 12, fontWeight: '400', color: c.muted },
  close:   { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

// Editing: same strip, the label on the primary tint.
const makeEditStyles = (c: ThemeColors) => StyleSheet.create({
  strip:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: Spacing.md, paddingRight: 6, paddingVertical: 4,
             backgroundColor: c.primaryTint, borderTopWidth: 1, borderTopColor: c.line },
  body:    { flex: 1, minWidth: 0 },
  name:    { fontSize: 12, fontWeight: '700', color: c.primaryOnTint, marginBottom: 2 },
  preview: { fontSize: 12, fontWeight: '400', color: c.primaryOnTint },
});
