# 同梱しているもの

参加者のIPアドレスなどがほかの会社に送られないよう、次のものはこのリポジトリに同梱し、外部の配信サービスからは読み込みません。

| もの | 場所 | ライセンス |
|---|---|---|
| Noto Sans JP（使う文字だけを抜き出したもの） | `fonts/` | SIL Open Font License 1.1 |
| MediaPipe Tasks Vision 0.10.14（手の検出） | `vendor/mediapipe/` | Apache License 2.0 |
| MediaPipe Hand Landmarker モデル | `vendor/mediapipe/hand_landmarker.task` | Apache License 2.0 |
| supabase-js 2.45.4 | `vendor/supabase.js` | MIT License |
| qrcode-generator 1.4.4 | `vendor/qrcode.js` | MIT License |
| JSZip 3.10.1 | `vendor/jszip.min.js` | MIT License / GPLv3（MITを選択） |

手の検出モデルは、GitHub Actions（`.github/workflows/fetch-model.yml`）が配布元から取得してリポジトリに追加します。追加されるまでの間だけ、参加者のブラウザが配布元（Google）から直接読み込みます。写真が送られることはありません。
