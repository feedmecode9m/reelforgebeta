//! Offline inventory + optional backfill for web playback derivatives.
//!
//! Default is **dry-run / report only** (no encode, no R2 upload, no DB writes).
//!
//! Usage (from backend package root, after env loaded):
//! ```text
//! cargo run -- playback-repair --dry-run
//! cargo run -- playback-repair --apply --limit 1
//! cargo run -- playback-repair --apply --reel-id <uuid>
//! ```
//!
//! `--apply` requires `REELFORGE_PLAYBACK_REPAIR_APPLY=1` so accidental production
//! mutation from a normal server start path is harder.

use std::collections::HashMap;
use std::env;
use std::path::PathBuf;
use std::time::Duration;

use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

use crate::db;
use crate::db::reels;
use crate::ingestion::playback_derivative::{
    self, MaterializeOutcomeKind, PlaybackInventoryBucket,
};
use crate::storage::r2::R2Storage;

#[derive(Debug, Clone)]
struct RepairArgs {
    dry_run: bool,
    apply: bool,
    limit: Option<usize>,
    reel_id: Option<Uuid>,
    json: bool,
}

impl RepairArgs {
    fn parse(argv: &[String]) -> Result<Self, String> {
        let mut dry_run = true;
        let mut apply = false;
        let mut limit = None;
        let mut reel_id = None;
        let mut json = false;

        let mut i = 0usize;
        while i < argv.len() {
            match argv[i].as_str() {
                "--dry-run" | "-n" => {
                    dry_run = true;
                    apply = false;
                }
                "--apply" => {
                    apply = true;
                    dry_run = false;
                }
                "--json" => json = true,
                "--limit" => {
                    i += 1;
                    let v = argv
                        .get(i)
                        .ok_or("--limit requires a number")?
                        .parse::<usize>()
                        .map_err(|_| "--limit must be a positive integer")?;
                    limit = Some(v);
                }
                "--reel-id" => {
                    i += 1;
                    let raw = argv.get(i).ok_or("--reel-id requires a uuid")?;
                    reel_id = Some(
                        Uuid::parse_str(raw).map_err(|_| format!("invalid --reel-id: {}", raw))?,
                    );
                }
                "--help" | "-h" => {
                    print_help();
                    std::process::exit(0);
                }
                other => return Err(format!("unknown argument: {}", other)),
            }
            i += 1;
        }

        Ok(Self {
            dry_run: dry_run || !apply,
            apply,
            limit,
            reel_id,
            json,
        })
    }
}

fn print_help() {
    eprintln!(
        "playback-repair — inventory / optional backfill for web_720p_h264 derivatives

Default: dry-run (report only; no mutations).

  cargo run -- playback-repair --dry-run
  cargo run -- playback-repair --apply --limit 1
  cargo run -- playback-repair --apply --reel-id <uuid>

Apply mode also requires:
  REELFORGE_PLAYBACK_REPAIR_APPLY=1

Does not mutate master video_url. Uses existing encode_web_playback_derivative
and set_playback_derivative. Stable object key: {{reelId}}.playback.mp4 under R2_KEY_PREFIX.
"
    );
}

