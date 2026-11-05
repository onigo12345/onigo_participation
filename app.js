// 立命館OIC 鬼ごっこサークル「つかまえた。」参加者アプリ
// 手の検出ライブラリはあとから読み込む（読み込みに失敗しても、画面やカメラは動くように）
const VISION = "./vendor/mediapipe/vision_bundle.mjs";   // 手の検出（Google MediaPipe・Apache 2.0）。同梱して外部には接続しない
let vision = null;

const CFG = window.APP_CONFIG || {};
const W = 1080, H = 1920;   // Instagramストーリー（9:16）
const C = { red: "#e82c34", blue: "#1c48c4", purple: "#9a26d9", paper: "#faf8f4", ink: "#19161e" };
const $ = (id) => document.getElementById(id);
// 古いページ（ブラウザに残ったもの）と新しいプログラムが混ざった時は、一度だけ新しく読み直す
if (!$("ruleNext") || !$("chooseSkip") || !$("doneB") || !$("okFeed")) {
  let tried = false; try { tried = sessionStorage.getItem("onigokko_reload") === location.search; } catch {}
  if (!tried) {
    try { sessionStorage.setItem("onigokko_reload", location.search); } catch {}
    const u = new URL(location.href); u.searchParams.set("v", Date.now().toString(36)); location.replace(u.href);
  }
  await new Promise(() => {});   // 読み直しが終わるまで止めておく
}
const sb = (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
if (CFG.SUPABASE_URL && !sb) console.error("Supabase のライブラリを読み込めませんでした。お試しモードで動きます。");

let myNo = null, lastPhoto = null, lastLm = null, stream = null, facing = "environment", lastBlob = null;
let photoId = 0, renderSeq = 0;

/* ---------- 小さな道具 ---------- */
function show(id) { for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id; }
function toast(t, ms = 2600) {
  const el = $("toast"); el.textContent = t; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), ms);
}
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, sleep(ms).then(() => { throw new Error("timeout"); })]);
function canvas(w, h) { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
// iPhone は使い終わったキャンバスのメモリをすぐ返さず、上限を超えると描けなくなるので、明示的に解放する
function free(...cs) { for (const c of cs) if (c) { c.width = 0; c.height = 0; } }
function showCamMessage(text, label, onClick) {
  const m = $("camMsg"); m.hidden = false; m.textContent = "";
  const p = document.createElement("div"); p.textContent = text;
  const b = document.createElement("button"); b.className = "btn"; b.type = "button"; b.textContent = label; b.onclick = onClick;
  m.append(p, b); $("shutter").disabled = true;
}

// 予期しないエラーは画面の下に短く表示する（原因を見つけやすくするため）
window.addEventListener("error", (e) => toast("エラー：" + (e.message || "不明"), 6000));
window.addEventListener("unhandledrejection", (e) => toast("エラー：" + (e.reason?.message || e.reason || "不明"), 6000));

/* ---------- 1. 来場の記録と参加番号（同じスマホは何度開いても同じ番号） ---------- */
// 来た時のQRを開くと、その日の来場（時刻・どのQRから来たか）を記録する。通信に失敗したら、撮影の時にもう一度
let joinPromise = null, hasProfile = false;
function getNumber() {
  if (!joinPromise) joinPromise = (async () => {
    for (let i = 0; i < 3; i++) {
      try { const r = await window.Visit.join(); hasProfile = !!r.has_profile; return r; }
      catch (e) { console.warn("join failed", e); await sleep(800 * (i + 1)); }
    }
    throw new Error("count");
  })().catch((e) => { joinPromise = null; throw e; });
  return joinPromise.then((r) => r.no);
}
function showNumber() {
  getNumber().then((n) => { myNo = n; $("countNum").textContent = n; return joinPromise; })
    .then((r) => {   // 2回目以降の人には「おかえり」
      if (r.visits > 1) { $("welcomeTitle").innerHTML = "おかえり！<br>今日も来てくれて<br>ありがとう！"; $("visitNote").textContent = `今日で${r.visits}回目の参加です`; $("visitNote").hidden = false; }
    })
    .catch(() => { $("countNum").textContent = "?"; toast("参加番号を取得できませんでした。電波の良い場所で開き直してね。", 4000); });
}
showNumber();

/* ---------- アンケート（初めての人だけ・1画面） ---------- */
async function goNext() {
  try { await withTimeout(joinPromise || getNumber(), 8000); } catch {}
  if (hasProfile) startRules(); else show("s-survey");
}
$("survey").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nick = $("nickname").value.trim();
  if (!$("faculty").value) { toast("学部を選んでね"); return; }
  if (!nick) { toast("ニックネームを入れてね"); return; }
  const btn = $("surveyGo"); btn.disabled = true;
  try {
    const r = await window.Visit.saveProfile({ faculty: $("faculty").value, grade: $("grade").value, nickname: nick.slice(0, 20), heard: $("heard").value });
    if (r && r.status === "exists") {   // 同じ学部・同じニックネームの人がいる → 本人か確認
      $("sameName").textContent = `${nick}さん（${$("faculty").value}）`;
      $("same").hidden = false; return;
    }
    hasProfile = true; startRules();
  } catch (err) { console.warn(err); toast("送れませんでした。電波の良い場所でもう一度押してね。", 3500); }
  finally { btn.disabled = false; }
});
// 「前にも来た？」の確認
$("sameYes").addEventListener("click", async () => {
  $("sameYes").disabled = true;
  try {
    const r = await window.Visit.relink({ faculty: $("faculty").value, nickname: $("nickname").value.trim() });
    if (r.status === "busy") { $("same").hidden = true; toast("その名前の人は、今日はもう参加しています。名前を少し変えてね", 4000); $("nickname").focus(); return; }
    if (r.status !== "ok") throw new Error(r.status);
    myNo = r.no; $("countNum").textContent = r.no; hasProfile = true; $("same").hidden = true;
    toast("おかえり！", 2400); startRules();
  } catch (err) { console.warn(err); toast("つなげませんでした。電波の良い場所でもう一度押してね。", 3500); }
  finally { $("sameYes").disabled = false; }
});
$("sameNo").addEventListener("click", () => {
  $("same").hidden = true; $("nickname").focus(); $("nickname").select();
  toast("同じ名前の人がいるので、少し変えてね（例：たっくん2）", 4000);
});
$("surveySkip").addEventListener("click", () => startRules());

