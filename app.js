// 古いページ（ブラウザに残った前の版）がこのファイルを読みに来た時だけ使う：新しいページを読み直す
try {
  if (sessionStorage.getItem("onigokko_reload2") !== location.search) {
    sessionStorage.setItem("onigokko_reload2", location.search);
    const u = new URL(location.href); u.searchParams.set("v", Date.now().toString(36)); location.replace(u.href);
  }
} catch { location.reload(); }
