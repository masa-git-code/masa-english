# Masa English

瞬間英作文スピーキングの練習アプリです。iPhoneのSafariで開いて使います。

- 1シーン5問の職場英会話。日本語を見て、すぐ英語で話します。
- マイクボタンを押している間だけ、英語（米国）で聞き取ります。短くタップすると「タップで開始・タップで停止」になります。
- AIが文法・ニュアンスと表現・構成の3つの視点で添削し、お手本音声を再生できます。
- 苦手な表現の保存と復習、記録（スコア・回答時間・推定レベル）。

データ（苦手な表現・記録）はiPhoneのSafariの中に保存されます。「苦手な表現」タブからJSONで書き出し・読み込みができます。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `index.html` | アプリ本体（GitHub Pagesで公開） |
| `config.js` | 中継サーバーのURL。秘密情報は書かない |
| `worker/worker.js` | AI添削の中継サーバー（Cloudflare Worker）。APIキーはここではなくCloudflareに保存する |
| `.github/workflows/pages.yml` | `main` に変更が入ると自動でGitHub Pagesに公開 |

## 初回の設定手順

APIキーと合言葉は、GitHub・チャット・`config.js` には絶対に書かないでください。Cloudflareの「Secret」にだけ保存します。

### 1. GitHub Pagesを有効にする

1. このリポジトリの **Settings** → 左メニュー **Pages**
2. **Build and deployment** の **Source** を **GitHub Actions** にする
3. **Actions** タブで「Deploy to GitHub Pages」が緑色になれば公開完了
   - URL: https://masa-git-code.github.io/masa-english/
   - 失敗している場合は、その実行を開き **Re-run all jobs** を押す

### 2. AnthropicのAPIキーを発行する

1. https://console.anthropic.com にログイン（アカウントがなければ作成）
2. **Billing** でクレジットを購入（まずは $5 程度で十分）
3. **Limits** で月の上限金額（例: $10）を設定しておくと安心です
4. **API Keys** → **Create Key** → 名前は `masa-english` → 表示されたキーをコピー（この画面でしか表示されません）

### 3. Cloudflare Workerを作る

1. https://dash.cloudflare.com に無料アカウントでログイン
2. **Workers & Pages** → **Create** → **Create Worker** → 名前を `masa-english` にして **Deploy**
3. **Edit code** を開き、中身をすべて消して `worker/worker.js` の内容を貼り付け → **Deploy**
4. Workerの **Settings** → **Variables and Secrets** で次の3つを追加 → **Deploy**

| 名前 | 種類 | 値 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Secret | 手順2でコピーしたAPIキー |
| `APP_TOKEN` | Secret | 自分で決める合言葉（英数字12文字以上がおすすめ） |
| `ALLOWED_ORIGIN` | Text | `https://masa-git-code.github.io` |

5. Workerの URL（`https://masa-english.〇〇.workers.dev`）をコピー

### 4. WorkerのURLをアプリに設定する

`config.js` の `workerUrl` に手順3のURLを入れます（URLは秘密情報ではありません）。Claudeに URL を伝えれば代わりに更新します。

### 5. iPhoneで使い始める

1. Safariで https://masa-git-code.github.io/masa-english/ を開く
2. ホーム画面の **設定** → **合言葉** に手順3の `APP_TOKEN` と同じ値を入れて **保存**
3. 共有ボタン → **ホーム画面に追加** でアプリのように使えます
4. 最初にマイクボタンを押すと、マイクと音声認識の許可を求められるので **許可** を押す

### 6. 以前のアプリから苦手な表現を移す

1. 以前のアプリ（Claudeの中のMasa English）の **苦手な表現** → **JSONをコピー**
2. 新しいアプリの **苦手な表現** → **貼り付けで読み込む** → 貼り付けてもう一度 **貼り付けで読み込む**

## 費用の目安

添削には `claude-sonnet-5-5`、新しいシーンの作成には `claude-haiku-5-5` を使っています。1問の添削で3円前後、1シーン（5問）で15円前後が目安です（実際の金額は回答の長さで変わります）。使った分だけAnthropicに請求されます。Anthropicの管理画面で月の上限金額を設定しておいてください。Cloudflare WorkersとGitHub Pagesは無料枠で使えます。

### モデルの切り替え（コードの変更は不要）

Workerの「変数とシークレット」にテキストの変数を追加すると、使うモデルを変えられます。追加後は「デプロイ」を押してください。

| 変数名 | 内容 | 例 |
|---|---|---|
| `GRADE_MODEL` | 添削に使うモデル | `claude-haiku-5-5`（さらに安く、1問1円未満） |
| `SCENE_MODEL` | シーン作成に使うモデル | `claude-sonnet-5-5` |
