import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/validation";
import { safeNext } from "@/lib/safe-next";

describe("normalizePhone", () => {
  it.each([
    ["8 700 123 45 67", "+77001234567"],
    ["+7 (700) 123-45-67", "+77001234567"],
    ["77001234567", "+77001234567"],
    ["+998 90 123 45 67", "+998901234567"],
  ])("%s → %s", (input, out) => expect(normalizePhone(input)).toBe(out));
  it.each(["", "123", "abc", "+1"])("отклоняет %s", (input) => expect(normalizePhone(input)).toBeNull());
});

describe("safeNext", () => {
  it.each(["/join/ABCD2345", "/g/123/feed"])("пропускает %s", (p) => expect(safeNext(p)).toBe(p));
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "", undefined])("не пропускает %s", (p) => expect(safeNext(p)).toBe("/"));
});
