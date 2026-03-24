<?php

declare(strict_types=1);

class Request
{
    public static function json(): ?array
    {
        $body = file_get_contents('php://input');
        $data = json_decode($body, true);

        return is_array($data) ? $data : null;
    }

    public static function ip(): string
    {
        $forwarded = $_SERVER['HTTP_CF_CONNECTING_IP']
            ?? $_SERVER['HTTP_X_FORWARDED_FOR']
            ?? $_SERVER['REMOTE_ADDR']
            ?? 'unknown';

        if (str_contains($forwarded, ',')) {
            $forwarded = trim(explode(',', $forwarded)[0]);
        }

        return trim((string) $forwarded) ?: 'unknown';
    }
}
