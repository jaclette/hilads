<?php

declare(strict_types=1);

/**
 * One push per (recipient, event): the same event can never notify the same person twice
 * (a retried request, a photo posted with its selfie, two code paths about one photo).
 *
 * claim() records the recipients of an event in one atomic insert and returns only the ones
 * not already recorded: send to those and nobody else. Recipient keys: 'u:<user id>',
 * 'g:<guest id>'. Event keys: 'new_photo:<proof id>', 'admin_photo:<source>:<ref id>'.
 * Rows older than 30 days are purged by POST /internal/cleanup.
 *
 * Fails open (everyone claimed) on a database error, before the migration for instance:
 * a guard outage must never silence the pushes.
 */
final class PushOnce
{
    private const CHUNK = 500;

    /** @param string[] $recipients @return string[] the recipients claimed now, in their order */
    public static function claim(string $event, array $recipients): array
    {
        $recipients = array_values(array_unique(array_filter($recipients, static fn($r) => is_string($r) && $r !== '')));
        if ($recipients === []) {
            return [];
        }
        try {
            $pdo     = Database::pdo();
            $claimed = [];
            foreach (array_chunk($recipients, self::CHUNK) as $chunk) {
                $stmt = $pdo->prepare('
                    INSERT INTO push_once (event_key, recipient_key)
                    VALUES ' . implode(', ', array_fill(0, count($chunk), '(?, ?)')) . '
                    ON CONFLICT DO NOTHING
                    RETURNING recipient_key
                ');
                $args = [];
                foreach ($chunk as $r) {
                    array_push($args, $event, $r);
                }
                $stmt->execute($args);
                foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $r) {
                    $claimed[(string) $r] = true;
                }
            }
            return array_values(array_filter($recipients, static fn($r) => isset($claimed[$r])));
        } catch (\Throwable $e) {
            error_log('[push-once] failed open for ' . $event . ': ' . $e->getMessage());
            return $recipients;
        }
    }
}
