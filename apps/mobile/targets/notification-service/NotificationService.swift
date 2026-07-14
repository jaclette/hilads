import UserNotifications

/// Downloads and attaches a push image so iOS shows a rich notification.
///
/// Triggered only when the push carries `mutable-content: 1` (the backend sets
/// this whenever a campaign image is attached). Expo delivers the push `data`
/// under `userInfo["body"]` (a dict or a JSON string), so we look for the image
/// URL in several likely places for robustness.
///
/// The class name MUST stay `NotificationService` to match the generated
/// Info.plist's `NSExtensionPrincipalClass` ($(PRODUCT_MODULE_NAME).NotificationService).
class NotificationService: UNNotificationServiceExtension {

    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        self.bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent

        guard let bestAttemptContent = bestAttemptContent else {
            contentHandler(request.content)
            return
        }

        guard
            let urlString = Self.extractImageURL(from: request.content.userInfo),
            let url = URL(string: urlString)
        else {
            contentHandler(bestAttemptContent)
            return
        }

        Self.downloadAttachment(url: url) { attachment in
            if let attachment = attachment {
                bestAttemptContent.attachments = [attachment]
            }
            contentHandler(bestAttemptContent)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        // Called just before the extension is terminated - deliver whatever we have.
        if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }

    // MARK: - Helpers

    /// Find the image URL in the push payload. Expo nests the custom `data` under
    /// `userInfo["body"]`, which can be a dictionary or a JSON string.
    private static func extractImageURL(from userInfo: [AnyHashable: Any]) -> String? {
        func fromDict(_ dict: [String: Any]) -> String? {
            if let s = dict["imageUrl"] as? String, !s.isEmpty { return s }
            if let rc = dict["richContent"] as? [String: Any],
               let s = rc["image"] as? String, !s.isEmpty { return s }
            return nil
        }

        // 1. Top-level keys.
        if let s = userInfo["imageUrl"] as? String, !s.isEmpty { return s }
        if let rc = userInfo["richContent"] as? [String: Any],
           let s = rc["image"] as? String, !s.isEmpty { return s }

        // 2. Expo `body` as a dictionary.
        if let body = userInfo["body"] as? [String: Any], let s = fromDict(body) { return s }

        // 3. Expo `body` as a JSON string.
        if let bodyStr = userInfo["body"] as? String,
           let data = bodyStr.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let s = fromDict(obj) {
            return s
        }

        return nil
    }

    private static func downloadAttachment(
        url: URL,
        completion: @escaping (UNNotificationAttachment?) -> Void
    ) {
        URLSession.shared.downloadTask(with: url) { downloadedURL, _, _ in
            guard let downloadedURL = downloadedURL else {
                completion(nil)
                return
            }
            let fileManager = FileManager.default
            var ext = url.pathExtension
            if ext.isEmpty { ext = "jpg" }
            let localURL = fileManager.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(ext)
            do {
                try fileManager.moveItem(at: downloadedURL, to: localURL)
                let attachment = try UNNotificationAttachment(
                    identifier: "campaign-image",
                    url: localURL,
                    options: nil
                )
                completion(attachment)
            } catch {
                completion(nil)
            }
        }.resume()
    }
}
