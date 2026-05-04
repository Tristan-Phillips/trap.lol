# ── Build stage ─────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

WORKDIR /src

# Cache deps before copying source
COPY go.mod ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /wallhaven-proxy .

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM scratch

# Pull in CA certs so we can reach wallhaven.cc over TLS
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

COPY --from=builder /wallhaven-proxy /wallhaven-proxy

EXPOSE 8080

ENTRYPOINT ["/wallhaven-proxy"]
