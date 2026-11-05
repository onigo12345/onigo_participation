// デモデータ：Supabase に接続する前に、画面の見え方を確かめるための架空のデータ
window.makeDemo = function () {
  let s = 20261105; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pick = (a, w) => { if (!w) return a[Math.floor(r() * a.length)]; let t = r() * w.reduce((x, y) => x + y, 0); for (let i = 0; i < a.length; i++) if ((t -= w[i]) < 0) return a[i]; return a.at(-1); };
  const fac = ["映像学部", "情報理工学部", "経営学部", "政策科学部", "総合心理学部", "グローバル教養学部", "産業社会学部", "理工学部", "ほかの大学"];
  const facW = [22, 16, 15, 9, 9, 5, 4, 4, 3];
  const nick = "かず たっくん みー ゆうき あお はる そら りん けい なな こたろう まな しゅん ゆい れん ひなた そうた もも だいち さき かいと ののか りく あかり ゆず たいが みお ひろ ちひろ".split(" ");
  const spots = [
    { token: "fjpc5t6gz9", placer: "代表", note: "最初のQR", active: true, created_at: "2026-05-01T00:00:00Z" },
    { token: "demo2tak", placer: "たっくん", note: "火曜担当", active: true, created_at: "2026-07-01T00:00:00Z" },
    { token: "demo3mii", placer: "みー", note: null, active: true, created_at: "2026-08-20T00:00:00Z" },
  ];
  // 隔週木曜＋常連が立ち上げた開催
  const days = [];
  for (let d = new Date("2026-05-07T12:00:00+09:00"); d < new Date("2026-11-03T00:00:00+09:00"); d.setDate(d.getDate() + 14)) days.push([d.toISOString().slice(0, 10), "fjpc5t6gz9"]);
  for (const x of ["2026-07-08", "2026-07-22", "2026-08-05", "2026-09-30", "2026-10-14", "2026-10-28"]) days.push([x, "demo2tak"]);
  for (const x of ["2026-08-29", "2026-09-12", "2026-10-10", "2026-10-24"]) days.push([x, "demo3mii"]);
  days.sort();
  const people = [], visits = []; let id = 0, vid = 0;
  const loyalty = [];
  days.forEach(([date, spot], i) => {
    const t = (h, m) => new Date(new Date(`${date}T${String(h).padStart(2, "0")}:00:00+09:00`).getTime() + m * 60000);
    const start = spot === "fjpc5t6gz9" ? 13 + Math.floor(r() * 2) : 16;
    // リピーター
    const att = new Set();
    for (const p of people) if (r() < loyalty[p.id]) att.add(p.id);
    // 新しい人（だんだん増える）
    const nNew = Math.round(1 + i * 0.12 + r() * 2.5);
    for (let k = 0; k < nNew; k++) {
      id++; const heard = pick(["Instagram", "友達のストーリー", "友達に誘われた", "公園で見かけた", "その他"], [3 + i * .1, 2 + i * .25, 4, 2, 1]);
      people.push({ id, faculty: pick(fac, facW), grade: pick(["1回生", "2回生", "3回生", "4回生", "院生", null], [30, 25, 20, 8, 3, 14]),
        nickname: nick[id % nick.length] + (id > nick.length ? String(Math.floor(id / nick.length) + 1) : ""), heard_from: r() < .85 ? heard : null, created_at: t(start, 0).toISOString() });
      loyalty[id] = pick([.05, .2, .45, .75], [40, 30, 20, 10]); att.add(id);
    }
    for (const pid of att) {
      const a = t(start, Math.floor(r() * 80)), stay = 30 + Math.floor(r() * 120);
      const left = r() < .78 ? new Date(a.getTime() + stay * 60000) : null;
      visits.push({ id: ++vid, participant_no: pid, spot, visit_date: date, arrived_at: a.toISOString(), left_at: left && left.toISOString(),
        made_image: r() < .8, shared: r() < .42, feeling: left && r() < .7 ? pick([1, 2, 3], [1, 4, 4]) : null });
    }
  });
  return { people, visits, spots, demo: true };
};
