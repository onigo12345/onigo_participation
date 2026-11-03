// 立命館OIC 鬼ごっこサークル「つかまえた。」参加者アプリ
// 手の検出ライブラリはあとから読み込む（読み込みに失敗しても、画面やカメラは動くように）
const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
let vision = null;

const CFG = window.APP_CONFIG || {};
const W = 1080, H = 1920;   // Instagramストーリー（9:16）
const C = { red: "#e82c34", blue: "#1c48c4", purple: "#9a26d9", paper: "#faf8f4", ink: "#19161e" };
const $ = (id) => document.getElementById(id);
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

/* ---------- 1. 参加番号（同じスマホは何度開いても同じ番号） ---------- */
// 通信に失敗した時は番号を決めずに、次の操作でもう一度取りにいく（仮の番号を端末に残さない）
let numberPromise = null;
function getNumber() {
  if (!numberPromise) numberPromise = assignNumber().catch((e) => { numberPromise = null; throw e; });
  return numberPromise;
}
async function assignNumber() {
  const saved = ls.get("onigokko_no");
  if (saved && +saved > 0) return +saved;
  if (!sb) { // お試しモード：この端末の中だけで数える
    const n = (+ls.get("onigokko_demo_counter") || 0) + 1;
    ls.set("onigokko_demo_counter", n); ls.set("onigokko_no", n); return n;
  }
  for (let i = 0; i < 3; i++) {
    const { data, error } = await sb.from("participants").insert({ source: "qr" }).select("id").single();
    if (!error && data) { ls.set("onigokko_no", data.id); return data.id; }
    console.warn("count failed", error); await sleep(800 * (i + 1));
  }
  throw new Error("count");
}
function showNumber() {
  getNumber().then((n) => { myNo = n; $("countNum").textContent = n; })
    .catch(() => { $("countNum").textContent = "?"; toast("参加番号を取得できませんでした。電波の良い場所で開き直してね。", 4000); });
}
showNumber();

/* ---------- 手の検出モデル（裏で先に読み込む。失敗したら次の撮影でもう一度） ---------- */
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
let modelPromise = null, fileset = null;
const createLandmarker = (delegate) => vision.HandLandmarker.createFromOptions(fileset, {
  baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "IMAGE", numHands: 2, minHandDetectionConfidence: 0.4,
});
function loadModel() {
  if (!modelPromise) modelPromise = (async () => {
    vision = vision || await import(VISION);
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
$("toCamera").addEventListener("click", startCamera);
$("back").addEventListener("click", () => { stopCamera(); show("s-welcome"); });
$("flip").addEventListener("click", () => { facing = facing === "environment" ? "user" : "environment"; startCamera(); });
$("retake").addEventListener("click", () => { flushUpload(); startCamera(); });

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
  const c = tone(copyOf(photo), 1.15, 0.9, 0.9), g = c.getContext("2d");
  // 細かい質感（毛・乾燥）をならす：ぼかした写真を重ねる
  const smooth = blurred(c, Math.max(3, palm * 0.08));
  g.globalAlpha = 1; g.drawImage(smooth, 0, 0);
  // 光がにじむモヤ：大きくぼかした明るい層を「スクリーン」で重ねる
  const haze = tone(blurred(photo, Math.max(6, palm * 0.16)), 1.3, 1, 1);
  g.globalCompositeOperation = "screen"; g.globalAlpha = 0.32; g.drawImage(haze, 0, 0);
  // 白いベール
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 0.08; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.globalAlpha = 1;
  free(smooth, haze); return c;
}
// 強くぼかす：細かいところは見えず、手の形と色だけがわかる程度
function strongBlur(photo, lm) {
  const palm = dist(lm[0], lm[9]);
  const c = tone(copyOf(photo), 1.2, 0.85, 0.85), g = c.getContext("2d");
  const heavy = blurred(c, Math.max(8, palm * 0.18));
  g.drawImage(heavy, 0, 0);
  const haze = tone(blurred(photo, Math.max(12, palm * 0.3)), 1.35, 1, 1);
  g.globalCompositeOperation = "screen"; g.globalAlpha = 0.4; g.drawImage(haze, 0, 0);
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 0.14; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.globalAlpha = 1;
  free(heavy, haze); return c;
}
// （使っていない）手の形をオレンジで塗る見え方の色
const SHAPE_COLOR = "#f5821f";
const photoForMode = () => (filterMode === "soft" ? softFilter(lastPhoto, lastLm) : filterMode === "blur" ? strongBlur(lastPhoto, lastLm) : lastPhoto);

async function renderResult() {
  const seq = ++renderSeq;                            // 切り替えを連打しても、最後に押したものだけを表示
  const src = photoForMode();
  const post = compose(src, lastLm, myNo, false);
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
    free(photo); free(lastPhoto);
    lastPhoto = crop.photo; lastLm = crop.lm; photoId++;
    filterMode = "none";
    document.querySelectorAll("#filters button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === "none"));
    await renderResult();
    show("s-result");
    markChanged();
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
const ARM = 0.55, MARGIN = 0.12, BORDER = 0.07;     // 手のひらの長さに対する、腕の長さ・実写の余白・白いふち

function armEndOf(lm, armLen) {
  const ux = lm[0].x - lm[9].x, uy = lm[0].y - lm[9].y, l = Math.hypot(ux, uy) || 1;
  return { x: lm[0].x + ux / l * armLen, y: lm[0].y + uy / l * armLen };
}
// 写真から手のまわりだけを切り出し、長い辺が1400pxを超えないように縮める
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
// 手（＋実写の余白）を切り抜く。shape=true は手の部分だけオレンジで塗る
function cutHand(photo, lm, shape) {
  const pw = photo.width, ph = photo.height, palm = dist(lm[0], lm[9]);
  const cut = copyOf(photo), cg = cut.getContext("2d");
  const mask = handMask(pw, ph, lm, palm, palm * MARGIN);
  cg.globalCompositeOperation = "destination-in"; cg.drawImage(mask, 0, 0); free(mask);
  if (shape) {
    const hs = handMask(pw, ph, lm, palm, palm * 0.04, SHAPE_COLOR);
    cg.globalCompositeOperation = "source-atop"; cg.drawImage(hs, 0, 0); free(hs);
  }
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

function compose(photo, lm, no, shape = false) {
  const pw = photo.width, ph = photo.height, palm = dist(lm[0], lm[9]);
  const cut = cutHand(photo, lm, shape);
  const rim = handMask(pw, ph, lm, palm, palm * (MARGIN + BORDER), C.paper);

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
function handMaterial(photo, lm, shape = false) {
  const palm = dist(lm[0], lm[9]), cut = cutHand(photo, lm, shape);
  const b = uprightBox(lm, palm, palm * (0.24 + MARGIN));
  const k = Math.min(1, 1400 / (b.y1 - b.y0));
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
    try { await navigator.share({ files: [file], text }); } catch (e) { if (e.name !== "AbortError") toast("シェアできませんでした。画像を保存してから投稿してね。"); }
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
      const src = photoForMode(), mat = handMaterial(src, lastLm, false);
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
      const ins = await sb.from("submissions").insert({ participant_no: myNo, image_path: `${base}.png`, story_path: storyPath, consent: true, look: mode });
      if (ins.error) throw ins.error;
    } catch (e) { console.warn("upload failed", e); uploadedKey = ""; }
    finally { uploading = null; if (`${photoId}:${filterMode}` !== uploadedKey) markChanged(); }
  })();
}
