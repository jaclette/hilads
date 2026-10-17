import { useState, type ReactNode } from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/**
 * Text input. "search": a pill with a search icon and a clear button (map).
 * "field": a labelled form field, primary border on focus, error line below;
 * `prefix` sits before the text ("@"), `right` after it (password eye, status).
 */
export function TextField({ variant = 'field', label, error, onClear, clearLabel, prefix, right, ...input }: TextInputProps & {
  variant?: 'field' | 'search';
  label?: string;
  error?: string | null;
  onClear?: () => void;
  clearLabel?: string;
  prefix?: string;
  right?: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  if (variant === 'search') {
    return (
      <View style={styles.search}>
        <Ionicons name="search-outline" size={20} color={colors.muted} />
        <TextInput style={styles.searchInput} placeholderTextColor={colors.muted} {...input} />
        {!!input.value && onClear && (
          <TouchableOpacity onPress={onClear} hitSlop={10} accessibilityRole="button" accessibilityLabel={clearLabel}>
            <Ionicons name="close-circle" size={20} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>
    );
  }
  return (
    <View style={styles.fieldWrap}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.field, input.multiline && styles.multiline, focused && styles.focused, !!error && styles.errorBorder]}>
        {!!prefix && <Text style={styles.prefix}>{prefix}</Text>}
        <TextInput
          style={[styles.input, input.multiline && styles.inputMultiline]}
          placeholderTextColor={colors.mutedDim}
          accessibilityLabel={input.accessibilityLabel ?? label}
          {...input}
          onFocus={e => { setFocused(true); input.onFocus?.(e); }}
          onBlur={e => { setFocused(false); input.onBlur?.(e); }}
        />
        {right}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  search:      { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 16, borderRadius: Radius.full,
                 borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '500', color: c.text, paddingVertical: 0 },
  fieldWrap:   { gap: 6 },
  label:       { fontSize: FontSizes.xs, fontWeight: '700', color: c.muted },
  field:       { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 14, borderRadius: Radius.button,
                 borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  multiline:   { minHeight: 96, alignItems: 'flex-start' },
  prefix:      { fontSize: FontSizes.md, fontWeight: '600', color: c.muted },
  input:       { flex: 1, minHeight: 46, paddingVertical: 12, fontSize: FontSizes.md, fontWeight: '400', color: c.text },
  inputMultiline: { textAlignVertical: 'top' },
  focused:     { borderColor: c.primary },
  errorBorder: { borderColor: c.red },
  error:       { fontSize: FontSizes.xs, fontWeight: '600', color: c.red },
});
