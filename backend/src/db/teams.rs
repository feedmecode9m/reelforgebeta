use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

pub const TEAM_ROLES: &[&str] = &["OWNER", "PRODUCER", "EDITOR", "WRITER", "REVIEWER"];

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UserRow {
    pub id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TeamRow {
    pub id: String,
    pub name: String,
    pub series_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberRow {
    pub id: String,
    pub team_id: String,
    pub user_id: String,
    pub role: String,
    pub joined_at: DateTime<Utc>,
    pub display_name: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TeamActivityRow {
    pub id: String,
    pub team_id: String,
    pub user_id: Option<String>,
    pub activity_type: String,
    pub payload: serde_json::Value,
    pub created_at: DateTime<Utc>,
    #[sqlx(default)]
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserInput {
    pub id: Option<String>,
    pub display_name: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamInput {
    pub id: Option<String>,
    pub name: String,
    pub series_id: Option<String>,
    pub owner_user_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTeamMemberInput {
    pub user_id: String,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTeamMemberInput {
    pub role: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignTeamTaskInput {
    pub task_id: String,
    pub user_id: String,
    pub assigned_by: Option<String>,
}

pub async fn count_users(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await
}

pub async fn count_teams(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM teams")
        .fetch_one(pool)
        .await
}

pub async fn list_users(pool: &PgPool) -> Result<Vec<UserRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, display_name, email, avatar_url, created_at
        FROM users
        ORDER BY display_name ASC
        "#,
    )
    .fetch_all(pool)
    .await
}

pub async fn create_user(pool: &PgPool, input: &CreateUserInput) -> Result<UserRow, sqlx::Error> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("user-{}", uuid::Uuid::new_v4()));
    sqlx::query_as(
        r#"
        INSERT INTO users (id, display_name, email, avatar_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            email = EXCLUDED.email,
            avatar_url = EXCLUDED.avatar_url
        RETURNING id, display_name, email, avatar_url, created_at
        "#,
    )
    .bind(&id)
    .bind(&input.display_name)
    .bind(&input.email)
    .bind(&input.avatar_url)
    .fetch_one(pool)
    .await
}

pub async fn list_teams(pool: &PgPool, series_id: Option<&str>) -> Result<Vec<TeamRow>, sqlx::Error> {
    if let Some(series_id) = series_id {
        sqlx::query_as(
            r#"
            SELECT id, name, series_id, created_at
            FROM teams
            WHERE series_id = $1
            ORDER BY created_at DESC
            "#,
        )
        .bind(series_id)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as(
            r#"
            SELECT id, name, series_id, created_at
            FROM teams
            ORDER BY created_at DESC
            "#,
        )
        .fetch_all(pool)
        .await
    }
}

pub async fn get_team(pool: &PgPool, team_id: &str) -> Result<Option<TeamRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, name, series_id, created_at
        FROM teams
        WHERE id = $1
        "#,
    )
    .bind(team_id)
    .fetch_optional(pool)
    .await
}

pub async fn create_team(pool: &PgPool, input: &CreateTeamInput) -> Result<TeamRow, sqlx::Error> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("team-{}", uuid::Uuid::new_v4()));

    let team = sqlx::query_as::<_, TeamRow>(
        r#"
        INSERT INTO teams (id, name, series_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            series_id = EXCLUDED.series_id
        RETURNING id, name, series_id, created_at
        "#,
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.series_id)
    .fetch_one(pool)
    .await?;

    let owner_id = input
        .owner_user_id
        .clone()
        .unwrap_or_else(|| "user-owner-1".to_string());

    let _ = add_team_member(
        pool,
        &team.id,
        &AddTeamMemberInput {
            user_id: owner_id.clone(),
            role: Some("OWNER".to_string()),
        },
    )
    .await?;

    let _ = record_activity(
        pool,
        &team.id,
        Some(&owner_id),
        "team_created",
        serde_json::json!({
            "teamName": team.name,
            "seriesId": team.series_id
        }),
    )
    .await?;

    Ok(team)
}

pub async fn list_team_members(pool: &PgPool, team_id: &str) -> Result<Vec<TeamMemberRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT
            tm.id,
            tm.team_id,
            tm.user_id,
            tm.role,
            tm.joined_at,
            u.display_name,
            u.email
        FROM team_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = $1
        ORDER BY
            CASE tm.role
                WHEN 'OWNER' THEN 1
                WHEN 'PRODUCER' THEN 2
                WHEN 'EDITOR' THEN 3
                WHEN 'WRITER' THEN 4
                WHEN 'REVIEWER' THEN 5
                ELSE 6
            END,
            u.display_name ASC
        "#,
    )
    .bind(team_id)
    .fetch_all(pool)
    .await
}

