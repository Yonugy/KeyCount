//! The local API behind the dashboard's Keys tab. Same routes, same access
//! code header and same CORS rules as agent.py's LocalKeysHandler.
//!
//! Bound to 127.0.0.1 only, never the network. On top of that, every request
//! needs this device's random access code, so an unrelated web page in your
//! browser can't quietly read your key stats.

use crate::store::Store;
use crate::sync::device_name;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tiny_http::{Header, Method, Response, Server};

pub const LOCAL_API_PORT: u16 = 8787;
const PRODUCTION_DASHBOARD_ORIGIN: &str = "https://key-count.vercel.app";

/// Only a browser page on this machine, or the hosted dashboard, may read
/// the response. Never `*`.
pub fn is_allowed_origin(origin: &str) -> bool {
    if origin == PRODUCTION_DASHBOARD_ORIGIN {
        return true;
    }
    let rest = match origin.strip_prefix("http://").or_else(|| origin.strip_prefix("https://")) {
        Some(r) => r,
        None => return false,
    };
    let (host, port) = match rest.split_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (rest, None),
    };
    if host != "localhost" && host != "127.0.0.1" {
        return false;
    }
    match port {
        None => true,
        Some(p) => !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()),
    }
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

/// Pull `name` out of a query string, percent-decoded.
fn query_param(query: &str, name: &str) -> Option<String> {
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        if k == name {
            return Some(percent_decode(v));
        }
    }
    None
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
                match hex {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap()
}

/// Decide the response for one request. Pure (no sockets) so it is tested
/// directly. Returns (status, json body or None, whether to add CORS grants).
pub fn route(store: &Store, token: &str, method: &str, url: &str, supplied_token: Option<&str>) -> (u16, Option<Value>) {
    if method == "OPTIONS" {
        return (204, None);
    }
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    if method != "GET" || (path != "/local/keys" && path != "/local/apps") {
        return (404, None);
    }
    if supplied_token != Some(token) {
        return (401, Some(json!({ "error": "invalid or missing local token" })));
    }

    let date = query_param(query, "date").map(|d| d.trim().to_string()).filter(|d| !d.is_empty() && is_date(d));

    if path == "/local/apps" {
        let apps = store.app_totals(date.as_deref()).unwrap_or_default();
        return (
            200,
            Some(json!({
                "device_name": device_name(),
                "apps": apps.into_iter().map(|(a, c)| json!({ "app_name": a, "keystrokes": c })).collect::<Vec<_>>(),
            })),
        );
    }

    let top_n = query_param(query, "top").and_then(|t| t.trim().parse::<i64>().ok()).unwrap_or(25).clamp(1, 100);
    let app = query_param(query, "app").map(|a| a.trim().to_string()).filter(|a| !a.is_empty());
    let keys = store.top_keys(top_n, app.as_deref(), date.as_deref()).unwrap_or_default();
    let apps = store.known_apps().unwrap_or_default();
    (
        200,
        Some(json!({
            "device_name": device_name(),
            "apps": apps,
            "keys": keys.into_iter().map(|(k, c)| json!({ "key": k, "count": c })).collect::<Vec<_>>(),
        })),
    )
}

pub struct KeysServer {
    stop: Arc<AtomicBool>,
}

