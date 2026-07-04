//! Strips gzip/br Content-Encoding from binary media responses.
//! Video/image files must never be HTTP-compressed (already compressed on disk).

use actix_web::dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform};
use actix_web::http::header;
use actix_web::Error;
use futures_util::future::{ready, LocalBoxFuture, Ready};

const BINARY_PREFIXES: &[&str] = &["video/", "image/", "audio/"];

fn is_binary_content_type<B>(res: &ServiceResponse<B>) -> bool {
    res.headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| BINARY_PREFIXES.iter().any(|p| ct.starts_with(p)) || ct.contains("octet-stream"))
        .unwrap_or(false)
}

fn strip_content_encoding<B>(res: &mut ServiceResponse<B>) {
    // NamedFile sets Content-Encoding: identity on 206 Range responses; Firefox treats
    // that as a compression error for binary video. Remove any Content-Encoding header.
    if res.headers().contains_key(header::CONTENT_ENCODING) {
        res.headers_mut().remove(header::CONTENT_ENCODING);
    }
}

pub struct NoCompress;

impl<S, B> Transform<S, ServiceRequest> for NoCompress
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type InitError = ();
    type Transform = NoCompressMiddleware<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(NoCompressMiddleware { service }))
    }
}

pub struct NoCompressMiddleware<S> {
    service: S,
}

impl<S, B> Service<ServiceRequest> for NoCompressMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let path = req.path().to_string();
        let is_media_path = path.starts_with("/videos/") || path.starts_with("/thumbs/");
        let fut = self.service.call(req);
        Box::pin(async move {
            let mut res = fut.await?;
            if is_media_path || is_binary_content_type(&res) {
                strip_content_encoding(&mut res);
            }
            Ok(res)
        })
    }
}
