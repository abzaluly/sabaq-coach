-- Seed с тестовой группой из 4 человек и историей за 3 недели появится на этапе 7.
-- Пока здесь только каталоги, нужные интерфейсу.

insert into public.cosmetics (code, kind, sort_order) values
  ('frame_ember', 'frame', 10),
  ('frame_gold', 'frame', 20),
  ('bg_meadow', 'background', 10),
  ('bg_aurora', 'background', 20),
  ('acc_scarf', 'accessory', 10),
  ('acc_crown', 'accessory', 20),
  ('acc_gavel', 'accessory', 30)
on conflict do nothing;

insert into public.achievements (code, cosmetic_code, sort_order) values
  ('streak_7', 'frame_ember', 10),
  ('streak_30', 'bg_aurora', 20),
  ('streak_100', 'frame_gold', 30),
  ('first_full_week', 'acc_scarf', 40),
  ('honest_judge', 'acc_gavel', 50),
  ('season_winner', 'acc_crown', 60)
on conflict do nothing;
