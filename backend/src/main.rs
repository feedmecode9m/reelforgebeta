mod cors;
mod db;
mod handlers;
mod models;

use std::env;

use actix_web::{App, HttpResponse, HttpServer, web};
use dotenvy::dotenv;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv().ok();

    let database_url = env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let bind_host = env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let bind_port = env::var("PORT")
        .or_else(|_| env::var("RAILWAY_PORT"))
        .unwrap_or_else(|_| "8080".into())
        .parse::<u16>()
        .expect("PORT must be a valid u16");

    let pool = db::connect(&database_url)
        .await
        .expect("failed to connect to postgres");
    db::init(&pool).await.expect("failed to initialize database");
    db::ensure_seed_data(&pool)
        .await
        .expect("failed to seed placeholder reels");

    let pool_data = web::Data::new(pool);

    println!("ReelForge backend listening on {bind_host}:{bind_port}");

    HttpServer::new(move || {
        App::new()
            .wrap(cors::build_cors())
            .app_data(pool_data.clone())
            .route("/", web::get().to(|| async {
                HttpResponse::Ok().body("ReelForge backend is running with real-time sync")
            }))
            .route("/health", web::get().to(handlers::health))
            .route("/api/health", web::get().to(handlers::health))
            .route("/api/reels", web::get().to(handlers::list_reels))
            .route("/api/reels/seed", web::post().to(handlers::seed_reels))
            .route("/api/reels/{id}", web::get().to(handlers::get_reel_by_id))
    })
    .bind((bind_host.as_str(), bind_port))?
    .run()
    .await
}
