// EAS build hook (eas-build-pre-install): refuse an iOS build on Xcode 27+.
// Expo SDK 53 has no UIScene support, and an app built with the iOS 27 SDK that hasn't adopted
// the scene life cycle is killed at launch on iOS 27 (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption):
// 2.0.3 (150) and 2.0.5 (154) were both rejected by App Review for it. eas.json pins the cloud
// image to Xcode 26.6, but `eas build --local` uses the Mac's own Xcode: point it at 26.x
// (DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer) or build in the cloud.
// Lift this once on Expo SDK 57+ with ios.enableSceneSupport.
const { execSync } = require('child_process');

if (process.env.EAS_BUILD_PLATFORM === 'ios' && process.platform === 'darwin') {
  let out = '';
  try { out = execSync('xcodebuild -version', { encoding: 'utf8' }); } catch { process.exit(0); }
  const major = Number((out.match(/Xcode (\d+)/) || [])[1]);
  if (major >= 27 && process.env.HILADS_ALLOW_XCODE27 !== '1') {
    console.error(`\n✖ iOS build on ${out.split('\n')[0]}: SDK 53 apps built with Xcode 27 crash at launch on iOS 27 (no UIScene).`);
    console.error('  Build in the cloud (eas build -p ios --profile production) or locally with Xcode 26.x:');
    console.error('  DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer eas build -p ios --local --profile production\n');
    process.exit(1);
  }
  console.log(`✓ ${out.split('\n')[0]}`);
}
