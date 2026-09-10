package main

import (
	"net/http"
	"sync"
	"time"
)

// Simple in-memory per-device token bucket guarding /v1/ingest/batch --
// stdlib only (no golang.org/x/time/rate dependency: a hand-rolled bucket
// is small, and this project already avoids adding Go modules it doesn't
// strictly need). In-memory is fine for a single-instance deployment --
// there's no multi-instance/load-balanced story for this backend yet (see
// README's "what's deliberately out of scope"); if that ever changes,
// this needs to move to something shared (Redis, the same store the
// design doc already earmarks for leaderboards) or it under/over-counts
// per instance.
//
// Legitimate traffic here is very low-frequency: agent.py syncs at most
// once every SYNC_INTERVAL_S (60s) under normal operation, and even a
// catch-up burst after being offline is still one request (the up-to-500-
// bucket batch cap already lives in ingest.go). ingestBucketCapacity is
// generous relative to that on purpose -- this exists to stop a flood (a
// compromised device token, a buggy client stuck retrying), not to police
// normal usage.
const (
	ingestBucketCapacity = 20
	ingestRefillInterval = 3 * time.Second // 1 token per 3s == 20/min sustained
)

type tokenBucket struct {
	tokens     float64
	lastRefill time.Time
}

type rateLimiter struct {
	mu      sync.Mutex
	buckets map[int64]*tokenBucket
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{buckets: make(map[int64]*tokenBucket)}
}

// allow reports whether the given device may make a request right now,
// consuming one token if so. Safe for concurrent use.
func (rl *rateLimiter) allow(deviceID int64) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[deviceID]
	if !ok {
		b = &tokenBucket{tokens: ingestBucketCapacity, lastRefill: time.Now()}
		rl.buckets[deviceID] = b
	}

	now := time.Now()
	elapsed := now.Sub(b.lastRefill).Seconds()
	if elapsed > 0 {
		refill := elapsed / ingestRefillInterval.Seconds()
		b.tokens = min(float64(ingestBucketCapacity), b.tokens+refill)
		b.lastRefill = now
	}

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// rateLimitIngest wraps a handler so it also enforces the per-device
// ingest rate limit. Registered INSIDE requireDevice in main.go (i.e.
// requireDevice(rateLimitIngest(handleIngestBatch))) so it always runs
// with a real, authenticated deviceID already in context -- an
// unauthenticated request never reaches this far, requireDevice already
// rejected it.
func (s *Server) rateLimitIngest(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		deviceID := r.Context().Value(deviceIDKey).(int64)
		if !s.ingestLimiter.allow(deviceID) {
			writeError(w, http.StatusTooManyRequests, "too many ingest requests -- slow down")
			return
		}
		next(w, r)
	}
}
