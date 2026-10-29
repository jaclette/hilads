<?php

declare(strict_types=1);

/**
 * App-wide switches (V3-04), all off or empty by default:
 *   CHALLENGE_CREATION_CLOSED  "1" when 1.8.0 ships: user challenge creation
 *                              becomes read-only (SPEC 9.10). Environment.
 *   Minimum / latest version   per platform, set in Admin › App versions
 *                              (app_settings), else APP_MIN_VERSION /
 *                              APP_LATEST_VERSION from the environment. Below
 *                              latest the app shows "Update available", below
 *                              minimum a blocking "Update required".
 *   Block old apps             Admin › App versions: the apps from before the
 *                              update screen (no X-App-Version, up to 1.7.1)
 *                              get 426 on every call, and their accounts are
 *                              kept in old_app_seen for an "Old app versions" push.
 *   Dual photo                 Admin › App versions: the Daily camera with the
 *                              selfie (off: the previous capture).
 * The app sends X-Platform and X-App-Version from 1.8.0 and reads GET /api/v1/app/config.
 */
final class AppConfig
{
    public const STORE_URLS = [
        'ios'     => 'https://apps.apple.com/app/id6768905591',
        'android' => 'https://play.google.com/store/apps/details?id=com.hilads.app',
    ];

    /** Shown as is by older apps on a blocked create call: keep it a plain sentence. */
    public const CHALLENGE_CLOSED_MESSAGE =
        'Creating challenges is no longer available in this version. Update Hilads to get the Daily Challenge.';

    public static function challengeCreationClosed(): bool
    {
        return in_array(strtolower(trim((string) getenv('CHALLENGE_CREATION_CLOSED'))), ['1', 'true', 'on', 'yes'], true);
    }

    /** A "major.minor.patch" version from the environment, else null. */
    public static function version(string $env): ?string
    {
        return self::parseVersion(getenv($env) ?: null);
    }

    /** "1.8" or "1.8.0" → "1.8.0"; anything else → null. */
    public static function parseVersion(?string $v): ?string
    {
        $v = trim((string) $v);
        if (!preg_match('/^(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?$/', $v, $m)) {
            return null;
        }
        return (int) $m[1] . '.' . (int) $m[2] . '.' . (int) ($m[3] ?? 0);
    }

    /** Is $version older than $than? Both "x.y.z". */
    public static function isOlder(string $version, string $than): bool
    {
        return version_compare($version, $than, '<');
    }

    // ── Settings (Admin › App versions) ──────────────────────────────────────

    public const PLATFORMS = ['ios', 'android'];
    public const SETTING_KEYS = ['ios_min_version', 'ios_latest_version', 'android_min_version',
                                 'android_latest_version', 'block_old_apps'];
    private const SETTINGS_CACHE = 'app_settings_v1';

    private static ?array $settings = null;

    /** The app_settings rows as key => value (cached 60 s; empty before the migration or without a DB). */
    public static function settings(): array
    {
        if (self::$settings !== null) {
            return self::$settings;
        }
        try {
            $rows = Cache::remember(self::SETTINGS_CACHE, 60, static function (): array {
                $out = [];
                foreach (Database::pdo()->query("SELECT key, value FROM app_settings")->fetchAll(\PDO::FETCH_ASSOC) as $r) {
                    $out[$r['key']] = (string) $r['value'];
                }
                return $out;
            });
        } catch (\Throwable $e) {
            $rows = [];
        }
        return self::$settings = $rows ?? [];
    }

    /** Tests: use these settings instead of the database (null = read it again). */
    public static function setSettings(?array $settings): void
    {
        self::$settings = $settings;
    }

    /** Save the back office form. Versions must be "x.y.z" (or empty = environment fallback). */
    public static function saveSettings(array $in, string $by): void
    {
        $values = [];
        foreach (self::PLATFORMS as $p) {
            foreach (['min', 'latest'] as $kind) {
                $key = "{$p}_{$kind}_version";
                $raw = trim((string) ($in[$key] ?? ''));
                $v   = self::parseVersion($raw);
                if ($raw !== '' && $v === null) {
                    throw new InvalidArgumentException("\"{$raw}\" is not a version (use 1.8.1).");
                }
                $values[$key] = $v ?? '';
            }
        }
        $values['block_old_apps'] = !empty($in['block_old_apps']) ? '1' : '0';
        $values['dual_photo']     = !empty($in['dual_photo']) ? '1' : '0';
        $stmt = Database::pdo()->prepare("
            INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, now(), ?)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
        ");
        foreach ($values as $k => $v) {
            $stmt->execute([$k, $v, $by]);
        }
        self::forgetSettings();
    }

