# ── Build stage ───────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /wallhaven-proxy .

# ── Runtime stage ─────────────────────────────────────────────────────────────
# alpine instead of scratch — needed for CA certs and timezone data
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata && \
    mkdir -p /data

COPY --from=builder /wallhaven-proxy /wallhaven-proxy

EXPOSE 8080

ENTRYPOINT ["/wallhaven-proxy"]
