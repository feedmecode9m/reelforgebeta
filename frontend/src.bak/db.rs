use sqlx::{PgPool, postgres::PgPoolOptions, Error};
use uuid::Uuid;
use webauthn_rs_core::interface::RegistrationState;

pub async fn connect_db() -> PgPool {
    PgPoolOptions::new()
        .max_connections(4)
        .connect_lazy("postgres://miles@localhost/reelforge")
        .expect("DB pool")
}

#[derive(Debug)]
pub struct Credential {
    pub id: Uuid,
    pub user_handle: Vec<u8>,
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
    pub counter: i64,
}

pub async fn save_credential(pool: &PgPool, cred: &Credential) -> Result<(), Error> {
    sqlx::query(
        r#"INSERT INTO credentials (id, user_handle, credential_id, public_key, counter)
           VALUES ($1, $2, $3, $4, $5)"#
    )
    .bind(cred.id)
    .bind(&cred.user_handle)
    .bind(&cred.credential_id)
    .bind(&cred.public_key)
    .bind(cred.counter)
    .execute(pool)
    .await?;
    Ok(())
}

// ✅ State storage
pub async fn save_registration_state(
    pool: &PgPool,
    state_id: Uuid,
    state: &RegistrationState,
    user_id: Uuid,
) -> Result<(), Error> {
    let state_bin = bincode::serialize(state).expect("state serialize");
    sqlx::query(
        r#"INSERT INTO registration_states (id, state, user_id, expires_at)
           VALUES ($1, $2, $3, NOW() + INTERVAL '5 minutes')"#
    )
    .bind(state_id)
    .bind(&state_bin)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn take_registration_state(
    pool: &PgPool,
    state_id: Uuid,
) -> Result<Option<(RegistrationState, Uuid)>, Error> {
    let row = sqlx::query!(
        r#"DELETE FROM registration_states 
           WHERE id = $1 AND expires_at > NOW() 
           RETURNING state, user_id"#
    )
    .bind(state_id)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(r) => {
            let state: RegistrationState = bincode::deserialize(&r.state)
                .expect("state deserialize");
            Ok(Some((state, Uuid::from_u128(r.user_id.into()))))
        }
        None => Ok(None),
    }
}
