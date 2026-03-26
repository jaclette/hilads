import { useState, useRef } from 'react';
import {
  View, TextInput, TouchableOpacity, Text,
  ActivityIndicator, StyleSheet, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

interface Props {
  sending:   boolean;
  onSendText:  (text: string) => void;
  onSendImage: (uri: string) => void;
}

export function ChatInput({ sending, onSendText, onSendImage }: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSendText(trimmed);
    setText('');
  }

  async function handlePickImage() {
    if (sending) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality:    0.8,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      onSendImage(result.assets[0].uri);
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={handlePickImage}
        activeOpacity={0.7}
        disabled={sending}
      >
        <Text style={styles.iconText}>📷</Text>
      </TouchableOpacity>

      <TextInput
        ref={inputRef}
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Message…"
        placeholderTextColor={Colors.muted2}
        multiline
        maxLength={1000}
        returnKeyType="send"
        blurOnSubmit={Platform.OS !== 'ios'}
        onSubmitEditing={Platform.OS !== 'ios' ? handleSend : undefined}
        editable={!sending}
      />

      <TouchableOpacity
        style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
        onPress={handleSend}
        activeOpacity={0.8}
        disabled={!text.trim() || sending}
      >
        {sending ? (
          <ActivityIndicator size="small" color={Colors.white} />
        ) : (
          <Text style={styles.sendIcon}>↑</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection:     'row',
    alignItems:        'flex-end',
    paddingHorizontal: Spacing.sm,
    paddingVertical:   Spacing.sm,
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
    backgroundColor:   Colors.bg,
    gap:               Spacing.xs,
  },

  iconBtn: {
    width:           40,
    height:          40,
    justifyContent:  'center',
    alignItems:      'center',
    borderRadius:    Radius.full,
    backgroundColor: Colors.bg3,
  },
  iconText: { fontSize: 18 },

  input: {
    flex:              1,
    minHeight:         40,
    maxHeight:         120,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: Spacing.sm,
    paddingTop:        10,
    paddingBottom:     10,
    color:             Colors.text,
    fontSize:          FontSizes.sm,
  },

  sendBtn: {
    width:           40,
    height:          40,
    borderRadius:    Radius.full,
    backgroundColor: Colors.accent,
    justifyContent:  'center',
    alignItems:      'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.bg3,
  },
  sendIcon: {
    fontSize:   18,
    color:      Colors.white,
    fontWeight: '700',
  },
});
