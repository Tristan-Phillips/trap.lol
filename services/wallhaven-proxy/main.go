package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const (
	wallhavenBase = "https://wallhaven.cc/api/v1"
	maxBodyBytes  = 4 << 20 // 4 MB
	maxImgBytes   = 32 << 20 // 32 MB — full-res images
)

var (
	allowedOrigins = mustParseOrigins(getenv("ALLOWED_ORIGINS", "*"))
	listenAddr     = getenv("LISTEN_ADDR", ":8080")
	dbPath         = getenv("DB_PATH", "/data/wallhaven.db")
	db             *sql.DB
)

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	var err error
	db, err = initDB(dbPath)
	if err != nil {
		slog.Error("failed to open database", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	client := &http.Client{
		Timeout: 20 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        64,
			MaxIdleConnsPerHost: 16,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	mux := http.NewServeMux()

	// Wallhaven API proxy (existing)
	mux.Handle("/api/v1/", corsMiddleware(rateLimitMiddleware(proxyHandler(client))))

	// Image proxy (new — solves hotlink/auth issues)
	mux.Handle("/img", corsMiddleware(imageProxyHandler(client)))

	// Vault API (new)
	mux.Handle("/vault/create", corsMiddleware(handleVaultCreate()))
	mux.Handle("/vault/", corsMiddleware(handleVault()))

	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	})

	slog.Info("wallhaven proxy starting", "addr", listenAddr)
	if err := http.ListenAndServe(listenAddr, mux); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}

// ── Database ──────────────────────────────────────────────────────────────────

func initDB(path string) (*sql.DB, error) {
	// Ensure parent directory exists (entrypoint guarantees it's writable)
	dir := path[:strings.LastIndex(path, "/")]
	if dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("mkdir %s: %w", dir, err)
		}
	}

	conn, err := sql.Open("sqlite", path+"?_journal=DELETE&_timeout=5000&_fk=1&_mutex=full")
	if err != nil {
		return nil, fmt.Errorf("sql.Open: %w", err)
	}
	conn.SetMaxOpenConns(1) // SQLite is single-writer

	// Ping to verify the file can actually be created/opened before running schema
	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("ping (db open failed): %w", err)
	}

	schema := `
	CREATE TABLE IF NOT EXISTS vaults (
		vault_id   TEXT PRIMARY KEY,
		created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
	);
	CREATE TABLE IF NOT EXISTS assignments (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		vault_id   TEXT NOT NULL REFERENCES vaults(vault_id) ON DELETE CASCADE,
		wall_id    TEXT NOT NULL,
		char_id    TEXT NOT NULL,
		char_name  TEXT NOT NULL DEFAULT '',
		thumb_url  TEXT NOT NULL DEFAULT '',
		full_url   TEXT NOT NULL DEFAULT '',
		assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
		UNIQUE(vault_id, wall_id, char_id)
	);
	CREATE TABLE IF NOT EXISTS likes (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		vault_id   TEXT NOT NULL REFERENCES vaults(vault_id) ON DELETE CASCADE,
		wall_id    TEXT NOT NULL,
		wall_data  TEXT NOT NULL DEFAULT '{}',
		liked_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
		UNIQUE(vault_id, wall_id)
	);
	CREATE TABLE IF NOT EXISTS saves (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		vault_id   TEXT NOT NULL REFERENCES vaults(vault_id) ON DELETE CASCADE,
		wall_id    TEXT NOT NULL,
		wall_data  TEXT NOT NULL DEFAULT '{}',
		saved_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
		UNIQUE(vault_id, wall_id)
	);
	CREATE INDEX IF NOT EXISTS idx_assignments_vault ON assignments(vault_id);
	CREATE INDEX IF NOT EXISTS idx_likes_vault ON likes(vault_id);
	CREATE INDEX IF NOT EXISTS idx_saves_vault ON saves(vault_id);
	`
	if _, err := conn.Exec(schema); err != nil {
		return nil, fmt.Errorf("schema init: %w", err)
	}
	slog.Info("database ready", "path", path)
	return conn, nil
}

// ── Vault ID generation ───────────────────────────────────────────────────────

func generateVaultID() (string, error) {
	b := make([]byte, 8) // 16 hex chars = 4 groups of 4
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	h := strings.ToUpper(hex.EncodeToString(b))
	return fmt.Sprintf("%s-%s-%s-%s", h[0:4], h[4:8], h[8:12], h[12:16]), nil
}

