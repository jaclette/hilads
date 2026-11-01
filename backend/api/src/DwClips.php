<?php

declare(strict_types=1);

/**
 * Video clips for "Different Worlds" topics in video mode: chosen while the
 * package is prepared in Claude Code, like the photos, from Wikimedia Commons
 * (free licenses, credited on the slide). A slide's clip is its "clip_url"
 * (the video file, or one of its transcodes, on upload.wikimedia.org),
 * "clip_start" (the second its good part starts) and "clip_credit". The Mac
 * downloads it when it renders the video (tools/promo, cached) and plays it in
 * the top square, where the photo is otherwise; without one, the photo.
 */
final class DwClips
{
    /** A clip source we accept: a video file on Wikimedia Commons' upload server. */
    public static function sourceOk(string $url): bool
    {
        return (bool) preg_match('#^https://upload\.wikimedia\.org/wikipedia/commons/\S+\.(webm|ogv|mp4)$#i', self::clean($url));
    }

    /** The URL without the query Commons' API adds (?utm_source=…) and any fragment. Pure. */
    public static function clean(string $url): string
    {
        return (string) preg_replace('/[?#].*$/', '', trim($url));
    }

    /** The Commons page of a clip file (or of the file a transcode comes from). Pure. */
    public static function pageUrl(string $url): string
    {
        $path = (string) parse_url($url, PHP_URL_PATH);
        // …/commons/a/ab/Name.webm, or …/commons/transcoded/a/ab/Name.webm/Name.webm.1080p.vp9.webm
        $name = preg_match('#/commons/transcoded/[0-9a-f]/[0-9a-f]{2}/([^/]+)/#', $path, $m) ? $m[1] : basename($path);
        return 'https://commons.wikimedia.org/wiki/File:' . $name;
    }

    /** A slide's clip from its content part: {url, start, credit, page}, or null (its photo). */
    public static function ofPart(array $part): ?array
    {
        $url = is_string($part['clip_url'] ?? null) ? self::clean($part['clip_url']) : '';
        if ($url === '' || !self::sourceOk($url)) {
            return null;
        }
        return [
            'url'    => $url,
            'start'  => max(0.0, (float) ($part['clip_start'] ?? 0)),
            'credit' => trim((string) ($part['clip_credit'] ?? '')),
            'page'   => self::pageUrl($url),
        ];
    }
}
