<?php

declare(strict_types=1);

class Response
{
    /**
     * @param array       $data        Data to encode (used when $preEncoded is null).
     * @param int         $status      HTTP status code.
     * @param string|null $preEncoded  Optional pre-encoded JSON string. When supplied,
     *                                 $data is ignored and json_encode is skipped — useful
     *                                 when the caller needs to measure serialisation time
     *                                 separately and avoid encoding the payload twice.
     */
    public static function json(array $data, int $status = 200, ?string $preEncoded = null): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo $preEncoded ?? json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        exit;
    }
}
