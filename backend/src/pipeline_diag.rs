//! Temporary upload-pipeline instrumentation (Mission: diagnostic logging).

pub fn pipeline_diag(
    tag: &str,
    function: &str,
    source_file: &str,
    asset_id: Option<&str>,
    file_name: Option<&str>,
    result: &str,
) {
    eprintln!(
        "[{}] timestamp={} function={} sourceFile={} assetId={} fileName={} result={}",
        tag,
        chrono::Utc::now().to_rfc3339(),
        function,
        source_file,
        asset_id.unwrap_or("-"),
        file_name.unwrap_or("-"),
        result
    );
}
