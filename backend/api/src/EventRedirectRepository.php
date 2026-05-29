<?php

declare(strict_types=1);

/**
 * Maps a retired recurring-occurrence channel_id → the surviving canonical
 * event channel_id. Populated by the recurring-event collapse migration; read
 * by the prerender's 404-fallback to 301 old /event/<occurrence-hex> URLs to
 * the canonical event. The per-date occurrence id is a one-way SHA-256, so it
 * can't be reversed — hence this table.
 */
class EventRedirectRepository
{
    /** Canonical channel_id for a retired occurrence id, or null if none. */
    public static function resolve(string $fromChannelId): ?string
    {
        $stmt = Database::pdo()->prepare(
            "SELECT to_channel_id FROM event_redirects WHERE from_channel_id = ? LIMIT 1"
        );
        $stmt->execute([$fromChannelId]);
        $to = $stmt->fetchColumn();
        return $to !== false ? (string) $to : null;
    }

    public static function add(string $fromChannelId, string $toChannelId): void
    {
        Database::pdo()->prepare("
            INSERT INTO event_redirects (from_channel_id, to_channel_id)
            VALUES (?, ?)
            ON CONFLICT (from_channel_id) DO NOTHING
        ")->execute([$fromChannelId, $toChannelId]);
    }
}
