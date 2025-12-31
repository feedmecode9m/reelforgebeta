use sqlx::PgPool;
use uuid::Uuid;
// The webauthn types need to be imported specifically
use webauthn_rs::prelude::PasskeyRegistration;

pub struct Credential {
    pub id: Uuid,
    pub user_id: Uuid,
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
}

pub async fn connect_db() -> PgPool {
    let db_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    PgPool::connect(&db_url).await.expect("Failed to connect to Postgres")
}

pub async fn save_registration_state(
    pool: &PgPool,
    id: Uuid,
    state: &PasskeyRegistration,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    // webauthn-rs uses internal serialization with the "danger" flag
    let data = serde_json::to_vec(state).unwrap();
    sqlx::query!(
        r#"INSERT INTO registration_states (id, user_id, data, expires_at) 
           VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')"#,
        id, user_id, data
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn take_registration_state(
    pool: &PgPool,
    id: Uuid,
) -> Result<(PasskeyRegistration, Uuid), sqlx::Error> {
    let row = sqlx::query!(
        r#"DELETE FROM registration_states 
           WHERE id = $1 AND expires_at > NOW() 
           RETURNING user_id, data"#,
        id
    )
    .fetch_one(pool)
    .await?;

    // Map the error to sqlx::Error or a custom error to avoid the anyhow issue
    let state: PasskeyRegistration = serde_json::from_slice(&row.data)
        .map_err(|_| sqlx::Error::RowNotFound)?; 

    Ok((state, row.user_id))
}

pub async fn save_credential(pool: &PgPool, cred: &Credential) -> Result<(), sqlx::Error> {
    sqlx::query!(
        "INSERT INTO credentials (id, user_id, credential_id, public_key) VALUES ($1, $2, $3, $4)",
        cred.id, cred.user_id, cred.credential_id, cred.public_key
    )
    .execute(pool)
    .await?;
    Ok(())
}
