<?php

declare(strict_types=1);

class AuthService
{
    /** Request-level cache — avoids a duplicate DB query when currentUser() is called
     *  more than once within the same request (e.g. join handler + analytics block). */
    private static bool  $resolved = false;
    private static ?array $cached  = null;

    public const ALLOWED_INTERESTS = [
        'drinks', 'party', 'nightlife', 'music', 'live music', 'culture', 'art',
        'food', 'coffee', 'sport', 'fitness', 'hiking', 'beach', 'wellness',
        'travel', 'hangout', 'socializing', 'language exchange', 'dating',
        'networking', 'startup', 'tech', 'gaming',
    ];

    // ── Signup ────────────────────────────────────────────────────────────────

    public static function signup(
        string $email,
        string $password,
        string $displayName,
        ?string $guestId = null,
        ?string $mode = null
    ): array {
        $email       = strtolower(trim($email));
        $displayName = mb_substr(trim(strip_tags($displayName)), 0, 30);

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Response::json(['error' => 'Invalid email address'], 422);
        }

        if (mb_strlen($password) < 8) {
            Response::json(['error' => 'Password must be at least 8 characters'], 422);
        }

        if (mb_strlen($password) > 72) {
            Response::json(['error' => 'Password must not exceed 72 characters'], 422);
        }

        if ($displayName === '') {
            Response::json(['error' => 'Display name is required'], 422);
        }

        $allowedModes = ['local', 'exploring'];
        if ($mode !== null && !in_array($mode, $allowedModes, true)) {
            Response::json(['error' => 'Invalid mode'], 422);
        }

        if (UserRepository::findByEmail($email) !== null) {
            Response::json(['error' => 'An account with this email already exists'], 409);
        }

        try {
            $user = UserRepository::create([
                'email'         => $email,
                'password_hash' => password_hash($password, PASSWORD_BCRYPT),
                'display_name'  => $displayName,
                'guest_id'      => $guestId,
                'mode'          => $mode ?? 'exploring',
            ]);
        } catch (\RuntimeException $e) {
            if ($e->getMessage() === 'email_already_exists') {
                // Race condition: two signups with same email both passed findByEmail check
                Response::json(['error' => 'An account with this email already exists'], 409);
            }
            throw $e;
        }

        $token = self::createDbSession($user['id']);
        $user['_token'] = $token; // exposed in response body for mobile clients

