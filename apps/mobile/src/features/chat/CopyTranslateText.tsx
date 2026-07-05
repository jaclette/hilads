import React, { useState } from 'react';
import { Text, type TextStyle, type StyleProp } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MessageActionSheet } from './MessageActionSheet';

interface Props {
  value:          string;
  style?:         StyleProp<TextStyle>;
  numberOfLines?: number;
}

/**
 * A title / label that opens a Copy + Translate sheet on tap or long-press.
 * Reuses MessageActionSheet with the emoji strip + reply omitted (no onReact),
 * so it shows only Copy + Translate. Used for the Hi now / Hi plan / Challenge
 * detail titles so they can be copied or sent to Google Translate.
 */
export function CopyTranslateText({ value, style, numberOfLines }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Text
        style={style}
        numberOfLines={numberOfLines}
        onPress={() => setOpen(true)}
        onLongPress={() => setOpen(true)}
        suppressHighlighting
      >
        {value}
      </Text>
      <MessageActionSheet
        visible={open}
        onClose={() => setOpen(false)}
        onCopy={() => { Clipboard.setStringAsync(value).catch(() => {}); }}
        translateText={value}
      />
    </>
  );
}
