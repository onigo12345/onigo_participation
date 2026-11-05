-- Supabase の SQL Editor に貼り付けて実行してください（何度実行しても大丈夫です）。
-- いちばん下の「管理者のメールアドレス」を、あなたのアドレスに書き換えてから実行してください。
--
-- 集めるデータ（これ以外は集めません）
--   参加者：参加番号／学部／回生（任意）／ニックネーム（本名不可）／知ったきっかけ（任意）／初めて来た日
--   来場  ：日付／来た時刻／帰った時刻／どのQR（設置者）から来たか／何回目か／画像を作ったか／シェアしたか／楽しかった度（任意）
-- 集めないもの：本名・学籍番号・連絡先・位置情報・顔写真
-- 端末の見分けには、スマホの中で作ったランダムな文字列（device_key）だけを使います。

-- ---------- 参加者 ----------
create table if not exists participants (
  id bigint generated always as identity primary key,
  source text,
  created_at timestamptz not null default now()
);
alter table participants add column if not exists source     text;
alter table participants add column if not exists device_key text;
alter table participants add column if not exists faculty    text;
alter table participants add column if not exists grade      text;
alter table participants add column if not exists nickname   text;
alter table participants add column if not exists heard_from text;
alter table participants add column if not exists profile_at timestamptz;
create unique index if not exists participants_device_key on participants(device_key);

