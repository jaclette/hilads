// EAS build hook (eas-build-pre-install): Expo SDK 58 supports only even (LTS) Node releases.
// An odd release (the Mac's default Node 25) fails later in confusing ways: stop here instead.
// Use Node 24: PATH=/opt/homebrew/opt/node@24/bin:$PATH eas build ...
const major = Number(process.versions.node.split('.')[0]);
if (major % 2 === 1 || major < 20) {
  console.error(`\n✖ Node ${process.versions.node}: Expo SDK 58 needs an even Node release (24 recommended).`);
  console.error('  PATH=/opt/homebrew/opt/node@24/bin:$PATH eas build -p ios --profile production --local\n');
  process.exit(1);
}
console.log(`✓ Node ${process.versions.node}`);