    /** After a write to app_settings: the next read goes to the database. */
    public static function forgetSettings(): void
    {
        Cache::forget(self::SETTINGS_CACHE);
        self::$settings = null;
    }

    /**
     * A platform's minimum ('min') or latest ('latest') version: the back
     * office's, else the environment's. An unknown platform gets the higher
     * of the two (never less strict than either).
     */
    public static function platformVersion(string $kind, ?string $platform): ?string
    {
        if (!in_array($platform, self::PLATFORMS, true)) {
            $all = array_filter(array_map(fn(string $p) => self::platformVersion($kind, $p), self::PLATFORMS));
            usort($all, 'version_compare');
            return $all === [] ? null : end($all);
        }
        return self::parseVersion(self::settings()["{$platform}_{$kind}_version"] ?? null)
            ?? self::version($kind === 'min' ? 'APP_MIN_VERSION' : 'APP_LATEST_VERSION');
    }

    public static function blockOldApps(): bool
    {
        return (self::settings()['block_old_apps'] ?? '0') === '1';
    }

    /**
     * Dual photo (docs/dual-photo-audit.md): the Daily camera with the selfie.
     * Off by default: the apps keep the previous capture (the system camera
     * on iOS). Dual photos already posted show everywhere either way.
     */
    public static function dualPhoto(): bool
    {
        return (self::settings()['dual_photo'] ?? '0') === '1';
    }

    // ── Old apps (up to 1.7.1: no update screen, no X-App-Version) ────────────

    /** The store name in a sentence, per locale (with its article where the language needs one). */
    private const STORE_NAMES = [
        'en' => ['ios' => 'the App Store', 'android' => 'Google Play'],
        'fr' => ['ios' => "l'App Store", 'android' => 'Google Play'],
        'de' => ['ios' => 'den App Store', 'android' => 'Google Play'],
        'nl' => ['ios' => 'de App Store', 'android' => 'Google Play'],
    ];

    /** The 426 message, shown as is by the old apps where they show a server error. */
    public const UPDATE_MESSAGES = [
        'en'      => 'A new version of Hilads is here. Update the app from {store} to keep using it.',
        'fr'      => "Une nouvelle version de Hilads est là. Mets à jour l'app sur {store} pour continuer.",
        'vi'      => 'Hilads đã có phiên bản mới. Cập nhật ứng dụng trên {store} để tiếp tục sử dụng.',
        'es'      => 'Hay una nueva versión de Hilads. Actualiza la app en {store} para seguir usándola.',
        'it'      => "È arrivata una nuova versione di Hilads. Aggiorna l'app su {store} per continuare a usarla.",
        'pt-br'   => 'Chegou uma nova versão do Hilads. Atualize o app na {store} para continuar usando.',
        'pt-pt'   => 'Há uma nova versão do Hilads. Atualiza a app na {store} para continuares a usá-la.',
        'de'      => 'Es gibt eine neue Version von Hilads. Aktualisiere die App über {store}, um sie weiter zu nutzen.',
        'nl'      => 'Er is een nieuwe versie van Hilads. Werk de app bij via {store} om hem te blijven gebruiken.',
        'zh-hans' => 'Hilads 有新版本了。请前往 {store} 更新应用后继续使用。',
        'zh-hant' => 'Hilads 有新版本了。請前往 {store} 更新 App 後繼續使用。',
        'ja'      => 'Hilads の新しいバージョンが出ました。引き続き使うには {store} でアプリをアップデートしてください。',
        'ko'      => 'Hilads 새 버전이 나왔어요. 계속 사용하려면 {store}에서 앱을 업데이트해 주세요.',
        'fil'     => 'May bagong bersyon ng Hilads. I-update ang app sa {store} para patuloy itong magamit.',
        'th'      => 'Hilads มีเวอร์ชันใหม่แล้ว อัปเดตแอปใน {store} เพื่อใช้งานต่อ',
        'id'      => 'Versi baru Hilads sudah hadir. Perbarui aplikasinya di {store} untuk terus menggunakannya.',
        'hi'      => 'Hilads का नया वर्ज़न आ गया है। इस्तेमाल जारी रखने के लिए {store} से ऐप अपडेट करें।',
        'ru'      => 'Вышла новая версия Hilads. Обнови приложение в {store}, чтобы продолжить.',
        'ar'      => 'يتوفر إصدار جديد من Hilads. حدّث التطبيق من {store} لمتابعة استخدامه.',
    ];

