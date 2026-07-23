use std::sync::OnceLock;
use std::time::Duration;

use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::config::Region;
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::Client;
use tokio::io::AsyncWriteExt;

static R2: OnceLock<Option<R2Storage>> = OnceLock::new();

#[derive(Clone, Debug)]
pub struct ObjectHead {
    pub content_length: i64,
    pub content_type: Option<String>,
}

#[derive(Clone)]
pub struct R2Storage {
    client: Client,
    bucket: String,
    key_prefix: String,
    public_base: String,
    endpoint: String,
}

impl R2Storage {
    pub fn init(storage: Option<Self>) {
        let _ = R2.set(storage);
    }

    pub fn global() -> Option<&'static R2Storage> {
        R2.get()?.as_ref()
    }

    pub fn enabled() -> bool {
        Self::global().is_some()
    }

    pub async fn from_env() -> Result<Option<Self>, String> {
        let bucket = match env_first(&["R2_BUCKET", "R2_BUCKET_NAME", "UPLOADS_S3_BUCKET"]) {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };
        let access_key = match env_first(&["R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"]) {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };
        let secret_key = match env_first(&[
            "R2_SECRET_ACCESS_KEY",
            "R2_SECRET_KEY",
            "AWS_SECRET_ACCESS_KEY",
        ]) {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };
        let endpoint = match resolve_endpoint() {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };
        let endpoint_for_client = endpoint.clone();
        let public_base = env_first(&["R2_PUBLIC_BASE_URL"])
            .unwrap_or_default()
            .trim_end_matches('/')
            .to_string();
        let key_prefix = std::env::var("R2_KEY_PREFIX")
            .or_else(|_| std::env::var("UPLOADS_KEY_PREFIX"))
            .unwrap_or_else(|_| "videos".to_string())
            .trim_matches('/')
            .to_string();

        let creds = Credentials::new(access_key, secret_key, None, None, "reelforge-r2");
        let region = Region::new(
            std::env::var("R2_REGION")
                .or_else(|_| std::env::var("UPLOADS_S3_REGION"))
                .unwrap_or_else(|_| "auto".to_string()),
        );
        let shared = aws_config::defaults(BehaviorVersion::latest())
            .credentials_provider(creds)
            .region(region)
            .endpoint_url(endpoint_for_client)
            .load()
            .await;

        let mut s3_conf = aws_sdk_s3::config::Builder::from(&shared);
        if env_truthy("UPLOADS_S3_FORCE_PATH_STYLE") {
            s3_conf = s3_conf.force_path_style(true);
        }
        let client = Client::from_conf(s3_conf.build());

        eprintln!(
            "[r2] enabled bucket={} prefix={} public_base={}",
            bucket, key_prefix, if public_base.is_empty() { "(unset)" } else { &public_base }
        );

        Ok(Some(Self {
            client,
            bucket,
            key_prefix,
            public_base,
            endpoint,
        }))
    }

    pub fn object_key(&self, stored_name: &str) -> String {
        format!("{}/{}", self.key_prefix, stored_name)
    }

    pub fn public_url(&self, stored_name: &str) -> String {
        let key = self.object_key(stored_name);
        if !self.public_base.is_empty() {
            return format!("{}/{}", self.public_base, key);
        }
        if env_truthy("UPLOADS_S3_FORCE_PATH_STYLE") {
            return format!(
                "{}/{}/{}",
                self.endpoint.trim_end_matches('/'),
                self.bucket,
                key
            );
        }
        format!("/videos/{}", stored_name)
    }

    pub async fn presigned_put_url(
        &self,
        stored_name: &str,
        content_type: &str,
        ttl_seconds: u64,
    ) -> Result<String, String> {
        let key = self.object_key(stored_name);
        let presigned = self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(&key)
            .content_type(content_type)
            .presigned(
                PresigningConfig::expires_in(Duration::from_secs(ttl_seconds.max(60)))
                    .map_err(|e| e.to_string())?,
            )
            .await
            .map_err(|e| format!("R2 presign PUT failed: {}", e))?;
        Ok(presigned.uri().to_string())
    }

    pub async fn head_object(&self, stored_name: &str) -> Result<ObjectHead, String> {
        let key = self.object_key(stored_name);
        let out = self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(&key)
            .send()
            .await
            .map_err(|e| format!("R2 head_object failed: {}", e))?;
        Ok(ObjectHead {
            content_length: out.content_length().unwrap_or(0),
            content_type: out.content_type().map(|s| s.to_string()),
        })
    }

    pub async fn delete_object(&self, stored_name: &str) -> Result<(), String> {
        let key = self.object_key(stored_name);
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(&key)
            .send()
            .await
            .map_err(|e| format!("R2 delete_object failed: {}", e))?;
        Ok(())
    }

    /// Stream object to a local path (for ffprobe validation when needed).
    pub async fn download_to_path(
        &self,
        stored_name: &str,
        dest: &std::path::Path,
    ) -> Result<u64, String> {
        let key = self.object_key(stored_name);
        let out = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(&key)
            .send()
            .await
            .map_err(|e| format!("R2 get_object failed: {}", e))?;
        let mut reader = out.body.into_async_read();
        let mut file = tokio::fs::File::create(dest)
            .await
            .map_err(|e| format!("open dest failed: {}", e))?;
        let total = tokio::io::copy(&mut reader, &mut file)
            .await
            .map_err(|e| format!("R2 stream write failed: {}", e))?;
        file.flush().await.map_err(|e| e.to_string())?;
        Ok(total)
    }
}

fn env_first(keys: &[&str]) -> Result<String, String> {
    for key in keys {
        if let Ok(v) = std::env::var(key) {
            let trimmed = v.trim().to_string();
            if !trimmed.is_empty() {
                return Ok(trimmed);
            }
        }
    }
    Err(format!("missing env: {}", keys.join(" or ")))
}

fn resolve_endpoint() -> Result<String, String> {
    for key in &["UPLOADS_S3_ENDPOINT", "R2_ENDPOINT"] {
        if let Ok(v) = std::env::var(key) {
            let trimmed = v.trim().trim_end_matches('/').to_string();
            if !trimmed.is_empty() {
                return Ok(trimmed);
            }
        }
    }
    if let Ok(account) = std::env::var("R2_ACCOUNT_ID") {
        let trimmed = account.trim();
        if !trimmed.is_empty() {
            return Ok(format!("https://{}.r2.cloudflarestorage.com", trimmed));
        }
    }
    Err("missing UPLOADS_S3_ENDPOINT or R2_ACCOUNT_ID".to_string())
}

fn env_truthy(key: &str) -> bool {
    std::env::var(key)
        .map(|v| {
            let v = v.trim();
            v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("yes")
        })
        .unwrap_or(false)
}
