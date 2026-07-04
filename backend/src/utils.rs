pub async fn upload_to_supabase(_local_path: &str, filename: &str) -> Result<String, String> {
    Ok(format!(
        "https://your-project.supabase.co/storage/v1/object/public/reels/{}",
        filename
    ))
}

pub async fn delete_from_supabase(_filename: &str) -> Result<(), String> {
    Ok(())
}