/* ---------- 公園でのお願い（1枚ずつ）→ 手を撮影するか選ぶ ---------- */
const RULES = [
  { text: "公園で遊ぶ<br>子どもたちに<br>気をつけてね！", color: "var(--red)" },
  { text: "モルックサークルの<br>皆さんの邪魔を<br>しないように！", color: "var(--blue)" },
  { text: "他の人の邪魔になる<br>場所では<br>遊ばないように！", sub: "遊具・歩道エリア等", color: "var(--purple)" },
];
let ruleIdx = 0;
function startRules() { ruleIdx = 0; showRule(); show("s-rules"); }
function showRule() {
  const r = RULES[ruleIdx];
  $("ruleText").innerHTML = r.text; $("ruleText").style.color = r.color;
  $("ruleSub").textContent = r.sub || ""; $("ruleSub").hidden = !r.sub;
  $("ruleDots").innerHTML = RULES.map((_, i) => `<i class="${i === ruleIdx ? "on" : ""}"></i>`).join("");
  const card = $("ruleCard"); card.classList.remove("in"); void card.offsetWidth; card.classList.add("in");
}
$("ruleNext").addEventListener("click", () => {
  if (ruleIdx < RULES.length - 1) { ruleIdx++; showRule(); } else show("s-choose");
});
$("chooseShoot").addEventListener("click", startCamera);
$("chooseSkip").addEventListener("click", finishWithoutPhoto);
// 参加完了：「それでは楽しんできてね！」→ 少しして「近くの人と一緒に鬼を決めてね！」に切り替わる（タップでもすぐ切り替わる）
function showDone() {
  $("doneNo").textContent = myNo || "?";
  $("doneA").hidden = false; $("doneB").hidden = true;
  show("s-done");
  clearTimeout(showDone.t); showDone.t = setTimeout(toOni, 3500);
}
function toOni() { clearTimeout(showDone.t); $("doneA").hidden = true; $("doneB").hidden = false; }
$("s-done").addEventListener("click", () => { if ($("doneB").hidden) toOni(); });
function finishWithoutPhoto() { showDone(); }

/* ---------- 手の検出モデル（裏で先に読み込む。失敗したら次の撮影でもう一度） ---------- */
const WASM = new URL("vendor/mediapipe/wasm", location.href).href;
// 手の検出モデル：同梱したものを使う。まだ同梱されていない時だけ Google の配布元から読む（写真は送らない）
const MODEL_LOCAL = new URL("vendor/mediapipe/hand_landmarker.task", location.href).href;
const MODEL_REMOTE = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
let MODEL = MODEL_LOCAL;
let modelPromise = null, fileset = null;
const createLandmarker = (delegate) => vision.HandLandmarker.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "IMAGE", numHands: 2, minHandDetectionConfidence: 0.4,
});
function loadModel() {
  if (!modelPromise) modelPromise = (async () => {
    vision = vision || await import(VISION);
    try { const r = await fetch(MODEL_LOCAL, { method: "HEAD" }); if (!r.ok) MODEL = MODEL_REMOTE; } catch { MODEL = MODEL_REMOTE; }
    fileset = fileset || await vision.FilesetResolver.forVisionTasks(WASM);
    try { return await createLandmarker("GPU"); } catch { return await createLandmarker("CPU"); }
  })().catch((e) => { modelPromise = null; throw e; });
  return modelPromise;
}
loadModel().catch((e) => console.warn("model", e));
async function detectHands(img) {
  let lmk = await loadModel();
  try { return lmk.detect(img); }
  catch (e) { // GPUで失敗する端末があるので、CPUで作り直してもう一度
    console.warn("detect GPU failed", e);
    modelPromise = createLandmarker("CPU"); lmk = await modelPromise; return lmk.detect(img);
  }
}

/* ---------- 文字のフォント（日本語の字形は使う文字を指定して読み込まないと、画像に反映されない） ---------- */
let fontsPromise = null;
function loadFonts() {
  const text = "つかまえた。人目のおともだちつぎは君も、このゆびとーまれ！0123456789No.RITSUMEIKANOICONIGOKKOCIRCLE @_"
    + (CFG.INSTAGRAM || "") + (CFG.PLACE || "");
  if (!fontsPromise) fontsPromise = withTimeout(Promise.all(
    ["900 76px", "700 46px", "500 26px"].map((f) => document.fonts.load(`${f} "Noto Sans JP"`, text))), 6000).catch(() => {});
  return fontsPromise;
}
loadFonts();

/* ---------- 2. カメラ ---------- */
$("toCamera").addEventListener("click", goNext);
$("back").addEventListener("click", () => { stopCamera(); show("s-choose"); });
$("flip").addEventListener("click", () => { facing = facing === "environment" ? "user" : "environment"; startCamera(); });
$("retake").addEventListener("click", () => { flushUpload(); startCamera(); });
$("finish").addEventListener("click", () => {
  flushUpload(); showDone();
  const story = $("okStory").checked, feed = $("okFeed").checked;
  if (story || feed) sendConsent(story, feed);
});
// 使ってよいと選んだ人：画像の保存が終わってから、その選択を記録する（投稿はサーバー・管理者が行う）
async function sendConsent(story, feed) {
  try { if (uploading) await uploading; await window.Visit.consent(story, feed); }
  catch (e) { console.warn("consent", e); }
}

