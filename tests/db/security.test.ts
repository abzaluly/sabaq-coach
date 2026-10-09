import { describe, expect, it } from "vitest";
import { tx } from "./helpers";

describe("аудит схемы", () => {
  it("RLS включён на каждой таблице public", () =>
    tx(async (db) => {
      const { rows } = await db.query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`,
      );
      expect(rows).toEqual([]);
    }));

  it("у каждой SECURITY DEFINER-функции зафиксирован search_path", () =>
    tx(async (db) => {
      const { rows } = await db.query(
        `select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'app_private') and p.prosecdef
            and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
      );
      expect(rows).toEqual([]);
    }));

  it("клиент не может писать ни в одну таблицу, кроме своих настроек", () =>
    tx(async (db) => {
      const { rows } = await db.query(
        `select table_name, privilege_type from information_schema.role_table_grants
          where grantee in ('authenticated', 'anon') and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
          order by 1, 2`,
      );
      expect(rows.map((r) => `${r.table_name}:${r.privilege_type}`)).toEqual([
        "notification_prefs:DELETE",
        "notification_prefs:INSERT",
        "notification_prefs:UPDATE",
        "push_subscriptions:DELETE",
        "push_subscriptions:INSERT",
        "push_subscriptions:UPDATE",
      ]);
    }));

  it("anon ничего не читает, кроме каталогов", () =>
    tx(async (db) => {
      const { rows } = await db.query(
        `select table_name from information_schema.role_table_grants
          where grantee = 'anon' and table_schema = 'public' order by 1`,
      );
      expect([...new Set(rows.map((r) => r.table_name))]).toEqual(["achievements", "cosmetics"]);
    }));
});
