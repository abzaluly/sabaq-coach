import { describe, expect, it } from "vitest";
import { moodFor, stageForPoints, traitsFromSeed } from "@/lib/character";

describe("персонаж", () => {
  it("внешность детерминирована seed'ом", () => {
    expect(traitsFromSeed("aika")).toEqual(traitsFromSeed("aika"));
    expect(traitsFromSeed("aika")).not.toEqual(traitsFromSeed("timur"));
  });

  it("стадии растут по порогам очков", () => {
    expect(stageForPoints(-20)).toBe(0);
    expect(stageForPoints(49)).toBe(0);
    expect(stageForPoints(50)).toBe(1);
    expect(stageForPoints(799)).toBe(2);
    expect(stageForPoints(2000)).toBe(4);
  });

  it("настроение: щит важнее усталости, огонь от 7 дней стрика", () => {
    expect(moodFor({ streak: 10, missedRecently: true, frozen: true })).toBe("shield");
    expect(moodFor({ streak: 0, missedRecently: true, frozen: false })).toBe("tired");
    expect(moodFor({ streak: 7, missedRecently: false, frozen: false })).toBe("fire");
    expect(moodFor({ streak: 6, missedRecently: false, frozen: false })).toBe("normal");
  });
});
