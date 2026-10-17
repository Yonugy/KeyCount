//! Talking to the KeyCount backend: sign in / sign up, register this
//! device, and push unsynced minute-buckets. Same endpoints and payload
//! shape as agent.py, so the Go backend needs no changes.
//!
//! PRIVACY: only events_buffer rows (counts per app per minute) are ever
//! sent. The per-key table is never read here.

use crate::store::Store;
use chrono::{Local, TimeZone};
use serde_json::{json, Value};
use std::time::Duration;

/// Packaged builds sync to the hosted backend out of the box.
pub const DEFAULT_BACKEND_URL: &str = "https://keycount.onrender.com";

pub struct HttpResponse {
    pub status: u16,
    pub body: Value,
}

/// POST JSON. `Err` means the request never got an answer at all (backend
/// unreachable, timeout); any HTTP status, including 4xx/5xx, is `Ok`.
pub fn post_json(url: &str, payload: &Value, token: Option<&str>) -> Result<HttpResponse, String> {
    // Render's free tier can take close to a minute to wake up, so be patient.
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(60)))
        .http_status_as_error(false)
        .build()
        .into();
    let mut req = agent.post(url);
    if let Some(t) = token {
        req = req.header("Authorization", format!("Bearer {t}"));
    }
    match req.send_json(payload) {
        Ok(mut resp) => {
            let status = resp.status().as_u16();
            let text = resp.body_mut().read_to_string().unwrap_or_default();
            let body = if text.is_empty() {
                json!({})
            } else {
                serde_json::from_str(&text).unwrap_or_else(|_| json!({ "error": text }))
            };
            Ok(HttpResponse { status, body })
        }
        Err(e) => Err(e.to_string()),
    }
}

fn err_text(body: &Value) -> String {
    match body.get("error") {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => body.to_string(),
    }
}

/// "win32" / "darwin" / "linux", the same strings agent.py sends.
pub fn platform_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

pub fn device_name() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "unnamed device".to_string())
}

pub fn normalize_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

/// Sign in (or sign up) and register this machine as a device, storing the
/// device token so syncing can run unattended. The password is only ever
/// held in the arguments for the duration of this call.
pub fn register_device(
    store: &Store,
    backend_url: &str,
    has_account: bool,
    email: &str,
    password: &str,
    username: Option<&str>,
) -> Result<String, String> {
    let backend_url = normalize_url(backend_url);
    if backend_url.is_empty() {
        return Err("Enter the backend URL.".into());
    }
    let (path, payload) = if has_account {
        ("/v1/auth/login", json!({ "email": email, "password": password }))
    } else {
        let username = username.unwrap_or("").trim();
        if username.is_empty() {
            return Err("Choose a username for the new account.".into());
        }
        ("/v1/auth/signup", json!({ "email": email, "username": username, "password": password }))
    };

    let resp = post_json(&format!("{backend_url}{path}"), &payload, None)
        .map_err(|e| format!("Could not reach {backend_url}: {e}"))?;
    if resp.status != 200 && resp.status != 201 {
        return Err(format!("Login/signup failed ({}): {}", resp.status, err_text(&resp.body)));
    }
    let token = resp
        .body
        .get("token")
        .and_then(Value::as_str)
        .ok_or_else(|| "The backend did not return a login token.".to_string())?
        .to_string();
    let resp_username = resp.body.get("username").and_then(Value::as_str).map(str::to_string);
    let signed_in_as = resp_username.clone().unwrap_or_else(|| "your account".to_string());

    let name = device_name();
    let resp = post_json(
        &format!("{backend_url}/v1/agent/register-device"),
        &json!({ "name": name, "platform": platform_name() }),
        Some(&token),
    )
    .map_err(|e| format!("Could not reach {backend_url}: {e}"))?;
    if resp.status != 201 {
        return Err(format!("Device registration failed ({}): {}", resp.status, err_text(&resp.body)));
    }
    let device_token = resp
        .body
        .get("device_token")
        .and_then(Value::as_str)
        .ok_or_else(|| "The backend did not return a device token.".to_string())?;

    store.set_setting("backend_url", &backend_url).map_err(|e| e.to_string())?;
    store.set_setting("device_token", device_token).map_err(|e| e.to_string())?;
    let account_name = resp_username.clone().unwrap_or_else(|| email.to_string());
    store.set_setting("account_name", &account_name).map_err(|e| e.to_string())?;
    Ok(format!("Signed in as {signed_in_as}. Registered device '{name}', syncing is now on."))
}

