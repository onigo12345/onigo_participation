// フィードの自動投稿（GitHub Actions で15分ごとに動く）
//
// 1. 本人が「投稿にも使ってよい」を選び、運営者が承認した手を、参加番号の小さい順に集める（1人1回まで）
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
// 試運転（DRY_RUN=1）：画像の読み込み・柄の描画・保存ができるかだけを確かめる。投稿も記録もしない
const DRY = process.env.DRY_RUN === "1";
const st = must(await db.from("settings").select("auto_feed, feed_force, feed_caption, feed_caption_first, feed_caption_blank").eq("id", 1).maybeSingle(), "settings");
if (!st?.auto_feed && !DRY) { console.log("フィードの自動投稿はオフです"); process.exit(0); }

// 前の列がまだ投稿し終わっていなければ、新しい列は作らない（柄と順番がずれないように）
const open = must(await db.from("feed_rows").select("row_no, status").neq("status", "posted").order("row_no"), "feed_rows");
if (open.length && !DRY) {
  const r = open[0];
  if (r.status === "ready") await askPost(r.row_no);   // 頼み忘れていた列があれば、もう一度頼む
  else console.log(`${r.row_no}列目が「${r.status}」のままです。管理ページで確認してください`);
  process.exit(0);
}

const state = must(await db.from("feed_state").select("*").eq("id", 1).maybeSingle(), "feed_state");
// 途中まで投稿した列（「今ある手で次の列を投稿する」で、右から先に投稿して左側をあけてある列）があれば、新しい列より先にそこを埋める
// あいているのは左側（pos が open_slots より小さいマス）。1人ずつ、右に近いマスから埋めて投稿する（プロフィールで左上が最新になる順）
const partial = DRY ? null : (must(await db.from("feed_rows").select("row_no, open_slots").gt("open_slots", 0).order("row_no").limit(1), "feed_rows（途中の列）") || [])[0] || null;
const row = partial ? partial.row_no : state?.next_row || 1;
const pattern = state?.pattern || JSON.parse(fs.readFileSync(path.join(ROOT, "tools/feed/seed_pattern.json"), "utf8"));

// ---------- 使ってよい手を、参加番号の順に（1人1回・本人が最後に選んだ見え方。帰った順ではなく、来た順の番号でそろえる） ----------
let sq = db.from("submissions").select("id, participant_no, image_path, feed_ok, feed_row, created_at").order("created_at", { ascending: true }).limit(5000);
if (!DRY) sq = sq.eq("feed_ok", true).not("approved_at", "is", null);   // 本人が選び、運営者が承認したものだけ。試運転では同意に関係なく手を使う（描くだけで、投稿も保存もしない）
const subs = must(await sq, "submissions");
const used = new Set(subs.filter((s) => s.feed_row != null).map((s) => s.participant_no));
const latest = new Map();
for (const s of subs) if (!used.has(s.participant_no) && s.participant_no != null) latest.set(s.participant_no, s);
const queue = [...latest.values()].sort((a, b) => a.participant_no - b.participant_no);
const force = !DRY && !partial && row > 1 && !!st.feed_force;   // 管理ページの「今ある手で次の列を投稿する」：3人に満たなくても、今ある手を右から並べて先に投稿し、左はあとで埋める
const need = DRY || partial ? 1 : row === 1 ? 1 : force ? 1 : 3;
console.log(`${row}列目：使ってよい手 ${queue.length}人分（必要 ${need}人分）${DRY ? "【試運転】" : ""}`);
if (queue.length < need) process.exit(0);

