use actix_web::{web, HttpResponse, Responder};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::Mutex;

const MAX_MOBILE_TRACE_ENTRIES: usize = 50;

#[derive(Default)]
pub struct MobileTraceBuffer {
    entries: Mutex<VecDeque<Value>>,
}

impl MobileTraceBuffer {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(VecDeque::with_capacity(MAX_MOBILE_TRACE_ENTRIES)),
        }
    }

    fn push(&self, value: Value) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.push_back(value);
            while entries.len() > MAX_MOBILE_TRACE_ENTRIES {
                let _ = entries.pop_front();
            }
        }
    }

    fn snapshot(&self) -> Vec<Value> {
        if let Ok(entries) = self.entries.lock() {
            return entries.iter().cloned().collect();
        }
        Vec::new()
    }
}

#[derive(Serialize)]
struct MobileTraceEnvelope {
    enabled: bool,
    count: usize,
    max: usize,
    traces: Vec<Value>,
}

pub fn is_local_debug_sink_enabled() -> bool {
    std::env::var("ENABLE_MOBILE_TRACE_SINK")
        .ok()
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(cfg!(debug_assertions))
}

pub async fn post_mobile_trace(
    buffer: web::Data<MobileTraceBuffer>,
    payload: web::Json<Value>,
) -> impl Responder {
    if !is_local_debug_sink_enabled() {
        return HttpResponse::Accepted().json(json!({
            "ok": true,
            "accepted": false,
            "reason": "mobile_trace_sink_disabled"
        }));
    }
    buffer.push(payload.into_inner());
    HttpResponse::Ok().json(json!({
        "ok": true,
        "accepted": true
    }))
}

pub async fn get_mobile_trace(buffer: web::Data<MobileTraceBuffer>) -> impl Responder {
    let traces = if is_local_debug_sink_enabled() {
        buffer.snapshot()
    } else {
        Vec::new()
    };
    HttpResponse::Ok().json(MobileTraceEnvelope {
        enabled: is_local_debug_sink_enabled(),
        count: traces.len(),
        max: MAX_MOBILE_TRACE_ENTRIES,
        traces,
    })
}
