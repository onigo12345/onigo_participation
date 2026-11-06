-- 鬼ごっこサークル：Supabase の準備
-- SQL Editor に貼り付けて実行してください。何度実行しても大丈夫です（データは消えません）。
-- いちばん下の「管理者のメールアドレス」を、あなたのアドレスに書き換えてから実行してください。
--
-- 集めるデータ（これ以外は集めません。詳しくは privacy.html）
--   参加者：参加番号／学部／回生（任意）／ニックネーム（本名不可）／知ったきっかけ（任意）
--   来場  ：日付／来た時刻／帰った時刻／どのQR（設置者）から来たか／画像を作ったか／シェアしたか／楽しかった度（任意）
--   画像  ：手の切り抜き（透明PNG）と、本人が作ったストーリー画像（JPEG）
-- 集めないもの：本名・学籍番号・連絡先・位置情報・顔写真・端末の情報
-- 端末の見分けには、スマホのブラウザの中で作ったランダムな文字列を使い、
-- データベースにはそれを元に戻せない形（SHA-256）に変えてから保存します。管理者にも見えません。
-- 来場の記録は2年たつと自動で消えます。参加者は帰る時のページから、自分の記録をいつでも消せます。

create extension if not exists pgcrypto with schema extensions;

-- ---------- 参加者 ----------
create table if not exists participants (
  id bigint generated always as identity primary key,
  source text,
  created_at timestamptz not null default now()
);
alter table participants add column if not exists source        text;
alter table participants add column if not exists device_key    text;     -- 端末の目印を SHA-256 にしたもの
alter table participants add column if not exists faculty       text;
alter table participants add column if not exists grade         text;
alter table participants add column if not exists nickname      text;
alter table participants add column if not exists heard_from    text;
alter table participants add column if not exists gender        text;     -- 性別（任意：男性／女性／その他）
alter table participants add column if not exists profile_at    timestamptz;
alter table participants add column if not exists profile_tries smallint not null default 0;   -- 名前の確認を何回したか（総当たり対策）
create unique index if not exists participants_device_key on participants(device_key);

