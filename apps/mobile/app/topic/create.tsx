import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { createTopic } from '@/api/topics';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

type TopicCategory = 'general' | 'tips' | 'food' | 'drinks' | 'help' | 'meetup';

const CATEGORIES: { value: TopicCategory; label: string; icon: string }[] = [
  { value: 'general', label: 'General',  icon: '💬' },
  { value: 'tips',    label: 'Tips',     icon: '💡' },
  { value: 'food',    label: 'Food',     icon: '🍴' },
  { value: 'drinks',  label: 'Drinks',   icon: '🍺' },
  { value: 'help',    label: 'Help',     icon: '🙋' },
  { value: 'meetup',  label: 'Meet up',  icon: '👋' },
];

export default function CreateTopicScreen() {
  const router   = useRouter();
  const { city, identity } = useApp();

  const [category,    setCategory]    = useState<TopicCategory>('general');
  const [title,       setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  async function handleSubmit() {
    const t = title.trim();
    if (!t || !city || !identity) return;
    setSubmitting(true);
    setError(null);
    try {
      await createTopic(city.channelId, identity.guestId, t, description.trim() || null, category);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start conversation');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Start a conversation</Text>
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">

        {/* Category chips */}
        <Text style={styles.sectionLabel}>Category</Text>
        <View style={styles.categoryGrid}>
          {CATEGORIES.map(cat => {
            const selected = category === cat.value;
            return (
              <TouchableOpacity
                key={cat.value}
                style={[styles.catChip, selected && styles.catChipSelected]}
                activeOpacity={0.7}
                onPress={() => setCategory(cat.value)}
              >
                <Text style={styles.catIcon}>{cat.icon}</Text>
                <Text style={[styles.catLabel, selected && styles.catLabelSelected]}>{cat.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Title */}
        <Text style={styles.sectionLabel}>What's on your mind?</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Best coffee spot in the area?"
          placeholderTextColor={Colors.muted2}
          maxLength={100}
          autoFocus
          returnKeyType="next"
        />

        {/* Description */}
        <Text style={styles.sectionLabel}>
          Add details{'  '}
          <Text style={styles.optional}>(optional)</Text>
        </Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder="Give it some context…"
          placeholderTextColor={Colors.muted2}
          maxLength={300}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />

        {/* Expiry note */}
        <Text style={styles.expiryNote}>⏱ Auto-expires in 24 h</Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, (!title.trim() || submitting) && styles.submitBtnDisabled]}
          activeOpacity={0.85}
          onPress={handleSubmit}
          disabled={!title.trim() || submitting}
        >
          {submitting
            ? <ActivityIndicator color={Colors.white} size="small" />
            : <Text style={styles.submitBtnText}>Start conversation 💬</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minHeight:         56,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
    zIndex:          1,
  },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  headerTitle:  { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },

  body:        { flex: 1 },
  bodyContent: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xl * 2 },

  sectionLabel: {
    fontSize:     FontSizes.xs,
    fontWeight:   '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color:         Colors.muted,
    marginTop:     Spacing.md,
    marginBottom:  Spacing.xs,
  },
  optional: { fontWeight: '400', textTransform: 'none', letterSpacing: 0 },

  categoryGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           Spacing.sm,
  },
  catChip: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             8,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    backgroundColor: Colors.bg2,
  },
  catChipSelected: {
    borderColor:     '#60a5fa',
    backgroundColor: 'rgba(96,165,250,0.10)',
  },
  catIcon:  { fontSize: 20 },
  catLabel: { fontSize: FontSizes.sm, fontWeight: '600', color: Colors.muted },
  catLabelSelected: { color: '#60a5fa' },

  input: {
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    borderRadius:    Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 4,
    fontSize:        FontSizes.md,
    color:           Colors.text,
  },
  textArea: { minHeight: 90, paddingTop: Spacing.sm + 4 },

  expiryNote: {
    fontSize:  FontSizes.sm,
    color:     Colors.muted2,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },

  errorText: {
    fontSize:  FontSizes.sm,
    color:     Colors.red,
    textAlign: 'center',
  },

  submitBtn: {
    marginTop:       Spacing.md,
    backgroundColor: '#60a5fa',
    borderRadius:    Radius.full,
    paddingVertical: Spacing.md + 2,
    alignItems:      'center',
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: {
    color:      Colors.white,
    fontWeight: '700',
    fontSize:   FontSizes.md,
  },
});
