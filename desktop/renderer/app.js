// おにごっこ名簿 — 画面の組み立て
const $ = (id) => document.getElementById(id);
const C = { red: "#e82c34", blue: "#1c48c4", purple: "#9a26d9", ink: "#19161e", line: "#e4e0d8", muted: "#7a7484", soft: "#f2efe9" };
const BASE_URL = "https://onigo12345.github.io/onigo_participation/";
const DAY = 86400000;
const TZ = { timeZone: "Asia/Tokyo" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const wd = (d) => "日月火水木金土"[new Date(d + "T12:00:00+09:00").getDay()];
const md = (d) => { const [, m, dd] = d.split("-"); return `${+m}/${+dd}`; };
const hm = (t) => t ? new Date(t).toLocaleTimeString("ja-JP", { ...TZ, hour: "2-digit", minute: "2-digit" }) : "–";
const hourOf = (t) => +new Date(t).toLocaleString("en-US", { ...TZ, hour: "2-digit", hour12: false }) % 24;
const dowOf = (t) => new Date(new Date(t).toLocaleString("en-US", TZ)).getDay();
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const fmtMin = (m) => m == null ? "–" : m >= 60 ? `${Math.floor(m / 60)}時間${String(Math.round(m % 60)).padStart(2, "0")}分` : `${Math.round(m)}分`;
const todayStr = () => new Intl.DateTimeFormat("sv-SE", TZ).format(new Date());
const daysAgo = (d) => Math.round((new Date(todayStr()) - new Date(d)) / DAY);
const stayOf = (v) => v.arrived_at && v.left_at ? Math.max(0, (new Date(v.left_at) - new Date(v.arrived_at)) / 60000) : null;
function toast(t) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2600); }
const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

/* ---------- データの取得 ---------- */
let sb = null, RAW = null, M = null;
function client() {
  const cfg = ls.get("onigo_cfg");
  if (!cfg?.url || !cfg?.key) return null;
  if (!sb) sb = window.supabase.createClient(cfg.url, cfg.key);
  return sb;
}
async function fetchAll(table, order, cols = "*") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).order(order).range(from, from + 999);
    if (error) throw error; out.push(...data); if (data.length < 1000) return out;
  }
}
async function load() {
  if (ls.get("onigo_demo")) { RAW = window.makeDemo(); return build(); }
  if (!client()) { openSettings(); RAW = { people: [], visits: [], spots: [] }; return build(); }
  const { data } = await sb.auth.getSession();
  if (!data.session) { openSettings(); RAW = RAW || { people: [], visits: [], spots: [] }; return build(); }
  try {
    const [people, visits, spots] = await Promise.all([fetchAll("participants", "id", "id,faculty,grade,nickname,heard_from,created_at"), fetchAll("visits", "id"), fetchAll("spots", "created_at")]);
    RAW = { people, visits, spots }; build();
  } catch (e) { toast("読み込めませんでした：" + (e.message || e)); }
}

