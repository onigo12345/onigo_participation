// フィードの自動投稿（GitHub Actions で15分ごとに動く）
//
// 1. 本人が「投稿にも使ってよい」を選んだ手を、届いた順に集める（1人1回まで）
// 2. 1列ぶん（1列目は創始者の手1つ、2列目からは3人分）たまったら、公式投稿メーカーと同じ柄で3枚を描く
// 3. 画像を保存して「投稿待ち」の列を作り、Supabase の Edge Function に投稿を頼む（右 → 真ん中 → 左の順）
//
// Instagram の鍵はここには置かない（Supabase の Secrets にだけある）。
// ここで使うのは Supabase のサーバー用の鍵（GitHub の Secrets の SUPABASE_SECRET_KEY）だけ。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const BUCKET = "hands";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const POS = ["左", "真ん中", "右"];
const ORDER = [3, 2, 1];   // 投稿する順番（右が最初、左が最後＝プロフィールで左上に来る）
if (!URL_ || !KEY) { console.log("SUPABASE_URL / SUPABASE_SECRET_KEY がないので終了します"); process.exit(0); }

const { createClient } = await import("@supabase/supabase-js");
const db = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };

// ---------- 今やることがあるか ----------
const st = must(await db.from("settings").select("auto_feed, feed_caption, feed_caption_first, feed_caption_blank").eq("id", 1).maybeSingle(), "settings");
if (!st?.auto_feed) { console.log("フィードの自動投稿はオフです"); process.exit(0); }

// 前の列がまだ投稿し終わっていなければ、新しい列は作らない（柄と順番がずれないように）
const open = must(await db.from("feed_rows").select("row_no, status").neq("status", "posted").order("row_no"), "feed_rows");
if (open.length) {
  const r = open[0];
  if (r.status === "ready") await askPost(r.row_no);   // 頼み忘れていた列があれば、もう一度頼む
  else console.log(`${r.row_no}列目が「${r.status}」のままです。管理ページで確認してください`);
  process.exit(0);
}

const state = must(await db.from("feed_state").select("*").eq("id", 1).maybeSingle(), "feed_state");
const row = state?.next_row || 1;
const pattern = state?.pattern || JSON.parse(fs.readFileSync(path.join(ROOT, "tools/feed/seed_pattern.json"), "utf8"));

// ---------- 使ってよい手を、届いた順に（1人1回・本人が最後に選んだ見え方） ----------
const subs = must(await db.from("submissions").select("id, participant_no, image_path, feed_ok, feed_row, created_at")
  .eq("feed_ok", true).order("created_at", { ascending: true }).limit(5000), "submissions");
const used = new Set(subs.filter((s) => s.feed_row != null).map((s) => s.participant_no));
const latest = new Map();
for (const s of subs) if (!used.has(s.participant_no) && s.participant_no != null) latest.set(s.participant_no, s);
const queue = [...latest.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
const need = row === 1 ? 1 : 3;
console.log(`${row}列目：使ってよい手 ${queue.length}人分（必要 ${need}人分）`);
if (queue.length < need) process.exit(0);

// 1列目：真ん中に創始者（最初に届いた手）だけ。2列目から：左・真ん中・右に届いた順
const picks = row === 1 ? [null, queue[0], null] : queue.slice(0, 3);

// ---------- 手の画像を読み込む ----------
const hands = [];
for (const p of picks) {
  if (!p) { hands.push(null); continue; }
  const { data, error } = await db.storage.from(BUCKET).download(p.image_path);
  if (error) throw new Error("手の画像を読めません: " + error.message);
  const b64 = Buffer.from(await data.arrayBuffer()).toString("base64");
  hands.push({ src: "data:image/png;base64," + b64, no: p.participant_no });
}

// ---------- ヘッドレスChromeで、公式投稿メーカーと同じ柄の3枚を描く ----------
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const type = { ".html": "text/html", ".css": "text/css", ".woff2": "font/woff2" }[path.extname(f)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type }); fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${server.address().port}/tools/feed/render.html`);
await page.waitForFunction(() => window.ready);
const out = await page.evaluate((args) => window.renderRow(args), { row, pattern, hands });
await browser.close(); server.close();

// ---------- 保存して「投稿待ち」の列を作る ----------
const caption = (i) => {
  if (row === 1) return i === 1 ? st.feed_caption_first : st.feed_caption_blank;
  return String(st.feed_caption || "").replaceAll("{no}", String(picks[i].participant_no).padStart(3, "0"));
};
const stamp = Date.now();
const posts = [];
for (let i = 0; i < 3; i++) {
  const p = `feed_r${row}_${i}_${stamp}.jpg`;
  const bytes = Buffer.from(out.tiles[i].split(",")[1], "base64");
  must(await db.storage.from(BUCKET).upload(p, bytes, { contentType: "image/jpeg" }), "upload");
  posts.push({ row_no: row, pos: i, ord: ORDER[i], path: p, submission_id: picks[i]?.id ?? null,
    participant_no: picks[i]?.participant_no ?? null, caption: caption(i) || "" });
}
must(await db.from("feed_rows").insert({ row_no: row, status: "ready" }), "feed_rows insert");
must(await db.from("feed_posts").insert(posts), "feed_posts insert");
for (const p of picks) if (p) must(await db.from("submissions").update({ feed_row: row }).eq("id", p.id), "submissions");
must(await db.from("feed_state").upsert({ id: 1, pattern: out.pattern, next_row: row + 1, updated_at: new Date().toISOString() }), "feed_state");
console.log(`${row}列目を作りました：` + picks.map((p, i) => `${POS[i]}=${p ? "No." + p.participant_no : "手なし"}`).join(" / "));

await askPost(row);

// Edge Function に「この列を投稿して」と頼む（右 → 真ん中 → 左の順に投稿される）
async function askPost(n) {
  const r = await fetch(`${URL_}/functions/v1/instagram`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedRow: n }),
  });
  console.log(`${n}列目の投稿：`, r.status, await r.text());
}
