import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Создаёт чистую тестовую БД и накатывает на неё миграции.
 *
 * TEST_DATABASE_URL — сервер Postgres ≥ 15 с правами суперпользователя
 * (по умолчанию локальный postgres). Для `supabase start` укажите
 * TEST_SUPABASE=1 — тогда шим не применяется и используется БД Supabase.
 */
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";
export const TEST_DB = "orle_test";

const root = path.resolve(import.meta.dirname, "../..");

export default async function setup() {
  if (process.env.TEST_SUPABASE === "1") return;

  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB}`;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    await db.query(readFileSync(path.join(root, "tests/db/supabase-shim.sql"), "utf8"));
    const dir = path.join(root, "supabase/migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      try {
        await db.query(readFileSync(path.join(dir, file), "utf8"));
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await db.end();
  }
}