/* ---------- 集計 ---------- */
function build() {
  const { people, visits, spots } = RAW;
  const S = new Map(spots.map((s) => [s.token, s]));
  const byP = new Map();
  for (const v of visits) { if (!byP.has(v.participant_no)) byP.set(v.participant_no, []); byP.get(v.participant_no).push(v); }
  const members = people.filter((p) => byP.has(p.id)).map((p) => {
    const vs = byP.get(p.id).sort((a, b) => a.visit_date < b.visit_date ? -1 : 1);
    const first = vs[0].visit_date, last = vs.at(-1).visit_date, n = vs.length, ago = daysAgo(last);
    const status = n >= 4 && ago <= 45 ? "core" : n >= 2 && ago > 35 ? "away" : n === 1 && daysAgo(first) <= 45 ? "new" : "mid";
    return { ...p, vs, n, first, last, ago, status, stay: avg(vs.map(stayOf).filter((m) => m != null && m < 720)), shared: vs.some((v) => v.shared) };
  });
  const firstDay = new Map(members.map((m) => [m.id, m.first]));
  const evMap = new Map();
  for (const v of visits) { const k = v.visit_date + "|" + (v.spot || ""); if (!evMap.has(k)) evMap.set(k, []); evMap.get(k).push(v); }
  const events = [...evMap.entries()].map(([k, vs]) => {
    const [date, spot] = k.split("|");
    const arr = vs.map((v) => v.arrived_at).filter(Boolean).sort(), lef = vs.map((v) => v.left_at).filter(Boolean).sort();
    const end = lef.at(-1) || null;
    const ev = []; for (const v of vs) { if (!v.arrived_at) continue; ev.push([+new Date(v.arrived_at), 1], [+new Date(v.left_at || end || +new Date(v.arrived_at) + 3600e3), -1]); }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); let cur = 0, peak = 0; for (const [, d] of ev) { cur += d; peak = Math.max(peak, cur); }
    const fe = vs.map((v) => v.feeling).filter(Boolean);
    return { key: k, date, spot, placer: spot ? S.get(spot)?.placer || "不明なQR" : "QRなし", vs,
      fresh: vs.filter((v) => firstDay.get(v.participant_no) === date).length, start: arr[0] || null, end, peak,
      stay: avg(vs.map(stayOf).filter((m) => m != null && m < 720)), images: vs.filter((v) => v.made_image).length,
      shared: vs.filter((v) => v.shared).length, feeling: avg(fe) };
  }).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  M = { members, events, spots, S, P: new Map(members.map((m) => [m.id, m])) };
  $("source").innerHTML = RAW.demo ? "<b>デモデータ</b>" : client() ? esc(new URL(ls.get("onigo_cfg").url).hostname.split(".")[0]) : "未接続";
  render();
}