        return $user;
    }

    // ── Login ─────────────────────────────────────────────────────────────────

    public static function login(string $email, string $password): array
    {
        $email = strtolower(trim($email));
        $user  = UserRepository::findByEmail($email);

        if ($user === null || !empty($user['deleted_at']) || empty($user['password_hash']) || !password_verify($password, $user['password_hash'])) {
            Response::json(['error' => 'Invalid email or password'], 401);
        }

        $token = self::createDbSession($user['id']);
        $user['_token'] = $token; // exposed in response body for mobile clients

        return $user;
    }

    // ── Session helpers ───────────────────────────────────────────────────────

    /**
     * Create a 30-day DB-backed session token and set it as an HttpOnly cookie.
     * Replaces PHP file sessions, which are lost on every container restart/deploy.
     */
    public static function createDbSession(string $userId): string
    {
        $token = bin2hex(random_bytes(32)); // 64-char hex token
        Database::pdo()->prepare("
            INSERT INTO user_sessions (id, user_id) VALUES (?, ?)
        ")->execute([$token, $userId]);

        setcookie('hilads_token', $token, [
            'expires'  => time() + 60 * 60 * 24 * 30,
            'path'     => '/',
            'secure'   => true,
            'httponly' => true,
            'samesite' => 'None',
        ]);

        return $token;
    }

    /**
     * Delete the current session token from the DB and clear the cookie.
     */
    public static function destroyDbSession(): void
    {
        $token = $_COOKIE['hilads_token'] ?? null;
        if ($token !== null && preg_match('/^[a-f0-9]{64}$/', $token)) {
            Database::pdo()->prepare("DELETE FROM user_sessions WHERE id = ?")
                ->execute([$token]);
        }
        setcookie('hilads_token', '', [
            'expires'  => time() - 3600,
            'path'     => '/',
            'secure'   => true,
            'httponly' => true,
            'samesite' => 'None',
        ]);
    }

    public static function currentUser(): ?array
    {
        // Request-level cache: the token never changes within a single HTTP request,
        // so a second call always returns the same result without a DB round-trip.
        if (self::$resolved) {
            return self::$cached;
        }
        self::$resolved = true;

        $token = $_COOKIE['hilads_token'] ?? null;

        // Mobile clients send the token as a Bearer header when cookies are unavailable
        if ($token === null) {
            $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
            if (str_starts_with($auth, 'Bearer ')) {
                $token = substr($auth, 7);
            }
        }

        if ($token === null || !preg_match('/^[a-f0-9]{64}$/', $token)) {
            self::$cached = null;
            return null;
        }

        // Single JOIN — resolves session + user + ambassador flag in one round-trip.
        // The EXISTS subquery adds ~0ms cost but eliminates the separate ambassador
        // check query in ownFields(), saving one full DB round-trip per /me call.
        $stmt = Database::pdo()->prepare("
            SELECT u.*,
                   EXISTS(
                       SELECT 1 FROM user_city_roles
                       WHERE user_id = u.id AND role = 'ambassador' LIMIT 1
                   ) AS _is_ambassador
            FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.id = ? AND s.expires_at > now() AND u.deleted_at IS NULL
        ");
        $stmt->execute([$token]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);

        self::$cached = $row ?: null;
        return self::$cached;
    }

    /** Returns the current user or sends a 401 and exits. */
    public static function requireAuth(): array
    {
        $user = self::currentUser();
        if ($user === null) {
            Response::json(['error' => 'Authentication required'], 401);
        }

        return $user;
    }

    // ── Password reset ────────────────────────────────────────────────────────

    /**
     * Initiate a password reset for the given email.
     * Always returns a generic message — never reveals whether the email exists.
     */
    public static function forgotPassword(string $email): void
    {
        $email = strtolower(trim($email));

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            // Return generic success to avoid leaking info
            return;
        }

        $user = UserRepository::findByEmail($email);
        if ($user === null || empty($user['password_hash'])) {
            // User not found or OAuth-only account — silent success
            return;
        }

        $pdo = Database::pdo();

        // Invalidate any unused tokens for this user
        $pdo->prepare("
            UPDATE password_reset_tokens
            SET used_at = now()
            WHERE user_id = ? AND used_at IS NULL
        ")->execute([$user['id']]);

        // Generate a cryptographically secure token
        $rawToken  = bin2hex(random_bytes(32)); // 64-char hex
        $tokenHash = hash('sha256', $rawToken);

        $pdo->prepare("
            INSERT INTO password_reset_tokens (user_id, token_hash)
            VALUES (?, ?)
        ")->execute([$user['id'], $tokenHash]);

        $resetUrl = rtrim(getenv('APP_URL') ?: 'https://hilads.live', '/')
                  . '/reset-password?token=' . $rawToken;

        self::sendResetEmail($user['email'], $user['display_name'], $resetUrl);
    }

    /**
     * Reset a user's password using a valid, unexpired, unused token.
     * Returns the user array on success, or calls Response::json with an error.
     */
    public static function resetPassword(string $rawToken, string $password): array
    {
        if (mb_strlen($password) < 8) {
            Response::json(['error' => 'Password must be at least 8 characters'], 422);
        }
        if (mb_strlen($password) > 72) {
            Response::json(['error' => 'Password must not exceed 72 characters'], 422);
        }

        $tokenHash = hash('sha256', $rawToken);
        $pdo       = Database::pdo();

        $stmt = $pdo->prepare("
            SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at
            FROM password_reset_tokens prt
            WHERE prt.token_hash = ?
            LIMIT 1
        ");
        $stmt->execute([$tokenHash]);
        $record = $stmt->fetch(\PDO::FETCH_ASSOC);

        if ($record === false) {
            Response::json(['error' => 'This reset link is invalid or expired.'], 400);
        }
        if ($record['used_at'] !== null) {
            Response::json(['error' => 'This reset link has already been used.'], 400);
        }
        if (strtotime($record['expires_at']) < time()) {
            Response::json(['error' => 'This reset link is invalid or expired.'], 400);
        }

        $userId       = $record['user_id'];
        $passwordHash = password_hash($password, PASSWORD_BCRYPT);

        // Update password and mark token as used in one transaction
        $pdo->beginTransaction();
        try {
            $pdo->prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
                ->execute([$passwordHash, time(), $userId]);

            $pdo->prepare("UPDATE password_reset_tokens SET used_at = now() WHERE id = ?")
                ->execute([$record['id']]);

            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        $user  = UserRepository::findById($userId);
        $token = self::createDbSession($userId);
        $user['_token'] = $token;

        return $user;
    }

    /**
     * Validate a reset token without consuming it.
     * Returns true if valid and unexpired, false otherwise.
     */
    public static function validateResetToken(string $rawToken): bool
    {
        $tokenHash = hash('sha256', $rawToken);
        $stmt      = Database::pdo()->prepare("
            SELECT 1 FROM password_reset_tokens
            WHERE token_hash = ? AND used_at IS NULL AND expires_at > now()
            LIMIT 1
        ");
        $stmt->execute([$tokenHash]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * Send the reset email via Resend.
     */
    private static function sendResetEmail(string $to, string $name, string $resetUrl): void
    {
        $apiKey = getenv('RESEND_API_KEY');
        if (!$apiKey) {
            error_log('[AuthService] RESEND_API_KEY not set — skipping reset email');
            return;
        }

        $firstName  = explode(' ', $name)[0];
        $htmlBody   = '<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0d0b09;color:#ede9e5;margin:0;padding:40px 20px">'
            . '<div style="max-width:480px;margin:0 auto">'
            . '<h2 style="color:#FF7A3C;margin-bottom:8px">Reset your Hilads password</h2>'
            . '<p>Hi ' . htmlspecialchars($firstName) . ',</p>'
            . '<p>Someone requested a password reset for your Hilads account.<br>'
            . 'If that was you, click the button below to choose a new password.</p>'
            . '<p style="margin:28px 0">'
            . '<a href="' . htmlspecialchars($resetUrl) . '" style="background:#FF7A3C;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:16px">Reset password</a>'
            . '</p>'
            . '<p style="color:#968880;font-size:14px">This link expires in <strong>1 hour</strong>.</p>'
            . '<p style="color:#968880;font-size:14px">If you didn\'t request this, you can safely ignore this email. Your password won\'t change.</p>'
            . '</div></body></html>';

        $textBody = "Reset your Hilads password\n\n"
            . "Hi $firstName,\n\n"
            . "Someone requested a password reset for your Hilads account.\n"
            . "If that was you, use the link below to choose a new password.\n\n"
            . "$resetUrl\n\n"
            . "This link expires in 1 hour.\n\n"
            . "If you didn't request this, you can safely ignore this email.";

        $payload = json_encode([
            'from'    => 'Hilads <no-reply@hilads.live>',
            'to'      => [$to],
            'subject' => 'Reset your Hilads password',
            'html'    => $htmlBody,
            'text'    => $textBody,
        ]);

        $ch = curl_init('https://api.resend.com/emails');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $apiKey,
                'Content-Type: application/json',
            ],
            CURLOPT_TIMEOUT        => 10,
        ]);
        $response = curl_exec($ch);
        $status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($status < 200 || $status >= 300) {
            error_log('[AuthService] Resend error ' . $status . ': ' . $response);
        }
    }

    // ── Profile field sanitisation ────────────────────────────────────────────

    /**
     * Validates and normalises profile fields from a raw request body.
     * Returns only the fields that are safe to pass to UserRepository::update().
     */
    public static function sanitiseProfileFields(array $body): array
    {
        $fields = [];
        $r2Base = rtrim(getenv('R2_PUBLIC_URL') ?: '', '/') . '/';

        if (array_key_exists('display_name', $body)) {
            $name = mb_substr(trim(strip_tags((string) ($body['display_name'] ?? ''))), 0, 30);
            if ($name === '') {
                Response::json(['error' => 'display_name must not be empty'], 422);
            }
            $fields['display_name'] = $name;
        }

        if (array_key_exists('birth_year', $body)) {
            $year    = $body['birth_year'];
            $minYear = (int) date('Y') - 100;
            $maxYear = (int) date('Y') - 18;

            if ($year !== null) {
                $year = filter_var($year, FILTER_VALIDATE_INT);
                if ($year === false || $year < $minYear || $year > $maxYear) {
                    Response::json(['error' => 'birth_year must be a valid year (users must be at least 18)'], 422);
                }
            }
            $fields['birth_year'] = $year;
        }

        if (array_key_exists('home_city', $body)) {
            $city = $body['home_city'];
            if ($city !== null) {
                $city = mb_substr(trim(strip_tags((string) $city)), 0, 60);
            }
            $fields['home_city'] = $city ?: null;
        }

        if (array_key_exists('profile_photo_url', $body)) {
            $url = $body['profile_photo_url'];
            if ($url !== null) {
                if (!is_string($url) || !str_starts_with($url, $r2Base)) {
                    Response::json(['error' => 'Invalid profile_photo_url'], 422);
                }
                $filename = basename(parse_url($url, PHP_URL_PATH) ?? '');
                if (!preg_match('/^[a-f0-9]{32}\.(jpg|png|webp)$/', $filename)) {
                    Response::json(['error' => 'Invalid profile_photo_url'], 422);
                }
            }
            $fields['profile_photo_url'] = $url;
        }

        if (array_key_exists('profile_thumb_photo_url', $body)) {
            $thumbUrl = $body['profile_thumb_photo_url'];
            if ($thumbUrl !== null) {
                if (!is_string($thumbUrl) || !str_starts_with($thumbUrl, $r2Base)) {
                    Response::json(['error' => 'Invalid profile_thumb_photo_url'], 422);
                }
                $thumbFilename = basename(parse_url($thumbUrl, PHP_URL_PATH) ?? '');
                if (!preg_match('/^thumb_[a-f0-9]{32}\.jpg$/', $thumbFilename)) {
                    Response::json(['error' => 'Invalid profile_thumb_photo_url'], 422);
                }
            }
            $fields['profile_thumb_photo_url'] = $thumbUrl;
        }

        if (array_key_exists('interests', $body)) {
            $raw = $body['interests'];
            if (!is_array($raw)) {
                Response::json(['error' => 'interests must be an array'], 422);
            }
            if (count($raw) > 10) {
                Response::json(['error' => 'You can select at most 10 interests'], 422);
            }
            foreach ($raw as $item) {
                if (!in_array($item, self::ALLOWED_INTERESTS, true)) {
                    Response::json(['error' => "Unknown interest: $item"], 422);
                }
            }
            $fields['interests'] = json_encode(array_values($raw));
        }

        if (array_key_exists('vibe', $body)) {
            $allowed = ['party', 'board_games', 'coffee', 'music', 'food', 'chill'];
            $vibe    = $body['vibe'];
            if (!in_array($vibe, $allowed, true)) {
                Response::json(['error' => 'Invalid vibe'], 422);
            }
            $fields['vibe'] = $vibe;
        }

        if (array_key_exists('mode', $body)) {
            $allowed = ['local', 'exploring'];
            $mode    = $body['mode'];
            if ($mode !== null && !in_array($mode, $allowed, true)) {
                Response::json(['error' => 'Invalid mode'], 422);
            }
            $fields['mode'] = $mode;
        }

        if (array_key_exists('about_me', $body)) {
            $bio = $body['about_me'];
            if ($bio !== null) {
                $bio = mb_substr(trim(strip_tags((string) $bio)), 0, 150);
                $bio = $bio === '' ? null : $bio;
            }
            $fields['about_me'] = $bio;
        }

        // ── Ambassador picks — editable only by ambassadors, but sanitised for all ──
        // The UI only shows these fields to ambassadors, so non-ambassador writes are harmless.
        $pickFields = [
            'ambassador_restaurant' => 200,
            'ambassador_spot'       => 200,
            'ambassador_tip'        => 300,
            'ambassador_story'      => 400,
        ];
        foreach ($pickFields as $key => $maxLen) {
            if (array_key_exists($key, $body)) {
                $val = $body[$key];
                if ($val !== null) {
                    $val = mb_substr(trim(strip_tags((string) $val)), 0, $maxLen);
                    $val = $val === '' ? null : $val;
                }
                $fields[$key] = $val;
            }
        }

        return $fields;
    }

    // ── Response shape helpers ────────────────────────────────────────────────

    /** Public profile — safe to return to anyone. */
    public static function publicFields(array $user): array
    {
        return [
            'id'                       => $user['id'],
            'display_name'             => $user['display_name'],
            'age'                      => self::computeAge($user['birth_year'] ?? null),
            'profile_photo_url'        => $user['profile_photo_url'],
            'profile_thumb_photo_url'  => $user['profile_thumb_photo_url'] ?? null,
            'home_city'                => $user['home_city'],
            'about_me'          => $user['about_me'] ?? null,
            'interests'         => json_decode($user['interests'] ?? '[]', true),
            'vibe'              => $user['vibe'] ?? 'chill',
            'mode'              => $user['mode'] ?? null,
            'primaryBadge'      => UserBadgeService::primaryForUser($user),
        ];
    }

    /** Own profile — includes email, guest_id, and ambassador state. Never includes password_hash or google_id. */
    public static function ownFields(array $user): array
    {
        // Use the ambassador flag pre-fetched by currentUser() to avoid a second query.
        // Falls back to a direct DB check when $user comes from a path that did not
        // go through currentUser() (e.g. admin tooling).
        if (array_key_exists('_is_ambassador', $user)) {
            $isAmbassador = (bool) $user['_is_ambassador'];
        } else {
            $stmt = Database::pdo()->prepare(
                "SELECT 1 FROM user_city_roles WHERE user_id = ? AND role = 'ambassador' LIMIT 1"
            );
            $stmt->execute([$user['id']]);
            $isAmbassador = (bool) $stmt->fetchColumn();
        }

        $picks = null;
        if ($isAmbassador) {
            $picks = array_filter([
                'restaurant' => $user['ambassador_restaurant'] ?? null,
                'spot'       => $user['ambassador_spot']       ?? null,
                'tip'        => $user['ambassador_tip']        ?? null,
                'story'      => $user['ambassador_story']      ?? null,
            ], static fn($v) => $v !== null && $v !== '');
        }

        return array_merge(self::publicFields($user), [
            'email'           => $user['email'],
            'guest_id'        => $user['guest_id']  ?? null,
            'is_verified'     => (bool) ($user['is_verified'] ?? false),
            'isAmbassador'    => $isAmbassador,
            'ambassadorPicks' => $isAmbassador ? (object) $picks : null,
        ]);
    }

    private static function computeAge(?int $birthYear): ?int
    {
        if ($birthYear === null) {
            return null;
        }
        return (int) date('Y') - $birthYear;
    }
}
