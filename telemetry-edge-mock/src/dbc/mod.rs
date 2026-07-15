use std::fs;
use std::path::Path;

pub fn load_manifest(dbc_dir: &str) {
    let path = Path::new(dbc_dir);
    if !path.is_dir() {
        tracing::warn!("⚠️ pasta DBC nao encontrada: {}", dbc_dir);
        return;
    }

    let mut count = 0usize;
    match fs::read_dir(path) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) == Some("dbc") {
                    tracing::info!("📘 DBC mock disponível: {}", p.display());
                    count += 1;
                }
            }
            tracing::info!("✅ {} arquivos DBC carregados do mock", count);
        }
        Err(err) => tracing::warn!("⚠️ falha ao ler {}: {}", dbc_dir, err),
    }
}
