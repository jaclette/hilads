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
}
