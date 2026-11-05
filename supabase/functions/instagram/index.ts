// Instagram への投稿（Supabase Edge Function「instagram」）
//
// ・ストーリー：参加者が「載せる」を選ぶと、データベースから合図（{story: 画像の番号}）が届く。
//   合図の中身は信用せず、データベースの状態（claim_story）を見て、投稿してよい画像だけを1回だけ投稿する。
// ・フィード：GitHub Actions（tools/feed）が作った列（3枚）を、右 → 真ん中 → 左の順に投稿する。
// ・ストーリーやフィードのやり直し／接続の確認：管理ページから。ログイン中の管理者だけが使える。
//
// Instagram の鍵（アクセストークン）は、Supabase の Edge Functions → Secrets の IG_TOKEN にだけ置く。
// このファイルやデータベース、参加者のブラウザには置かない。
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const GRAPH = "https://graph.facebook.com/v27.0";
const IG_USER = Deno.env.get("IG_USER_ID") || "17841421970707110";   // @onigo12345 の Instagram アカウントID（公開してよい番号）
const TOKEN = Deno.env.get("IG_TOKEN") || "";
const BUCKET = "hands";

// サーバー用の鍵（Supabase が自動で渡してくれる。新しい形式の鍵があればそちらを使う）
function serverKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const k = keys.default || Object.values(keys)[0];
    if (k) return String(k);
  } catch { /* 古い形式だけのプロジェクト */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, serverKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msg = (e: unknown) => String((e as Error)?.message || e).slice(0, 300);

// Instagram（Graph API）を呼ぶ。エラーの時は Instagram からのメッセージをそのまま投げる
async function graph(path: string, params: Record<string, string>, method: "GET" | "POST" = "POST") {
  const q = new URLSearchParams({ ...params, access_token: TOKEN });
  const r = method === "GET" ? await fetch(`${GRAPH}/${path}?${q}`) : await fetch(`${GRAPH}/${path}`, { method, body: q });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.error_user_msg || j.error?.message || `Instagram HTTP ${r.status}`);
  return j;
}

