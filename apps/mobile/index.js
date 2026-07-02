// Custom entry: install global responsive scaling BEFORE expo-router loads any
// screens, so the StyleSheet.create patch in ./src/scaling is in place before the
// first component registers its styles. Then hand off to the normal Expo Router
// entry. (package.json "main" points here.)
import './src/scaling';
import 'expo-router/entry';
