# oidc-reeldev

reeldev.jp向けOIDCサービス一式。

## 構成

- `oidc.reeldev.jp` … OIDCプロバイダ本体(Dexフォークを想定)
- `console.reeldev.jp` … 管理画面(お知らせ・リンクのCRUD、Discord認証で管理人のみ操作可)
- GitHub Actions → GHCR(ghcr.io/OWNER/oidc-server, oidc-console) → ArgoCD → k8s(node worker, tier: prod)
- Vault: Discordクライアントシークレット・OIDC署名鍵・管理人Discord IDリストを保管
- NFS: DexのDBバックエンド(署名鍵・トークン等)の永続化

## バージョン管理でコミットを増やさない工夫

1. GitHub Actionsはイメージに `sha-<12桁ハッシュ>` と `edge`(mainの最新)、
   リリース時のみ `vX.Y.Z` を付けてGHCRへpushするだけで、**リポジトリへの書き戻しは一切行わない**。
2. ArgoCD Image Updaterの `write-back-method` を `git` ではなく `argocd` に設定。
   新しいイメージを検知した際の更新情報はArgoCD Applicationリソース内に保持されるため、
   「イメージ更新用の自動コミット」がgit履歴に積み上がらない。
3. digest(SHAダイジェスト)ベースで更新するため、タグ運用が乱立しても実体は一意に追跡できる。

## 事前準備(あなたの環境で行うこと)

- `OWNER` をGitHub Organization/ユーザー名に置換
- NFSの `storageClassName: nfs-client` を実際のStorageClass名に置換
- Vaultに以下のパスでシークレットを投入
  ```
  vault kv put secret/oidc/server \
    discord_client_id=... discord_client_secret=... signing_key=...
  vault kv put secret/oidc/console \
    discord_client_id=... discord_client_secret=... \
    admin_discord_ids="123456789012345678,234567890123456789" \
    session_secret=...
  ```
- Vault Kubernetes Auth に `oidc-server` / `oidc-console` ロールを作成し、
  対象ServiceAccountとpolicyを紐付け
- Discord Developer Portalでアプリを作成し、リダイレクトURIに
  `https://console.reeldev.jp/api/auth/callback/discord` を登録
- `kubectl apply -f k8s/argocd/application.yaml`(ArgoCDが以降のk8sリソースを同期)

## 管理画面(console)側で実装が必要なもの

- お知らせ(announcements)・リンク(links)のCRUD API + 一覧/編集UI
- Discordログイン後、`ADMIN_DISCORD_IDS` に含まれないユーザーは403にする認可ミドルウェア
- モバイル: ナビバーに溶け込むハンバーガー風ボタン → 右からスライドインするドロワーメニュー
- フッター等に `© reel hosiduki 2026 all rights reserved` を表示

これらのアプリケーション本体(Dexのカスタム設定・consoleのNext.js等)は
このリポジトリの `dex-config/` `console/` 配下に別途追加していく想定です。

## ライセンス

公開リポジトリ運用を前提に、2階建てにしています(詳細は `LICENSE` 参照)。

- `vendor/dex/` … Dex由来コード。Apache License 2.0(`vendor/dex/LICENSE`に全文同梱)。
  Dexから改変したファイルには「何を変更したか」を示すコメントを残すこと(Apache 2.0 第4条(b)の義務)。
- それ以外(`console/`, `k8s/`, `.github/workflows/`, ドキュメント等) … 独自コード。
  `© reel hosiduki 2026 all rights reserved`。無断での再配布・改変・商用利用は不可。

Dexへコントリビュートし直す(アップストリームにPRする)場合は、その部分のみDexのApache 2.0の下で提供する形になります。
