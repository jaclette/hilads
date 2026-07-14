/**
 * iOS Notification Service Extension target (via @bacons/apple-targets).
 *
 * Enables rich push notifications on iOS: when a push arrives with
 * `mutable-content: 1` (the backend sets this whenever a campaign image is
 * attached), this extension downloads the image and attaches it so the
 * notification shows the picture - the iOS equivalent of Android's big-picture.
 *
 * @bacons/apple-targets generates the correct Info.plist + entitlements for the
 * `notification-service` type and wires the target into the Xcode project during
 * `expo prebuild`. The Swift class MUST be named `NotificationService` to match
 * the generated NSExtensionPrincipalClass.
 */
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'notification-service',
  name: 'NotificationService',
  // Keep <= the app's iOS deployment target.
  deploymentTarget: '15.1',
};
