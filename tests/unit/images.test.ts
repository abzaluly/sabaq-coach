import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { dHash, hamming, InvalidImageError, processProof } = await import("@/lib/images");

/** Тестовая картинка: градиент + прямоугольник; EXIF с датой съёмки и GPS. */
async function photo(opts: { shift?: number; date?: string; withGps?: boolean } = {}) {
  const w = 400;
  const h = 300;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const inBox = x > 100 + (opts.shift ?? 0) && x < 250 && y > 80 && y < 200;
      raw[i] = inBox ? 220 : (x * 255) / w;
      raw[i + 1] = inBox ? 40 : (y * 255) / h;
      raw[i + 2] = 120;
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg()
    .withExif({
      IFD0: { Make: "TestCam", Orientation: "1" },
      IFD2: { DateTimeOriginal: opts.date ?? "2026:10:09 10:00:00", OffsetTimeOriginal: "+05:00" },
      ...(opts.withGps === false ? {} : { IFD3: { GPSLatitudeRef: "N", GPSLatitude: "43/1 15/1 0/1" } }),
    })
    .toBuffer();
}

describe("обработка пруфа", () => {
  it("удаляет EXIF и GPS, но читает время съёмки из оригинала", async () => {
    const input = await photo();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processProof(input);
    const meta = await sharp(out.image).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(out.takenAt?.toISOString()).toBe("2026-10-09T05:00:00.000Z");
  });

  it("одинаковые и слегка изменённые фото дают близкий хэш, разные — далёкий", async () => {
    const a = await dHash(await photo());
    const recompressed = await dHash(await sharp(await photo()).jpeg({ quality: 40 }).resize(200).toBuffer());
    const other = await dHash(await sharp(await photo()).flop().toBuffer());
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hamming(a, recompressed)).toBeLessThanOrEqual(6);
    expect(hamming(a, other)).toBeGreaterThan(6);
  });

  it("отклоняет не-изображения", async () => {
    await expect(processProof(Buffer.from("hello"))).rejects.toBeInstanceOf(InvalidImageError);
  });

  it("уменьшает большие фото", async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#f80" } }).jpeg().toBuffer();
    const out = await processProof(big);
    expect(Math.max(out.width, out.height)).toBe(1600);
  });
});