async function startCamera() {
  show("s-camera"); stopCamera(); $("camMsg").hidden = true; $("shutter").disabled = false;
  // LINE・Instagramの中のブラウザや古いiPhoneでは、ページの中でカメラを使えない
  if (!navigator.mediaDevices?.getUserMedia) {
    showCamFallback("このブラウザではページの中でカメラを使えません。検索アプリやブラウザアプリの設定によっては、カメラが起動しないことがあります。SafariやChromeで開き直すか、下のボタンからカメラアプリで撮影してね。");
    return;
  }
  const tries = [
    { video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
    { video: { facingMode: facing }, audio: false },
    { video: true, audio: false },                     // 条件をゆるめてもう一度
  ];
  let lastErr = null;
  for (const c of tries) {
    try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
    catch (e) { lastErr = e; if (e.name === "NotAllowedError" || e.name === "SecurityError") break; }
  }
  if (!stream) { showCamFallback(cameraErrorText(lastErr)); return; }
  try {
    const v = $("video");
    v.setAttribute("playsinline", ""); v.setAttribute("muted", ""); v.muted = true;
    v.srcObject = stream; v.style.transform = facing === "user" ? "scaleX(-1)" : "";
    await v.play();
  } catch (e) { console.warn("play", e); }          // iPhoneで再生が遅れても、映像が出ればシャッターは使える
}
function cameraErrorText(e) {
  const n = e?.name || "";
  if (n === "NotAllowedError") return "カメラの使用が許可されていません。iPhoneは「設定 → アプリ → Safari → カメラ」を「確認」か「許可」にして開き直すか、下のボタンからカメラアプリで撮影してね。";
  if (n === "NotReadableError") return "ほかのアプリがカメラを使っているようです。ほかのアプリを閉じてもう一度試すか、下のボタンからカメラアプリで撮影してね。";
  if (n === "NotFoundError") return "カメラが見つかりませんでした。下のボタンから写真を選んでね。";
  return `カメラを起動できませんでした（${n || "不明"}）。検索アプリやブラウザアプリの設定によっては、カメラが起動しないことがあります。下のボタンからカメラアプリで撮影してね。`;
}
// カメラアプリで撮る：iPhoneでも確実に開くよう、ボタンそのものをファイル入力のラベルにする
function showCamFallback(text) {
  const m = $("camMsg"); m.hidden = false; m.textContent = "";
  const p = document.createElement("div"); p.textContent = text;
  const l = document.createElement("label"); l.className = "btn"; l.htmlFor = "fileFallback"; l.textContent = "カメラアプリで撮る";
  m.append(p, l); $("shutter").disabled = true;
}
function stopCamera() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }
document.addEventListener("visibilitychange", () => { if (document.hidden) { stopCamera(); flushUpload(); } });

$("shutter").addEventListener("click", () => {
  const v = $("video"); if (!v.videoWidth || $("shutter").disabled) return;
  $("shutter").disabled = true;                       // 連打で2回生成しないように
  const c = canvas(v.videoWidth, v.videoHeight), g = c.getContext("2d");
  if (facing === "user") { g.translate(c.width, 0); g.scale(-1, 1); }
  g.drawImage(v, 0, 0); stopCamera(); generate(c);
});
$("fileFallback").addEventListener("change", (e) => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 1920 / Math.max(img.width, img.height));
    const c = canvas(img.width * k, img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); generate(c);
  };
  img.onerror = () => showCamFallback("この写真は読み込めませんでした。もう一度撮ってね。");
  img.src = URL.createObjectURL(f); e.target.value = "";
});

/* ---------- どのブラウザでも効く画像処理 ----------
   iPhoneのSafariは canvas の filter（blur・brightness など）が効かないため、自前で行う */
function blurred(src, r) {                            // 半分ずつ縮めてから、倍ずつ戻す方法でぼかす（ムラが出にくい）
  const target = Math.max(1, r / 1.4);
  const steps = [];
  let cur = src, f = 1;
  while (f * 2 <= target) {
    const n = canvas(cur.width / 2, cur.height / 2), ng = n.getContext("2d");
    ng.imageSmoothingQuality = "high"; ng.drawImage(cur, 0, 0, n.width, n.height);
    if (cur !== src) steps.push(cur); cur = n; f *= 2;
  }
  for (let i = steps.length - 1; i >= -1; i--) {      // 縮めた段を逆にたどって元の大きさへ
    const w = i >= 0 ? steps[i].width : src.width, h = i >= 0 ? steps[i].height : src.height;
    const n = canvas(w, h), ng = n.getContext("2d");
    ng.imageSmoothingQuality = "high"; ng.drawImage(cur, 0, 0, w, h);
    if (cur !== src) free(cur); cur = n;
  }
  free(...steps);
  return cur === src ? copyOf(src) : cur;
}
function tone(c, bright, contrast, sat) {             // 明るさ・コントラスト・彩度
  const g = c.getContext("2d"), id = g.getImageData(0, 0, c.width, c.height), a = id.data;
  for (let i = 0; i < a.length; i += 4) {
    let r = a[i] * bright, gr = a[i + 1] * bright, b = a[i + 2] * bright;
    r = (r - 128) * contrast + 128; gr = (gr - 128) * contrast + 128; b = (b - 128) * contrast + 128;
    const l = 0.3 * r + 0.59 * gr + 0.11 * b;
    a[i] = l + (r - l) * sat; a[i + 1] = l + (gr - l) * sat; a[i + 2] = l + (b - l) * sat;
  }
  g.putImageData(id, 0, 0); return c;
}
function copyOf(src) { const c = canvas(src.width, src.height); c.getContext("2d").drawImage(src, 0, 0); return c; }