-- ---------- QRの設置者（QRに入れる短い合言葉 → 誰が置いたQRか） ----------
create table if not exists spots (
  token      text primary key,
  placer     text not null,          -- 設置者のニックネーム（例：代表）
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- 来場（1人×1日＝1行。来た時のQRと帰る時のQRで記録） ----------
create table if not exists visits (
  id            bigint generated always as identity primary key,
  participant_no bigint not null references participants(id) on delete cascade,
  spot          text references spots(token) on delete set null,
  visit_date    date not null,
  arrived_at    timestamptz,
  left_at       timestamptz,
  made_image    boolean not null default false,
  shared        boolean not null default false,
  feeling       smallint check (feeling between 1 and 3)
);
create index if not exists visits_date on visits(visit_date);
create index if not exists visits_participant on visits(participant_no);
create unique index if not exists visits_one_per_day on visits(participant_no, visit_date);   -- 1人1日1行

-- ---------- 参加者が作った画像の記録 ----------
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
alter table spots        enable row level security;
alter table visits       enable row level security;
alter table submissions  enable row level security;

-- ---------- 管理者 ----------
create table if not exists admins (email text primary key);
alter table admins enable row level security;
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email')) $$;

-- ---------- 参加者のスマホから呼ぶ処理（中身を直接は読めない・書けない。この処理だけ使える） ----------
create or replace function public._me(p_device text) returns bigint
  language sql stable security definer set search_path = public
  as $$ select id from participants where device_key = p_device $$;

-- 来た時のQR：参加者を登録（初回のみ）し、今日の来場を記録する
create or replace function public.join_visit(p_device text, p_spot text default null) returns json
  language plpgsql security definer set search_path = public as $$
declare pid bigint; prof boolean; n int; today date := (now() at time zone 'Asia/Tokyo')::date; s text := null;
begin
  if p_device is null or length(p_device) < 24 or length(p_device) > 64 then raise exception 'bad device'; end if;
  select id, nickname is not null into pid, prof from participants where device_key = p_device;
  if pid is null then
    insert into participants(device_key, source) values (p_device, 'qr') returning id into pid; prof := false;
  end if;
  select token into s from spots where token = p_spot and active;
  if not exists (select 1 from visits where participant_no = pid and visit_date = today) then
    insert into visits(participant_no, spot, visit_date, arrived_at) values (pid, s, today, now());
  else
    update visits set arrived_at = coalesce(arrived_at, now()), spot = coalesce(spot, s)
      where participant_no = pid and visit_date = today;
  end if;
  select count(*) into n from visits where participant_no = pid;
  return json_build_object('no', pid, 'has_profile', prof, 'visits', n);
end $$;

-- アンケート（初回だけ）
create or replace function public.save_profile(p_device text, p_faculty text, p_grade text, p_nickname text, p_heard text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(p_nickname, '')) not between 1 and 20 or length(coalesce(p_faculty, '')) not between 1 and 30 then
    raise exception 'bad profile';
  end if;
  update participants set faculty = p_faculty, grade = nullif(left(p_grade, 10), ''), nickname = p_nickname,
         heard_from = nullif(left(p_heard, 20), ''), profile_at = now()
   where device_key = p_device;
end $$;

-- 画像を作った・シェアした
create or replace function public.mark_visit(p_device text, p_what text) returns void
  language plpgsql security definer set search_path = public as $$
declare pid bigint := public._me(p_device); today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if pid is null then return; end if;
  if p_what = 'image'  then update visits set made_image = true where participant_no = pid and visit_date = today; end if;
  if p_what = 'shared' then update visits set shared     = true where participant_no = pid and visit_date = today; end if;
end $$;

-- 帰る時のQR：帰った時刻を記録し、今日の滞在時間を返す（読み直したら時刻を上書き）
create or replace function public.leave_visit(p_device text, p_spot text default null, p_feeling smallint default null) returns json
  language plpgsql security definer set search_path = public as $$
declare pid bigint := public._me(p_device); today date := (now() at time zone 'Asia/Tokyo')::date; s text := null; v visits; n int; nick text;
begin
  if pid is null then return json_build_object('known', false); end if;
  select token into s from spots where token = p_spot and active;
  select * into v from visits where participant_no = pid and visit_date = today;
  if v.id is null then
    insert into visits(participant_no, spot, visit_date, left_at, feeling) values (pid, s, today, now(), p_feeling) returning * into v;
  else
    update visits set left_at = now(), feeling = coalesce(p_feeling, feeling), spot = coalesce(spot, s) where id = v.id returning * into v;
  end if;
  select count(*) into n from visits where participant_no = pid;
  select nickname into nick from participants where id = pid;
  return json_build_object('known', true, 'no', pid, 'visits', n, 'nickname', nick,
    'minutes', case when v.arrived_at is null then null else round(extract(epoch from (v.left_at - v.arrived_at)) / 60) end);
end $$;

revoke all on function public._me(text) from public, anon, authenticated;
grant execute on function public.join_visit(text, text)                    to anon, authenticated;
grant execute on function public.save_profile(text, text, text, text, text) to anon, authenticated;
grant execute on function public.mark_visit(text, text)                     to anon, authenticated;
grant execute on function public.leave_visit(text, text, smallint)          to anon, authenticated;

-- ---------- 読み書きのルール ----------
-- 参加者のスマホからは、上の処理を通してしか読み書きできない（表を直接は見られない）
drop policy if exists "anyone can join"     on participants;
drop policy if exists "anyone can read ids" on participants;
drop policy if exists "admin reads participants" on participants;
create policy "admin reads participants" on participants for select to authenticated using (public.is_admin());

drop policy if exists "admin reads visits" on visits;
create policy "admin reads visits" on visits for select to authenticated using (public.is_admin());

drop policy if exists "admin manages spots" on spots;
create policy "admin manages spots" on spots for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "anyone can submit" on submissions;
create policy "anyone can submit" on submissions for insert to anon
  with check (consent = true and look in ('none', 'soft', 'blur', 'shape'));
drop policy if exists "admin reads submissions"   on submissions;
drop policy if exists "admin deletes submissions" on submissions;
create policy "admin reads submissions"   on submissions for select to authenticated using (public.is_admin());
create policy "admin deletes submissions" on submissions for delete to authenticated using (public.is_admin());

-- ---------- 画像の保存先（非公開）。PNG・JPEGのみ・1枚5MBまで ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('hands', 'hands', false, 5242880, array['image/png', 'image/jpeg'])
  on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/png', 'image/jpeg'];
drop policy if exists "anyone can upload hand" on storage.objects;
drop policy if exists "admin reads hands"      on storage.objects;
drop policy if exists "admin deletes hands"    on storage.objects;
create policy "anyone can upload hand" on storage.objects for insert to anon with check (bucket_id = 'hands');
create policy "admin reads hands"   on storage.objects for select to authenticated using (bucket_id = 'hands' and public.is_admin());
create policy "admin deletes hands" on storage.objects for delete to authenticated using (bucket_id = 'hands' and public.is_admin());

-- ---------- 最初のQR（代表が設置するもの）。いま配っているQRコードと対応しています ----------
insert into spots (token, placer, note) values ('fjpc5t6gz9', '代表', '最初のQR') on conflict (token) do nothing;

-- ▼ 管理者のメールアドレス（書き換えてください。複数人なら行を増やす）
insert into admins (email) values ('your-email@example.com') on conflict do nothing;
