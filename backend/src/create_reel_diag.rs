use actix_web::{http::header, HttpRequest, HttpResponse};

#[derive(Debug, Clone, Default)]
pub struct CreateReelRequestMeta {
    pub has_authorization: bool,
    pub admin_authenticated: bool,
}

impl CreateReelRequestMeta {
    pub fn from_request(req: &HttpRequest) -> Self {
        let has_authorization = req
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        Self {
            has_authorization,
            // AdminAuth middleware runs before handlers::create_reel.
            admin_authenticated: has_authorization,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct CreateReel400Log {
    pub filename: Option<String>,
    pub content_type: Option<String>,
    pub multipart_fields: Vec<String>,
    pub category: Option<String>,
    pub file_size: Option<u64>,
    pub request_meta: CreateReelRequestMeta,
    pub validation_boundary: &'static str,
    pub cause: String,
}

pub fn log_create_reel_400(ctx: &CreateReel400Log) {
    eprintln!(
        "[BG7X_CREATE_REEL_400] {}",
        serde_json::json!({
            "filename": ctx.filename,
            "contentType": ctx.content_type,
            "multipartFields": ctx.multipart_fields,
            "category": ctx.category,
            "fileSize": ctx.file_size,
            "hasAuthorization": ctx.request_meta.has_authorization,
            "adminAuthenticated": ctx.request_meta.admin_authenticated,
            "validationBoundary": ctx.validation_boundary,
            "cause": ctx.cause,
        })
    );
}

pub fn bad_request_create_reel(ctx: CreateReel400Log, error: impl Into<String>) -> HttpResponse {
    let error = error.into();
    log_create_reel_400(&ctx);
    HttpResponse::BadRequest().json(serde_json::json!({ "error": error }))
}