// ── Vault handlers ────────────────────────────────────────────────────────────

func handleVaultCreate() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "POST only")
			return
		}

		id, err := generateVaultID()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "id generation failed")
			return
		}

		if _, err := db.Exec(`INSERT INTO vaults(vault_id) VALUES(?)`, id); err != nil {
			writeError(w, http.StatusInternalServerError, "db error")
			return
		}

		slog.Info("vault created", "id", id)
		writeJSON(w, http.StatusCreated, map[string]string{"vault_id": id})
	})
}

// handleVault routes /vault/{id}/... requests
func handleVault() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// Parse: /vault/{id}/{resource}[/{param}]
		parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/vault/"), "/", 3)
		if len(parts) < 2 {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		vaultID := parts[0]
		resource := parts[1]
		param := ""
		if len(parts) == 3 {
			param = parts[2]
		}

		if !vaultExists(vaultID) {
			writeError(w, http.StatusNotFound, "vault not found")
			return
		}

		switch resource {
		case "data":
			vaultDataHandler(w, r, vaultID)
		case "assign":
			assignHandler(w, r, vaultID, param)
		case "like":
			likeHandler(w, r, vaultID, param)
		case "save":
			saveHandler(w, r, vaultID, param)
		default:
			writeError(w, http.StatusNotFound, "unknown resource")
		}
	})
}

