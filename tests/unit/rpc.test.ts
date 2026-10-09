import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES, RPC_ERROR_CODES, rpcErrorCode } from "@/lib/rpc";
import ru from "../../messages/ru.json";

const root = path.resolve(import.meta.dirname, "../..");

describe("rpcErrorCode", () => {
  it("распознаёт известный код бизнес-ошибки", () => {
    expect(rpcErrorCode({ code: "P0001", message: "cannot_vote_own" })).toBe("cannot_vote_own");
  });
  it("не пропускает произвольный текст из БД в интерфейс", () => {
    expect(rpcErrorCode({ code: "P0001", message: "<script>" })).toBe("generic");
    expect(rpcErrorCode({ code: "42501", message: "permission denied" })).toBe("generic");
  });
});

describe("коды ошибок синхронизированы", () => {
  const sql = readdirSync(path.join(root, "supabase/migrations"))
    .map((f) => readFileSync(path.join(root, "supabase/migrations", f), "utf8"))
    .join("\n");
  const raised = new Set([...sql.matchAll(/raise_error\('([a-z_]+)'/g)].map((m) => m[1]));
  raised.add("rate_limited"); // возвращается как NULL, см. create_checkin

  it("каждый код из SQL есть в RPC_ERROR_CODES", () => {
    expect([...raised].sort()).toEqual([...RPC_ERROR_CODES].sort());
  });
  it("у каждого кода есть перевод", () => {
    for (const code of [...RPC_ERROR_CODES, ...APP_ERROR_CODES, "generic", "network"]) expect(ru.errors, code).toHaveProperty(code);
  });
});
