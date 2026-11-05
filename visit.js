// 来場の記録（来た時のQR・帰る時のQRで共通）
// 端末の見分けには、このスマホの中で作ったランダムな文字列だけを使う（名前や連絡先は使わない）
(function () {
  const CFG = window.APP_CONFIG || {};
  const sb = (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase)
    ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());   // 2026-11-05

  function deviceKey() {
    let k = ls.get("onigokko_device");
    if (!k) { const b = new Uint8Array(16); crypto.getRandomValues(b); k = [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); ls.set("onigokko_device", k); }
    return k;
  }
  // QRに入っている設置者の合言葉（?k=…）。読み直しても同じ日なら覚えておく
  function spot() {
    const k = new URLSearchParams(location.search).get("k");
    if (k && /^[a-z0-9]{4,32}$/.test(k)) { ls.set("onigokko_spot", today() + ":" + k); return k; }
    const s = ls.get("onigokko_spot");
    return s && s.startsWith(today() + ":") ? s.split(":")[1] : null;
  }
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }
  // お試しモード（Supabase未設定）では、このスマホの中だけで同じ動きをまねる
  const local = {
    get() { try { return JSON.parse(ls.get("onigokko_local") || "{}"); } catch { return {}; } },
    put(v) { ls.set("onigokko_local", JSON.stringify(v)); },
  };

  window.Visit = {
    online: !!sb,
    // 来た時：参加番号・何回目か・アンケート済みかを返す
    async join() {
      if (sb) return rpc("join_visit", { p_device: deviceKey(), p_spot: spot() });
      const v = local.get(); v.days = v.days || {};
      if (!v.no) v.no = (+ls.get("onigokko_demo_counter") || 0) + 1, ls.set("onigokko_demo_counter", v.no);
      if (!v.days[today()]) v.days[today()] = { arrived: Date.now() };
      else v.days[today()].arrived = v.days[today()].arrived || Date.now();
      local.put(v);
      return { no: v.no, has_profile: !!v.profile, visits: Object.keys(v.days).length };
    },
    async saveProfile(p) {
      if (sb) return rpc("save_profile", { p_device: deviceKey(), p_faculty: p.faculty, p_grade: p.grade || "", p_nickname: p.nickname, p_heard: p.heard || "" });
      const v = local.get(); v.profile = p; local.put(v);
    },
    async mark(what) {
      try {
        if (sb) return await rpc("mark_visit", { p_device: deviceKey(), p_what: what });
        const v = local.get(); if (v.days?.[today()]) { v.days[today()][what] = true; local.put(v); }
      } catch (e) { console.warn("mark", e); }
    },
    // 帰る時：滞在時間（分）と通算の回数を返す。来た時のQRを読んでいない端末は known:false
    async leave(feeling) {
      if (sb) {
        if (!ls.get("onigokko_device")) return { known: false };
        return rpc("leave_visit", { p_device: deviceKey(), p_spot: spot(), p_feeling: feeling || null });
      }
      const v = local.get(); if (!v.no) return { known: false };
      v.days = v.days || {}; const d = v.days[today()] || (v.days[today()] = {});
      d.left = Date.now(); if (feeling) d.feeling = feeling; local.put(v);
      return { known: true, no: v.no, visits: Object.keys(v.days).length, nickname: v.profile?.nickname || null,
               minutes: d.arrived ? Math.round((d.left - d.arrived) / 60000) : null };
    },
  };
})();