async fn get_team_member(
    pool: &PgPool,
    team_id: &str,
    user_id: &str,
) -> Result<Option<TeamMemberRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT
            tm.id,
            tm.team_id,
            tm.user_id,
            tm.role,
            tm.joined_at,
            u.display_name,
            u.email
        FROM team_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = $1 AND tm.user_id = $2
        "#,
    )
    .bind(team_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn add_team_member(
    pool: &PgPool,
    team_id: &str,
    input: &AddTeamMemberInput,
) -> Result<TeamMemberRow, sqlx::Error> {
    let role = input
        .role
        .clone()
        .unwrap_or_else(|| "EDITOR".to_string())
        .to_uppercase();
    if !TEAM_ROLES.contains(&role.as_str()) {
        return Err(sqlx::Error::Protocol(format!("Invalid team role: {role}")));
    }

    let member_id = format!("tm-{}", uuid::Uuid::new_v4());
    sqlx::query(
        r#"
        INSERT INTO team_members (id, team_id, user_id, role)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role
        "#,
    )
    .bind(&member_id)
    .bind(team_id)
    .bind(&input.user_id)
    .bind(&role)
    .execute(pool)
    .await?;

    let member = get_team_member(pool, team_id, &input.user_id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;

    let _ = record_activity(
        pool,
        team_id,
        Some(&input.user_id),
        "member_added",
        serde_json::json!({
            "userId": input.user_id,
            "role": role,
            "displayName": member.display_name
        }),
    )
    .await?;

    Ok(member)
}

pub async fn update_team_member_role(
    pool: &PgPool,
    team_id: &str,
    user_id: &str,
    input: &UpdateTeamMemberInput,
) -> Result<Option<TeamMemberRow>, sqlx::Error> {
    let role = input.role.to_uppercase();
    if !TEAM_ROLES.contains(&role.as_str()) {
        return Err(sqlx::Error::Protocol(format!("Invalid team role: {role}")));
    }

    let updated = sqlx::query(
        r#"
        UPDATE team_members
        SET role = $3
        WHERE team_id = $1 AND user_id = $2
        "#,
    )
    .bind(team_id)
    .bind(user_id)
    .bind(&role)
    .execute(pool)
    .await?;

    let member = if updated.rows_affected() > 0 {
        get_team_member(pool, team_id, user_id).await?
    } else {
        None
    };

    if let Some(ref row) = member {
        let _ = record_activity(
            pool,
            team_id,
            Some(user_id),
            "role_changed",
            serde_json::json!({
                "userId": user_id,
                "role": role,
                "displayName": row.display_name
            }),
        )
        .await?;
    }

    Ok(member)
}

pub async fn remove_team_member(
    pool: &PgPool,
    team_id: &str,
    user_id: &str,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM team_members WHERE team_id = $1 AND user_id = $2")
        .bind(team_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn list_team_activity(
    pool: &PgPool,
    team_id: &str,
    limit: i64,
) -> Result<Vec<TeamActivityRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT
            ta.id,
            ta.team_id,
            ta.user_id,
            ta.activity_type,
            ta.payload,
            ta.created_at,
            u.display_name
        FROM team_activity ta
        LEFT JOIN users u ON u.id = ta.user_id
        WHERE ta.team_id = $1
        ORDER BY ta.created_at DESC
        LIMIT $2
        "#,
    )
    .bind(team_id)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn record_activity(
    pool: &PgPool,
    team_id: &str,
    user_id: Option<&str>,
    activity_type: &str,
    payload: serde_json::Value,
) -> Result<TeamActivityRow, sqlx::Error> {
    let id = format!("act-{}", uuid::Uuid::new_v4());
    sqlx::query_as(
        r#"
        INSERT INTO team_activity (id, team_id, user_id, activity_type, payload)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, team_id, user_id, activity_type, payload, created_at,
            (SELECT display_name FROM users WHERE id = $3) AS display_name
        "#,
    )
    .bind(&id)
    .bind(team_id)
    .bind(user_id)
    .bind(activity_type)
    .bind(&payload)
    .fetch_one(pool)
    .await
}

pub async fn assign_task_to_member(
    pool: &PgPool,
    team_id: &str,
    input: &AssignTeamTaskInput,
) -> Result<serde_json::Value, sqlx::Error> {
    let member = sqlx::query_as::<_, TeamMemberRow>(
        r#"
        SELECT
            tm.id,
            tm.team_id,
            tm.user_id,
            tm.role,
            tm.joined_at,
            u.display_name,
            u.email
        FROM team_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = $1 AND tm.user_id = $2
        "#,
    )
    .bind(team_id)
    .bind(&input.user_id)
    .fetch_optional(pool)
    .await?;

    let member = member.ok_or_else(|| sqlx::Error::RowNotFound)?;

    let task = crate::db::workflow::update_workflow_task(
        pool,
        &input.task_id,
        &crate::db::workflow::UpdateWorkflowTaskInput {
            series_id: None,
            episode_id: None,
            task_type: None,
            priority: None,
            status: Some("IN_PROGRESS".to_string()),
            assigned_to: Some(member.display_name.clone()),
            title: None,
            reel_id: None,
            estimated_impact: None,
            estimated_minutes: None,
            metadata: Some(serde_json::json!({
                "assignedUserId": member.user_id,
                "assignedUserRole": member.role,
                "assignedBy": input.assigned_by
            })),
            completed_at: None,
        },
    )
    .await?;

    let task = task.ok_or_else(|| sqlx::Error::RowNotFound)?;

    let _ = record_activity(
        pool,
        team_id,
        input.assigned_by.as_deref().or(Some(member.user_id.as_str())),
        "task_assigned",
        serde_json::json!({
            "taskId": input.task_id,
            "userId": member.user_id,
            "displayName": member.display_name,
            "role": member.role,
            "taskType": task.task_type,
            "seriesId": task.series_id
        }),
    )
    .await?;

    Ok(serde_json::json!({
        "task": task,
        "member": member
    }))
}

pub async fn list_assigned_tasks_for_user(
    pool: &PgPool,
    display_name: &str,
    series_id: Option<&str>,
) -> Result<Vec<crate::db::workflow::WorkflowTaskDto>, sqlx::Error> {
    let tasks = crate::db::workflow::list_workflow_tasks(pool, series_id).await?;
    Ok(tasks
        .into_iter()
        .filter(|task| task.assigned_to.as_deref() == Some(display_name))
        .collect())
}
