pub mod models;
pub mod db;
pub mod handlers;
pub mod ai_detector;

use actix_web::{web, App, HttpServer};
use actix_cors::Cors;
use actix_files::Files;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();
    
    let db_url = std::env::var("DATABASE_URL").expect("Set DATABASE_URL in .env");
    let pool = sqlx::PgPool::connect(&db_url).await.expect("DB Connection Failed");
    let pool_data = web::Data::new(pool);

    println!("🚀 ReelForge Pro Backend | Smart Production Studio");
    println!("🌐 Running at http://0.0.0.0:8080");

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .app_data(pool_data.clone())
            // 1. STATIC FILES (Allows Firefox to see /public/art)
            .service(Files::new("/public", "./public").show_files_listing())
            // 2. EXISTING ROUTES
            .service(handlers::sync_stats)
            .service(handlers::get_reels)
            .service(handlers::create_reel)
            .service(handlers::like_reel)
            // 3. SMART STUDIO ROUTES
            .service(handlers::get_studio_dashboard)
            .service(handlers::get_categories)
            .service(handlers::detect_category)
            .service(handlers::delete_reel)
            .service(handlers::update_reel)
    })
    .bind("0.0.0.0:8080")?
    .run()
    .await
}