/* ---------- 共通の部品 ---------- */
const AVC = [C.red, C.blue, C.purple, "#2f2a36", "#c2410c", "#0f766e"];
function avatar(name) { let h = 0; for (const ch of String(name || "?")) h = (h * 31 + ch.codePointAt(0)) >>> 0; return `<span class="av" style="background:${AVC[h % AVC.length]}">${esc(String(name || "?").slice(0, 1))}</span>`; }
const TAG = { core: "常連", new: "初参加", away: "離れ気味", mid: "ときどき" };
const tag = (s) => `<span class="tag ${s}">${TAG[s]}</span>`;
function bars(el, pairs, color = C.blue) {
  const max = Math.max(1, ...pairs.map((p) => p[1]));
  $(el).innerHTML = pairs.length ? `<div class="bars">${pairs.map(([k, n]) => `<div class="bar"><span>${esc(k)}</span><i style="width:${n / max * 100}%;background:${color}"></i><span class="n">${n}</span></div>`).join("")}</div>` : `<div class="empty">まだ記録がありません</div>`;
}
function count(arr) { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); }
function spark(values, color) {
  if (values.length < 2) return "";
  const w = 200, h = 26, max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="0,${h} ${pts} ${w},${h}" fill="${color}" fill-opacity=".1" stroke="none"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ---------- ホーム ---------- */
function renderHome() {
  const { members, events } = M, t = todayStr();
  const inRange = (d, a, b) => { const x = daysAgo(d); return x >= a && x < b; };
  const now30 = events.filter((e) => inRange(e.date, 0, 30)), prev30 = events.filter((e) => inRange(e.date, 30, 60));
  const sum = (es) => es.reduce((x, e) => x + e.vs.length, 0);
  const newNow = members.filter((m) => inRange(m.first, 0, 30)).length;
  const rep = members.length ? members.filter((m) => m.n >= 2).length / members.length : null;
  const stays = events.flatMap((e) => e.vs.map(stayOf)).filter((m) => m != null && m < 720);
  const delta = (a, b) => b ? `<em class="${a >= b ? "up" : "down"}">${a >= b ? "＋" : "−"}${Math.abs(Math.round((a - b) / b * 100))}%</em>` : "";
  const perEv = events.slice(-16);
  let cum = 0; const cumArr = events.map((e) => (cum += e.fresh));
  $("kpis").innerHTML = [
    [members.length, "メンバー", newNow ? `<em class="up">＋${newNow}</em>` : "", spark(cumArr.slice(-16), C.ink)],
    [sum(now30), "この30日の来場", delta(sum(now30), sum(prev30)), spark(perEv.map((e) => e.vs.length), C.red)],
    [rep == null ? "–" : Math.round(rep * 100) + "%", "リピート率", "", spark(perEv.map((e) => e.vs.length ? (e.vs.length - e.fresh) / e.vs.length : 0), C.blue)],
    [fmtMin(avg(stays)), "平均の滞在", "", spark(perEv.map((e) => e.stay || 0), C.purple)],
  ].map(([b, s, d, sp]) => `<div class="kpi"><b>${b}</b><span>${s}</span>${d}${sp}</div>`).join("");
  $("homeTitle").textContent = events.length ? `${events.length}回の開催、${members.length}人の鬼。` : "今日も、だれかが鬼。";
  growthChart(events);
  $("recentEvents").innerHTML = events.length ? `<div class="rows">${events.slice(-6).reverse().map((e) => {
    const max = Math.max(...events.map((x) => x.vs.length));
    return `<div class="erow"><div class="d">${md(e.date)}（${wd(e.date)}）<small>${esc(e.placer)}</small></div>
      <div class="stack" style="width:${e.vs.length / max * 100}%"><i class="n" style="flex:${e.fresh}"></i><i class="r" style="flex:${e.vs.length - e.fresh}"></i></div>
      <div class="c">${e.vs.length}<small> 人</small></div></div>`; }).join("")}</div>` : `<div class="empty">開催の記録がまだありません</div>`;
  // 声をかけたい人：離れ気味の常連と、前回が初参加だった人
  const away = members.filter((m) => m.status === "away").sort((a, b) => b.n - a.n).slice(0, 5);
  const fresh = members.filter((m) => m.status === "new").sort((a, b) => a.ago - b.ago).slice(0, 4);
  const list = [...away, ...fresh];
  $("nudges").innerHTML = list.length ? `<div class="rows">${list.map((m) => `<div class="person" data-id="${m.id}">${avatar(m.nickname)}
    <div class="who">${esc(m.nickname || "（未回答）")}<small>${esc(m.faculty || "")} · ${m.n}回 · 最後は${m.ago}日前</small></div>${tag(m.status)}</div>`).join("")}</div>` : `<div class="empty">みんな最近来ています</div>`;
}
function growthChart(events) {
  const el = $("growthChart");
  if (!events.length) { el.innerHTML = `<div class="empty">開催の記録がまだありません</div>`; return; }
  const W = 1000, H = 260, L = 34, R = 40, T = 12, B = 30, iw = W - L - R, ih = H - T - B;
  const maxV = Math.max(...events.map((e) => e.vs.length), 1);
  let cum = 0; const cums = events.map((e) => (cum += e.fresh)); const maxC = Math.max(cum, 1);
  const bw = Math.min(26, iw / events.length * 0.62), x = (i) => L + (events.length === 1 ? iw / 2 : i / (events.length - 1) * (iw - bw) + bw / 2);
  const yv = (v) => T + ih - v / maxV * ih, yc = (v) => T + ih - v / maxC * ih;
  const ticksV = [0, Math.ceil(maxV / 2), maxV], ticksC = [0, Math.round(maxC / 2), maxC];
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  for (const t of ticksV) s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${yv(t)}" y2="${yv(t)}"/><text x="${L - 6}" y="${yv(t) + 4}" text-anchor="end">${t}</text>`;
  for (const t of ticksC) s += `<text x="${W - R + 6}" y="${yc(t) + 4}" fill="${C.ink}" style="fill:${C.ink}">${t}</text>`;
  events.forEach((e, i) => {
    const xi = x(i) - bw / 2, rep = e.vs.length - e.fresh;
    s += `<rect x="${xi}" y="${yv(rep)}" width="${bw}" height="${ih + T - yv(rep)}" fill="${C.blue}" rx="2"><title>${e.date} ${e.placer}：リピーター${rep}人</title></rect>`;
    s += `<rect x="${xi}" y="${yv(e.vs.length)}" width="${bw}" height="${yv(rep) - yv(e.vs.length)}" fill="${C.red}" rx="2"><title>${e.date} ${e.placer}：初参加${e.fresh}人</title></rect>`;
  });
  const step = Math.ceil(events.length / 10);
  events.forEach((e, i) => { if (i % step === 0 || i === events.length - 1) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${md(e.date)}</text>`; });
  s += `<polyline points="${events.map((e, i) => `${x(i)},${yc(cums[i])}`).join(" ")}" fill="none" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>`;
  s += `<circle cx="${x(events.length - 1)}" cy="${yc(cum)}" r="4.5" fill="${C.ink}"/>`;
  el.innerHTML = s + "</svg>";
}

/* ---------- メンバー ---------- */
let mFilter = "all", mSort = { key: "last", dir: -1 }, mSel = null;
const COLS = [["nickname", "ニックネーム"], ["faculty", "学部"], ["grade", "回生"], ["n", "来場", "n"], ["first", "初回"], ["last", "最後"], ["stay", "滞在", "n"], ["heard_from", "きっかけ"], ["status", ""]];
function renderMembers() {
  const { members } = M, q = $("q").value.trim();
  const counts = { all: members.length, core: 0, new: 0, away: 0 }; for (const m of members) if (counts[m.status] != null) counts[m.status]++;
  $("segFilter").innerHTML = [["all", "すべて"], ["core", "常連"], ["new", "初参加"], ["away", "離れ気味"]].map(([k, l]) =>
    `<button data-k="${k}" aria-pressed="${mFilter === k}">${k === "all" ? "" : `<span class="tag ${k}" style="padding:0;background:none"></span>`}${l} ${counts[k]}</button>`).join("");
  let list = members.filter((m) => (mFilter === "all" || m.status === mFilter) && (!q || `${m.nickname} ${m.faculty} ${m.grade}`.includes(q)));
  const k = mSort.key; list.sort((a, b) => { const x = a[k] ?? "", y = b[k] ?? ""; return (x < y ? -1 : x > y ? 1 : 0) * mSort.dir; });
  const maxN = Math.max(1, ...members.map((m) => m.n));
  $("memberTable").innerHTML = `<thead><tr>${COLS.map(([key, l, cls]) => `<th data-k="${key}" class="${cls || ""}" ${mSort.key === key ? `aria-sort="${mSort.dir > 0 ? "ascending" : "descending"}"` : ""}>${l}</th>`).join("")}</tr></thead>
    <tbody>${list.map((m) => `<tr data-id="${m.id}" aria-selected="${mSel === m.id}">
      <td><span class="nick">${avatar(m.nickname)}${esc(m.nickname || "（未回答）")}</span></td><td>${esc(m.faculty || "–")}</td><td>${esc(m.grade || "–")}</td>
      <td class="n"><span class="vbar"><i style="width:${m.n / maxN * 60}px"></i>${m.n}</span></td><td>${md(m.first)}</td><td>${md(m.last)}</td>
      <td class="n">${fmtMin(m.stay)}</td><td>${esc(m.heard_from || "–")}</td><td>${tag(m.status)}</td></tr>`).join("") || `<tr><td colspan="9" class="empty">該当するメンバーはいません</td></tr>`}</tbody>`;
  renderDetail();
}
function renderDetail() {
  const m = M.P.get(mSel), el = $("memberDetail");
  if (!m) { el.innerHTML = `<div class="empty-detail">メンバーを選ぶと、ここに来場の記録が出ます</div>`; return; }
  const been = new Set(m.vs.map((v) => v.visit_date));
  const dots = M.events.filter((e) => e.date >= m.first).map((e) => `<i class="${e.date === m.first ? "first" : been.has(e.date) ? "on" : ""}" title="${e.date} ${esc(e.placer)}"></i>`).join("");
  el.innerHTML = `<div class="dhead">${avatar(m.nickname)}<div><b>${esc(m.nickname || "（未回答）")}</b><small>${esc([m.faculty, m.grade].filter(Boolean).join(" · ") || "アンケート未回答")}</small></div><span class="sp" style="flex:1"></span>${tag(m.status)}</div>
    <div class="dstats"><div><b>${m.n}</b><span>来場</span></div><div><b>${m.stay == null ? "–" : Math.round(m.stay) + "分"}</b><span>平均滞在</span></div><div><b>${m.ago}日</b><span>前に来た</span></div></div>
    <div class="dots" title="初参加からの開催">${dots}</div>
    <div class="dlist">${[...m.vs].reverse().map((v) => `<div><span>${md(v.visit_date)}（${wd(v.visit_date)}）</span><span class="t">${hm(v.arrived_at)} – ${hm(v.left_at)}</span><span>${v.shared ? "📣" : v.made_image ? "✋" : ""}${"★".repeat(v.feeling || 0)}</span></div>`).join("")}</div>
    ${m.heard_from ? `<div class="muted">きっかけ：${esc(m.heard_from)}</div>` : ""}`;
}

/* ---------- 開催 ---------- */
function renderEvents() {
  const list = [...M.events].reverse();
  $("eventList").innerHTML = list.length ? list.map((e) => {
    const firstDay = (pid) => M.P.get(pid)?.first;
    const vs = e.vs.filter((v) => v.arrived_at).sort((a, b) => a.arrived_at < b.arrived_at ? -1 : 1);
    let s0 = Math.min(...vs.map((v) => +new Date(v.arrived_at))), s1 = Math.max(...vs.map((v) => +new Date(v.left_at || e.end || +new Date(v.arrived_at) + 3600e3)));
    if (!vs.length) { s0 = 0; s1 = 1; }
    s0 = Math.floor(s0 / 1800e3) * 1800e3; s1 = Math.ceil(s1 / 1800e3) * 1800e3;
    const W = 600, rowH = Math.max(1.6, Math.min(6, 110 / Math.max(1, vs.length))), H = Math.round(vs.length * rowH + 22), x = (t) => (t - s0) / (s1 - s0 || 1) * W;
    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">`;
    for (let t = s0; t <= s1; t += 1800e3) { const xx = x(t); svg += `<line x1="${xx}" x2="${xx}" y1="0" y2="${H - 16}" stroke="${C.line}"/>`; if (new Date(t).getMinutes() === 0) svg += `<text x="${Math.min(W - 14, Math.max(14, xx))}" y="${H - 3}" text-anchor="middle" style="font-size:10px;fill:${C.muted}">${hourOf(t)}時</text>`; }
    vs.forEach((v, i) => { const a = +new Date(v.arrived_at), b = v.left_at ? +new Date(v.left_at) : null; const col = firstDay(v.participant_no) === e.date ? C.red : C.blue;
      svg += `<rect x="${x(a)}" y="${i * rowH + 2}" width="${Math.max(3, (b ? x(b) : x(a) + 10) - x(a))}" height="${rowH - 1.5}" rx="1.5" fill="${col}" opacity="${b ? 1 : .35}"/>`; });
    svg += "</svg>";
    return `<div class="ev"><div class="date">${md(e.date)}<small>${wd(e.date)}曜・${esc(e.placer)}<br>${hm(e.start)}–${hm(e.end)}</small></div>
      <div class="timeline">${svg}</div>
      <div class="nums"><div><b>${e.vs.length}</b><span>来場</span></div><div><b class="red">${e.fresh}</b><span>初参加</span></div><div><b>${e.peak}</b><span>最大同時</span></div><div><b>${e.stay ? Math.round(e.stay) : "–"}<small style="font-size:11px">分</small></b><span>平均滞在</span></div></div></div>`;
  }).join("") : `<div class="empty">開催の記録がまだありません</div>`;
}

/* ---------- 設置者 ---------- */
function renderPlacers() {
  const { spots, events, members } = M;
  $("placerList").innerHTML = spots.length ? spots.map((s) => {
    const es = events.filter((e) => e.spot === s.token);
    return `<div class="pl ${s.active ? "" : "off"}"><div class="top">${avatar(s.placer)}<b>${esc(s.placer)}</b>${s.active ? "" : `<span class="tag mid">停止中</span>`}</div>
      <div class="nums"><div><b>${es.length}</b><span>開催</span></div><div><b>${es.reduce((x, e) => x + e.vs.length, 0)}</b><span>延べ来場</span></div><div><b style="color:${C.red}">${es.reduce((x, e) => x + e.fresh, 0)}</b><span>初参加</span></div></div>
      <div class="acts"><button data-qr="${esc(s.token)}" data-name="${esc(s.placer)}">QR</button><button data-toggle="${esc(s.token)}">${s.active ? "止める" : "再開"}</button></div></div>`;
  }).join("") : `<div class="empty">まだQRがありません</div>`;
  const placers = new Set(spots.map((s) => s.placer));
  const cand = members.filter((m) => m.status === "core" && !placers.has(m.nickname)).sort((a, b) => b.n - a.n).slice(0, 8);
  $("candidates").innerHTML = cand.length ? `<div class="rows">${cand.map((m) => `<div class="person" data-cand="${esc(m.nickname)}">${avatar(m.nickname)}
    <div class="who">${esc(m.nickname)}<small>${esc(m.faculty || "")} · ${m.n}回 · 平均${fmtMin(m.stay)}</small></div><button class="cand">QRを任せる</button></div>`).join("")}</div>` : `<div class="empty">常連が増えると、ここに並びます</div>`;
}

/* ---------- 伸び ---------- */
function renderGrowth() {
  const { members, events } = M;
  // 初めて来た月ごとの、2回目・3回目・5回目まで来た割合
  const byMonth = new Map(); for (const m of members) { const k = m.first.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(m); }
  const rowsC = [...byMonth.entries()].sort();
  const cell = (p) => p == null ? `<td></td>` : `<td class="c" style="background:rgba(28,72,196,${0.12 + p * 0.88})">${Math.round(p * 100)}%</td>`;
  $("cohort").innerHTML = rowsC.length ? `<table class="cohort"><tr><th></th><th>人数</th><th>2回目</th><th>3回目</th><th>5回目</th></tr>${rowsC.map(([k, ms]) =>
    `<tr><td class="m">${+k.slice(5)}月</td><td>${ms.length}</td>${[2, 3, 5].map((n) => cell(ms.filter((m) => m.n >= n).length / ms.length)).join("")}</tr>`).join("")}</table>` : `<div class="empty">まだ記録がありません</div>`;
  // 曜日×時間（来た時刻）
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0)); let maxG = 0;
  for (const e of events) for (const v of e.vs) if (v.arrived_at) { const g = ++grid[dowOf(v.arrived_at)][hourOf(v.arrived_at)]; maxG = Math.max(maxG, g); }
  const hrs = []; for (let h = 0; h < 24; h++) if (grid.some((r) => r[h])) hrs.push(h);
  const h0 = Math.max(0, Math.min(...hrs, 12) - 1), h1 = Math.min(23, Math.max(...hrs, 19) + 1), cols = h1 - h0 + 1;
  const cw = 34, ch = 26, L = 28, T = 4;
  let hs = `<svg viewBox="0 0 ${L + cols * cw} ${T + 7 * ch + 18}" style="width:100%">`;
  "日月火水木金土".split("").forEach((d, r) => { hs += `<text x="${L - 8}" y="${T + r * ch + 17}" text-anchor="end">${d}</text>`;
    for (let c = 0; c < cols; c++) { const n = grid[r][h0 + c]; hs += `<rect x="${L + c * cw + 1}" y="${T + r * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="4" fill="${n ? C.red : C.soft}" fill-opacity="${n ? 0.15 + 0.85 * n / maxG : 1}"><title>${d} ${h0 + c}時台：${n}人</title></rect>`; } });
  for (let c = 0; c < cols; c += 2) hs += `<text x="${L + c * cw + cw / 2}" y="${T + 7 * ch + 14}" text-anchor="middle">${h0 + c}</text>`;
  $("heat").innerHTML = `<div class="heat">${hs}</svg></div>`;
  bars("gFaculty", count(members.map((m) => m.faculty || "未回答")));
  bars("gHeard", count(members.map((m) => m.heard_from || "未回答")), C.red);
  const order = ["1回生", "2回生", "3回生", "4回生", "院生", "その他", "未回答"];
  bars("gGrade", count(members.map((m) => m.grade || "未回答")).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])), C.purple);
  // ストーリーの広がり：来た → 画像を作った → シェアした → 友達のストーリーで来た
  const all = events.flatMap((e) => e.vs);
  const steps = [["来場", all.length, C.ink], ["画像を作った", all.filter((v) => v.made_image).length, C.purple], ["シェアした", all.filter((v) => v.shared).length, C.red], ["ストーリーで来た", members.filter((m) => m.heard_from === "友達のストーリー").length, C.blue]];
  const mx = Math.max(1, steps[0][1]);
  $("gShare").innerHTML = `<div class="funnel">${steps.map(([l, n, c]) => `<div><span>${l}</span><i style="width:${n / mx * 100}%;background:${c}"></i><span class="n">${n}</span></div>`).join("")}</div>`;
}