impl KeysServer {
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Starts the server on a background thread. `Err` carries a readable
/// reason, usually that another KeyCount (or the Python agent) already holds
/// the port.
pub fn start(store: Arc<Store>, port: u16) -> Result<KeysServer, String> {
    let server = Server::http(("127.0.0.1", port)).map_err(|e| format!("port {port} is busy ({e})"))?;
    let token = store.local_token();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    std::thread::spawn(move || {
        while !stop_flag.load(Ordering::SeqCst) {
            let req = match server.recv_timeout(Duration::from_millis(500)) {
                Ok(Some(r)) => r,
                Ok(None) => continue,
                Err(_) => break,
            };
            let origin = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("Origin"))
                .map(|h| h.value.to_string())
                .unwrap_or_default();
            let supplied = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("X-Local-Token"))
                .map(|h| h.value.to_string());
            let method = req.method().clone();
            let method_str = if method == Method::Options { "OPTIONS" } else if method == Method::Get { "GET" } else { "OTHER" };
            let (status, body) = route(&store, &token, method_str, req.url(), supplied.as_deref());

            let mut resp = Response::from_string(body.map(|b| b.to_string()).unwrap_or_default()).with_status_code(status);
            if is_allowed_origin(&origin) {
                resp.add_header(header("Access-Control-Allow-Origin", &origin));
                resp.add_header(header("Vary", "Origin"));
            }
            resp.add_header(header("Access-Control-Allow-Headers", "X-Local-Token, Content-Type"));
            resp.add_header(header("Access-Control-Allow-Methods", "GET, OPTIONS"));
            if method_str == "OPTIONS" && is_allowed_origin(&origin) {
                // Chrome's private-network preflight, harmless elsewhere.
                resp.add_header(header("Access-Control-Allow-Private-Network", "true"));
            }
            resp.add_header(header("Content-Type", "application/json"));
            let _ = req.respond(resp);
        }
    });
    Ok(KeysServer { stop })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded() -> Arc<Store> {
        let s = Arc::new(Store::open_in_memory().unwrap());
        s.bump_keys(&[
            (("a".into(), "code".into(), "2026-10-01".into()), 5),
            (("b".into(), "code".into(), "2026-10-01".into()), 2),
            (("a".into(), "chrome".into(), "2026-10-02".into()), 4),
        ])
        .unwrap();
        s
    }

    #[test]
    fn origin_rules_match_the_python_agent() {
        for ok in [
            "http://localhost",
            "http://localhost:5173",
            "https://localhost:3000",
            "http://127.0.0.1:8787",
            "https://key-count.vercel.app",
        ] {
            assert!(is_allowed_origin(ok), "{ok} should be allowed");
        }
        for bad in [
            "",
            "null",
            "http://key-count.vercel.app",
            "https://key-count.vercel.app.evil.com",
            "https://evil-key-count.vercel.app",
            "http://localhost.evil.com",
            "http://localhost:abc",
            "http://localhost:",
            "ftp://localhost",
            "https://key-count.vercel.app/",
        ] {
            assert!(!is_allowed_origin(bad), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn routes_check_token_and_shape_responses() {
        let s = seeded();
        assert_eq!(route(&s, "tok", "OPTIONS", "/local/keys", None).0, 204);
        assert_eq!(route(&s, "tok", "GET", "/other", Some("tok")).0, 404);
        assert_eq!(route(&s, "tok", "GET", "/local/keys", None).0, 401);
        assert_eq!(route(&s, "tok", "GET", "/local/keys", Some("wrong")).0, 401);

        let (status, body) = route(&s, "tok", "GET", "/local/keys?top=100", Some("tok"));
        let body = body.unwrap();
        assert_eq!(status, 200);
        assert_eq!(body["keys"][0], json!({ "key": "a", "count": 9 }));
        assert_eq!(body["keys"][1], json!({ "key": "b", "count": 2 }));
        assert_eq!(body["apps"], json!(["code", "chrome"]));
        assert!(body["device_name"].is_string());
    }

    #[test]
    fn filters_clamp_and_ignore_garbage_like_the_python_agent() {
        let s = seeded();
        let get = |q: &str| route(&s, "t", "GET", &format!("/local/keys?{q}"), Some("t")).1.unwrap();
        assert_eq!(get("app=chrome")["keys"], json!([{ "key": "a", "count": 4 }]));
        assert_eq!(get("date=2026-10-01")["keys"].as_array().unwrap().len(), 2);
        // "apps" is always the full list, whatever the filter
        assert_eq!(get("app=chrome")["apps"], json!(["code", "chrome"]));
        // garbage date -> treated as no filter; garbage top -> default; top clamps
        assert_eq!(get("date=notadate")["keys"].as_array().unwrap().len(), 2);
        assert_eq!(get("top=abc")["keys"].as_array().unwrap().len(), 2);
        assert_eq!(get("top=0")["keys"].as_array().unwrap().len(), 1);
        assert_eq!(get("app=code&date=2026-10-02")["keys"], json!([]));
        assert_eq!(get("app=my%20app")["keys"], json!([]));

        let apps = route(&s, "t", "GET", "/local/apps?date=2026-10-01", Some("t")).1.unwrap();
        assert_eq!(apps["apps"], json!([{ "app_name": "code", "keystrokes": 7 }]));
        let all = route(&s, "t", "GET", "/local/apps", Some("t")).1.unwrap();
        assert_eq!(all["apps"][0], json!({ "app_name": "code", "keystrokes": 7 }));
    }

    #[test]
    fn percent_decoding_handles_edges() {
        assert_eq!(percent_decode("my%20app"), "my app");
        assert_eq!(percent_decode("a+b"), "a b");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
        assert_eq!(percent_decode("%41"), "A");
        assert_eq!(percent_decode("x%4"), "x%4");
    }

    fn http_get(port: u16, path: &str, origin: Option<&str>, token: Option<&str>, method: &str) -> (u16, Vec<(String, String)>, String) {
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
        let url = format!("http://127.0.0.1:{port}{path}");
        let mut req = if method == "OPTIONS" {
            let r = ureq::http::Request::builder().method("OPTIONS").uri(&url);
            let r = if let Some(o) = origin { r.header("Origin", o) } else { r };
            let mut resp = agent.run(r.body(()).unwrap()).unwrap();
            let status = resp.status().as_u16();
            let hdrs = resp.headers().iter().map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string())).collect();
            return (status, hdrs, resp.body_mut().read_to_string().unwrap_or_default());
        } else {
            agent.get(&url)
        };
        if let Some(o) = origin {
            req = req.header("Origin", o);
        }
        if let Some(t) = token {
            req = req.header("X-Local-Token", t);
        }
        let mut resp = req.call().unwrap();
        let status = resp.status().as_u16();
        let hdrs = resp.headers().iter().map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string())).collect();
        (status, hdrs, resp.body_mut().read_to_string().unwrap_or_default())
    }

    fn header_of<'a>(h: &'a [(String, String)], name: &str) -> Option<&'a str> {
        h.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    #[test]
    fn real_socket_end_to_end_including_cors_and_port_conflict() {
        let store = seeded();
        // port 0 isn't usable with start()'s fixed bind, so pick a free one
        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let server = start(store.clone(), port).expect("should bind");
        let token = store.local_token();

        let (status, hdrs, body) = http_get(port, "/local/keys?top=5", Some("https://key-count.vercel.app"), Some(&token), "GET");
        assert_eq!(status, 200);
        assert_eq!(header_of(&hdrs, "access-control-allow-origin"), Some("https://key-count.vercel.app"));
        assert!(body.contains("\"key\":\"a\""));

        let (status, hdrs, _) = http_get(port, "/local/keys", Some("https://evil.example"), Some(&token), "GET");
        assert_eq!(status, 200);
        assert_eq!(header_of(&hdrs, "access-control-allow-origin"), None, "no CORS grant for strangers");

        let (status, _, body) = http_get(port, "/local/keys", Some("http://localhost:5173"), None, "GET");
        assert_eq!(status, 401);
        assert!(body.contains("invalid or missing local token"));

        let (status, hdrs, _) = http_get(port, "/local/keys", Some("https://key-count.vercel.app"), None, "OPTIONS");
        assert_eq!(status, 204);
        assert_eq!(header_of(&hdrs, "access-control-allow-origin"), Some("https://key-count.vercel.app"));
        assert!(header_of(&hdrs, "access-control-allow-headers").unwrap().contains("X-Local-Token"));

        // a second server on the same port reports a readable error
        let err = start(store.clone(), port).err().expect("port should be busy");
        assert!(err.contains("busy"));
        server.stop();
    }
}
