import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Character } from "@/components/character";
import type { Mood, Stage } from "@/lib/character";

describe("SVG-персонаж", () => {
  it("все стадии и настроения рисуются по-разному", () => {
    const stages = ([0, 1, 2, 3, 4] as Stage[]).map((stage) => renderToStaticMarkup(<Character seed="aika" stage={stage} />));
    expect(new Set(stages).size).toBe(5);
    const moods = (["normal", "fire", "tired", "shield"] as Mood[]).map((mood) => renderToStaticMarkup(<Character seed="aika" stage={2} mood={mood} />));
    expect(new Set(moods).size).toBe(4);
  });

  it("косметика меняет картинку", () => {
    const plain = renderToStaticMarkup(<Character seed="aika" stage={3} />);
    const dressed = renderToStaticMarkup(
      <Character seed="aika" stage={3} cosmetics={{ frame: "frame_gold", background: "bg_aurora", accessory: "acc_crown" }} />,
    );
    expect(dressed).not.toBe(plain);
  });

  // GALLERY_DIR=... pnpm vitest run character-render — HTML-галерея для визуальной проверки.
  it.runIf(Boolean(process.env.GALLERY_DIR))("галерея", () => {
    const cells: string[] = [];
    for (const seed of ["aika", "timur", "dana"])
      for (const stage of [0, 1, 2, 3, 4] as Stage[]) cells.push(renderToStaticMarkup(<Character seed={seed} stage={stage} size={120} />));
    for (const mood of ["normal", "fire", "tired", "shield"] as Mood[]) cells.push(renderToStaticMarkup(<Character seed="aika" stage={3} mood={mood} size={120} />));
    for (const c of [
      { frame: "frame_ember" },
      { frame: "frame_gold", accessory: "acc_crown" },
      { background: "bg_meadow", accessory: "acc_scarf" },
      { background: "bg_aurora", accessory: "acc_gavel" },
    ])
      cells.push(renderToStaticMarkup(<Character seed="timur" stage={4} cosmetics={c} size={120} />));
    writeFileSync(`${process.env.GALLERY_DIR}/gallery.html`, `<body style="background:#fff8f0;display:grid;grid-template-columns:repeat(5,130px);gap:8px">${cells.join("")}</body>`);
  });
});