/* ---------- 手の見え方フィルター ---------- */
// 手をそのまま見せたくない人向け。"soft" = 明るく、モヤがかかったようにふんわりぼかす／"blur" = さらに強くぼかし、手の形と色だけがわかる程度にする
let filterMode = "none";
function softFilter(photo, lm) {
  const palm = dist(lm[0], lm[9]);
  const c = tone(copyOf(photo), 1.1, 0.94, 0.94), g = c.getContext("2d");
  // 細かい質感（毛・乾燥）をならす：ぼかした写真を重ねる
  const smooth = blurred(c, Math.max(2, palm * 0.05));
  g.globalAlpha = 0.75; g.drawImage(smooth, 0, 0);
  // 光がにじむモヤ：大きくぼかした明るい層を「スクリーン」で重ねる
  const haze = tone(blurred(photo, Math.max(5, palm * 0.12)), 1.2, 1, 1);
  g.globalCompositeOperation = "screen"; g.globalAlpha = 0.22; g.drawImage(haze, 0, 0);
  // 白いベール
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 0.05; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.globalAlpha = 1;
  free(smooth, haze); return c;
}
// 強くぼかす：細かいところは見えず、手の形と色だけがわかる程度
function strongBlur(photo, lm) {
  const palm = dist(lm[0], lm[9]);
  const c = tone(copyOf(photo), 1.15, 0.9, 0.9), g = c.getContext("2d");
  const heavy = blurred(c, Math.max(5, palm * 0.11));
  g.drawImage(heavy, 0, 0);
  const haze = tone(blurred(photo, Math.max(9, palm * 0.22)), 1.25, 1, 1);
  g.globalCompositeOperation = "screen"; g.globalAlpha = 0.28; g.drawImage(haze, 0, 0);
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 0.09; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.globalAlpha = 1;
  free(heavy, haze); return c;
}
// （使っていない）手の形をオレンジで塗る見え方の色
const SHAPE_COLOR = "#f5821f";
const photoForMode = () => (filterMode === "soft" ? softFilter(lastPhoto, lastLm) : filterMode === "blur" ? strongBlur(lastPhoto, lastLm) : lastPhoto);

async function renderResult() {
  const seq = ++renderSeq;                            // 切り替えを連打しても、最後に押したものだけを表示
  const src = photoForMode();
  const post = compose(src, lastLm, myNo, false, lastPhoto);   // 手の形は、加工前の写真から推定する
  if (src !== lastPhoto) free(src);
  const blob = await new Promise((r) => post.toBlob(r, "image/jpeg", 0.92));
  free(post);
  if (seq !== renderSeq) return;
  lastBlob = blob;
  const old = $("result").src, url = URL.createObjectURL(blob);
  $("result").src = url; $("save").href = url; $("save").download = `onigokko_${pad(myNo)}.jpg`;
  if (old.startsWith("blob:")) URL.revokeObjectURL(old);
}
$("filters").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b || !lastPhoto || b.dataset.v === filterMode) return;
  filterMode = b.dataset.v;
  document.querySelectorAll("#filters button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  await renderResult();
  markChanged();
});

