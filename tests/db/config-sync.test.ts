import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, DEFAULT_SCORING } from "../../config/scoring";
import { tx } from "./helpers";

describe("config/scoring.ts ↔ SQL-дефолты", () => {
  it("коэффициенты очков совпадают", () =>
    tx(async (db) => {
      const { rows } = await db.query("select app_private.default_scoring_config() as c");
      expect(rows[0].c).toEqual(DEFAULT_SCORING);
    }));

  it("правила проверки совпадают", () =>
    tx(async (db) => {
      const { rows } = await db.query("select app_private.default_rules() as c");
      expect(rows[0].c).toEqual(DEFAULT_RULES);
    }));
});
