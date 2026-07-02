use actix_cors::Cors;
use actix_web::http::header;

pub fn build_cors() -> Cors {
    let allowed_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://helpful-concha-7dd8d6.netlify.app",
        "https://reelforge-frontend.netlify.app",
    ];

    let mut cors = Cors::default()
        .allowed_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS"])
        .allowed_headers(vec![
            header::AUTHORIZATION,
            header::ACCEPT,
            header::CONTENT_TYPE,
        ])
        .supports_credentials()
        .max_age(3600);

    for origin in allowed_origins {
        cors = cors.allowed_origin(origin);
    }

    cors
}
