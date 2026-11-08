# Frame Studio

図形・文字・画像を組み合わせた絵を複数フレーム（GIF 的）で描き、そのまま Claude Code に指示を送る mod。

エディタ本体は本物の HTML Canvas（`hooks/editor.html`）で、mod が同梱の小さなローカルサーバー（`hooks/server.py`、Python 標準ライブラリ）から配ります。エディタの「AIに送信」はサーバーの送信箱に積まれ、mod が拾ってこのセッションのプロンプトとして送ります。

## インストール

Claude Code のターミナルで:

```
/plugin install frame-studio --marketplace GorosukeSan/frame-studio
```

`Add marketplace?` に `y`、スコープを選んで Enter。

シェルからなら:

```bash
claude plugin install frame-studio --marketplace GorosukeSan/frame-studio
```

デスクトップアプリ（`/plugin` が使えない場所）では、プロンプト欄の横の + → Plugins → Add marketplace に `GorosukeSan/frame-studio` → Add plugin。

## 使い方

1. `/frame-studio` — サーバーが起動し、ペインに URL（http://localhost:48123）が出る
2. その URL を Claude Code の Browser ペインか普通のブラウザで開く
3. 描く
   - ツール: 選択/四角/円/線/矢印/ペン/文字/画像（キー: V R E L A P T）
   - Shift で正方形・正円・45° 単位。選択ツールでドラッグ移動、角のハンドルで拡大縮小
   - 文字: 文字ツールでクリックして入力、Enter で確定。ダブルクリックで編集
   - 画像: 「🖼 画像」ボタン、Ctrl+V 貼り付け、ファイルのドロップ
   - Ctrl+Z / Ctrl+Y / Ctrl+D / Delete / [ ] で前面・背面 / 矢印キーで微調整
4. フレーム: 「複製して次へ」で前のコマを元に次のコマ。オニオンスキンで前コマを薄く表示、「▶ 再生」でプレビュー、表示時間は ms 単位
5. 「AIへの指示」を書いて「AIに送信」（Ctrl+Enter）。「プロンプト欄に入れる」なら送る前に編集できる

送信すると `<作業フォルダ>/.frame-studio/<日時>/` に `frame_XX.png`（2 倍解像度）、`anim.gif`（Pillow がある場合）、全コマ一覧 `sheet.png`、`scene.json`、貼った画像 `img_XX.png` が書き出され、そのパスと図形の概要（座標・色・文字）を添えた指示が Claude に届きます。

エディタの内容はブラウザの localStorage に残るので、閉じても次回に続きから描けます。

## 必要なもの

- Python 3（サーバー）。GIF 書き出しには Pillow（`pip install pillow`）。なくても PNG と一覧は出ます
- ポート 48123 が空いていること（サーバーは 127.0.0.1 だけで待ち受けます）
- 描画はブラウザで行うので、ターミナル版の Claude Code でも使えます（URL を普通のブラウザで開く）

## ライセンス

MIT
