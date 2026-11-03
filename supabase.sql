-- Supabase の SQL Editor に貼り付けて実行してください（何度実行しても大丈夫です）。
-- いちばん下の「管理者のメールアドレス」を、あなたのアドレスに書き換えてから実行してください。

-- 参加者（番号＝id。スマホごとに1回だけ増える）
create table if not exists participants (
  id bigint generated always as identity primary key,
  source text,
  created_at timestamptz not null default now()
);
alter table participants add column if not exists source text;

-- 参加者が作った画像の記録
--   image_path = 広報用の手の素材（透明PNG）  story_path = 本人がシェアしたストーリー画像（JPEG）
--   look = そのまま(none) / ふんわり(soft) / 強くぼかす(blur)
create table if not exists submissions (
  id bigint generated always as identity primary key,
  participant_no bigint,
  image_path text not null,
  story_path text,
  consent boolean not null default true,
  look text,
  created_at timestamptz not null default now()
);
alter table submissions add column if not exists look text;
alter table submissions add column if not exists story_path text;

alter table participants enable row level security;
alter table submissions  enable row level security;

-- 管理者（このメールアドレスでログインした人だけが、管理ページで見る・保存する・削除する）
create table if not exists admins (email text primary key);
alter table admins enable row level security;     -- 管理者の一覧そのものは、外からは読めない
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email')) $$;

-- 参加者（ログインなし）は「番号をもらう」「画像を送る」だけできる
drop policy if exists "anyone can join"     on participants;
drop policy if exists "anyone can read ids" on participants;
create policy "anyone can join"     on participants for insert to anon with check (true);
create policy "anyone can read ids" on participants for select to anon, authenticated using (true);

drop policy if exists "anyone can submit" on submissions;
create policy "anyone can submit" on submissions for insert to anon
  with check (consent = true and look in ('none', 'soft', 'blur', 'shape'));

-- 管理者は、記録を見る・削除できる
drop policy if exists "admin reads submissions"   on submissions;
drop policy if exists "admin deletes submissions" on submissions;
create policy "admin reads submissions"   on submissions for select to authenticated using (public.is_admin());
create policy "admin deletes submissions" on submissions for delete to authenticated using (public.is_admin());

-- 画像の保存先（非公開）。PNG・JPEGのみ・1枚5MBまで
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('hands', 'hands', false, 5242880, array['image/png', 'image/jpeg'])
  on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/png', 'image/jpeg'];

-- 参加者はアップロードだけ（上書き・閲覧・削除は不可）。管理者は閲覧と削除ができる
drop policy if exists "anyone can upload hand" on storage.objects;
drop policy if exists "admin reads hands"      on storage.objects;
drop policy if exists "admin deletes hands"    on storage.objects;
create policy "anyone can upload hand" on storage.objects for insert to anon
  with check (bucket_id = 'hands');
create policy "admin reads hands"   on storage.objects for select to authenticated using (bucket_id = 'hands' and public.is_admin());
create policy "admin deletes hands" on storage.objects for delete to authenticated using (bucket_id = 'hands' and public.is_admin());

-- ▼ 管理者のメールアドレス（書き換えてください。複数人なら行を増やす）
insert into admins (email) values ('your-email@example.com') on conflict do nothing;
