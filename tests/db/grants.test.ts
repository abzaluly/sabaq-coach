import { describe, expect, it } from "vitest";
import { tx } from "./helpers";

/**
 * Страж прав: какие функции может вызвать клиент. Новая RPC-функция должна быть
 * осознанно добавлена сюда — иначе тест падает. Внутренние app_private.* клиенту
 * недоступны (кроме трёх помощников для RLS-политик).
 */
const AUTHENTICATED = [
  "app_private.is_group_admin",
  "app_private.is_member",
  "app_private.shares_group",
  "public.add_comment",
  "public.archive_habit",
  "public.cancel_freeze",
  "public.complete_onboarding",
  "public.create_checkin",
  "public.create_group",
  "public.create_invite",
  "public.declare_freeze",
  "public.edit_proposed_habit",
  "public.equip_cosmetic",
  "public.group_arena",
  "public.invite_preview",
  "public.join_group",
  "public.leaderboard",
  "public.leave_group",
  "public.moderate_checkin",
  "public.my_summary",
  "public.my_today",
  "public.nickname_available",
  "public.propose_habit",
  "public.remove_member",
  "public.resolve_audit",
  "public.revoke_invite",
  "public.set_member_role",
  "public.toggle_reaction",
  "public.update_group_settings",
  "public.vote_checkin",
  "public.vote_habit",
];

const SERVICE_ONLY = ["public.discard_proof", "public.register_proof", "public.run_tick", "public.stale_proofs"];

async function executable(db: Parameters<Parameters<typeof tx>[0]>[0], role: string) {
  const { rows } = await db.query<{ fn: string }>(
    `select distinct n.nspname || '.' || p.proname as fn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app_private')
        and has_function_privilege($1, p.oid, 'execute')
      order by 1`,
    [role],
  );
  return rows.map((r) => r.fn);
}

describe("права на функции", () => {
  it("anon не может вызвать ни одну функцию", () =>
    tx(async (db) => {
      expect(await executable(db, "anon")).toEqual([]);
    }));

  it("authenticated — ровно белый список", () =>
    tx(async (db) => {
      expect(await executable(db, "authenticated")).toEqual([...AUTHENTICATED].sort());
    }));

  it("служебные функции — только service_role", () =>
    tx(async (db) => {
      const service = await executable(db, "service_role");
      for (const fn of SERVICE_ONLY) expect(service).toContain(fn);
    }));
});
