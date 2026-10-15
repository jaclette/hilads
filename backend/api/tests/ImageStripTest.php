<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/** Uploads are stored without metadata: ImageProcessor::stripMetadata re-encodes them. */
final class ImageStripTest extends TestCase
{
    private array $tmp = [];

    protected function setUp(): void
    {
        if (!extension_loaded('gd')) {
            $this->markTestSkipped('GD not loaded');
        }
    }

    protected function tearDown(): void
    {
        foreach ($this->tmp as $f) @unlink($f);
    }

    /** A 20x10 JPEG carrying an EXIF block: Orientation (6 = turn right) + a fake GPS string. */
    private function jpegWithExif(int $orientation): string
    {
        $img = imagecreatetruecolor(20, 10);
        ob_start();
        imagejpeg($img);
        $jpeg = (string) ob_get_clean();

        // TIFF, big-endian: one IFD entry 0x0112 SHORT = $orientation.
        $tiff = "MM\x00\x2a\x00\x00\x00\x08"
              . "\x00\x01"
              . "\x01\x12\x00\x03\x00\x00\x00\x01" . pack('n', $orientation) . "\x00\x00"
              . "\x00\x00\x00\x00"
              . 'GPSLatitude 10.7769 GPSLongitude 106.7009';
        $app1 = "Exif\x00\x00" . $tiff;
        $segment = "\xFF\xE1" . pack('n', strlen($app1) + 2) . $app1;
        $file = substr($jpeg, 0, 2) . $segment . substr($jpeg, 2);

        $path = tempnam(sys_get_temp_dir(), 'strip_test_');
        file_put_contents($path, $file);
        return $this->tmp[] = $path;
    }

    public function testJpegLosesExifAndGps(): void
    {
        $src = $this->jpegWithExif(1);
        $this->assertStringContainsString("Exif\x00\x00", (string) file_get_contents($src));

        $out = ImageProcessor::stripMetadata($src, 'image/jpeg');
        $this->assertNotNull($out, (string) ImageProcessor::$lastError);
        $this->tmp[] = $out;
        $bytes = (string) file_get_contents($out);
        $this->assertStringNotContainsString('Exif', $bytes);
        $this->assertStringNotContainsString('GPSLatitude', $bytes);
        $this->assertSame([20, 10], array_slice(getimagesize($out), 0, 2));
    }

    public function testOrientationIsAppliedBeforeStripping(): void
    {
        if (!function_exists('exif_read_data')) {
            $this->markTestSkipped('exif extension not loaded');
        }
        $out = ImageProcessor::stripMetadata($this->jpegWithExif(6), 'image/jpeg');
        $this->assertNotNull($out);
        $this->tmp[] = $out;
        $this->assertSame([10, 20], array_slice(getimagesize($out), 0, 2));
    }

    public function testPngKeepsTransparency(): void
    {
        $img = imagecreatetruecolor(4, 4);
        imagealphablending($img, false);
        imagesavealpha($img, true);
        imagefill($img, 0, 0, imagecolorallocatealpha($img, 0, 0, 0, 127));
        $src = $this->tmp[] = tempnam(sys_get_temp_dir(), 'strip_png_');
        imagepng($img, $src);

        $out = ImageProcessor::stripMetadata($src, 'image/png');
        $this->assertNotNull($out);
        $this->tmp[] = $out;
        $back = imagecreatefrompng($out);
        $alpha = (imagecolorat($back, 1, 1) >> 24) & 0x7F;
        $this->assertSame(127, $alpha);
    }

    public function testUndecodableFileFails(): void
    {
        $src = $this->tmp[] = tempnam(sys_get_temp_dir(), 'strip_bad_');
        file_put_contents($src, 'not an image');
        $this->assertNull(ImageProcessor::stripMetadata($src, 'image/jpeg'));
        $this->assertNotNull(ImageProcessor::$lastError);
    }
}