/* ---------- 3. 生成 ---------- */
async function generate(photo) {
  show("s-loading"); $("loadingText").textContent = "画像をつくっています…";
  try {
    try { myNo = await withTimeout(getNumber(), 10000); } catch { throw new Error("count"); }
    $("countNum").textContent = myNo;
    const res = await withTimeout(detectHands(photo), 30000);
    if (!res.landmarks?.length) throw new Error("nohand");
    // 一番大きく写っている手を使う
    const hands = res.landmarks.map((l) => l.map((p) => ({ x: p.x * photo.width, y: p.y * photo.height })));
    const lm = hands.sort((a, b) => dist(b[0], b[9]) - dist(a[0], a[9]))[0];
    await loadFonts();
    // 以降の処理は手のまわりだけを切り出して行う（メモリと時間の節約）
    const crop = cropToHand(photo, lm);
    evenBrightness(crop.photo, crop.lm);   // 暗い場所で撮っても、手の明るさがそろうように
    free(photo); free(lastPhoto);
    lastPhoto = crop.photo; lastLm = crop.lm; photoId++;
    filterMode = "none";
    document.querySelectorAll("#filters button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === "none"));
    await renderResult();
    show("s-result");
    markChanged();
    window.Visit.mark("image");
  } catch (e) {
    console.warn(e);
    show("s-camera");
    const msg = e.message === "nohand" ? "手が見つかりませんでした。手のひら全体が写るように、もう一度撮ってね。"
      : e.message === "count" ? "参加番号を取得できませんでした。電波の良い場所でもう一度試してね。"
      : "読み込みに失敗しました。電波の良い場所でもう一度試してね。";
    showCamMessage(msg, "もう一度撮る", startCamera);
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const pad = (n) => String(n || 0).padStart(3, "0");
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const ARM = 0.55, MARGIN = 0.12, BORDER = 0.07, EDGE_REAL = 0.09;   // EDGE_REAL＝実際の手の輪郭のまわりに残す実写の幅     // 手のひらの長さに対する、腕の長さ・実写の余白・白いふち

function armEndOf(lm, armLen) {
  const ux = lm[0].x - lm[9].x, uy = lm[0].y - lm[9].y, l = Math.hypot(ux, uy) || 1;
  return { x: lm[0].x + ux / l * armLen, y: lm[0].y + uy / l * armLen };
}
// 写真から手のまわりだけを切り出し、長い辺が1400pxを超えないように縮める
// 手の明るさをそろえる：手のひらの真ん中あたりの明るさ（中央値）を測り、
// 暗い写真は明るく、明るすぎる写真は少し抑える（ガンマ補正。白とびしにくい）
function evenBrightness(c, lm) {
  const g = c.getContext("2d", { willReadFrequently: true });
  const ids = [0, 5, 9, 13, 17];
  const cx = ids.reduce((s, i) => s + lm[i].x, 0) / ids.length, cy = ids.reduce((s, i) => s + lm[i].y, 0) / ids.length;
  const r = dist(lm[0], lm[9]) * 0.45;
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
  const w = Math.min(c.width, Math.ceil(cx + r)) - x0, h = Math.min(c.height, Math.ceil(cy + r)) - y0;
  if (w < 4 || h < 4) return;
  const d = g.getImageData(x0, y0, w, h).data, lum = [];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    if ((x + x0 - cx) ** 2 + (y + y0 - cy) ** 2 > r * r) continue;
    const i = (y * w + x) * 4; lum.push((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255);
  }
  if (lum.length < 20) return;
  lum.sort((a, b) => a - b);
  const m = Math.min(0.97, Math.max(0.03, lum[lum.length >> 1]));
  const gamma = Math.min(1.25, Math.max(0.4, Math.log(BRIGHT_TARGET) / Math.log(m)));
  if (Math.abs(gamma - 1) < 0.04) return;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * Math.pow(i / 255, gamma));
  const all = g.getImageData(0, 0, c.width, c.height), p = all.data;
  for (let i = 0; i < p.length; i += 4) { p[i] = lut[p[i]]; p[i + 1] = lut[p[i + 1]]; p[i + 2] = lut[p[i + 2]]; }
  g.putImageData(all, 0, 0);
}
const BRIGHT_TARGET = 0.6;   // 手のひらの明るさの目標（0〜1）

function cropToHand(photo, lm) {
  const palm = dist(lm[0], lm[9]), pts = [...lm, armEndOf(lm, palm * ARM)], p = palm * 0.9;
  const x0 = Math.max(0, Math.min(...pts.map((q) => q.x)) - p), x1 = Math.min(photo.width, Math.max(...pts.map((q) => q.x)) + p);
  const y0 = Math.max(0, Math.min(...pts.map((q) => q.y)) - p), y1 = Math.min(photo.height, Math.max(...pts.map((q) => q.y)) + p);
  const k = Math.min(1, 1400 / Math.max(x1 - x0, y1 - y0));
  const c = canvas((x1 - x0) * k, (y1 - y0) * k);
  c.getContext("2d").drawImage(photo, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return { photo: c, lm: lm.map((q) => ({ x: (q.x - x0) * k, y: (q.y - y0) * k })) };
}

// 手の形（指・手のひら・腕）を、指定した太さの余白つきで塗る
function paintHand(g, lm, palm, extra, armLen) {
  g.lineCap = "round"; g.lineJoin = "round";
  const finger = palm * 0.42 + extra * 2;
  g.beginPath(); for (const [a, b] of BONES) { g.moveTo(lm[a].x, lm[a].y); g.lineTo(lm[b].x, lm[b].y); }
  g.lineWidth = finger; g.stroke();
  g.beginPath(); [0, 1, 2, 5, 9, 13, 17].forEach((i, k) => (k ? g.lineTo(lm[i].x, lm[i].y) : g.moveTo(lm[i].x, lm[i].y))); g.closePath();
  g.fill(); g.lineWidth = finger; g.stroke();
  const e = armEndOf(lm, armLen);                   // 腕：手首から、中指の付け根と反対方向へ
  g.beginPath(); g.moveTo(lm[0].x, lm[0].y); g.lineTo(e.x, e.y);
  g.lineWidth = palm * 0.95 + extra * 2; g.stroke();
}
// 手の形のマスク（ふちを少しぼかす）
function handMask(w, h, lm, palm, extra, color = "#fff") {
  const m = canvas(w, h), g = m.getContext("2d"); g.fillStyle = g.strokeStyle = color;
  paintHand(g, lm, palm, extra, palm * ARM);
  const f = blurred(m, Math.max(1, palm * 0.02)); free(m); return f;
}
/* ---------- 実際の手の形を写真から推定する ----------
   骨格（関節の点）だけだと、指の太さや手のひらの形が実際とずれる。
   骨格のまわりで「手の肌の色」に近い所を拾い、本人の手の輪郭に沿ったマスクを作る。
   うまく拾えない写真（背景が肌に近い色など）は、骨格の形に戻す */
let shapeCache = { key: null, mask: null };
function alphaArray(c) { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, a = new Uint8Array(c.width * c.height); for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3]; return a; }
function maskCanvas(a, w, h) {
  const c = canvas(w, h), g = c.getContext("2d"), id = g.createImageData(w, h);
  for (let i = 0; i < a.length; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = a[i]; }
  g.putImageData(id, 0, 0); return c;
}
// 形を r だけ太らせる。手の輪郭からの正確な距離で太らせるので、ふちがなめらかになる
function edt1d(f, n, d, v, z) {                     // 1列ぶんの「最も近い手までの距離の2乗」
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
function distanceToShape(a, w, h) {
  const INF = 1e20, D = new Float64Array(w * h), n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = a[y * w + x] > 127 ? 0 : INF; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) D[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = D[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) D[y * w + x] = d[x]; }
  return D;
}
// 太らせたあと、外側の線をさらに大まかな曲線にする（指の間のくぼみもゆるやかに）
function growRound(maskC, r, round) {
  const w = maskC.width, h = maskC.height, g0 = grow(maskC, r), a = alphaArray(g0); free(g0);
  for (let i = 0; i < a.length; i++) a[i] = a[i] > 127 ? 255 : 0;
  smoothShape(a, w, h, round);
  const c = maskCanvas(a, w, h), f = blurred(c, 1.2); free(c); return f;
}
function grow(maskC, r) {
  const w = maskC.width, h = maskC.height, a = alphaArray(maskC), D = distanceToShape(a, w, h), o = new Uint8Array(w * h);
  for (let i = 0; i < o.length; i++) o[i] = Math.round(255 * Math.min(1, Math.max(0, r - Math.sqrt(D[i]) + 0.5)));
  return maskCanvas(o, w, h);
}
function handShape(photo, lm) {
  const key = photo.width + "x" + photo.height + ":" + lm.map((p) => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(";");
  if (shapeCache.key === key) return shapeCache.mask;
  const w = photo.width, h = photo.height, palm = dist(lm[0], lm[9]), N = w * h;
  const skel = () => { const m = canvas(w, h), g = m.getContext("2d"); g.fillStyle = g.strokeStyle = "#fff"; return [m, g]; };
  // 探す範囲（骨格を大きめに太らせた形）と、必ず手に含める芯（骨格を細めにした形）
  const [rc, rg] = skel(); paintHand(rg, lm, palm, palm * 0.16, palm * ARM); const region = alphaArray(rc); free(rc);
  const [cc, cg] = skel(); paintHand(cg, lm, palm, -palm * 0.1, palm * ARM); const core = alphaArray(cc); free(cc);
  const [fc, fg] = skel(); paintHand(fg, lm, palm, 0, palm * ARM); const fallback = alphaArray(fc); free(fc);
  const px = photo.getContext("2d").getImageData(0, 0, w, h).data;
  const ycc = (i) => { const r = px[i], g = px[i + 1], b = px[i + 2];
    return [0.299 * r + 0.587 * g + 0.114 * b, 128 - 0.1687 * r - 0.3313 * g + 0.5 * b, 128 + 0.5 * r - 0.4187 * g - 0.0813 * b]; };
  // 肌の色の見本：芯の中の点を集める
  const sam = [];
  for (let i = 0, step = Math.max(1, Math.floor(N / 40000)); i < N; i += step) if (core[i] > 200) sam.push(ycc(i * 4));
  const pick = (k) => { const v = sam.map((s) => s[k]).sort((a, b) => a - b); const m = v[v.length >> 1];
    const mad = v.map((x) => Math.abs(x - m)).sort((a, b) => a - b)[v.length >> 1]; return [m, mad * 1.48 + 1]; };
  let mask = null;
  if (sam.length > 50) {
    const [mY, sY] = pick(0), [mB, sB] = pick(1), [mR, sR] = pick(2);
    const a = new Uint8Array(N); let cnt = 0, regionCnt = 0, fbCnt = 0;
    for (let i = 0; i < N; i++) {
      if (fallback[i] > 127) fbCnt++;
      if (region[i] < 127) continue; regionCnt++;
      const [y, cb, cr] = ycc(i * 4);
      const d = ((cb - mB) / (sB * 3 + 4)) ** 2 + ((cr - mR) / (sR * 3 + 4)) ** 2;
      if ((d < 1 && Math.abs(y - mY) < sY * 4 + 60) || core[i] > 127) { a[i] = 255; cnt++; }
    }
    // 拾いすぎ（背景も肌色に近い）・拾わなさすぎの時は骨格の形に戻す
    if (cnt > fbCnt * 0.75 && cnt < regionCnt * 0.92) mask = a;
  }
  if (!mask) { mask = new Uint8Array(N); for (let i = 0; i < N; i++) mask[i] = fallback[i] > 127 ? 255 : 0; }
  // 小さな穴やギザギザをならす（閉じる）→ 穴を埋める → 一番大きな塊だけ残す
  let c = maskCanvas(mask, w, h); const closed = grow(c, palm * 0.04); free(c);
  const a2 = alphaArray(closed); free(closed);
  const b2 = blurred(maskCanvas(a2, w, h), palm * 0.04), a3 = alphaArray(b2); free(b2);
  for (let i = 0; i < N; i++) a3[i] = a3[i] > 200 ? 255 : 0;
  // 細いトゲ（背景の土などを拾った所）を削る：一度細らせてから戻す
  { const Din = distanceToShape(a3.map((x) => 255 - x), w, h), ae = new Uint8Array(N), rr = palm * 0.06;
    for (let i = 0; i < N; i++) ae[i] = Math.sqrt(Din[i]) > rr ? 255 : 0;
    const back = grow(maskCanvas(ae, w, h), rr), ab = alphaArray(back); free(back);
    for (let i = 0; i < N; i++) a3[i] = (ab[i] > 127 || core[i] > 127) ? 255 : 0; }
  keepLargestFilled(a3, w, h);
  // ギザギザをならして曲線にする：形をなめらかにぼかし、半分の濃さの所で輪郭を引き直す（2回）
  smoothShape(a3, w, h, palm * 0.09); smoothShape(a3, w, h, palm * 0.06);
  for (let i = 0; i < N; i++) if (core[i] > 127) a3[i] = 255;    // ならしすぎて指先が欠けないように、芯は残す
  smoothShape(a3, w, h, palm * 0.03);
  keepLargestFilled(a3, w, h);
  const out = maskCanvas(a3, w, h);
  free(shapeCache.mask); shapeCache = { key, mask: out };
  return out;
}
// 輪郭をなめらかにする：箱ぼかしを3回かけて（ほぼガウスぼかし）、真ん中の濃さで切り直す
function boxBlur(src, w, h, r) {
  r = Math.max(1, Math.round(r));
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) { let acc = 0; const o = y * w;
    for (let x = -r; x <= r; x++) acc += src[o + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[o + x] = acc * k; acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc * k; acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  return out;
}
function smoothShape(a, w, h, r) {
  let f = Float32Array.from(a); const rr = r / Math.sqrt(3);
  for (let i = 0; i < 3; i++) f = boxBlur(f, w, h, rr);
  for (let i = 0; i < a.length; i++) a[i] = f[i] >= 127.5 ? 255 : 0;
}
function keepLargestFilled(a, w, h) {
  const N = w * h, lab = new Int32Array(N), st = new Int32Array(N); let best = 0, bestN = 0, n = 0;
  for (let s = 0; s < N; s++) { if (!a[s] || lab[s]) continue; n++; let top = 0, cnt = 0; st[top++] = s; lab[s] = n;
    while (top) { const p = st[--top], x = p % w; cnt++;
      if (x > 0 && a[p - 1] && !lab[p - 1]) { lab[p - 1] = n; st[top++] = p - 1; }
      if (x < w - 1 && a[p + 1] && !lab[p + 1]) { lab[p + 1] = n; st[top++] = p + 1; }
      if (p >= w && a[p - w] && !lab[p - w]) { lab[p - w] = n; st[top++] = p - w; }
      if (p < N - w && a[p + w] && !lab[p + w]) { lab[p + w] = n; st[top++] = p + w; } }
    if (cnt > bestN) { bestN = cnt; best = n; } }
  const seen = new Uint8Array(N); let top = 0;
  for (let i = 0; i < N; i++) a[i] = lab[i] === best ? 255 : 0;
  for (let x = 0; x < w; x++) for (const p of [x, N - w + x]) if (!a[p] && !seen[p]) { seen[p] = 1; st[top++] = p; }
  for (let y = 0; y < h; y++) for (const p of [y * w, y * w + w - 1]) if (!a[p] && !seen[p]) { seen[p] = 1; st[top++] = p; }
  while (top) { const p = st[--top], x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < N && !a[q] && !seen[q]) { seen[q] = 1; st[top++] = q; } }
  for (let i = 0; i < N; i++) if (!a[i] && !seen[i]) a[i] = 255;   // 外から届かない所＝手の中の穴
}

// 手（＋実写の余白）を切り抜く。余白も白いふちも、実際の手の輪郭に沿って太らせる
function cutHand(photo, lm, shape, shapeSrc = photo) {
  const palm = dist(lm[0], lm[9]);
  const cut = copyOf(photo), cg = cut.getContext("2d");
  const mask = growRound(handShape(shapeSrc, lm), palm * EDGE_REAL, palm * 0.12);
  cg.globalCompositeOperation = "destination-in"; cg.drawImage(mask, 0, 0); free(mask);
  cg.globalCompositeOperation = "source-over";
  return cut;
}
// 指先が上を向く角度と、回転後の外接枠
function uprightBox(lm, palm, padding) {
  const rotA = -Math.PI / 2 - Math.atan2(lm[9].y - lm[0].y, lm[9].x - lm[0].x);
  const cos = Math.cos(rotA), sin = Math.sin(rotA);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const q of [...lm, armEndOf(lm, palm * ARM)]) { const x = q.x * cos - q.y * sin, y = q.x * sin + q.y * cos;
    x0 = Math.min(x0, x - padding); x1 = Math.max(x1, x + padding); y0 = Math.min(y0, y - padding); y1 = Math.max(y1, y + padding * 0.6); }
  return { rotA, x0, x1, y0, y1 };
}

function compose(photo, lm, no, shape = false, shapeSrc = photo) {
  const pw = photo.width, ph = photo.height, palm = dist(lm[0], lm[9]);
  const cut = cutHand(photo, lm, shape, shapeSrc);
  const rim = growRound(handShape(shapeSrc, lm), palm * (EDGE_REAL + BORDER), palm * 0.14);
  { const rg = rim.getContext("2d"); rg.globalCompositeOperation = "source-in"; rg.fillStyle = C.paper; rg.fillRect(0, 0, pw, ph); }

  const c = canvas(W, H), g = c.getContext("2d");
  drawBackground(g, 0);                     // 背景は赤と青の円が重なる形（全員共通）
  // 手全体（白ふち込み）が枠に収まる大きさにして、枠の下端にそろえる
  const b = uprightBox(lm, palm, palm * (0.21 + MARGIN + BORDER));
  const BOX = HAND_BOX, s = Math.min((BOX.x1 - BOX.x0) / (b.x1 - b.x0), (BOX.y1 - BOX.y0) / (b.y1 - b.y0));
  g.save(); g.translate((BOX.x0 + BOX.x1) / 2 - s * (b.x0 + b.x1) / 2, BOX.y1 - s * b.y1); g.scale(s, s); g.rotate(b.rotA);
  g.imageSmoothingQuality = "high"; g.drawImage(rim, 0, 0); g.drawImage(cut, 0, 0);
  g.restore(); free(cut, rim);

  drawTexts(g, no);
  grain(g);
  return c;
}

/* ---------- 背景（赤・青・紫・白だけ。拡散用は「ふたつの円」で固定。ほかの形も残してある） ---------- */
// ストーリー用 1080×1920。上下約250pxはInstagramの表示と重なるので、文字は置かない
const HAND_BOX = { x0: 110, x1: 970, y0: 560, y1: 1330 };
const BAND_Y = 1400;
function drawBackground(g, pat) {
  g.fillStyle = C.paper; g.fillRect(0, 0, W, H);
  const circ = (x, y, r) => { const p = new Path2D(); p.arc(x, y, r, 0, Math.PI * 2); return p; };
  const cy = 950;
  if (pat === 0) { const A = circ(390, cy, 310), B = circ(690, cy, 310);
    g.fillStyle = C.red; g.fill(A); g.fillStyle = C.blue; g.fill(B);
    g.save(); g.clip(A); g.fillStyle = C.purple; g.fill(B); g.restore(); }
  if (pat === 1) { const p = new Path2D(); p.moveTo(0, 1180); p.lineTo(W, 640); p.lineTo(W, 920); p.lineTo(0, 1460); p.closePath();
    g.fillStyle = C.blue; g.fill(p); }
  if (pat === 2) { [[360, C.blue], [275, C.paper], [190, C.red], [105, C.paper]].forEach(([r, col]) => { g.fillStyle = col; g.fill(circ(540, cy, r)); }); }
  if (pat === 3) { for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? C.red : C.blue; g.fillRect(70 + i * 110, 580, 46, 820); } }
  if (pat === 4) { g.fillStyle = C.red; g.fill(circ(540, cy, 360)); }
  g.fillStyle = C.red; g.fillRect(0, BAND_Y, W, H - BAND_Y);
}

/* ---------- 文字 ---------- */
function fit(g, t, x, y, maxW, size, wt) {
  let s = size; do { g.font = `${wt} ${s}px "Noto Sans JP", sans-serif`; s -= 4; } while (g.measureText(t).width > maxW && s > 28);
  g.fillText(t, x, y);
}
function drawTexts(g, no) {
  const d = new Date(), date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  g.textBaseline = "top";
  g.fillStyle = C.ink; g.font = '700 28px "Noto Sans JP", sans-serif'; g.fillText("RITSUMEIKAN OIC  ONIGOKKO CIRCLE", 60, 250);
  g.textAlign = "right"; g.fillText("No." + pad(no), W - 60, 250); g.textAlign = "left";
  g.fillStyle = C.red; fit(g, "つかまえた。", 60, 310, W - 120, 160, 900);
  // 下の赤帯：2行は中央揃え、アカウント・日付・場所は右下
  g.textAlign = "center";
  g.fillStyle = C.paper; fit(g, `${no}人目のおともだち`, W / 2, BAND_Y + 50, W - 120, 76, 900);
  const sub = "つぎは君も、このゆびとーまれ！";
  g.font = '700 46px "Noto Sans JP", sans-serif'; const tw = g.measureText(sub).width;
  g.fillStyle = C.paper; g.fillRect((W - tw) / 2 - 22, BAND_Y + 160, tw + 44, 76); g.fillStyle = C.red; g.fillText(sub, W / 2, BAND_Y + 172);
  g.textAlign = "right"; g.fillStyle = C.paper;
  g.font = '700 34px "Noto Sans JP", sans-serif'; g.fillText(CFG.INSTAGRAM || "", W - 60, BAND_Y + 290);
  g.font = '500 26px "Noto Sans JP", sans-serif'; g.fillText(`${date}  ${CFG.PLACE || ""}`, W - 60, BAND_Y + 340);
  g.textAlign = "left";
}
function grain(g) {
  const id = g.getImageData(0, 0, W, H), a = id.data;
  for (let i = 0; i < a.length; i += 4) { const n = 1 - Math.random() * 0.03; a[i] *= n; a[i + 1] *= n; a[i + 2] *= n; }
  g.putImageData(id, 0, 0);
}

// 広報用の素材：手（輪郭の周りまで実写）を、指先が上を向くよう回転して切り出した透明PNG。
// 公式アカウントの投稿画像は、この素材から別のツールで作る
function handMaterial(photo, lm, shape = false, shapeSrc = photo) {
  const palm = dist(lm[0], lm[9]), cut = cutHand(photo, lm, shape, shapeSrc);
  const b = uprightBox(lm, palm, palm * (0.24 + MARGIN));
  const k = Math.min(1, 1000 / (b.y1 - b.y0));   // 指紋が読み取れるほどの解像度にしない
  const out = canvas((b.x1 - b.x0) * k, (b.y1 - b.y0) * k), og = out.getContext("2d");
  og.scale(k, k); og.translate(-b.x0, -b.y0); og.rotate(b.rotA); og.drawImage(cut, 0, 0);
  free(cut); return out;
}

/* ---------- 4. シェア・保存 ---------- */
$("share").addEventListener("click", async () => {
  if (!lastBlob) return;
  flushUpload();
  const file = new File([lastBlob], `onigokko_${pad(myNo)}.jpg`, { type: "image/jpeg" });
  const text = `鬼ごっこサークルの${myNo}人目のおともだちになりました！ つぎは君も、このゆびとーまれ！ ${CFG.INSTAGRAM || ""} #立命館 #OIC #鬼ごっこサークル`;
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); window.Visit.mark("shared"); } catch (e) { if (e.name !== "AbortError") toast("シェアできませんでした。画像を保存してから投稿してね。"); }
  } else {
    toast("この端末では直接シェアできません。画像を長押しで保存してから投稿してね。", 3600);
  }
});
$("save").addEventListener("click", () => flushUpload());

