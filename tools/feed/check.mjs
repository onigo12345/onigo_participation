// フィードの自動投稿：重い準備（Chromeのインストール）をする前に、やることがあるかだけを軽く調べる
import fs from "node:fs";
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const say = (need, why) => { console.log(why); if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `need=${need}\n`); process.exit(0); };
if (!URL_ || !KEY) say(false, "SUPABASE_SECRET_KEY が GitHub の Secrets に入っていません");
const get = async (q) => { const r = await fetch(`${URL_}/rest/v1/${q}`, { headers: { apikey: KEY } }); if (!r.ok) throw new Error(q + " " + r.status + " " + await r.text()); return r.json(); };
const [st] = await get("settings?id=eq.1&select=auto_feed");
if (!st?.auto_feed) say(false, "フィードの自動投稿はオフです");
const open = await get("feed_rows?status=neq.posted&select=row_no,status");
if (open.length) say(open.some((r) => r.status === "ready"), `投稿し終わっていない列があります：${JSON.stringify(open)}`);
const [fs_] = await get("feed_state?id=eq.1&select=next_row");
const row = fs_?.next_row || 1;
const subs = await get("submissions?feed_ok=eq.true&select=participant_no,feed_row&limit=5000");
const used = new Set(subs.filter((s) => s.feed_row != null).map((s) => s.participant_no));
const waiting = new Set(subs.filter((s) => s.participant_no != null && !used.has(s.participant_no)).map((s) => s.participant_no)).size;
const need = row === 1 ? 1 : 3;
say(waiting >= need, `${row}列目：使ってよい手 ${waiting}人分（必要 ${need}人分）`);