/* ---------- 画面の切り替え ---------- */
let view = "home";
function render() {
  if (!M) return;
  ({ home: renderHome, members: renderMembers, events: renderEvents, placers: renderPlacers, growth: renderGrowth })[view]();
}
function go(v) {
  view = v;
  document.querySelectorAll("#nav button").forEach((b) => b.dataset.view === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== "v-" + v));
  $("main").scrollTop = 0; render();
}
$("nav").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) go(b.dataset.view); });
$("q").addEventListener("input", renderMembers);
$("segFilter").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { mFilter = b.dataset.k; renderMembers(); } });
$("memberTable").addEventListener("click", (e) => {
  const th = e.target.closest("th"); if (th) { const k = th.dataset.k; mSort = { key: k, dir: mSort.key === k ? -mSort.dir : (["n", "last", "first", "stay"].includes(k) ? -1 : 1) }; renderMembers(); return; }
  const tr = e.target.closest("tr[data-id]"); if (tr) { mSel = +tr.dataset.id; renderMembers(); }
});
document.addEventListener("click", (e) => {
  const p = e.target.closest(".person[data-id]"); if (p) { mSel = +p.dataset.id; mFilter = "all"; go("members"); }
});
document.addEventListener("keydown", (e) => {
  if (e.metaKey && e.key === "r") { e.preventDefault(); load(); }
  if (e.metaKey && /^[1-5]$/.test(e.key)) go(["home", "members", "events", "placers", "growth"][+e.key - 1]);
});
$("refresh").addEventListener("click", load);

