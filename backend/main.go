package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://localhost:5432/keycount?sslmode=disable"
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("connecting to postgres: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("postgres ping failed: %v (is Postgres running, and does the database in DATABASE_URL exist?)", err)
	}

	if err := RunMigrations(db); err != nil {
		log.Fatalf("running migrations: %v", err)
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET env var is required (set it to any long random string)")
	}

	srv := &Server{DB: db, JWTSecret: []byte(jwtSecret), ingestLimiter: newRateLimiter()}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/healthz", srv.handleHealth)
	mux.HandleFunc("POST /v1/auth/signup", srv.handleSignup)
	mux.HandleFunc("POST /v1/auth/login", srv.handleLogin)
	mux.HandleFunc("POST /v1/auth/refresh", srv.handleRefresh)
	mux.HandleFunc("POST /v1/agent/register-device", srv.requireUser(srv.handleRegisterDevice))
	mux.HandleFunc("POST /v1/ingest/batch", srv.requireDevice(srv.rateLimitIngest(srv.handleIngestBatch)))
	mux.HandleFunc("GET /v1/me/stats", srv.requireUser(srv.handleMeStats))
	mux.HandleFunc("GET /v1/me/history", srv.requireUser(srv.handleMeHistory))
	mux.HandleFunc("GET /v1/me/apps-breakdown", srv.requireUser(srv.handleAppsBreakdown))
	mux.HandleFunc("GET /v1/me/day-buckets", srv.requireUser(srv.handleMeDayBuckets))
	mux.HandleFunc("GET /v1/me/day-apps", srv.requireUser(srv.handleMeDayApps))
	mux.HandleFunc("GET /v1/me/settings", srv.requireUser(srv.handleGetSettings))
	mux.HandleFunc("PATCH /v1/me/settings", srv.requireUser(srv.handlePatchSettings))
	mux.HandleFunc("GET /v1/leaderboards/keystrokes", srv.requireUser(srv.handleLeaderboardKeystrokes))
	mux.HandleFunc("GET /v1/leaderboards/streak", srv.requireUser(srv.handleLeaderboardStreak))
	mux.HandleFunc("GET /v1/users/{username}/public-profile", srv.handlePublicProfile)

	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}

	allowedOrigins := parseAllowedOrigins(os.Getenv("ALLOWED_ORIGINS"))

	httpServer := &http.Server{
		Addr:         addr,
		Handler:      corsMiddleware(allowedOrigins, logRequests(mux)),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	log.Printf("KeyCount backend listening on %s (allowed origins: %v)", addr, allowedOrigins)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

// parseAllowedOrigins reads a comma-separated ALLOWED_ORIGINS env var
// (e.g. "http://localhost:5173,https://keycount.example.com"), trimming
// whitespace around each entry. Defaults to the Vite dev server's default
// origin so local development keeps working with zero config, same as
// DATABASE_URL/JWT_SECRET/ADDR's own env-var-with-a-sane-default pattern
// above. Empty entries (from a trailing comma, or an unset/empty env var)
// are dropped rather than accidentally matching an empty Origin header.
func parseAllowedOrigins(raw string) []string {
	if raw == "" {
		return []string{"http://localhost:5173"}
	}
	var origins []string
	for _, o := range strings.Split(raw, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			origins = append(origins, o)
		}
	}
	if len(origins) == 0 {
		return []string{"http://localhost:5173"}
	}
	return origins
}

// corsMiddleware used to be a flat `Access-Control-Allow-Origin: *` --
// fine while this API only ever talked to one developer's own localhost
// frontend, but this phase (2026-09-02) is the first time other people's
// browsers are expected to hit it too (leaderboards, public profiles).
// "*" also can't be combined with credentialed requests per the CORS spec
// in the first place, though this API doesn't use cookies -- the real
// reason to lock it down is that "any website in the world can read
// responses from this API in a logged-in user's browser" was never an
// intentional choice, just an MVP default nobody had revisited yet. Now
// it echoes back the specific Origin only when it's in the allowlist
// (plus Vary: Origin so caches don't serve one origin's preflight
// response to another), same origin-echo pattern agent.py's local API
// already uses for its own CORS handling.
func corsMiddleware(allowedOrigins []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isAllowedOrigin(origin, allowedOrigins) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isAllowedOrigin(origin string, allowed []string) bool {
	if origin == "" {
		return false
	}
	for _, a := range allowed {
		if a == origin {
			return true
		}
	}
	return false
}
