// Генерирует PNG-иконки PWA из SVG-персонажа: pnpm icons
// (vitest используется как раннер TSX без отдельного tsx/ts-node).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { it } from "vitest";
import { Character } from "../src/components/character";

/** librsvg не знает oklch() — переводим в hex (OKLab → линейный sRGB → sRGB). */
function oklchToHex(l: number, c: number, h: number): string {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return `#${lin
    .map((x) => {
      const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

const toHex = (svg: string) =>
  svg.replace(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ [\d.]+)?\)/g, (_, l, c, h) => oklchToHex(Number(l), Number(c), Number(h)));

it("icons", async () => {
  const dir = path.resolve(import.meta.dirname, "../public/icons");
  mkdirSync(dir, { recursive: true });
  const bird = toHex(renderToStaticMarkup(<Character seed="orle" stage={3} size={120} />)).replace(/^<svg[^>]*>|<\/svg>$/g, "");
  const icon = (pad: number, bg: string) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="${pad ? 0 : 26}" fill="${bg}"/><g transform="translate(${pad} ${pad}) scale(${(120 - 2 * pad) / 120})">${bird}</g></svg>`,
    );
  await sharp(icon(6, "#fff1e2")).resize(192).png().toFile(`${dir}/icon-192.png`);
  await sharp(icon(6, "#fff1e2")).resize(512).png().toFile(`${dir}/icon-512.png`);
  await sharp(icon(18, "#fff1e2")).resize(512).png().toFile(`${dir}/maskable-512.png`);
  await sharp(icon(6, "#fff1e2")).resize(180).png().toFile(`${dir}/apple-touch-icon.png`);
  await sharp(icon(4, "#00000000")).resize(72).greyscale().png().toFile(`${dir}/badge-72.png`);
});