/* ---------- 接続 ---------- */
function openSettings() {
  const cfg = ls.get("onigo_cfg") || {};
  $("sUrl").value = cfg.url || ""; $("sKey").value = cfg.key || ""; $("sErr").hidden = true;
  if (!$("settings").open) $("settings").showModal();
}
$("openSettings").addEventListener("click", openSettings);
$("sClose").addEventListener("click", () => $("settings").close());
$("useDemo").addEventListener("click", () => { ls.set("onigo_demo", true); $("settings").close(); load(); });
$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("sUrl").value.trim().replace(/\/$/, ""), key = $("sKey").value.trim();
  const err = (t) => { $("sErr").textContent = t; $("sErr").hidden = false; };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) return err("Project URL は https://xxxx.supabase.co の形です");
  if (key.length < 30) return err("anon public key を貼り付けてください");
  ls.set("onigo_cfg", { url, key }); ls.set("onigo_demo", false); sb = null; client();
  const { error } = await sb.auth.signInWithPassword({ email: $("sEmail").value.trim(), password: $("sPass").value });
  if (error) return err("ログインできませんでした：" + error.message);
  $("sPass").value = ""; $("settings").close(); load();
});

/* ---------- QRをつくる・止める ---------- */
function canWrite() { if (RAW?.demo) { toast("デモデータでは保存されません"); return true; } if (!client()) { openSettings(); return false; } return true; }
$("newSpot").addEventListener("click", () => { $("spotForm").reset(); $("spotDlg").showModal(); });
$("spCancel").addEventListener("click", () => $("spotDlg").close());
$("spotForm").addEventListener("submit", async (e) => {
  e.preventDefault(); if (!canWrite()) return;
  const a = "abcdefghijkmnpqrstuvwxyz23456789", r = crypto.getRandomValues(new Uint8Array(10));
  const token = [...r].map((x) => a[x % a.length]).join(""), placer = $("spName").value.trim(), note = $("spNote").value.trim() || null;
  if (!RAW.demo) { const { error } = await sb.from("spots").insert({ token, placer, note }); if (error) { toast("作れませんでした：" + error.message); return; } }
  RAW.spots.push({ token, placer, note, active: true, created_at: new Date().toISOString() });
  $("spotDlg").close(); build(); showQR(token, placer);
});
document.addEventListener("click", async (e) => {
  const q = e.target.closest("[data-qr]"); if (q) showQR(q.dataset.qr, q.dataset.name);
  const t = e.target.closest("[data-toggle]");
  if (t) { if (!canWrite()) return; const s = RAW.spots.find((x) => x.token === t.dataset.toggle);
    if (!RAW.demo) { const { error } = await sb.from("spots").update({ active: !s.active }).eq("token", s.token); if (error) { toast("変更できませんでした：" + error.message); return; } }
    s.active = !s.active; build(); }
  const c = e.target.closest("[data-cand]"); if (c) { $("spotForm").reset(); $("spName").value = c.dataset.cand; $("spotDlg").showModal(); }
});
// QRのポスター（B3の縦横比・印刷用に大きめ）。サークル名をいちばん大きく
function qrPoster(q, arrive, F, C) {
  const n = q.getModuleCount();
  const W = 2150, H = Math.round(W * 515 / 364), S = W / 1000, h = H / S;
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const band = arrive ? C.red : C.blue;
  g.scale(S, S); g.fillStyle = C.paper; g.fillRect(0, 0, 1000, h); g.textBaseline = "top";
  g.fillStyle = C.ink; g.font = F(700, 22); g.fillText("RITSUMEIKAN OIC  ONIGOKKO CIRCLE", 60, 58);
  let fs = 176; g.font = F(900, fs);
  const wide = Math.max(g.measureText("おにごっこ").width, g.measureText("サークル").width);
  if (wide > 880) { fs *= 880 / wide; g.font = F(900, fs); }
  g.fillStyle = band; g.fillText("おにごっこ", 56, 100); g.fillText("サークル", 56, 100 + fs * 1.06);
  const bandTop = h - 250, top = 110 + fs * 2.12 + 20, size = Math.min(660, bandTop - 36 - top);
  g.fillStyle = band; g.fillRect(0, bandTop, 1000, h - bandTop);
  g.fillStyle = C.paper; g.textAlign = "center";
  g.font = F(900, 46); g.fillText(arrive ? "参加する時に、読み込んでね！" : "帰る前に、もう一度読み込んでね！", 500, bandTop + 40);
  g.font = F(700, 28); g.fillText("@onigo12345　立命館OIC 岩倉公園", 500, bandTop + 118);
  g.globalAlpha = .85; g.font = F(500, 20); g.fillText("大学非公認の学生有志サークル", 500, bandTop + 176); g.globalAlpha = 1;
  // QRは画素ぴったりに描く（にじまないように）
  g.setTransform(1, 0, 0, 1, 0, 0);
  const cell = Math.floor(size * S / (n + 4)), x0 = Math.round((W - cell * (n + 4)) / 2), y0 = Math.round(top * S);
  g.fillStyle = C.paper; g.fillRect(x0, y0, cell * (n + 4), cell * (n + 4)); g.fillStyle = C.ink;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) g.fillRect(x0 + (x + 2) * cell, y0 + (y + 2) * cell, cell, cell);
  return c;
}
function qrCanvas(url, arrive) {
  const q = qrcode(0, "H"); q.addData(url); q.make();
  return qrPoster(q, arrive, (w, s) => `${w} ${s}px -apple-system,"Hiragino Sans","Noto Sans JP",sans-serif`, { red: C.red, blue: C.blue, ink: C.ink, paper: "#faf8f4" });
}
function showQR(token, name) {
  const box = $("qrPair"); box.innerHTML = "";
  for (const [arrive, url, label] of [[true, BASE_URL + "?k=" + token, "来た時"], [false, BASE_URL + "bye.html?k=" + token, "帰る時"]]) {
    const c = qrCanvas(url, arrive), f = document.createElement("figure"), b = document.createElement("button");
    b.textContent = `${label}のQRを保存`;
    b.onclick = () => c.toBlob((bl) => { const a = document.createElement("a"); a.href = URL.createObjectURL(bl); a.download = `QR_${name}_${label}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
    f.append(c, b); box.append(f);
  }
  $("qrDlg").showModal();
}
$("qrClose").addEventListener("click", () => $("qrDlg").close());

load();
