# --- Stage 1: Build Dex Binary ---
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git make gcc musl-dev

WORKDIR /app

# リポジトリ全体をコピー
COPY . .

# vendor/dex 内の Go モジュールを使ってバイナリをビルド
# WORKDIR を vendor/dex に移動して直接コンパイルします
WORKDIR /app/vendor/dex
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -v -o /app/bin/dex ./cmd/dex

# --- Stage 2: Runtime Image ---
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# ビルドした Dex バイナリをコピー
COPY --from=builder /app/bin/dex /usr/local/bin/dex

# Dex の Web UI 用テンプレート・静的ファイルをコピー
COPY --from=builder /app/vendor/dex/web /app/web

EXPOSE 5556

ENTRYPOINT ["/usr/local/bin/dex"]
CMD ["serve", "/etc/dex/config.yaml"]