/// One sync pass. Returns (buckets synced, error). Same contract as
/// agent.py's sync_once.
pub fn sync_once(store: &Store, backend_url: &str, device_token: &str, limit: i64) -> (usize, Option<String>) {
    let rows = match store.unsynced_batch(limit) {
        Ok(r) => r,
        Err(e) => return (0, Some(format!("could not read pending data: {e}"))),
    };
    if rows.is_empty() {
        return (0, None);
    }
    let payload: Vec<Value> = rows
        .iter()
        .map(|r| {
            // The machine's own calendar day for this bucket, not UTC's, so
            // activity just after local midnight lands on the right day.
            let local_date = Local
                .timestamp_opt(r.bucket_start_ts, 0)
                .earliest()
                .map(|d| d.format("%Y-%m-%d").to_string())
                .unwrap_or_default();
            json!({
                "bucket_start_ts": r.bucket_start_ts,
                "app_name": r.app_name,
                "keystrokes": r.keystrokes,
                "backspaces": r.backspaces,
                "mouse_clicks": r.mouse_clicks,
                "mouse_distance_px": r.mouse_distance_px,
                "local_date": local_date,
            })
        })
        .collect();
    let ids: Vec<i64> = rows.iter().map(|r| r.id).collect();

    let url = format!("{}/v1/ingest/batch", normalize_url(backend_url));
    match post_json(&url, &Value::Array(payload), Some(device_token)) {
        Ok(resp) if resp.status == 200 => {
            if let Err(e) = store.mark_synced(&ids) {
                return (0, Some(format!("synced but could not mark rows: {e}")));
            }
            let inserted = resp.body.get("inserted").and_then(Value::as_u64).map(|n| n as usize);
            (inserted.unwrap_or(ids.len()), None)
        }
        Ok(resp) => (0, Some(format!("sync failed ({}): {}", resp.status, err_text(&resp.body)))),
        Err(e) => (0, Some(format!("sync failed: could not reach the backend: {e}"))),
    }
}

