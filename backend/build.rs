use std::path::Path;

fn main() {
    warn_if_target_not_owned_by_current_user();
}

fn warn_if_target_not_owned_by_current_user() {
    let target_dir = Path::new("target");
    if !target_dir.exists() {
        return;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;

        let Ok(meta) = std::fs::metadata(target_dir) else {
            return;
        };

        let Some(current_uid) = current_uid() else {
            return;
        };

        let owner_uid = meta.uid();
        if owner_uid == current_uid {
            return;
        }

        println!(
            "cargo:warning=`target/` is owned by uid {owner_uid}, but the current user is uid {current_uid}"
        );
        println!("cargo:warning=builds may fail with \"Permission denied (os error 13)\"");
        println!(
            "cargo:warning=run `./scripts/dev-start.sh` from the project root to fix ownership automatically"
        );
        println!(
            "cargo:warning=or run `sudo chown -R $(id -u):$(id -g) target/` inside the backend directory"
        );
    }
}

#[cfg(unix)]
fn current_uid() -> Option<u32> {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|status| {
            status
                .lines()
                .find(|line| line.starts_with("Uid:"))
                .and_then(|line| line.split_whitespace().nth(1))
                .and_then(|uid| uid.parse().ok())
        })
}

#[cfg(not(unix))]
fn current_uid() -> Option<u32> {
    None
}
