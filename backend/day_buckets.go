package main

import (
	"net/http"
	"strconv"
	"time"
)

type dayBucketPoint struct {
	// Unix seconds, UTC instant. Deliberately not a formatted local time --
	// see the handler comment below for why converting this to an hour of
	// day is entirely the frontend's job, not this endpoint's.
	BucketStartTS int64 `json:"bucket_start_ts"`
	Keystrokes    int   `json:"keystrokes"`
	Clicks        int   `json:"clicks"`
}

// A day is usually 86400s; DST "fall back" makes one local day 25 hours
// long twice a year. This just needs to comfortably cover the longest a
// caller could legitimately ask for -- it's a sanity cap against a bad
// request, not a meaningful business rule.
const maxDayBucketsWindowSeconds = 26 * 60 * 60

// parseDayWindow parses and validates the since/until unix-second query
// params shared by handleMeDayBuckets and handleMeDayApps (added
// 2026-09-02) -- both endpoints take exactly the same "one local calendar
// day, expressed as UTC instants" window, see handleMeDayBuckets's own
// comment below for the full contract and why the server does no
// timezone math itself. Returns a non-empty errMsg (and zero times)
// instead of an error so callers can pass it straight to writeError
// without re-deriving a message.
func parseDayWindow(r *http.Request) (since, until time.Time, errMsg string) {
	sinceParam := r.URL.Query().Get("since")
	untilParam := r.URL.Query().Get("until")
	if sinceParam == "" || untilParam == "" {
		return time.Time{}, time.Time{}, "since and until are required, as unix-second timestamps"
	}
	sinceTS, errS := strconv.ParseInt(sinceParam, 10, 64)
	untilTS, errU := strconv.ParseInt(untilParam, 10, 64)
	if errS != nil || errU != nil {
		return time.Time{}, time.Time{}, "since and until must be integer unix-second timestamps"
	}
	if untilTS <= sinceTS {
		return time.Time{}, time.Time{}, "until must be after since"
	}
	if untilTS-sinceTS > maxDayBucketsWindowSeconds {
		return time.Time{}, time.Time{}, "since/until window too large -- this endpoint is meant for one day at a time"
	}
	return time.Unix(sinceTS, 0).UTC(), time.Unix(untilTS, 0).UTC(), ""
}

// handleMeDayBuckets serves GET /v1/me/day-buckets?since=<unix>&until=<unix>
// -- per-minute activity totals (summed across every device and app) for
// an arbitrary UTC instant window, read straight from activity_buckets.
// Built for the Day view's intraday timeline (2026-09-01): the caller is
// expected to compute since/until as the UTC instants bounding ONE LOCAL
// CALENDAR DAY (this local midnight to the next), then bucket the
// returned points into hours of that same local day itself.
//
// This endpoint does zero timezone math on purpose -- it has no idea what
// timezone the caller is in, and doesn't try to guess. That's the same
// call the local_date fix (see the timezone note in web/README.md) landed
// on for daily_rollups: only the client actually knows the viewer's
// clock, so the server stays timezone-naive and lets the client own the
// day boundary. Concretely: the frontend computes since/until with
// `new Date(year, month, day, 0, 0, 0)` / `+ 1 day` in the *browser's*
// timezone, converts those to unix seconds, and later reads each
// returned bucket_start_ts back into an hour with `.getHours()` on the
// browser's own clock -- never a UTC hour. As long as the frontend
// requests exactly one such local-day window, every point that comes
// back is guaranteed to land in hour 0-23 of the right day once it does
// that conversion, with no server-side timezone logic required at all.
func (s *Server) handleMeDayBuckets(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userIDKey).(int64)

	since, until, errMsg := parseDayWindow(r)
	if errMsg != "" {
		writeError(w, http.StatusBadRequest, errMsg)
		return
	}

	// GROUP BY bucket_start collapses the per-device/per-app rows
	// activity_buckets can have for the same minute (see ingest.go) into
	// one total-activity point -- this endpoint is about *when* during
	// the day you were active, not which app, so per-app detail would
	// just be discarded downstream anyway. (For "which app," see the
	// sibling handleMeDayApps, added the same day this comment was.)
	rows, err := s.DB.QueryContext(r.Context(),
		`SELECT bucket_start, COALESCE(SUM(keystrokes), 0), COALESCE(SUM(clicks), 0)
		 FROM activity_buckets
		 WHERE user_id = $1 AND bucket_start >= $2 AND bucket_start < $3
		 GROUP BY bucket_start ORDER BY bucket_start`,
		userID, since, until,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load day buckets")
		return
	}
	defer rows.Close()

	result := []dayBucketPoint{}
	for rows.Next() {
		var bucketStart time.Time
		var p dayBucketPoint
		if err := rows.Scan(&bucketStart, &p.Keystrokes, &p.Clicks); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read day bucket row")
			return
		}
		p.BucketStartTS = bucketStart.Unix()
		result = append(result, p)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read day buckets")
		return
	}

	writeJSON(w, http.StatusOK, result)
}
