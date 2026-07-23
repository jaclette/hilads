/**
 * Internal debug panel - only shown in dev builds or via secret gesture.
 * Shows app state, connection info, and quick-action buttons.
 */
import { View, Text, TouchableOpacity, ScrollView, Alert, StyleSheet } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { clearIdentity } from '@/lib/identity';
import { clearToken } from '@/services/session';
import { FontSizes, Spacing, Radius, API_URL, WS_URL, APP_VERSION, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

// ── Row ───────────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
    </View>
  );
}

// ── Action button ─────────────────────────────────────────────────────────────

function Action({ title, onPress, danger }: { title: string; onPress: () => void; danger?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={[styles.action, danger && styles.actionDanger]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.actionText, danger && styles.actionTextDanger]}>{title}</Text>
    </TouchableOpacity>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function DebugPanel() {
  const styles = useThemedStyles(makeStyles);

  const { identity, sessionId, account, city, wsConnected, logout } = useApp();

  function handleForceReconnect() {
    socket.reconnectNow();
  }

  function handleClearSession() {
    Alert.alert(
      'Clear session',
      'This will sign out and reset your guest identity. The app will need to be restarted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await logout();
            await clearIdentity();
            await clearToken();
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>App</Text>
      <View style={styles.card}>
        <Row label="Version"     value={APP_VERSION} />
        <Row label="API"         value={API_URL} />
        <Row label="WS"          value={WS_URL} />
        <Row label="WS status"   value={wsConnected ? 'Connected' : 'Disconnected'} />
      </View>

      <Text style={styles.heading}>Identity</Text>
      <View style={styles.card}>
        <Row label="Guest ID"    value={identity?.guestId  ?? '-'} />
        <Row label="Nickname"    value={identity?.nickname ?? '-'} />
        <Row label="Session ID"  value={sessionId ?? '-'} />
        <Row label="Account"     value={account ? `${account.display_name} (${account.id})` : 'Guest'} />
      </View>

      <Text style={styles.heading}>Location</Text>
      <View style={styles.card}>
        <Row label="City"        value={city?.name ?? 'Not detected'} />
        <Row label="Channel ID"  value={city?.channelId ?? '-'} />
      </View>

      <Text style={styles.heading}>Actions</Text>
      <View style={styles.actions}>
        <Action title="Force WS reconnect"  onPress={handleForceReconnect} />
        <Action title="Clear session + identity" onPress={handleClearSession} danger />
        {/* TEMPORARY - remove after confirming events appear in hilads-mobile Sentry project */}
        <Action
          title="Send Sentry test event"
          onPress={() => {
            Sentry.captureMessage('Hilads mobile Sentry test - OK');
            Alert.alert('Sentry', 'Test event sent - check hilads-mobile on sentry.io');
          }}
        />
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  content:   { padding: Spacing.md, gap: Spacing.sm },

  heading: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         c.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop:     Spacing.sm,
    marginBottom:  2,
  },

  card: {
    backgroundColor: c.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     c.border,
    overflow:        'hidden',
  },
  row: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   10,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  label: { fontSize: FontSizes.sm, color: c.muted, flexShrink: 0 },
  value: { fontSize: FontSizes.xs, color: c.text, flex: 1, textAlign: 'right', marginLeft: Spacing.sm },

  actions: { gap: Spacing.sm },
  action: {
    backgroundColor: c.bg3,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     c.border,
    paddingVertical: Spacing.sm,
    alignItems:      'center',
  },
  actionDanger: {
    borderColor:     'rgba(248,113,113,0.4)',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  actionText:       { fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  actionTextDanger: { color: c.red },
});
