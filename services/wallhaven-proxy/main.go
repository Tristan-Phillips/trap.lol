package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	wallhavenBase = "https://wallhaven.cc/api/v1"
	maxBodyBytes  = 4 << 20 // 4 MB — API responses are never larger
)

var (
	allowedOrigins = mustParseOrigins(getenv("ALLOWED_ORIGINS", "*"))
	listenAddr     = getenv("LISTEN_ADDR", ":8080")

	// allowedPaths are the only Wallhaven API paths we forward
	allowedPaths = map[string]bool{
		"/search":   true,
		"/tag/":     true, // prefix match
		"/settings": true,
		"/w/":       true, // prefix match
	}
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	client := &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        64,
			MaxIdleConnsPerHost: 16,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	mux := http.NewServeMux()
	mux.Handle("/api/v1/", corsMiddleware(rateLimitMiddleware(proxyHandler(client))))
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	})

	slog.Info("wallhaven proxy starting", "addr", listenAddr, "origins", allowedOrigins)
	if err := http.ListenAndServe(listenAddr, mux); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}

// ── Proxy ─────────────────────────────────────────────────────────────────

func proxyHandler(client *http.Client) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Strip our /api/v1 prefix, leaving e.g. /search or /w/abc123
		stripped := strings.TrimPrefix(r.URL.Path, "/api/v1")
		if !isAllowedPath(stripped) {
			http.Error(w, "path not proxied", http.StatusForbidden)
			return
		}

		// Build upstream URL
		upstream, err := url.Parse(wallhavenBase + stripped)
		if err != nil {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}

		// Forward query params (includes apikey if caller provides it)
		upstream.RawQuery = r.URL.RawQuery

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, upstream.String(), nil)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		// Forward API key from either query param or header (both are valid per Wallhaven docs)
		if key := r.Header.Get("X-API-Key"); key != "" {
			req.Header.Set("X-API-Key", key)
		}
		req.Header.Set("User-Agent", "wallhaven-proxy/1.0 (+https://wallhaven.trap.lol)")
		req.Header.Set("Accept", "application/json")

		start := time.Now()
		resp, err := client.Do(req)
		if err != nil {
			slog.Error("upstream request failed", "path", stripped, "err", err)
			writeError(w, http.StatusBadGateway, "upstream unavailable")
			return
		}
		defer resp.Body.Close()

		slog.Info("proxied", "path", stripped, "status", resp.StatusCode, "ms", time.Since(start).Milliseconds())

		body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
		if err != nil {
			writeError(w, http.StatusBadGateway, "failed to read upstream response")
			return
		}

		// Relay upstream headers the client cares about
		w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
		if ct := resp.Header.Get("X-RateLimit-Limit"); ct != "" {
			w.Header().Set("X-RateLimit-Limit", ct)
		}
		if ct := resp.Header.Get("X-RateLimit-Remaining"); ct != "" {
			w.Header().Set("X-RateLimit-Remaining", ct)
		}
		if ct := resp.Header.Get("Retry-After"); ct != "" {
			w.Header().Set("Retry-After", ct)
		}

		// Cache successful search/tag responses for 5 minutes to be kind to Wallhaven
		if resp.StatusCode == http.StatusOK {
			w.Header().Set("Cache-Control", "public, max-age=300, stale-while-revalidate=60")
		} else {
			w.Header().Set("Cache-Control", "no-store")
		}

		w.WriteHeader(resp.StatusCode)
		w.Write(body)
	})
}

// ── Rate limiter (token bucket, per-IP, 45 req/min matching Wallhaven) ────

type rateLimiter struct {
	mu      chan struct{}
	buckets map[string]*bucket
}

type bucket struct {
	tokens    float64
	lastRefil time.Time
}

var rl = &rateLimiter{
	mu:      make(chan struct{}, 1),
	buckets: make(map[string]*bucket),
}

func init() {
	rl.mu <- struct{}{}
	// Evict buckets idle for more than 10 minutes every 5 minutes.
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			cutoff := time.Now().Add(-10 * time.Minute)
			<-rl.mu
			for ip, b := range rl.buckets {
				if b.lastRefil.Before(cutoff) {
					delete(rl.buckets, ip)
				}
			}
			rl.mu <- struct{}{}
		}
	}()
}

func rateLimitMiddleware(next http.Handler) http.Handler {
	const (
		capacity  = 45.0
		refillPer = time.Minute
	)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := realIP(r)

		<-rl.mu
		b, ok := rl.buckets[ip]
		if !ok {
			b = &bucket{tokens: capacity, lastRefil: time.Now()}
			rl.buckets[ip] = b
		}
		elapsed := time.Since(b.lastRefil)
		refilled := elapsed.Seconds() / refillPer.Seconds() * capacity
		b.tokens = min(capacity, b.tokens+refilled)
		b.lastRefil = time.Now()
		allowed := b.tokens >= 1
		if allowed {
			b.tokens--
		}
		remaining := int(b.tokens)
		rl.mu <- struct{}{}

		w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%.0f", capacity))
		w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))

		if !allowed {
			w.Header().Set("Retry-After", "10")
			writeError(w, http.StatusTooManyRequests, "rate limit exceeded — max 45 req/min per IP")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── CORS middleware ────────────────────────────────────────────────────────

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allow := "*"
		if origin != "" && len(allowedOrigins) > 0 {
			for _, o := range allowedOrigins {
				if o == "*" || strings.EqualFold(o, origin) {
					allow = origin
					break
				}
			}
		}
		w.Header().Set("Access-Control-Allow-Origin", allow)
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "X-API-Key, Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")
		w.Header().Set("Vary", "Origin")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── Health ────────────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "ts": time.Now().UTC().Format(time.RFC3339)})
}

// ── Helpers ───────────────────────────────────────────────────────────────

func isAllowedPath(p string) bool {
	if allowedPaths[p] {
		return true
	}
	for prefix := range allowedPaths {
		if strings.HasSuffix(prefix, "/") && strings.HasPrefix(p, prefix) {
			return true
		}
	}
	return false
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]any{"error": msg, "status": code})
}

func realIP(r *http.Request) string {
	// Cloudflare sets CF-Connecting-IP; fall back to X-Real-IP then RemoteAddr
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip
	}
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	// strip port
	addr := r.RemoteAddr
	if i := strings.LastIndex(addr, ":"); i != -1 {
		return addr[:i]
	}
	return addr
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func mustParseOrigins(raw string) []string {
	if raw == "*" {
		return []string{"*"}
	}
	var out []string
	for _, o := range strings.Split(raw, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			out = append(out, o)
		}
	}
	return out
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
