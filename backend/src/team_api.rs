use actix_web::{web, HttpResponse};
use sqlx::PgPool;

use crate::db;
use crate::db::teams::{
    AddTeamMemberInput, AssignTeamTaskInput, CreateTeamInput, CreateUserInput, UpdateTeamMemberInput,
};

#[derive(Debug, serde::Deserialize)]
pub struct ListTeamsQuery {
    #[serde(rename = "seriesId")]
    pub series_id: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct AssignedTasksQuery {
    #[serde(rename = "seriesId")]
    pub series_id: Option<String>,
    #[serde(rename = "userId")]
    pub user_id: String,
}

fn team_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Team API disabled",
        "hint": "Set REELFORGE_TEAM_API=true to enable"
    }))
}

fn check_team_enabled() -> Result<(), HttpResponse> {
    if db::team_api_enabled() {
        Ok(())
    } else {
        Err(team_disabled())
    }
}

pub async fn team_status(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    match db::teams::count_teams(pool.get_ref()).await {
        Ok(team_count) => {
            let user_count = db::teams::count_users(pool.get_ref()).await.unwrap_or(0);
            HttpResponse::Ok().json(serde_json::json!({
                "enabled": true,
                "teamCount": team_count,
                "userCount": user_count,
                "roles": db::teams::TEAM_ROLES
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_users(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    match db::teams::list_users(pool.get_ref()).await {
        Ok(users) => HttpResponse::Ok().json(users),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn create_user(pool: web::Data<PgPool>, body: web::Json<CreateUserInput>) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    if body.display_name.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "displayName is required"
        }));
    }
    match db::teams::create_user(pool.get_ref(), &body).await {
        Ok(user) => HttpResponse::Created().json(user),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_teams(pool: web::Data<PgPool>, query: web::Query<ListTeamsQuery>) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    match db::teams::list_teams(pool.get_ref(), query.series_id.as_deref()).await {
        Ok(teams) => HttpResponse::Ok().json(teams),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn create_team(pool: web::Data<PgPool>, body: web::Json<CreateTeamInput>) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    if body.name.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "name is required"
        }));
    }
    match db::teams::create_team(pool.get_ref(), &body).await {
        Ok(team) => HttpResponse::Created().json(team),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_team(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    let team_id = path.into_inner();
    match db::teams::get_team(pool.get_ref(), &team_id).await {
        Ok(Some(team)) => HttpResponse::Ok().json(team),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Team not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_team_members(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    let team_id = path.into_inner();
    match db::teams::list_team_members(pool.get_ref(), &team_id).await {
        Ok(members) => HttpResponse::Ok().json(members),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn add_team_member(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<AddTeamMemberInput>,
) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    let team_id = path.into_inner();
    if body.user_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "userId is required"
        }));
    }
    match db::teams::add_team_member(pool.get_ref(), &team_id, &body).await {
        Ok(member) => HttpResponse::Created().json(member),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn update_team_member(
    pool: web::Data<PgPool>,
    path: web::Path<(String, String)>,
    body: web::Json<UpdateTeamMemberInput>,
) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    let (team_id, user_id) = path.into_inner();
    match db::teams::update_team_member_role(pool.get_ref(), &team_id, &user_id, &body).await {
        Ok(Some(member)) => HttpResponse::Ok().json(member),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Team member not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn remove_team_member(pool: web::Data<PgPool>, path: web::Path<(String, String)>) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    let (team_id, user_id) = path.into_inner();
    match db::teams::remove_team_member(pool.get_ref(), &team_id, &user_id).await {
        Ok(true) => HttpResponse::Ok().json(serde_json::json!({ "removed": true })),
        Ok(false) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Team member not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_team_activity(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    let team_id = path.into_inner();
    match db::teams::list_team_activity(pool.get_ref(), &team_id, 50).await {
        Ok(activity) => HttpResponse::Ok().json(activity),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn assign_team_task(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    body: web::Json<AssignTeamTaskInput>,
) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    let team_id = path.into_inner();
    if body.task_id.trim().is_empty() || body.user_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "taskId and userId are required"
        }));
    }
    match db::teams::assign_task_to_member(pool.get_ref(), &team_id, &body).await {
        Ok(result) => HttpResponse::Ok().json(result),
        Err(sqlx::Error::RowNotFound) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Task or team member not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_assigned_tasks(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    query: web::Query<AssignedTasksQuery>,
) -> HttpResponse {
    if let Err(resp) = check_team_enabled() {
        return resp;
    }
    let team_id = path.into_inner();
    let members = match db::teams::list_team_members(pool.get_ref(), &team_id).await {
        Ok(rows) => rows,
        Err(e) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": e.to_string()
            }));
        }
    };
    let member = members.into_iter().find(|m| m.user_id == query.user_id);
    let Some(member) = member else {
        return HttpResponse::NotFound().json(serde_json::json!({
            "error": "Team member not found"
        }));
    };
    match db::teams::list_assigned_tasks_for_user(
        pool.get_ref(),
        &member.display_name,
        query.series_id.as_deref(),
    )
    .await
    {
        Ok(tasks) => HttpResponse::Ok().json(tasks),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}
