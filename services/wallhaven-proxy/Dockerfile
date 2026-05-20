# ── Build stage ───────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /wallhaven-proxy .

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata su-exec && \
    addgroup -g 65532 -S app && \
    adduser  -u 65532 -S app -G app

COPY --from=builder /wallhaven-proxy /wallhaven-proxy
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# /data is created here so the named volume inherits the directory on first mount.
# Ownership is fixed at runtime by the entrypoint (runs briefly as root).
RUN mkdir -p /data

EXPOSE 8080

# Entrypoint runs as root, chowns /data, then execs the binary as app (65532)
ENTRYPOINT ["/entrypoint.sh"]
