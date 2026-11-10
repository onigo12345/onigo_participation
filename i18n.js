// 日本語／英語の切り替え（参加者向けのページ：来た時・帰る時・公園の掲示・集めているデータ）
// - ページは日本語で書いておき、英語の時だけこの辞書で置き換える（辞書にない文はそのまま日本語）
// - 選んだ言語はこのスマホの中だけに覚える（サーバーには送らない）。最初はスマホの言語設定に合わせる
// - アンケートの答えは、英語で選んでも日本語のまま記録する（集計がそろうように）
// - URLに ?lang=en / ?lang=ja を付けると、その言語で開く（公園の掲示用など）
(function () {
  const KEY = "onigokko_lang";
  const ls = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch {} },
  };
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "en" || q === "ja") ls.set(q);
  let lang = ls.get() || ((navigator.languages?.[0] || navigator.language || "ja").toLowerCase().startsWith("ja") ? "ja" : "en");
  if (lang !== "en") lang = "ja";

  /* ---------- 1文ずつの辞書（日本語の文 → 英語） ---------- */
  const EN = {
    // ページの題名
    "鬼ごっこサークル｜立命館OIC 岩倉公園": "Tag Circle | Ritsumeikan OIC, Iwakura Park",
    "またね！｜立命館OIC 鬼ごっこサークル": "See you! | Ritsumeikan OIC Tag Circle",
    "いまの鬼ごっこ｜立命館OIC 鬼ごっこサークル": "Tag right now | Ritsumeikan OIC Tag Circle",
    "集めているデータ｜立命館OIC 鬼ごっこサークル": "Data we collect | Ritsumeikan OIC Tag Circle",

    // 共通
    "今": "Right now",
    "人が遊んでいます": "people playing",
    "途中参加、大歓迎！": "Join anytime, even midway!",
    "開催中！ 今": "We're playing! Right now",
    "今日の開催は終わりました": "Today's game is over",
    "本日は未開催": "Not playing today",
    "つぎへ": "Next",
    "エラー：": "Error: ",
    "不明": "unknown",

    // 来た時（index.html）
    "参加する": "Join",
    "18歳以上です・上の注意書きに同意します": "I'm 18 or older and agree to the notes above",
    "さいしょに": "First,",
    "参加の記録ができませんでした。電波の良い場所でもう一度押してね。": "Couldn't record your visit. Move somewhere with better signal and tap again.",
    "今日は {t} から遊んでいます": "Playing since {t} today",
    "よく開かれるのは：{x}": "Usually held: {x}",

    // 公園の掲示（now.html）
    "RITSUMEIKAN OIC  ONIGOKKO CIRCLE ／ 岩倉公園": "RITSUMEIKAN OIC  ONIGOKKO CIRCLE / IWAKURA PARK",
    "おにごっこサークル": "Tag Circle",
    "参加する時に読んでね": "Scan when you join",
    "今日は {t} から開催中": "Playing since {t} today",
    "開催したら @onigo12345 のストーリーでお知らせします": "We announce each game on @onigo12345's Instagram Story",

    // 帰る時（bye.html / bye.js）
    "またね！": "See you!",
    "、": ", ",
    "おつかれさま！": "Good game!",
    "今日あそんだ時間": "Played today",
    "通算の参加": "Total visits",
    "未記録": "Not recorded",
    "今日は来た時のQRを読んでいなかったので、遊んだ時間は記録していません。": "You didn't scan the QR code when you arrived today, so your play time wasn't recorded.",
    "今日タッチした手を撮ると、あなただけのストーリー画像がもらえるよ": "Take a photo of the hand you tagged with today and get your own Story image",
    "今日タッチした手を撮る": "Photograph my tagging hand",
    "撮らずにすすむ": "Skip the photo",
    "記録できませんでした。電波の良い場所で、もう一度QRを読み込んでね。": "Couldn't save your record. Move somewhere with better signal and scan the QR code again.",
    "今日も遊んでくれてありがとう！ 18歳以上の人は、次は来た時に赤いQRを読むと、帰りに手の画像がもらえるよ。": "Thanks for playing today! If you're 18 or older, scan the red QR code when you arrive next time and you'll get a hand image when you leave.",
    "もどる": "Back",
    "撮影する": "Take photo",
    "画像をつくっています…": "Making your image…",
    "今日のあなたの手！": "Your hand today!",
    "あなたの手でつくったストーリー画像": "Story image made from your hand",
    "手の見え方": "How your hand looks",
    "そのまま": "Original",
    "ふんわり": "Soft",
    "明るく・ぼかす": "Brighter, blurred",
    "強くぼかす": "Strong blur",
    "形と色だけ": "Shape and color only",
    "シェア": "Share",
    "保存": "Save",
    "撮りなおす": "Retake",
    "保存できない時は、画像を長押しして保存してください。": "If saving doesn't work, press and hold the image to save it.",
    "サークルのInstagram（@onigo12345）で使ってもいい？": "Can we use it on the circle's Instagram (@onigo12345)?",
    "ストーリーに載せる": "Post to our Story",
    "24時間で消えます": "Disappears after 24 hours",
    "投稿にも使ってよい": "OK to use in feed posts too",
    "写るのは手だけ・名前は載せません。投稿はプロフィールに残ります": "Only your hand is shown, never your name. Feed posts stay on our profile",
    "載せる前に、運営者が1枚ずつ確認します。": "The organizers check every image before it's posted.",
    "受け取った！ つぎへ": "Got it! Next",
    "ちょっとだけ教えて（任意）・": "A few quick questions (optional) - ",
    "学部は？": "Your faculty?",
    "選んでください": "Please choose",
    "衣笠・BKC": "Kinugasa / BKC",
    "そのほか": "Other",
    "映像学部": "College of Image Arts and Sciences",
    "経営学部": "College of Business Administration",
    "政策科学部": "College of Policy Science",
    "総合心理学部": "College of Comprehensive Psychology",
    "情報理工学部": "College of Information Science and Engineering",
    "グローバル教養学部": "College of Global Liberal Arts",
    "法学部": "College of Law",
    "産業社会学部": "College of Social Sciences",
    "国際関係学部": "College of International Relations",
    "文学部": "College of Letters",
    "デザイン・アート学部": "College of Design and Art",
    "経済学部": "College of Economics",
    "スポーツ健康科学部": "College of Sport and Health Science",
    "食マネジメント学部": "College of Gastronomy Management",
    "理工学部": "College of Science and Engineering",
    "生命科学部": "College of Life Sciences",
    "薬学部": "College of Pharmaceutical Sciences",
    "大学院": "Graduate school",
    "ほかの大学": "Another university",
    "社会人・その他": "Working / other",
    "ニックネームは？": "Your nickname?",
    "例：たっくん（本名はNG）": "e.g. Takkun (no real names)",
    "本名は入れないでね。次に来た時も同じ名前で": "Please don't use your real name. Use the same one next time",
    "何回生？": "What year are you in?",
    "1回生": "1st year", "2回生": "2nd year", "3回生": "3rd year", "4回生": "4th year", "院生": "Grad student",
    "その他": "Other",
    "答えない": "Prefer not to say",
    "性別は？": "Your gender?",
    "男性": "Male", "女性": "Female",
    "なんで参加した？": "Why did you join?",
    "友達のストーリー": "A friend's Story",
    "友達に誘われた": "A friend invited me",
    "公園で見かけた": "Saw it in the park",
    "以前も参加したことがあるから": "I've joined before",
    "サークル運営者": "I'm an organizer",
    "今日はなにして遊んだ？": "What did you play today?",
    "いくつでも選べます": "Choose as many as you like",
    "鬼ごっこ": "Tag",
    "ケイドロ": "Cops and robbers",
    "こんなルールで遊んだよ／鬼ごっこじゃないけど、こんなことして遊んだよ": "The rules we played with / something else we played",
    "人の名前や連絡先は書かないでね。サークルの記録として、運営者だけが見ます。": "Please don't write names or contact details. Only the organizers read this, as a record for the circle.",
    "今日はどうだった？": "How was today?",
    "まあまあ": "Not bad",
    "たのしい": "Fun",
    "最高！": "Awesome!",
    "← もどる": "← Back",
    "スキップ": "Skip",
    "つぎの鬼ごっこ": "NEXT GAME",
    "@onigo12345 をフォローする": "Follow @onigo12345",
    "途中参加も歓迎。QRなしでも「入れて」で参加OK！": "Join midway anytime. No QR code needed, just ask \"Can I play?\"",
    "大学非公認の学生有志サークル": "Unofficial student-run circle (not recognized by the university)",
    "集めているデータ": "Data we collect",
    "わたしの記録を消す": "Delete my records",
    "本当に消す（もう一度押す）": "Really delete? (tap again)",
    "消せませんでした。もう一度押してね": "Couldn't delete. Please tap again",
    "前にも来てくれた？": "have you been here before?",
    "ちがう人": "No, someone else",
    "そう、わたし！": "Yes, that's me!",
    "学部を選んでね": "Please choose your faculty",
    "ニックネームを入れてね": "Please enter a nickname",
    "送れませんでした。電波の良い場所でもう一度押してね。": "Couldn't send. Move somewhere with better signal and tap again.",
    "その名前の人は、今日はもう参加しています。名前を少し変えてね": "Someone with that name has already joined today. Please change your name a little",
    "おかえり！": "Welcome back!",
    "つなげませんでした。電波の良い場所でもう一度押してね。": "Couldn't link your records. Move somewhere with better signal and tap again.",
    "同じ名前の人がいるので、少し変えてね（例：たっくん2）": "Someone already uses that name. Please change it a little (e.g. Takkun2)",
    "もう一度撮る": "Take it again",
    "カメラアプリで撮る": "Use the camera app",
    "手が見つかりませんでした。手のひら全体が写るように、もう一度撮ってね。": "Couldn't find a hand. Please try again with your whole palm in the frame.",
    "参加番号を取得できませんでした。電波の良い場所でもう一度試してね。": "Couldn't get your participant number. Move somewhere with better signal and try again.",
    "読み込みに失敗しました。電波の良い場所でもう一度試してね。": "Loading failed. Move somewhere with better signal and try again.",
    "この写真は読み込めませんでした。もう一度撮ってね。": "Couldn't read this photo. Please take it again.",
    "シェアできませんでした。画像を保存してから投稿してね。": "Couldn't share. Please save the image first, then post it.",
    "この端末では直接シェアできません。画像を長押しで保存してから投稿してね。": "This device can't share directly. Press and hold the image to save it, then post it.",
    "このブラウザではページの中でカメラを使えません。検索アプリやブラウザアプリの設定によっては、カメラが起動しないことがあります。SafariやChromeで開き直すか、下のボタンからカメラアプリで撮影してね。": "This browser can't use the camera inside the page. Some search apps and in-app browsers block it. Reopen this page in Safari or Chrome, or use the button below to take a photo with your camera app.",
    "カメラの使用が許可されていません。iPhoneは「設定 → アプリ → Safari → カメラ」を「確認」か「許可」にして開き直すか、下のボタンからカメラアプリで撮影してね。": "Camera access isn't allowed. On iPhone, set Settings → Apps → Safari → Camera to \"Ask\" or \"Allow\" and reopen the page, or use the button below to take a photo with your camera app.",
    "ほかのアプリがカメラを使っているようです。ほかのアプリを閉じてもう一度試すか、下のボタンからカメラアプリで撮影してね。": "Another app seems to be using the camera. Close it and try again, or use the button below to take a photo with your camera app.",
    "カメラが見つかりませんでした。下のボタンから写真を選んでね。": "No camera found. Use the button below to choose a photo.",
    "カメラを起動できませんでした（{n}）。検索アプリやブラウザアプリの設定によっては、カメラが起動しないことがあります。下のボタンからカメラアプリで撮影してね。": "Couldn't start the camera ({n}). Some search apps and in-app browsers block it. Use the button below to take a photo with your camera app.",

    // 文の中に数や名前が入るもの
    "<span>{n}</span>人目のおともだち": "Friend <span>#{n}</span>",
    "おかえり！ 今日で<span>{n}</span>回目": "Welcome back! Visit <span>#{n}</span>",
    "{n}<small>回目</small>": "{n}",
    "{h}<small>時間</small>{m}<small>分</small>": "{h}<small>h</small> {m}<small>min</small>",
    "{m}<small>分</small>": "{m}<small>min</small>",
    "{name}さん（{faculty}）": "{name} ({faculty})",
    "<small>よく開かれるのは</small>{x}": "<small>Usually held</small>{x}",
    "鬼ごっこサークルの{n}人目のおともだちになりました！ つぎは君も、このゆびとーまれ！ {ig} #立命館 #OIC #鬼ごっこサークル":
      "I became friend #{n} of the Tag Circle! You're next, come join in! {ig} #Ritsumeikan #OIC #鬼ごっこサークル",
    "<h1 class=\"next-h\">消しました。</h1><p class=\"lead\">アンケート・来場の記録・画像を消しました。また遊びに来てね！</p>":
      "<h1 class=\"next-h\">Deleted.</h1><p class=\"lead\">Your survey answers, visit records and images have been deleted. Come play again!</p>",
  };

  /* ---------- まとまった文章（data-i18n="名前" を付けた要素の中身を、まるごと置き換える） ---------- */
  const IG = '<a href="https://www.instagram.com/onigo12345/" target="_blank" rel="noopener">@onigo12345</a>';
  const HTML = {
    enterTitle: "Tag<br>Circle",
    enterNotice: `<b>Before you join</b>
      <ul>
        <li>Watch out for children playing in the park</li>
        <li>Don't get in the way of the Molkky circle</li>
        <li>Don't play near playground equipment, walkways, or anywhere you'd get in other people's way</li>
      </ul>
      When you tap the button, we record your arrival time and a participant number (no name or contact details). Scan the blue QR code when you leave to see how long you played and get a hand image. You can delete your records anytime (<a href="privacy.html">Data we collect</a>). This is an unofficial, student-run circle, not recognized by the university.`,
    closed: `We're not playing right now. Scan again while a game is on.<br>We announce each game on ${IG}'s Instagram Story.`,
    minor: `Under 18? No need for the QR code, just ask <b>"Can I play?"</b> Nothing is recorded.`,
    doneA: "Go have<br>fun!",
    doneB: "Decide who's<br>\"it\" and the<br>rules with<br>people nearby!",
    doneFoot: "When you leave, scan the <b>blue QR code</b> to see how long you played and get an image of the hand you tagged with today",
    camTop: "Hold out the hand you tagged with today, matching the outline<small>Spread your fingers a little for a clean cut-out / If the camera won't start, open this page in Safari or Chrome</small>",
    flip: "Switch<br>camera",
    surveyPrivacy: 'We only use your answers to help run the circle, and never publish them. <a href="privacy.html">Details</a>',
    nextH: "Thank you!<br>Let's play again",
    nextWhere: `There's no fixed date. We announce each game on ${IG}'s Instagram Story.`,
    nowFree: `No QR code needed, just ask <b>"Can I play?"</b><small>If you're 18 or older, scan the QR code to get a hand image when you leave</small>`,
    privacy: `
  <div>
    <div class="eyebrow">RITSUMEIKAN OIC&nbsp; ONIGOKKO CIRCLE</div>
    <h1>Data we collect</h1>
  </div>
  <section>
    <h2>What we collect</h2>
    <table>
      <tr><th>Joining</th><td>The time you tap "Join (18 or older, agree to the notes)" on the arrival QR page. Just opening the page records nothing. People under 18 can join without the QR code, and nothing is recorded</td></tr>
      <tr><th>Survey (optional)</th><td>Answered when you leave: faculty, nickname (please don't use your real name), year (optional), gender (optional: male, female, other), how you heard about us (optional)</td></tr>
      <tr><th>Visits</th><td>Date, arrival time, leaving time ("not recorded" on days you didn't scan the leaving QR code), which QR code you came from, whether you made or shared an image, how much fun you had (optional), what you played today (optional; "Other" is free text)</td></tr>
      <tr><th>Images</th><td>A cut-out of only the area around "the hand you tagged with today", taken when you leave, and the Story image you received. If you chose "Soft" or "Strong blur", we save it that way</td></tr>
      <tr><th>Phone marker</th><td>To recognize the same person, a random string is created inside your phone's browser. The circle only receives it in a form that can't be reversed (SHA-256), so even the administrator can't see what it is</td></tr>
    </table>
  </section>
  <section>
    <h2>What we don't collect</h2>
    <ul class="no">
      <li>Real names, student ID numbers, contact details (email, phone, social media accounts)</li>
      <li>Location (GPS), photos of faces</li>
      <li>Device information such as phone model or identifiers</li>
      <li>Information attached to photos, such as where they were taken (removed when the image is re-created)</li>
    </ul>
  </section>
  <section>
    <h2>How we use it</h2>
    <ul class="yes">
      <li>Showing your participant number, and "Welcome back" from your second visit</li>
      <li>Making the circle easier to join, for example by seeing which times work and which faculties we reach</li>
      <li>Showing whether a game is on, how many people are playing, today's start time, and the usual days and times, on the arrival page and the park display (numbers only, never who came)</li>
      <li>If you leave "Post to our Story" on (it starts on), an organizer checks and approves your image, then posts it to @onigo12345's Story (it disappears after 24 hours)</li>
      <li>If you leave "OK to use in feed posts too" on (it starts on), an organizer approves your image, then uses it in @onigo12345's feed posts (which stay on the profile). Turn it off and we won't</li>
      <li>We only use images on Instagram from people who are 18 or older and agreed to the notes</li>
      <li>At the start and end of each game, the host takes one photo of the park, adds text, and posts it to our Story. Photos showing recognizable faces are not allowed. The photo is not kept after posting</li>
    </ul>
  </section>
  <section>
    <h2>Who can see it</h2>
    <p>Only the circle representative (administrator). Other participants and members who set up QR codes can't see your records. We never sell or give your data to anyone.</p>
  </section>
  <section>
    <h2>How long we keep it, and how to delete it</h2>
    <ul>
      <li>Visit records are deleted automatically after 2 years</li>
      <li>On the page opened by the leaving QR code, "<b>Delete my records</b>" deletes all your survey answers, visit records and images (images are removed the next time the administrator opens the admin page)</li>
      <li>To remove an image that has already been posted, send a DM to ${IG}</li>
    </ul>
  </section>
  <section>
    <h2>Where it's stored</h2>
    <p>Records and images are stored on Supabase (Tokyo region), and this page is hosted on GitHub Pages. Both may temporarily keep the IP address of each access as part of their logs. Images are passed to Instagram (Meta) only when they are posted. When making feed images (a row of 3), GitHub's automation (GitHub Actions) loads the hand images temporarily and doesn't keep them afterwards. Images made for posting are deleted once posted. This page doesn't connect to any other company's services (such as fonts or ads).</p>
  </section>
  <section>
    <h2>Everything is open</h2>
    <p>All the code, including this page, is public on <a href="https://github.com/onigo12345/onigo_participation" target="_blank" rel="noopener">GitHub</a>. How data is handled is exactly as written in <a href="https://github.com/onigo12345/onigo_participation/blob/main/supabase.sql" target="_blank" rel="noopener">supabase.sql</a>.</p>
  </section>
  <section>
    <h2>About the circle</h2>
    <p>This circle is not an official Ritsumeikan University organization; it is run by student volunteers. The university does not handle inquiries about it. Please contact us by DM at ${IG}.</p>
  </section>
  <small>Ritsumeikan OIC Tag Circle (unofficial)  Last updated: November 7, 2026<br>If the English and Japanese versions differ, the Japanese version applies.</small>`,
  };

  /* ---------- 曜日と時間帯（「よく開かれるのは」） ---------- */
  const WD = { ja: ["日", "月", "火", "水", "木", "金", "土"], en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };
  const SLOT = { 朝: "morning", 昼: "midday", 夕方: "afternoon", 夜: "evening" };
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function t(s, vars) {
    let out = lang === "en" && EN[s] != null ? EN[s] : s;
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return out;
  }
  const often = (list) => (list || []).map((x) => lang === "en" ? `${WD.en[x.dow]} ${SLOT[x.slot] || x.slot}` : `${WD.ja[x.dow]}曜の${x.slot}`).join(lang === "en" ? ", " : "・");
  // 11月10日（火） / Tue, Nov 10（日本時間の日付を渡す）
  const date = (j) => lang === "en" ? `${WD.en[j.getUTCDay()]}, ${MON[j.getUTCMonth()]} ${j.getUTCDate()}` : `${j.getUTCMonth() + 1}月${j.getUTCDate()}日（${WD.ja[j.getUTCDay()]}）`;

  /* ---------- 画面の文字の置き換え ---------- */
  const textOrig = new WeakMap();   // 文字 → { ja: 元の日本語, en: 置き換えた英語 }
  const htmlOrig = new WeakMap();   // data-i18n の要素 → 元の日本語の中身
  const ATTRS = ["placeholder", "aria-label", "alt", "title", "label"];
  const skip = (el) => !el || el.closest("script,style,[data-no-i18n]");

  function doText(node) {
    const p = node.parentElement;
    if (skip(p) || p.closest("[data-i18n]")) return;
    let rec = textOrig.get(node);
    if (!rec || (node.data !== rec.ja && node.data !== rec.en)) { rec = { ja: node.data, en: null }; textOrig.set(node, rec); }   // 文字がプログラムで書き換わった
    if (lang === "en") {
      const key = rec.ja.trim(); if (!key || EN[key] == null) return;
      rec.en = rec.ja.replace(key, EN[key]);
      if (node.data !== rec.en) node.data = rec.en;
    } else if (node.data !== rec.ja) node.data = rec.ja;
  }
  function doElement(el) {
    const name = el.dataset.i18n;
    if (name && HTML[name] != null) {
      if (!htmlOrig.has(el)) htmlOrig.set(el, el.innerHTML);
      const want = lang === "en" ? HTML[name] : htmlOrig.get(el);
      if (el.innerHTML !== want) el.innerHTML = want;
    }
    for (const a of ATTRS) {
      if (!el.hasAttribute(a) && !el.hasAttribute("data-ja-" + a)) continue;
      if (!el.hasAttribute("data-ja-" + a)) el.setAttribute("data-ja-" + a, el.getAttribute(a));
      const ja = el.getAttribute("data-ja-" + a), v = lang === "en" && EN[ja] != null ? EN[ja] : ja;
      if (el.getAttribute(a) !== v) el.setAttribute(a, v);
    }
  }
  // アンケートの答え：表示が英語でも、記録は日本語のまま（data-v / value に元の日本語を入れておく）
  function keepValues(root) {
    for (const b of root.querySelectorAll(".choices button:not([data-v])")) b.dataset.v = b.textContent.trim();
    for (const o of root.querySelectorAll("option:not([value])")) o.value = o.textContent.trim();
  }
  function apply(root) {
    if (!root) return;
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 || skip(root)) return;
    keepValues(root);
    for (const el of [root, ...root.querySelectorAll("*")]) if (!skip(el)) doElement(el);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) doText(n);
  }
  function applyAll() {
    document.documentElement.lang = lang;
    if (!document.documentElement.dataset.jaTitle) document.documentElement.dataset.jaTitle = document.title;
    document.title = t(document.documentElement.dataset.jaTitle);
    apply(document.body);
    for (const b of document.querySelectorAll("[data-lang-toggle]")) {
      b.textContent = lang === "en" ? "日本語" : "English";
      b.setAttribute("aria-label", lang === "en" ? "日本語で表示" : "Show in English");
      b.lang = lang === "en" ? "ja" : "en";
    }
  }
  // プログラムがあとから書き換えた文字も置き換える
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") doText(m.target);
      else for (const n of m.addedNodes) apply(n);
    }
  });

  // 切り替えボタンの見た目（各ページの右上）
  const css = document.createElement("style");
  css.textContent = `[data-lang-toggle]{position:absolute!important;top:max(14px,env(safe-area-inset-top));right:max(14px,env(safe-area-inset-right));z-index:5!important;
    font:inherit;font-size:.78rem;font-weight:700;padding:6px 12px;border:1.5px solid var(--ink,#19161e);border-radius:999px;
    background:rgba(255,255,255,.92);color:var(--ink,#19161e);cursor:pointer;line-height:1.2}
  [data-lang-toggle].inline{position:static!important}
  [data-lang-toggle]:focus-visible{outline:3px solid var(--blue,#1c48c4);outline-offset:2px}
  html[lang=en] .notice,html[lang=en] .msg,html[lang=en] .hint{word-break:normal;overflow-wrap:anywhere}`;
  document.head.append(css);

  function setLang(l) {
    lang = l === "en" ? "en" : "ja"; ls.set(lang); applyAll();
    document.dispatchEvent(new CustomEvent("langchange", { detail: lang }));
  }
  function start() {
    applyAll();
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", (e) => { if (e.target.closest("[data-lang-toggle]")) setLang(lang === "en" ? "ja" : "en"); });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);

  window.I18N = { t, often, date, get lang() { return lang; }, set: setLang };
})();
