import "server-only";
import exifReader from "exif-reader";
import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 1600;

export type ProcessedProof = {
  /** Публичная версия: WebP без EXIF/GPS, повёрнутая по ориентации. */
  image: Buffer;
  contentType: "image/webp";
  /** dHash, 64 бита в hex — перцептивный хэш для поиска повторов. */
  phash: string;
  /** Время съёмки из EXIF оригинала (если было) — для флага «старое фото». */
  takenAt: Date | null;
  width: number;
  height: number;
};

export class InvalidImageError extends Error {}

export async function processProof(input: Buffer): Promise<ProcessedProof> {
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new InvalidImageError("too_large");
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new InvalidImageError("not_an_image");
  }
  if (!meta.format || !["jpeg", "png", "webp", "heif", "avif"].includes(meta.format)) {
    throw new InvalidImageError("unsupported_format");
  }

  const takenAt = meta.exif ? exifDate(meta.exif) : null;

  // .rotate() без аргументов применяет EXIF-ориентацию; sharp по умолчанию
  // не переносит метаданные в результат — EXIF и GPS отбрасываются.
  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });

  return { image: data, contentType: "image/webp", phash: await dHash(data), takenAt, width: info.width, height: info.height };
}

/** Разностный хэш: 9×8 в градациях серого, сравнение соседних пикселей по строке. */
export async function dHash(input: Buffer): Promise<string> {
  const pixels = await sharp(input).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (pixels[y * 9 + x]! > pixels[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

function exifDate(exif: Buffer): Date | null {
  try {
    const parsed = exifReader(exif) as { Photo?: { DateTimeOriginal?: Date; OffsetTimeOriginal?: string } };
    const d = parsed.Photo?.DateTimeOriginal;
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    // exif-reader трактует локальное время съёмки как UTC; поправляем, если смещение известно.
    const offset = parsed.Photo?.OffsetTimeOriginal?.match(/^([+-])(\d{2}):(\d{2})$/);
    if (offset) {
      const minutes = (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === "+" ? 1 : -1);
      return new Date(d.getTime() - minutes * 60_000);
    }
    return d;
  } catch {
    return null;
  }
}