#[cfg(test)]
pub mod test_support {
    //! A tiny fake backend for tests, recording every request it receives.
    use serde_json::Value;
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Clone)]
    pub struct Seen {
        pub method: String,
        pub path: String,
        pub auth: Option<String>,
        pub body: Value,
    }

    pub struct FakeBackend {
        pub url: String,
        pub seen: Arc<Mutex<Vec<Seen>>>,
        server: Arc<tiny_http::Server>,
    }

    impl Drop for FakeBackend {
        fn drop(&mut self) {
            self.server.unblock();
        }
    }

    /// `respond(path, request_body)` returns (status, json_body).
    pub fn start(respond: impl Fn(&str, &Value) -> (u16, Value) + Send + 'static) -> FakeBackend {
        let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").unwrap());
        let port = server.server_addr().to_ip().unwrap().port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (srv, log) = (server.clone(), seen.clone());
        std::thread::spawn(move || {
            for mut req in srv.incoming_requests() {
                let mut text = String::new();
                let _ = std::io::Read::read_to_string(req.as_reader(), &mut text);
                let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                let auth = req
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv("Authorization"))
                    .map(|h| h.value.to_string());
                let path = req.url().to_string();
                log.lock().unwrap().push(Seen { method: req.method().to_string(), path: path.clone(), auth, body: body.clone() });
                let (status, resp_body) = respond(&path, &body);
                let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
                let _ = req.respond(
                    tiny_http::Response::from_string(resp_body.to_string()).with_status_code(status).with_header(header),
                );
            }
        });
        FakeBackend { url: format!("http://127.0.0.1:{port}"), seen, server }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::start;
    use super::*;

    fn store_with_rows() -> Store {
        let s = Store::open_in_memory().unwrap();
        s.insert_bucket(1_790_000_400, "code", 10, 1, 2, 50).unwrap();
        s.insert_bucket(1_790_000_400, "chrome", 5, 0, 0, 0).unwrap();
        s
    }

    #[test]
    fn sync_posts_the_agent_payload_and_marks_rows_synced() {
        let backend = start(|_, _| (200, json!({ "inserted": 2 })));
        let store = store_with_rows();
        let (n, err) = sync_once(&store, &backend.url, "devtok", 500);
        assert_eq!((n, err), (2, None));
        assert!(store.unsynced_batch(10).unwrap().is_empty());

        let seen = backend.seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].method, "POST");
        assert_eq!(seen[0].path, "/v1/ingest/batch");
        assert_eq!(seen[0].auth.as_deref(), Some("Bearer devtok"));
        let arr = seen[0].body.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        let first = &arr[0];
        for k in ["bucket_start_ts", "app_name", "keystrokes", "backspaces", "mouse_clicks", "mouse_distance_px", "local_date"] {
            assert!(first.get(k).is_some(), "missing field {k}");
        }
        assert_eq!(first["app_name"], "code");
        assert_eq!(first["keystrokes"], 10);
        assert_eq!(first["local_date"].as_str().unwrap().len(), 10);
        // never anything about individual keys
        assert!(first.get("keys").is_none() && first.get("key_name").is_none());
    }

    #[test]
    fn failed_sync_keeps_rows_for_retry() {
        let backend = start(|_, _| (401, json!({ "error": "bad token" })));
        let store = store_with_rows();
        let (n, err) = sync_once(&store, &backend.url, "nope", 500);
        assert_eq!(n, 0);
        assert!(err.unwrap().contains("401"));
        assert_eq!(store.unsynced_batch(10).unwrap().len(), 2);

        // unreachable backend
        let (n, err) = sync_once(&store, "http://127.0.0.1:1", "x", 500);
        assert_eq!(n, 0);
        assert!(err.is_some());
        assert_eq!(store.unsynced_batch(10).unwrap().len(), 2);
    }

    #[test]
    fn nothing_to_sync_makes_no_request() {
        let backend = start(|_, _| (200, json!({})));
        let store = Store::open_in_memory().unwrap();
        assert_eq!(sync_once(&store, &backend.url, "t", 500), (0, None));
        assert!(backend.seen.lock().unwrap().is_empty());
    }

    #[test]
    fn register_logs_in_then_registers_device_and_saves_tokens() {
        let backend = start(|path, _| match path {
            "/v1/auth/login" => (200, json!({ "token": "jwt1", "username": "yonugy" })),
            "/v1/agent/register-device" => (201, json!({ "device_token": "devtok9" })),
            _ => (404, json!({ "error": "no" })),
        });
        let store = Store::open_in_memory().unwrap();
        let msg = register_device(&store, &format!("{}/", backend.url), true, "a@b.c", "pw", None).unwrap();
        assert!(msg.contains("yonugy"));
        assert_eq!(store.get_setting("device_token").as_deref(), Some("devtok9"));
        assert_eq!(store.get_setting("backend_url").as_deref(), Some(backend.url.as_str()));

        let seen = backend.seen.lock().unwrap();
        assert_eq!(seen[0].body["email"], "a@b.c");
        assert_eq!(seen[1].auth.as_deref(), Some("Bearer jwt1"));
        assert_eq!(seen[1].body["platform"], platform_name());
    }

    #[test]
    fn signup_needs_a_username_and_failures_are_readable() {
        let backend = start(|path, _| match path {
            "/v1/auth/signup" => (409, json!({ "error": "email already registered" })),
            _ => (404, json!({})),
        });
        let store = Store::open_in_memory().unwrap();
        let err = register_device(&store, &backend.url, false, "a@b.c", "pw", None).unwrap_err();
        assert!(err.contains("username"));
        assert!(backend.seen.lock().unwrap().is_empty(), "no request without a username");

        let err = register_device(&store, &backend.url, false, "a@b.c", "pw", Some("yo")).unwrap_err();
        assert!(err.contains("409") && err.contains("already registered"));
        assert_eq!(store.get_setting("device_token"), None);

        let err = register_device(&store, "http://127.0.0.1:1", true, "a@b.c", "pw", None).unwrap_err();
        assert!(err.starts_with("Could not reach"));
    }
}