/* ---------- 広報用の素材を保存 ----------
   最初の画面の注意書きに同意して撮影した人の手を、本人が「最後に選んだ見え方」で1回だけ保存する。
   見え方を選んでいる途中（「そのまま」のまま）で送ってしまわないよう、
   シェア・保存・撮りなおし・画面を離れた時、または20秒操作がなかった時に送る */
let changedTimer = null, uploadedKey = "", uploading = null;
function markChanged() { clearTimeout(changedTimer); changedTimer = setTimeout(flushUpload, 20000); }
function flushUpload() {
  clearTimeout(changedTimer);
  const key = `${photoId}:${filterMode}`;
  if (!sb || !lastPhoto || !myNo || key === uploadedKey || uploading) return;   // お試しモードでは送らない
  uploadedKey = key;
  uploading = (async () => {
    try {
      const mode = filterMode, story = lastBlob;
      const src = photoForMode(), mat = handMaterial(src, lastLm, false, lastPhoto);
      if (src !== lastPhoto) free(src);
      const blob = await new Promise((r) => mat.toBlob(r, "image/png")); free(mat);
      const base = `${pad(myNo)}_${photoId}_${mode}_${Date.now()}`;
      const bucket = sb.storage.from(CFG.BUCKET || "hands");
      // 広報用の手の素材（透明PNG）と、本人がシェアしたストーリー画像（JPEG）の両方を保存する
      const up1 = await bucket.upload(`${base}.png`, blob, { contentType: "image/png" });
      if (up1.error) throw up1.error;
      let storyPath = null;
      if (story) { const up2 = await bucket.upload(`${base}_story.jpg`, story, { contentType: "image/jpeg" });
        if (!up2.error) storyPath = `${base}_story.jpg`; else console.warn("story upload failed", up2.error); }
      await window.Visit.addSubmission(`${base}.png`, storyPath, mode);   // 参加番号はサーバー側で端末から決める
    } catch (e) { console.warn("upload failed", e); uploadedKey = ""; }
    finally { uploading = null; if (`${photoId}:${filterMode}` !== uploadedKey) markChanged(); }
  })();
}

// お試しモード（サーバー未設定）では、Instagramで使ってよいかの選択は出さない
if (!sb) $("consent").hidden = true;
