import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors, FontSizes, Spacing } from '@/constants';

interface Props {
  error: string | null;
}

export function BootScreen({ error }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>Hilads</Text>
      {error ? (
        <>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorHint}>Check your connection and restart the app.</Text>
        </>
      ) : (
        <ActivityIndicator color={Colors.accent} size="large" style={styles.spinner} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: Colors.bg,
    alignItems:      'center',
    justifyContent:  'center',
    padding:         Spacing.xl,
  },
  logo: {
    fontSize:    40,
    fontWeight:  '800',
    color:       Colors.accent,
    letterSpacing: -1,
    marginBottom: Spacing.xl,
  },
  spinner:   { marginTop: Spacing.md },
  errorText: {
    fontSize:   FontSizes.md,
    color:      Colors.red,
    textAlign:  'center',
    marginTop:  Spacing.md,
  },
  errorHint: {
    fontSize:  FontSizes.sm,
    color:     Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
});