// 1列目：真ん中に創始者（番号のいちばん小さい手）だけ。2列目から：右・真ん中・左に参加番号の小さい順
// （投稿は右 → 真ん中 → 左の順。番号の小さい人から先に投稿され、プロフィールでは左上がいちばん新しい番号になる）
// 途中の列を埋める時：あいているマスのうち、いちばん右のマスに1人だけ
// 今ある手で作る時（3人に満たない）：右から詰めて置き、左のあいたマスはあとで埋める
let picks, openAfter = 0;
if (DRY) picks = [queue[1 % queue.length], queue[0], queue[2 % queue.length]];
else if (partial) { const pos = partial.open_slots - 1; picks = [0, 1, 2].map((i) => (i === pos ? queue[0] : null)); openAfter = pos; }
else if (row === 1) picks = [null, queue[0], null];
else if (queue.length >= 3) picks = queue.slice(0, 3).reverse();
else { const k = queue.length; openAfter = 3 - k; picks = [...Array(openAfter).fill(null), ...queue.slice(0, k).reverse()]; }
// 投稿する画像：1列目は3枚とも（左右は手なし）。それ以外は手のあるマスだけ
const outPos = [0, 1, 2].filter((i) => row === 1 || picks[i]);

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
// 途中の列を埋める時は、今の柄（その列の糸と丸をすでに含む）でもう一度その列を描き、埋めるマスだけを使う＝前に投稿した2枚とつながる
const out = await page.evaluate((args) => window.renderRow(args), { row: DRY ? Math.max(2, row) : row, pattern, hands });
await browser.close(); server.close();

if (DRY) {
  const sizes = out.tiles.map((t) => Math.round(Buffer.from(t.split(",")[1], "base64").length / 1024) + "KB");
  const test = `feed_dryrun_${Date.now()}.jpg`;
  must(await db.storage.from(BUCKET).upload(test, Buffer.from(out.tiles[1].split(",")[1], "base64"), { contentType: "image/jpeg" }), "upload（試運転）");
  must(await db.storage.from(BUCKET).remove([test]), "remove（試運転）");
  console.log(`【試運転】手の読み込み・柄の描画・画像の保存と削除ができました。画像の大きさ：${sizes.join(" / ")}（投稿も記録もしていません）`);
  process.exit(0);
}

// ---------- 保存して「投稿待ち」の列を作る ----------
const caption = (i) => {
  if (row === 1) return i === 1 ? st.feed_caption_first : st.feed_caption_blank;
  if (!picks[i]) return st.feed_caption_blank;   // 手なしのマス
  return String(st.feed_caption || "").replaceAll("{no}", String(picks[i].participant_no));
};
const stamp = Date.now();
const posts = [];
for (const i of outPos) {
  const p = `feed_r${row}_${i}_${stamp}.jpg`;
  const bytes = Buffer.from(out.tiles[i].split(",")[1], "base64");
  must(await db.storage.from(BUCKET).upload(p, bytes, { contentType: "image/jpeg" }), "upload");
  posts.push({ row_no: row, pos: i, ord: ORDER[i], path: p, submission_id: picks[i]?.id ?? null,
    participant_no: picks[i]?.participant_no ?? null, caption: caption(i) || "" });
}
if (partial) must(await db.from("feed_rows").update({ status: "ready", open_slots: openAfter, posted_at: null }).eq("row_no", row), "feed_rows update");
else must(await db.from("feed_rows").insert({ row_no: row, status: "ready", open_slots: openAfter }), "feed_rows insert");
must(await db.from("feed_posts").insert(posts), "feed_posts insert");
for (const p of picks) if (p) must(await db.from("submissions").update({ feed_row: row }).eq("id", p.id), "submissions");
if (force) must(await db.from("settings").update({ feed_force: false }).eq("id", 1), "settings");
must(await db.from("feed_state").upsert({ id: 1, pattern: out.pattern, next_row: partial ? state.next_row : row + 1, updated_at: new Date().toISOString() }), "feed_state");
console.log(`${row}列目を作りました：` + picks.map((p, i) => `${POS[i]}=${p ? "No." + p.participant_no : i < openAfter ? "あとで" : "手なし"}`).join(" / "));

await askPost(row);

// Edge Function に「この列を投稿して」と頼む（右 → 真ん中 → 左の順に投稿される）
async function askPost(n) {
  const r = await fetch(`${URL_}/functions/v1/instagram`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedRow: n }),
  });
  console.log(`${n}列目の投稿：`, r.status, await r.text());
}