    public static function updateMessage(string $locale, string $platform): string
    {
        $locale = DailyI18n::normalize($locale);
        $store  = (self::STORE_NAMES[$locale] ?? [])[$platform]
            ?? ($platform === 'android' ? 'Google Play' : 'App Store');
        return str_replace('{store}', $store, self::UPDATE_MESSAGES[$locale] ?? self::UPDATE_MESSAGES['en']);
    }

    /**
     * An app from before the update screen: it says it is the iOS or Android
     * app (X-Platform, since June 2026) but sends no X-App-Version (since
     * 1.8.0). The web never sends ios/android, and a 1.8.0+ app always sends
     * its version, so neither can match. Calls without X-Platform (crawlers,
     * Vercel functions, the app's own uploads) never match either.
     */
    public static function isOldApp(): bool
    {
        $platform = Request::platform();
        return in_array($platform, self::PLATFORMS, true)
            && trim((string) ($_SERVER['HTTP_X_APP_VERSION'] ?? '')) === '';
    }

    /**
     * Before routing: with "Block old apps" on, an old app's API call gets 426
     * and a message in its language, and its account (or guest) is kept for
     * the "Old app versions" push. GET /app/config is never blocked. A 1.8.0+
     * app below the minimum is never blocked here: its own "Update required"
     * screen handles it (and only mounts once its calls work).
     */
    public static function guardOldApp(string $uri): void
    {
        if (!str_starts_with($uri, '/api/v1/') || $uri === '/api/v1/app/config' || !self::isOldApp() || !self::blockOldApps()) {
            return;
        }
        $platform = Request::platform();
        $locale   = self::rememberOldApp($platform);
        header('Cache-Control: no-store');
        Response::json([
            'error'    => self::updateMessage($locale, $platform),
            'code'     => 'update_required',
            'storeUrl' => self::STORE_URLS[$platform],
        ], 426);
    }

    /**
     * Keep the account or guest behind an old app's call in old_app_seen (once
     * an hour per device, so polling costs one cache read), and return its
     * locale (users.locale, else the device's Accept-Language). Never throws.
     */
    private static function rememberOldApp(string $platform): string
    {
        $header = DailyI18n::normalize(explode(',', (string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? ''))[0]);
        $token  = (string) ($_COOKIE['hilads_token'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? '');
        $guest  = self::requestGuestId();
        if ($token === '' && $guest === null) {
            return $header;
        }
        $key = 'old_app_' . sha1($token . '|' . $guest);
        try {
            $hit = Cache::get($key);
            if ($hit !== null) {
                return (string) $hit['locale'];
            }
            $user   = $token !== '' ? AuthService::currentUser() : null;
            $locale = isset($user['locale']) ? DailyI18n::normalize($user['locale']) : $header;
            if ($user !== null || $guest !== null) {
                Database::pdo()->prepare("
                    INSERT INTO old_app_seen (id, user_id, guest_id, platform, seen_at)
                    VALUES (?, ?, ?, ?, now())
                    ON CONFLICT (id) DO UPDATE SET seen_at = now(), platform = EXCLUDED.platform
                ")->execute([$user !== null ? 'user:' . $user['id'] : 'guest:' . $guest,
                             $user['id'] ?? null, $user === null ? $guest : null, $platform]);
            }
            Cache::set($key, ['locale' => $locale], 3600);
            return $locale;
        } catch (\Throwable $e) {
            error_log('[old-app] remember failed: ' . $e->getMessage());
            return $header;
        }
    }

    /** The guest id an old app sends: ?guestId=, X-Guest-Id or a JSON body's guestId. */
    private static function requestGuestId(): ?string
    {
        $id = $_GET['guestId'] ?? $_SERVER['HTTP_X_GUEST_ID'] ?? null;
        if ($id === null && str_contains((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'json')) {
            $body = json_decode((string) file_get_contents('php://input'), true);
            $id   = is_array($body) ? ($body['guestId'] ?? null) : null;
        }
        return is_string($id) && preg_match('/^[a-f0-9]{32}$/', $id) ? $id : null;
    }

    /** GET /app/config payload, for the caller's platform (X-Platform). */
    public static function payload(?string $platform = null): array
    {
        return [
            'minVersion'              => self::platformVersion('min', $platform),
            'latestVersion'           => self::platformVersion('latest', $platform),
            'storeUrls'               => self::STORE_URLS,
            'challengeCreationClosed' => self::challengeCreationClosed(),
            'dualPhoto'               => self::dualPhoto(),
        ];
    }
}