/// Entry point installed from `main` when argv[1] == "playback-repair".
pub async fn run(argv: Vec<String>) -> std::io::Result<()> {
    let args = match RepairArgs::parse(&argv) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("playback-repair: {}", e);
            print_help();
            std::process::exit(2);
        }
    };

    if args.apply {
        if env_truthy("REELFORGE_PLAYBACK_REPAIR_APPLY") {
            // allowed
        } else {
            eprintln!(
                "playback-repair: --apply refused without REELFORGE_PLAYBACK_REPAIR_APPLY=1"
            );
            eprintln!("  (default is dry-run; re-run without --apply for inventory)");
            std::process::exit(3);
        }
        if !crate::ingestion::transcode::playback_transcode_enabled() {
            eprintln!("playback-repair: PLAYBACK_TRANSCODE disabled; abort apply");
            std::process::exit(3);
        }
    }

    let db_url =
        env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost/reelforge".to_string());
    let pool = match PgPoolOptions::new()
        .max_connections(3)
        .acquire_timeout(Duration::from_secs(8))
        .connect(&db_url)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            eprintln!("playback-repair: database unavailable: {}", e);
            std::process::exit(1);
        }
    };

    if let Err(e) = db::run_migrations(&pool).await {
        eprintln!("playback-repair: migrations failed: {}", e);
        std::process::exit(1);
    }

    // Optional R2 for apply / object presence checks.
    match R2Storage::from_env().await {
        Ok(Some(r2)) => {
            R2Storage::init(Some(r2));
            eprintln!("playback-repair: R2 enabled");
        }
        Ok(None) => {
            R2Storage::init(None);
            eprintln!("playback-repair: R2 not configured (local derivative paths only)");
        }
        Err(e) => {
            eprintln!("playback-repair: R2 init error (continuing without): {}", e);
            R2Storage::init(None);
        }
    }

    let inventory = match playback_derivative::inventory_all_reels(&pool).await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("playback-repair: inventory failed: {}", e);
            std::process::exit(1);
        }
    };

    let mut counts: HashMap<&'static str, usize> = HashMap::new();
    for entry in &inventory {
        let key = match entry.bucket {
            PlaybackInventoryBucket::ReadyMasterMissingPlayback => "ready_master_missing_playback",
            PlaybackInventoryBucket::ReadyPlayback => "ready_playback",
            PlaybackInventoryBucket::IncompletePlayback => "incomplete_playback",
            PlaybackInventoryBucket::MissingOrInvalidMaster => "missing_or_invalid_master",
            PlaybackInventoryBucket::NonReadyMaster => "non_ready_master",
        };
        *counts.entry(key).or_insert(0) += 1;
    }

    if args.json {
        let rows: Vec<serde_json::Value> = inventory
            .iter()
            .map(|e| {
                serde_json::json!({
                    "reelId": e.reel_id,
                    "title": e.title,
                    "masterStatus": e.master_status,
                    "masterUrl": e.master_url,
                    "playbackStatus": e.playback_status,
                    "playbackUrl": e.playback_url,
                    "playbackFileName": e.playback_file_name,
                    "bucket": format!("{:?}", e.bucket),
                })
            })
            .collect();
        println!(
            "{}",
            serde_json::json!({
                "mode": if args.apply { "apply" } else { "dry-run" },
                "counts": counts,
                "reels": rows,
            })
        );
    } else {
        println!("playback-repair inventory ({})", if args.apply { "apply" } else { "dry-run" });
        println!("  ready_master_missing_playback: {}", counts.get("ready_master_missing_playback").copied().unwrap_or(0));
        println!("  ready_playback:                {}", counts.get("ready_playback").copied().unwrap_or(0));
        println!("  incomplete_playback:           {}", counts.get("incomplete_playback").copied().unwrap_or(0));
        println!("  missing_or_invalid_master:     {}", counts.get("missing_or_invalid_master").copied().unwrap_or(0));
        println!("  non_ready_master:              {}", counts.get("non_ready_master").copied().unwrap_or(0));
        println!("  total_rows:                    {}", inventory.len());
        for e in &inventory {
            if matches!(
                e.bucket,
                PlaybackInventoryBucket::ReadyMasterMissingPlayback
                    | PlaybackInventoryBucket::IncompletePlayback
                    | PlaybackInventoryBucket::ReadyPlayback
                    | PlaybackInventoryBucket::MissingOrInvalidMaster
            ) {
                println!(
                    "  - id={} title={:?} bucket={:?} pb_status={:?} master={}",
                    e.reel_id,
                    e.title,
                    e.bucket,
                    e.playback_status,
                    e.master_url.as_deref().unwrap_or("-")
                );
            }
        }
    }

    if args.dry_run || !args.apply {
        eprintln!("playback-repair: dry-run complete (no mutations)");
        return Ok(());
    }

    let videos_path = resolve_videos_path();
    eprintln!(
        "playback-repair: apply starting videos_path={}",
        videos_path.display()
    );

    let mut targets: Vec<_> = inventory
        .into_iter()
        .filter(|e| {
            if let Some(id) = args.reel_id {
                return e.reel_id == id;
            }
            matches!(
                e.bucket,
                PlaybackInventoryBucket::ReadyMasterMissingPlayback
                    | PlaybackInventoryBucket::IncompletePlayback
            )
        })
        .collect();

    if let Some(lim) = args.limit {
        targets.truncate(lim);
    }

    if targets.is_empty() {
        eprintln!("playback-repair: nothing to apply");
        return Ok(());
    }

    let mut ready_n = 0usize;
    let mut fail_n = 0usize;
    let mut skip_n = 0usize;

    for entry in targets {
        let Some(row) = reels::get_reel_by_id(&pool, entry.reel_id)
            .await
            .ok()
            .flatten()
        else {
            eprintln!("playback-repair: missing reel {}", entry.reel_id);
            fail_n += 1;
            continue;
        };

        let outcome = playback_derivative::repair_reel(&pool, &row, &videos_path).await;
        match outcome.kind {
            MaterializeOutcomeKind::Ready => {
                ready_n += 1;
                eprintln!(
                    "playback-repair: READY reel={} url={}",
                    outcome.reel_id,
                    outcome.playback_url.as_deref().unwrap_or("-")
                );
            }
            MaterializeOutcomeKind::SkippedAlreadyReady
            | MaterializeOutcomeKind::SkippedFeatureFlag => {
                skip_n += 1;
                eprintln!(
                    "playback-repair: SKIP reel={} msg={}",
                    outcome.reel_id, outcome.message
                );
            }
            MaterializeOutcomeKind::Failed => {
                fail_n += 1;
                eprintln!(
                    "playback-repair: FAIL reel={} msg={}",
                    outcome.reel_id, outcome.message
                );
            }
        }
    }

    eprintln!(
        "playback-repair: apply done ready={} failed={} skipped={}",
        ready_n, fail_n, skip_n
    );
    Ok(())
}

fn resolve_videos_path() -> PathBuf {
    if let Ok(p) = env::var("VIDEOS_DIR") {
        let t = p.trim();
        if !t.is_empty() {
            return PathBuf::from(t);
        }
    }
    if let Ok(p) = env::var("REELFORGE_VIDEOS_PATH") {
        let t = p.trim();
        if !t.is_empty() {
            return PathBuf::from(t);
        }
    }
    PathBuf::from("./videos")
}

fn env_truthy(key: &str) -> bool {
    env::var(key)
        .map(|v| {
            let v = v.trim();
            v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("yes")
        })
        .unwrap_or(false)
}
