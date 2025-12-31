use axum::{
    extract::{Json, State, Path}, // ✅ Added Path
    http::StatusCode,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc};
use uuid::Uuid;
use webauthn_rs::prelude::{
    Webauthn, WebauthnBuilder, CreationChallengeResponse,
    RegisterPublicKeyCredential, // ✅ Removed unused PasskeyRegistration
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use url::Url;
use bincode;

mod db;

#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
    pub webauthn: Arc<Webauthn>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let pool = db::connect_db().await;

    let rp_id = "localhost";
    let rp_origin = Url::parse("http://localhost:3000")?;
    let builder = WebauthnBuilder::new(rp_id, &rp_origin)?;
    let webauthn = Arc::new(builder.build()?);

    let app = Router::new()
        .route("/health", get(|| async { "✅ ReelForge Core v0.9" }))
        .route("/api/auth/challenge", post(challenge))
        .route("/api/auth/register", post(register))
        // ✅ FIXED: Added Path parameter handling
        .route("/api/dramas/:id/fork", post(|Path(_id): Path<String>| async move { 
            Json(serde_json::json!({ 
                "id": "fork_123", 
                "title": "Fan Cut",
                "forked_from": _id
            }))
        }))
        .route("/api/dramas/:id/scenes", post(|Path(_id): Path<String>| async move { 
            Json(serde_json::json!({ "status": "ok" }))
        }))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(AppState { pool, webauthn });

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("🚀 ReelForge ready on http://{}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}

#[derive(Serialize)]
struct ChallengeRes {
    state_id: String,
    public_key: CreationChallengeResponse,
    user_id: String,
}

async fn challenge(
    State(state): State<AppState>,
) -> Result<Json<ChallengeRes>, StatusCode> {
    let user_id = Uuid::new_v4();

    let (ccr, reg_state) = state.webauthn
        .start_passkey_registration(user_id, "creator", "ReelForge Creator", None)
        .map_err(|e| {
            eprintln!("🔐 Challenge Error: {:?}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let state_id = Uuid::new_v4();
    db::save_registration_state(&state.pool, state_id, &reg_state, user_id)
        .await
        .map_err(|e| {
            eprintln!("💾 Save State Error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(ChallengeRes {
        state_id: state_id.to_string(),
        public_key: ccr,
        user_id: user_id.to_string(),
    }))
}

#[derive(Deserialize)]
struct RegisterReq {
    state_id: String,
    response: RegisterPublicKeyCredential,
}

async fn register(
    State(state): State<AppState>,
    Json(payload): Json<RegisterReq>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let state_id = Uuid::parse_str(&payload.state_id)
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    // ✅ FIXED: Direct tuple return (no Option handling)
    let (reg_state, user_id) = db::take_registration_state(&state.pool, state_id)
        .await
        .map_err(|e| {
            eprintln!("🔍 State Lookup Error (Expired or Missing): {}", e);
            StatusCode::GONE // 410 Gone is perfect for expired registration states
        })?;

    let reg = state.webauthn
        .finish_passkey_registration(&payload.response, &reg_state)
        .map_err(|e| {
            eprintln!("🔐 Register Error: {:?}", e);
            StatusCode::BAD_REQUEST
        })?;

    let public_key_bin = bincode::serialize(&reg)
        .map_err(|e| {
            eprintln!("📦 Bincode Error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let cred = db::Credential {
        id: Uuid::new_v4(),
        user_id,
        credential_id: reg.cred_id().to_vec(),
        public_key: public_key_bin,
    };

    db::save_credential(&state.pool, &cred)
        .await
        .map_err(|e| {
            eprintln!("💾 Save Cred Error: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(serde_json::json!({
        "status": "ok",
        "credential_id": URL_SAFE_NO_PAD.encode(&cred.credential_id)
    })))
}
