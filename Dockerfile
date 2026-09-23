# --- Stage 1: Build Dex Binary ---
FROM golang:1.22-alpine AS builder

# ビルドに必要なツールをインストール
RUN apk add --no-no-cache git make gcc musl-dev

WORKDIR /app

# Goモジュールの依存関係をコピーしてキャッシュ
COPY go.mod go.sum ./
RUN go mod download

# 全ソースコード（vendor含む）をコピー
COPY . .

# vendor/dex 配下のコードをビルドして /app/bin/dex バイナリを生成
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -v -mod=vendor -o /app/bin/dex ./vendor/github.com/dexidp/dex/cmd/dex
# ※ もし vendor 内の構造が ./vendor/dex/cmd/dex の場合はパスを適宜合わせてください

# --- Stage 2: Runtime Image ---
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# ビルドした Dex バイナリをコピー
COPY --from=builder /app/bin/dex /usr/local/bin/dex

# Dex の Web UI 用テンプレートや静的ファイルをコピー
COPY --from=builder /app/vendor/github.com/dexidp/dex/web /app/web

EXPOSE 5556

ENTRYPOINT ["/usr/local/bin/dex"]
CMD ["serve", "/etc/dex/config.yaml"]
