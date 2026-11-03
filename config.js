// ここを書き換えるだけで本番になります。
// SUPABASE_URL / SUPABASE_ANON_KEY が空のままだと「お試しモード」で動きます
// （参加人数はその端末の中だけで数え、広報用の画像はどこにも送られません）。
window.APP_CONFIG = {
  SUPABASE_URL: "",          // 例: "https://xxxxxxxx.supabase.co"
  SUPABASE_ANON_KEY: "",     // Supabase の Project Settings → API → anon public key
  BUCKET: "hands",           // 広報用に同意してもらった画像の保存先
  INSTAGRAM: "@onigo12345",  // 画像の下に入るアカウント名（未定なら空文字）
  PLACE: "立命館OIC 岩倉公園",
};