-- ---------- QRの設置者 ----------
create table if not exists spots (
  token      text primary key,
  placer     text not null,
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- 来場（1人×1日＝1行） ----------
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
create unique index if not exists visits_one_per_day on visits(participant_no, visit_date);

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

-- ---------- 消してほしいと頼まれた画像（管理ページを開いた時に自動で消す） ----------
create table if not exists deletion_requests (
  id bigint generated always as identity primary key,
  paths text[] not null,
  requested_at timestamptz not null default now()
);

alter table participants      enable row level security;
alter table spots             enable row level security;
alter table visits            enable row level security;
alter table submissions       enable row level security;
alter table deletion_requests enable row level security;

-- ---------- 管理者 ----------
create table if not exists admins (email text primary key);
alter table admins enable row level security;
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email')) $$;

-- ---------- 小さな道具 ----------
-- 端末の目印を、元に戻せない形にする
create or replace function public._hash(t text) returns text language sql immutable
  as $$ select encode(extensions.digest(t, 'sha256'), 'hex') $$;
-- 名前の比べ方（全角・半角、大文字・小文字、空白の違いは同じとみなす）
create or replace function public._norm(t text) returns text language sql immutable
  as $$ select lower(regexp_replace(normalize(coalesce(t, ''), NFKC), '\s+', '', 'g')) $$;
create or replace function public._me(p_device text) returns bigint
  language sql stable security definer set search_path = public
  as $$ select id from participants where device_key = public._hash(p_device) $$;
create or replace function public._today() returns date language sql stable
  as $$ select (now() at time zone 'Asia/Tokyo')::date $$;

-- これまでに生のまま保存していた目印を、元に戻せない形に置きかえる（1回だけ効く）
update participants set device_key = public._hash(device_key) where device_key is not null and length(device_key) <> 64;

-- ---------- 参加者のスマホから呼ぶ処理（表は直接読めない・書けない。この処理だけ使える） ----------
-- 来た時のQR：参加者を登録（初回のみ）し、今日の来場を記録する
drop function if exists public.join_visit(text, text);
create or replace function public.join_visit(p_device text, p_spot text default null) returns json
  language plpgsql security definer set search_path = public as $$
declare pid bigint; prof boolean; n int; today date := public._today(); s text := null;
begin
  if p_device is null or p_device !~ '^[0-9a-f]{32}$' then raise exception 'bad device'; end if;
  select id, nickname is not null into pid, prof from participants where device_key = public._hash(p_device);
  if pid is null then
    insert into participants(device_key, source) values (public._hash(p_device), 'qr') returning id into pid; prof := false;
  end if;
  select token into s from spots where token = p_spot and active;
  insert into visits(participant_no, spot, visit_date, arrived_at) values (pid, s, today, now())
    on conflict (participant_no, visit_date) do update
      set arrived_at = coalesce(visits.arrived_at, excluded.arrived_at), spot = coalesce(visits.spot, excluded.spot);
  select count(*) into n from visits where participant_no = pid;
  -- 保存期間：2年より前の来場と、来場の記録がなくなった参加者を消す（ときどき）
  if random() < 0.05 then
    delete from visits where visit_date < today - 730;
    delete from participants p where created_at < now() - interval '730 days'
      and not exists (select 1 from visits v where v.participant_no = p.id);
  end if;
  return json_build_object('no', pid, 'has_profile', prof, 'visits', n);
end $$;

-- アンケート：同じ学部・同じニックネームの人がいたら、登録せずに {status:"exists"} を返す
drop function if exists public.save_profile(text, text, text, text, text);
drop function if exists public.save_profile(text, text, text, text, text, text);
create or replace function public.save_profile(p_device text, p_faculty text, p_grade text, p_nickname text, p_heard text, p_gender text default '') returns json
  language plpgsql security definer set search_path = public as $$
declare me bigint := public._me(p_device); other bigint; tries smallint;
begin
  if me is null then raise exception 'unknown device'; end if;
  if length(coalesce(trim(p_nickname), '')) not between 1 and 20 or length(coalesce(p_faculty, '')) not between 1 and 30 then
    raise exception 'bad profile';
  end if;
  update participants set profile_tries = profile_tries + 1 where id = me returning profile_tries into tries;
  if tries > 15 then raise exception 'too many tries'; end if;   -- 名前を総当たりで調べられないように
  select id into other from participants
   where id <> me and faculty = p_faculty and public._norm(nickname) = public._norm(p_nickname) limit 1;
  if other is not null then return json_build_object('status', 'exists'); end if;
  update participants set faculty = p_faculty, grade = nullif(left(p_grade, 10), ''), nickname = trim(p_nickname),
         heard_from = nullif(left(p_heard, 20), ''),
         gender = case when p_gender in ('男性', '女性', 'その他') then p_gender end,
         profile_at = now()
   where id = me;
  return json_build_object('status', 'ok', 'no', me);
end $$;

-- 「前にも来た」本人：この端末を、前の自分の記録につなぎ直す
drop function if exists public.relink(text, text, text);
create or replace function public.relink(p_device text, p_faculty text, p_nickname text) returns json
  language plpgsql security definer set search_path = public as $$
declare me bigint := public._me(p_device); old bigint; tries smallint;
begin
  if me is null then raise exception 'unknown device'; end if;
  update participants set profile_tries = profile_tries + 1 where id = me returning profile_tries into tries;
  if tries > 15 then raise exception 'too many tries'; end if;
  select id into old from participants
   where id <> me and faculty = p_faculty and public._norm(nickname) = public._norm(p_nickname) limit 1;
  if old is null then return json_build_object('status', 'notfound'); end if;
  -- 前の自分に今日の記録がすでにある＝今日は別のスマホで参加済み。なりすましで他人の今日の記録を見られないよう、つなぎ直さない
  if exists (select 1 from visits where participant_no = old and visit_date = public._today()) then
    return json_build_object('status', 'busy');
  end if;
  update visits set participant_no = old where participant_no = me;
  update submissions set participant_no = old where participant_no = me;
  delete from participants where id = me;
  update participants set device_key = public._hash(p_device), profile_tries = 0 where id = old;
  return json_build_object('status', 'ok', 'no', old);
end $$;

-- 画像を作った・シェアした
drop function if exists public.mark_visit(text, text);
create or replace function public.mark_visit(p_device text, p_what text) returns void
  language plpgsql security definer set search_path = public as $$
declare pid bigint := public._me(p_device);
begin
  if pid is null then return; end if;
  if p_what = 'image'  then update visits set made_image = true where participant_no = pid and visit_date = public._today(); end if;
  if p_what = 'shared' then update visits set shared     = true where participant_no = pid and visit_date = public._today(); end if;
end $$;

-- 画像の記録：参加番号は端末から決める（他人の番号で画像を登録できないように）
drop function if exists public.add_submission(text, text, text, text);
create or replace function public.add_submission(p_device text, p_image text, p_story text, p_look text) returns void
  language plpgsql security definer set search_path = public as $$
declare pid bigint := public._me(p_device);
begin
  if pid is null then raise exception 'unknown device'; end if;
  if p_look not in ('none', 'soft', 'blur') or p_image !~ '^[0-9a-z_]+\.png$' or (p_story is not null and p_story !~ '^[0-9a-z_]+\.jpg$') then
    raise exception 'bad submission';
  end if;
  insert into submissions(participant_no, image_path, story_path, consent, look) values (pid, p_image, p_story, true, p_look);
end $$;

-- 帰る時のQR：帰った時刻を記録し、今日の滞在時間を返す
drop function if exists public.leave_visit(text, text, smallint);
create or replace function public.leave_visit(p_device text, p_spot text default null, p_feeling smallint default null) returns json
  language plpgsql security definer set search_path = public as $$
declare pid bigint := public._me(p_device); today date := public._today(); s text := null; v visits; n int; nick text;
begin
  if pid is null then return json_build_object('known', false); end if;
  select token into s from spots where token = p_spot and active;
  insert into visits(participant_no, spot, visit_date, left_at, feeling) values (pid, s, today, now(), p_feeling)
    on conflict (participant_no, visit_date) do update
      set left_at = now(), feeling = coalesce(excluded.feeling, visits.feeling), spot = coalesce(visits.spot, excluded.spot)
    returning * into v;
  select count(*) into n from visits where participant_no = pid;
  select nickname into nick from participants where id = pid;
  return json_build_object('known', true, 'no', pid, 'visits', n, 'nickname', nick,
    'minutes', case when v.arrived_at is null then null else round(extract(epoch from (v.left_at - v.arrived_at)) / 60) end);
end $$;

-- 自分の記録をすべて消す（アンケート・来場・画像）。画像のファイルは、管理ページを開いた時に自動で消える
drop function if exists public.forget_me(text);
create or replace function public.forget_me(p_device text) returns json
  language plpgsql security definer set search_path = public as $$
declare pid bigint := public._me(p_device); ps text[];
begin
  if pid is null then return json_build_object('status', 'none'); end if;
  select array_agg(p) into ps from (
    select image_path as p from submissions where participant_no = pid
    union all select story_path from submissions where participant_no = pid and story_path is not null) x;
  if ps is not null then insert into deletion_requests(paths) values (ps); end if;
  delete from submissions where participant_no = pid;
  delete from participants where id = pid;    -- 来場の記録も一緒に消える
  return json_build_object('status', 'ok');
end $$;

revoke all on function public._me(text), public._hash(text), public._norm(text) from public, anon, authenticated;
grant execute on function public.join_visit(text, text)                     to anon, authenticated;
grant execute on function public.save_profile(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.relink(text, text, text)                   to anon, authenticated;
grant execute on function public.mark_visit(text, text)                     to anon, authenticated;
grant execute on function public.add_submission(text, text, text, text)     to anon, authenticated;
grant execute on function public.leave_visit(text, text, smallint)          to anon, authenticated;
grant execute on function public.forget_me(text)                            to anon, authenticated;

-- ---------- 表を使える役割（必要なものだけ） ----------
grant usage on schema public to anon, authenticated;
revoke all on participants, visits, spots, submissions, admins, deletion_requests from anon, authenticated;
-- 管理者も、端末の目印（device_key）や確認の回数は見られない
grant select (id, source, faculty, grade, nickname, heard_from, gender, profile_at, created_at) on participants to authenticated;
grant select                 on visits            to authenticated;
grant select, insert, update on spots             to authenticated;
grant select, delete         on submissions       to authenticated;
grant select, delete         on deletion_requests to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- 読み書きのルール（管理者だけが読める） ----------
drop policy if exists "anyone can join"          on participants;
drop policy if exists "anyone can read ids"      on participants;
drop policy if exists "admin reads participants" on participants;
create policy "admin reads participants" on participants for select to authenticated using (public.is_admin());

drop policy if exists "admin reads visits" on visits;
create policy "admin reads visits" on visits for select to authenticated using (public.is_admin());

drop policy if exists "admin manages spots" on spots;
create policy "admin manages spots" on spots for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "anyone can submit"         on submissions;
drop policy if exists "admin reads submissions"   on submissions;
drop policy if exists "admin deletes submissions" on submissions;
create policy "admin reads submissions"   on submissions for select to authenticated using (public.is_admin());
create policy "admin deletes submissions" on submissions for delete to authenticated using (public.is_admin());

drop policy if exists "admin handles deletion requests" on deletion_requests;
create policy "admin handles deletion requests" on deletion_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 画像の保存先（非公開）。PNG・JPEGのみ・1枚2MBまで ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('hands', 'hands', false, 2097152, array['image/png', 'image/jpeg'])
  on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/png', 'image/jpeg'];
drop policy if exists "anyone can upload hand" on storage.objects;
drop policy if exists "admin reads hands"      on storage.objects;
drop policy if exists "admin deletes hands"    on storage.objects;
-- 参加者はアップロードだけ（上書き・閲覧・削除は不可）。ファイル名の形も決めておく
create policy "anyone can upload hand" on storage.objects for insert to anon
  with check (bucket_id = 'hands' and name ~ '^[0-9a-z_]+\.(png|jpg)$');
create policy "admin reads hands"   on storage.objects for select to authenticated using (bucket_id = 'hands' and public.is_admin());
create policy "admin deletes hands" on storage.objects for delete to authenticated using (bucket_id = 'hands' and public.is_admin());

-- ---------- Instagramへの投稿 ----------
-- ストーリー：参加者が「参加する！」の時に「載せる」を選んだ画像だけを、1日1回、自動で投稿する
-- フィード　：本人が「投稿にも使ってよい」を選んだ画像の中から、管理者が選んで投稿する
-- Instagramの鍵（アクセストークン）はデータベースには置かず、Edge Function の Secrets（IG_TOKEN）にだけ置く
alter table submissions add column if not exists story_requested_at timestamptz;   -- 本人が「載せる」を選んだ時刻
alter table submissions add column if not exists story_posting_at   timestamptz;   -- 投稿の処理を始めた時刻（二重投稿を防ぐ）
alter table submissions add column if not exists story_posted_at    timestamptz;
alter table submissions add column if not exists story_media_id     text;
alter table submissions add column if not exists feed_posted_at     timestamptz;
alter table submissions add column if not exists feed_media_id      text;
alter table submissions add column if not exists post_error         text;

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  auto_story boolean not null default true,      -- ストーリーの自動投稿（管理ページで止められる）
  story_daily_cap int not null default 30        -- 24時間に自動で投稿するストーリーの上限（いたずら対策）
);
insert into settings (id) values (1) on conflict do nothing;
alter table settings enable row level security;
revoke all on settings from anon, authenticated;
grant select on settings to authenticated;
grant update (auto_story, story_daily_cap) on settings to authenticated;
drop policy if exists "admin manages settings" on settings;
create policy "admin manages settings" on settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 参加者：今日いちばん新しい画像を、ストーリーに載せてほしいと記録する（1日1回まで）
create or replace function public.request_story(p_device text) returns text
  language plpgsql security definer set search_path = public as $$
declare pid bigint := public._me(p_device); sid bigint;
begin
  if pid is null then return 'unknown'; end if;
  if exists (select 1 from submissions where participant_no = pid
             and (story_requested_at at time zone 'Asia/Tokyo')::date = public._today()) then return 'already'; end if;
  select id into sid from submissions where participant_no = pid and story_path is not null
    and (created_at at time zone 'Asia/Tokyo')::date = public._today() order by created_at desc limit 1;
  if sid is null then return 'none'; end if;
  update submissions set story_requested_at = now() where id = sid;
  return 'ok';
end $$;
revoke all on function public.request_story(text) from public;
grant execute on function public.request_story(text) to anon, authenticated;

-- 参加者：最後の画面で選んだ「ストーリーに載せる」「投稿にも使ってよい」を、今日いちばん新しい画像に記録する
alter table submissions add column if not exists feed_ok boolean not null default false;
create or replace function public.give_consent(p_device text, p_story boolean, p_feed boolean) returns text
  language plpgsql security definer set search_path = public as $$
declare pid bigint := public._me(p_device); sid bigint;
begin
  if pid is null then return 'unknown'; end if;
  select id into sid from submissions where participant_no = pid and story_path is not null
    and (created_at at time zone 'Asia/Tokyo')::date = public._today() order by created_at desc limit 1;
  if sid is null then return 'none'; end if;
  if p_feed then update submissions set feed_ok = true where id = sid; end if;
  if p_story and not exists (select 1 from submissions where participant_no = pid
             and (story_requested_at at time zone 'Asia/Tokyo')::date = public._today()) then
    update submissions set story_requested_at = now() where id = sid;   -- ストーリーは1日1回まで
  end if;
  return 'ok';
end $$;
revoke all on function public.give_consent(text, boolean, boolean) from public;
grant execute on function public.give_consent(text, boolean, boolean) to anon, authenticated;

-- サーバー（Edge Function）だけが使う：投稿してよい画像なら「投稿中」にして、画像の場所を返す
create or replace function public.claim_story(p_id bigint, p_force boolean default false) returns text
  language plpgsql security definer set search_path = public as $$
declare st settings; n int; path text;
begin
  select * into st from settings where id = 1;
  if not p_force and not coalesce(st.auto_story, false) then return null; end if;
  select count(*) into n from submissions where coalesce(story_posting_at, story_posted_at) > now() - interval '24 hours';
  if n >= coalesce(st.story_daily_cap, 30) then
    update submissions set post_error = '24時間の上限に達したため、投稿しませんでした' where id = p_id and story_posted_at is null;
    return null;
  end if;
  update submissions set story_posting_at = now(), post_error = null
   where id = p_id and story_path is not null and story_posted_at is null and story_posting_at is null
     and story_requested_at is not null and (p_force or story_requested_at > now() - interval '30 minutes')
   returning story_path into path;
  return path;
end $$;
revoke all on function public.claim_story(bigint, boolean) from public, anon, authenticated;
grant execute on function public.claim_story(bigint, boolean) to service_role;
-- 投稿のプログラム（Edge Function）が、管理者の確認と投稿結果の記録に使う
grant select on admins to service_role;
grant select, update on submissions to service_role;

-- 「載せる」が記録されたら、Edge Function に合図を送る（中身は送らない。Edge Function がデータベースを見て判断する）
-- ※ 自分で動かす時は、URL を自分のプロジェクトのものに書き換えてください
create extension if not exists pg_net;
create or replace function public._story_signal() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://axwbndpdzlajvpqnegde.supabase.co/functions/v1/instagram',
    body := jsonb_build_object('story', new.id),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return new;
end $$;
revoke all on function public._story_signal() from public, anon, authenticated;
drop trigger if exists story_signal on submissions;
create trigger story_signal after update of story_requested_at on submissions
  for each row when (old.story_requested_at is null and new.story_requested_at is not null)
  execute function public._story_signal();

-- ---------- フィードの自動投稿（3枚で1列・糸の柄がつながる） ----------
-- GitHub Actions（tools/feed）が、使ってよい手が1列ぶんたまったら3枚を描いて「投稿待ち」の列を作り、
-- Edge Function「instagram」が右 → 真ん中 → 左の順に投稿する
alter table submissions add column if not exists feed_row int;   -- どの列に使ったか（1人1回まで）
alter table settings add column if not exists auto_feed boolean not null default false;
alter table settings add column if not exists feed_caption text not null default
  '{no}にんめのおともだち！
つかまえた！
また来てね👹

#鬼ごっこサークル
#立命館大学';
alter table settings add column if not exists feed_caption_first text not null default
  'このゆび、とーまれ！

#鬼ごっこサークル
#立命館大学';
alter table settings add column if not exists feed_caption_blank text not null default
  '#鬼ごっこサークル
#立命館大学';
grant update (auto_feed, feed_caption, feed_caption_first, feed_caption_blank) on settings to authenticated;

create table if not exists feed_rows (
  row_no int primary key,
  status text not null default 'ready',     -- ready（投稿待ち）／posting（投稿中）／posted（投稿済み）／error（失敗）
  error text,
  created_at timestamptz not null default now(),
  posted_at timestamptz
);
create table if not exists feed_posts (
  id bigint generated always as identity primary key,
  row_no int not null references feed_rows(row_no) on delete cascade,
  pos smallint not null,                     -- 0 左／1 真ん中／2 右
  ord smallint not null,                     -- 投稿する順番（右が1）
  path text not null,
  submission_id bigint,
  participant_no bigint,
  caption text not null default '',
  status text not null default 'ready',
  media_id text,
  error text,
  posted_at timestamptz
);
create table if not exists feed_state (
  id int primary key default 1 check (id = 1),
  pattern jsonb,                             -- これまでの柄（次の列へつなぐため）
  next_row int not null default 1,
  updated_at timestamptz
);
alter table feed_rows  enable row level security;
alter table feed_posts enable row level security;
alter table feed_state enable row level security;
revoke all on feed_rows, feed_posts, feed_state from anon, authenticated;
grant select on feed_rows, feed_posts, feed_state to authenticated;
drop policy if exists "admin reads feed rows"  on feed_rows;
drop policy if exists "admin reads feed posts" on feed_posts;
drop policy if exists "admin reads feed state" on feed_state;
create policy "admin reads feed rows"  on feed_rows  for select to authenticated using (public.is_admin());
create policy "admin reads feed posts" on feed_posts for select to authenticated using (public.is_admin());
create policy "admin reads feed state" on feed_state for select to authenticated using (public.is_admin());
-- サーバー（GitHub Actions と Edge Function）が使う
grant select, insert, update on feed_rows, feed_posts, feed_state to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on settings to service_role;

-- ---------- 最初のQR（代表が設置するもの） ----------
insert into spots (token, placer, note) values ('fjpc5t6gz9', '代表', '最初のQR') on conflict (token) do nothing;

-- ▼ 管理者のメールアドレス（書き換えてください。複数人なら行を増やす）
insert into admins (email) values ('your-email@example.com') on conflict do nothing;
