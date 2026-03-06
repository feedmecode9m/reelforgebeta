// src/main.rs

pub mod handlers;
pub mod models;
pub mod db;
pub mod ai_detector;
pub mod utils;
pub mod video_stream;
pub mod events;

use actix_cors::Cors;
use actix_files::Files;
use actix_web::{web, App, HttpServer, HttpResponse, middleware, HttpRequest};
use events::EventBus;
use tokio::sync::broadcast;
use crate::events::ReelEvent;
use futures_util::StreamExt;
use std::env;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();

    // --- PANIC HOOK for debugging ---
    std::panic::set_hook(Box::new(|panic_info| {
        eprintln!("🔥 PANIC: {:?}", panic_info);
        if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            eprintln!("Panic payload: {}", s);
        }
    }));

    let db_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = sqlx::PgPool::connect(&db_url).await.expect("DB Connection Failed");
    let pool_data = web::Data::new(pool);

    let event_bus = web::Data::new(EventBus::new(100));
    println!("📡 Real-time event system initialized");

    // --- PATH SETUP (relative to project root, works on Render) ---
    let public_path = std::path::PathBuf::from("./public");
    let thumbs_path = public_path.join("thumbs");
    let videos_path = public_path.join("videos");

    println!("📂 Serving videos from: {:?}", videos_path);
    println!("📂 Serving thumbs from: {:?}", thumbs_path);

    let _ = std::fs::create_dir_all(&thumbs_path);
    let _ = std::fs::create_dir_all(&videos_path);

    // Wrap paths in web::Data so they can be passed to the custom handlers
    let videos_path_data = web::Data::new(videos_path.clone());
    let thumbs_path_data = web::Data::new(thumbs_path.clone());

    // Get the port from the environment (Render sets PORT)
    let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let bind_address = format!("0.0.0.0:{}", port);
    println!("🚀 Binding to {}", bind_address);

    HttpServer::new(move || {
        // CORS – allow any origin for now; replace with your frontend domain in production
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .expose_headers(vec!["Content-Range", "Accept-Ranges", "Content-Length"])
            .max_age(3600);

        App::new()
            .wrap(cors)
            .wrap(middleware::DefaultHeaders::new().add(("Accept-Ranges", "bytes")))
            .app_data(web::PayloadConfig::new(104_857_600)) // 100MB
            .app_data(web::JsonConfig::default().limit(10_485_760)) // 10MB
            .app_data(pool_data.clone())
            .app_data(event_bus.clone())
            .app_data(videos_path_data.clone())
            .app_data(thumbs_path_data.clone())
            
            .route("/ws/control-center", web::get().to(control_center_ws))
            
            .service(
                web::scope("/api")
                    .route("/register-local", web::post().to(handlers::register_local_video))
                    .route("/studio/local-videos", web::get().to(handlers::list_local_videos))
                    .route("/studio/import", web::post().to(handlers::import_local_to_vault))
                    .route("/studio/upload", web::post().to(handlers::upload_video))
                    .route("/upload", web::post().to(handlers::upload_video))
                    .route("/thumbnails", web::get().to(handlers::list_thumbnails))
                    .route("/sync", web::get().to(handlers::sync_stats))
                    .route("/reels", web::get().to(handlers::get_reels))
                    .route("/reels/{id}", web::delete().to(handlers::delete_reel))
                    .route("/reels/{id}/category", web::patch().to(handlers::update_reel_category))
                    .route("/stats/categories", web::get().to(handlers::get_category_stats))
            )

            // Custom handlers for video/thumb serving
            .route("/videos/{filename:.*}", web::get().to(handlers::serve_video))
            .route("/thumbs/{filename:.*}", web::get().to(handlers::serve_thumb))

            .route("/", web::get().to(|| async { 
                HttpResponse::Ok().body("ReelForge backend is running with real-time sync") 
            }))
    })
    .bind(bind_address)?
    .run()
    .await
}

async fn control_center_ws(
    req: HttpRequest,
    body: web::Payload,
    event_bus: web::Data<EventBus>,
) -> Result<HttpResponse, actix_web::Error> {
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, body)?;
    let mut event_rx: broadcast::Receiver<ReelEvent> = event_bus.subscribe();
    
    actix_web::rt::spawn(async move {
        loop {
            tokio::select! {
                Ok(event) = event_rx.recv() => {
                    let msg = match event {
                        ReelEvent::Deleted { id, title, category, deleted_at } => {
                            serde_json::json!({ "type": "DELETED", "id": id, "title": title, "category": category, "deleted_at": deleted_at }).to_string()
                        }
                        ReelEvent::Created { id, title, category, created_at } => {
                            serde_json::json!({ "type": "CREATED", "id": id, "title": title, "category": category, "created_at": created_at }).to_string()
                        }
                    };
                    if session.text(msg).await.is_err() { break; }
                }
                msg = msg_stream.next() => {
                    match msg {
                        Some(Ok(actix_ws::Message::Ping(bytes))) => { 
                            if session.pong(&bytes).await.is_err() { break; } 
                        }
                        Some(Ok(actix_ws::Message::Close(_))) => break,
                        None => break,
                        _ => {}
                    }
                }
            }
        }
    });
    Ok(response)
}