func vaultExists(id string) bool {
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM vaults WHERE vault_id=?`, id).Scan(&n)
	return n > 0
}

// GET /vault/{id}/data → full vault state
func vaultDataHandler(w http.ResponseWriter, r *http.Request, vaultID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}

	type AssignEntry struct {
		WallID     string `json:"wallId"`
		CharID     string `json:"charId"`
		CharName   string `json:"charName"`
		ThumbURL   string `json:"thumbUrl"`
		FullURL    string `json:"fullUrl"`
		AssignedAt string `json:"assignedAt"`
	}
	type WallEntry struct {
		WallID   string          `json:"wallId"`
		WallData json.RawMessage `json:"wallData"`
		At       string          `json:"at"`
	}

	var assignments []AssignEntry
	rows, err := db.Query(`SELECT wall_id,char_id,char_name,thumb_url,full_url,assigned_at FROM assignments WHERE vault_id=? ORDER BY assigned_at DESC`, vaultID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var e AssignEntry
		rows.Scan(&e.WallID, &e.CharID, &e.CharName, &e.ThumbURL, &e.FullURL, &e.AssignedAt)
		assignments = append(assignments, e)
	}

	var liked []WallEntry
	rows2, err := db.Query(`SELECT wall_id,wall_data,liked_at FROM likes WHERE vault_id=? ORDER BY liked_at DESC`, vaultID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows2.Close()
	for rows2.Next() {
		var e WallEntry
		var raw string
		rows2.Scan(&e.WallID, &raw, &e.At)
		e.WallData = json.RawMessage(raw)
		liked = append(liked, e)
	}

	var saved []WallEntry
	rows3, err := db.Query(`SELECT wall_id,wall_data,saved_at FROM saves WHERE vault_id=? ORDER BY saved_at DESC`, vaultID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows3.Close()
	for rows3.Next() {
		var e WallEntry
		var raw string
		rows3.Scan(&e.WallID, &raw, &e.At)
		e.WallData = json.RawMessage(raw)
		saved = append(saved, e)
	}

	if assignments == nil {
		assignments = []AssignEntry{}
	}
	if liked == nil {
		liked = []WallEntry{}
	}
	if saved == nil {
		saved = []WallEntry{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"vault_id":    vaultID,
		"assignments": assignments,
		"liked":       liked,
		"saved":       saved,
	})
}

// POST /vault/{id}/assign          — add assignment
// DELETE /vault/{id}/assign/{wallId}/{charId} — remove assignment
func assignHandler(w http.ResponseWriter, r *http.Request, vaultID, param string) {
	switch r.Method {
	case http.MethodPost:
		var body struct {
			WallID   string `json:"wallId"`
			CharID   string `json:"charId"`
			CharName string `json:"charName"`
			ThumbURL string `json:"thumbUrl"`
			FullURL  string `json:"fullUrl"`
		}
		if err := readJSON(r, &body); err != nil || body.WallID == "" || body.CharID == "" {
			writeError(w, http.StatusBadRequest, "wallId and charId required")
			return
		}
		_, err := db.Exec(
			`INSERT INTO assignments(vault_id,wall_id,char_id,char_name,thumb_url,full_url)
			 VALUES(?,?,?,?,?,?)
			 ON CONFLICT(vault_id,wall_id,char_id) DO UPDATE SET
			   char_name=excluded.char_name,
			   thumb_url=excluded.thumb_url,
			   full_url=excluded.full_url`,
			vaultID, body.WallID, body.CharID, body.CharName, body.ThumbURL, body.FullURL,
		)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "db error")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "assigned"})

	case http.MethodDelete:
		// param = "wallId/charId"
		p := strings.SplitN(param, "/", 2)
		if len(p) < 2 {
			writeError(w, http.StatusBadRequest, "DELETE /vault/{id}/assign/{wallId}/{charId}")
			return
		}
		wallID, charID := p[0], p[1]
		db.Exec(`DELETE FROM assignments WHERE vault_id=? AND wall_id=? AND char_id=?`, vaultID, wallID, charID)
		writeJSON(w, http.StatusOK, map[string]string{"status": "unassigned"})

	default:
		writeError(w, http.StatusMethodNotAllowed, "POST or DELETE")
	}
}

// POST /vault/{id}/like            — add like
// DELETE /vault/{id}/like/{wallId} — remove like
func likeHandler(w http.ResponseWriter, r *http.Request, vaultID, wallID string) {
	switch r.Method {
	case http.MethodPost:
		var body struct {
			WallID   string          `json:"wallId"`
			WallData json.RawMessage `json:"wallData"`
		}
		if err := readJSON(r, &body); err != nil || body.WallID == "" {
			writeError(w, http.StatusBadRequest, "wallId required")
			return
		}
		raw := string(body.WallData)
		if raw == "" || raw == "null" {
			raw = "{}"
		}
		db.Exec(
			`INSERT INTO likes(vault_id,wall_id,wall_data) VALUES(?,?,?)
			 ON CONFLICT(vault_id,wall_id) DO UPDATE SET wall_data=excluded.wall_data`,
			vaultID, body.WallID, raw,
		)
		writeJSON(w, http.StatusOK, map[string]string{"status": "liked"})

	case http.MethodDelete:
		if wallID == "" {
			writeError(w, http.StatusBadRequest, "DELETE /vault/{id}/like/{wallId}")
			return
		}
		db.Exec(`DELETE FROM likes WHERE vault_id=? AND wall_id=?`, vaultID, wallID)
		writeJSON(w, http.StatusOK, map[string]string{"status": "unliked"})

	default:
		writeError(w, http.StatusMethodNotAllowed, "POST or DELETE")
	}
}

// POST /vault/{id}/save            — add save
// DELETE /vault/{id}/save/{wallId} — remove save
func saveHandler(w http.ResponseWriter, r *http.Request, vaultID, wallID string) {
	switch r.Method {
	case http.MethodPost:
		var body struct {
			WallID   string          `json:"wallId"`
			WallData json.RawMessage `json:"wallData"`
		}
		if err := readJSON(r, &body); err != nil || body.WallID == "" {
			writeError(w, http.StatusBadRequest, "wallId required")
			return
		}
		raw := string(body.WallData)
		if raw == "" || raw == "null" {
			raw = "{}"
		}
		db.Exec(
			`INSERT INTO saves(vault_id,wall_id,wall_data) VALUES(?,?,?)
			 ON CONFLICT(vault_id,wall_id) DO UPDATE SET wall_data=excluded.wall_data`,
			vaultID, body.WallID, raw,
		)
		writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})

	case http.MethodDelete:
		if wallID == "" {
			writeError(w, http.StatusBadRequest, "DELETE /vault/{id}/save/{wallId}")
			return
		}
		db.Exec(`DELETE FROM saves WHERE vault_id=? AND wall_id=?`, vaultID, wallID)
		writeJSON(w, http.StatusOK, map[string]string{"status": "unsaved"})

	default:
		writeError(w, http.StatusMethodNotAllowed, "POST or DELETE")
	}
}

// ── Image proxy ───────────────────────────────────────────────────────────────
// GET /img?url=<encoded_wallhaven_url>
// Proxies wallhaven images with correct headers so hotlink protection is bypassed.

var imgCache sync.Map // url string → cachedImage

type cachedImage struct {
	data        []byte
	contentType string
	cachedAt    time.Time
}

func imageProxyHandler(client *http.Client) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "GET only")
			return
		}

		rawURL := r.URL.Query().Get("url")
		if rawURL == "" {
			writeError(w, http.StatusBadRequest, "url param required")
			return
		}

		// Only allow wallhaven domains
		parsed, err := url.Parse(rawURL)
		if err != nil || !isWallhavenHost(parsed.Host) {
			writeError(w, http.StatusForbidden, "only wallhaven.cc image URLs are allowed")
			return
		}

		// In-memory cache (5 min TTL)
		if cached, ok := imgCache.Load(rawURL); ok {
			ci := cached.(cachedImage)
			if time.Since(ci.cachedAt) < 5*time.Minute {
				w.Header().Set("Content-Type", ci.contentType)
				w.Header().Set("Cache-Control", "public, max-age=300")
				w.Header().Set("X-Cache", "HIT")
				w.Write(ci.data)
				return
			}
			imgCache.Delete(rawURL)
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, rawURL, nil)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad url")
			return
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; wallhaven-proxy/2.0)")
		req.Header.Set("Referer", "https://wallhaven.cc/")
		req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")

		// Forward API key if provided (needed for NSFW full-res)
		if key := r.Header.Get("X-API-Key"); key != "" {
			req.Header.Set("X-API-Key", key)
		}

		start := time.Now()
		resp, err := client.Do(req)
		if err != nil {
			writeError(w, http.StatusBadGateway, "upstream unavailable")
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			slog.Warn("image proxy upstream error", "url", rawURL, "status", resp.StatusCode)
			w.WriteHeader(resp.StatusCode)
			return
		}

		data, err := io.ReadAll(io.LimitReader(resp.Body, maxImgBytes))
		if err != nil {
			writeError(w, http.StatusBadGateway, "read error")
			return
		}

		ct := resp.Header.Get("Content-Type")
		if ct == "" {
			ct = "image/jpeg"
		}

		imgCache.Store(rawURL, cachedImage{data: data, contentType: ct, cachedAt: time.Now()})

		slog.Info("img proxy", "url", rawURL, "bytes", len(data), "ms", time.Since(start).Milliseconds())

		w.Header().Set("Content-Type", ct)
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.Header().Set("X-Cache", "MISS")
		w.Write(data)
	})
}

func isWallhavenHost(host string) bool {
	return host == "wallhaven.cc" ||
		strings.HasSuffix(host, ".wallhaven.cc") ||
		host == "th.wallhaven.cc" ||
		host == "w.wallhaven.cc"
}

// ── Wallhaven API proxy ───────────────────────────────────────────────────────

var allowedPaths = map[string]bool{
	"/search":   true,
	"/tag/":     true,
	"/settings": true,
	"/w/":       true,
}

func proxyHandler(client *http.Client) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		stripped := strings.TrimPrefix(r.URL.Path, "/api/v1")
		if !isAllowedPath(stripped) {
			http.Error(w, "path not proxied", http.StatusForbidden)
			return
		}

		upstream, err := url.Parse(wallhavenBase + stripped)
		if err != nil {
			http.Error(w, "bad path", http.StatusBadRequest)
			return
		}
		upstream.RawQuery = r.URL.RawQuery

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, upstream.String(), nil)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}

		if key := r.Header.Get("X-API-Key"); key != "" {
			req.Header.Set("X-API-Key", key)
		}
		req.Header.Set("User-Agent", "wallhaven-proxy/2.0 (+https://wallhaven.trap.lol)")
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

		w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
		for _, h := range []string{"X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"} {
			if v := resp.Header.Get(h); v != "" {
				w.Header().Set(h, v)
			}
		}
		if resp.StatusCode == http.StatusOK {
			w.Header().Set("Cache-Control", "public, max-age=300, stale-while-revalidate=60")
		} else {
			w.Header().Set("Cache-Control", "no-store")
		}

		w.WriteHeader(resp.StatusCode)
		w.Write(body)
	})
}

// ── Rate limiter ──────────────────────────────────────────────────────────────

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
		b.tokens = floatMin(capacity, b.tokens+refilled)
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

// ── CORS middleware ───────────────────────────────────────────────────────────

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
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
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

// ── Health ────────────────────────────────────────────────────────────────────

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "ts": time.Now().UTC().Format(time.RFC3339)})
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, dst any) error {
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(dst)
}

func realIP(r *http.Request) string {
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip
	}
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
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

func floatMin(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
