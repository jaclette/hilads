<?php

declare(strict_types=1);

class Storage
{
    public static function path(string $filename): string
    {
        $base = rtrim(getenv('STORAGE_PATH') ?: __DIR__ . '/../storage', '/');
        return $base . '/' . $filename;
    }

    public static function dir(): string
    {
        return rtrim(getenv('STORAGE_PATH') ?: __DIR__ . '/../storage', '/');
    }
}