// 画像を1枚投稿する（入れ物を作る → 準備ができるまで待つ → 公開）
async function publish(imageUrl: string, kind: "story" | "feed", caption = "") {
  const c = await graph(`${IG_USER}/media`, kind === "story"
    ? { image_url: imageUrl, media_type: "STORIES" }
    : { image_url: imageUrl, caption });
  for (let i = 0; i < 20; i++) {
    const s = await graph(c.id, { fields: "status_code" }, "GET");
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram が画像を受け取れませんでした（${s.status_code}）`);
    await sleep(1500);
  }
  const p = await graph(`${IG_USER}/media_publish`, { creation_id: c.id });
  return String(p.id);
}

// Instagram が画像を取りに来るための、15分だけ使えるURL
async function signedUrl(path: string) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 900);
  if (error || !data?.signedUrl) throw error || new Error("画像のURLを作れませんでした");
  return data.signedUrl;
}

async function postStory(id: number, force = false) {
  const { data: path, error } = await db.rpc("claim_story", { p_id: id, p_force: force });
  if (error) return { status: "error", message: error.message };
  if (!path) return { status: "skip" };   // 載せない設定・上限・投稿済みなど
  try {
    const media = await publish(await signedUrl(path as string), "story");
    await db.from("submissions").update({ story_posted_at: new Date().toISOString(), story_media_id: media, post_error: null }).eq("id", id);
    return { status: "ok", media };
  } catch (e) {
    await db.from("submissions").update({ post_error: "ストーリー：" + msg(e) }).eq("id", id);
    return { status: "error", message: msg(e) };
  }
}

// フィード：GitHub Actions が作った「投稿待ち」の列を、右 → 真ん中 → 左の順に投稿する
// 同じ列を2か所から同時に投稿しないよう、列を「投稿中」にできた1か所だけが進める
async function postFeedRow(row: number) {
  const { data: claimed, error } = await db.from("feed_rows").update({ status: "posting", error: null })
    .eq("row_no", row).eq("status", "ready").select("row_no");
  if (error) return { status: "error", message: error.message };
  if (!claimed?.length) return { status: "skip" };
  const { data: posts } = await db.from("feed_posts").select("*").eq("row_no", row).order("ord");
  for (const p of posts || []) {
    if (p.status === "posted") continue;
    try {
      const media = await publish(await signedUrl(p.path), "feed", p.caption || "");
      await db.from("feed_posts").update({ status: "posted", media_id: media, error: null, posted_at: new Date().toISOString() }).eq("id", p.id);
      if (p.submission_id) await db.from("submissions").update({ feed_posted_at: new Date().toISOString(), feed_media_id: media }).eq("id", p.submission_id);
    } catch (e) {
      await db.from("feed_posts").update({ status: "error", error: msg(e) }).eq("id", p.id);
      await db.from("feed_rows").update({ status: "error", error: msg(e) }).eq("row_no", row);
      return { status: "error", message: msg(e) };
    }
    await sleep(4000);   // 投稿の順番がInstagramの中でも入れ替わらないよう、少し間をあける
  }
  await db.from("feed_rows").update({ status: "posted", posted_at: new Date().toISOString() }).eq("row_no", row);
  return { status: "ok" };
}

// 管理ページから来たか（ログイン中の管理者か）を確かめる。だめな時は理由を返す
async function adminCheck(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt || jwt.startsWith("sb_")) return "ログインの情報が届いていません（管理ページに入り直してください）";
  const { data, error } = await db.auth.getUser(jwt);
  if (error) return "ログインの確認に失敗しました：" + error.message;
  const email = data?.user?.email?.toLowerCase();
  if (!email) return "ログイン中のメールアドレスがわかりません";
  const { data: admins, error: e2 } = await db.from("admins").select("email");
  if (e2) return "管理者の一覧を読めません：" + e2.message;
  return (admins || []).some((a) => String(a.email).toLowerCase() === email) ? null : `${email} は管理者に入っていません`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!TOKEN) return json({ status: "error", message: "IG_TOKEN（Instagramの鍵）が Secrets に入っていません" }, 500);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.story ?? body.retryStory);

  // GitHub Actions からの合図：「投稿待ち」の列を順番どおりに投稿するだけなので、ログインは要らない
  if (body.feedRow != null) {
    const row = Number(body.feedRow);
    if (!Number.isSafeInteger(row)) return json({ error: "bad row" }, 400);
    return json(await postFeedRow(row));
  }

  // データベースからの合図：誰が呼んでも、投稿してよい画像を1回だけ投稿するだけなので、ログインは要らない
  if (body.story != null) {
    if (!Number.isSafeInteger(id)) return json({ error: "bad id" }, 400);
    const task = postStory(id);
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) { rt.waitUntil(task); return json({ status: "accepted" }); }
    return json(await task);
  }

  const ng = await adminCheck(req);
  if (ng) return json({ status: "error", message: "管理者だけが使えます（" + ng + "）" }, 403);

  if (body.check) {
    try {
      const me = await graph(IG_USER, { fields: "username" }, "GET");
      return json({ status: "ok", username: me.username });
    } catch (e) { return json({ status: "error", message: msg(e) }); }
  }
  if (body.retryStory != null && Number.isSafeInteger(id)) {
    await db.from("submissions").update({ story_posting_at: null }).eq("id", id).is("story_posted_at", null);
    return json(await postStory(id, true));
  }
  if (body.retryFeedRow != null && Number.isSafeInteger(Number(body.retryFeedRow))) {
    const row = Number(body.retryFeedRow);
    await db.from("feed_rows").update({ status: "ready" }).eq("row_no", row).eq("status", "error");
    return json(await postFeedRow(row));
  }
  return json({ status: "error", message: "unknown request" }, 400);
});
