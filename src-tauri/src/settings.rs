use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            base_url: "http://localhost:11434/v1".to_string(),
            api_key: "ollama".to_string(),
            model: "llama3.2".to_string(),
        }
    }
}

/// 全局文件已存在则只用它。否则把项目里的 `.maid/settings.json` 复制成全局文件。
/// 两边都没有时返回默认值，不创建全局文件。
pub fn resolve_settings(global_file: &Path, legacy_file: &Path) -> Result<Settings, String> {
    if global_file.is_file() {
        return read_settings(global_file);
    }
    if legacy_file.is_file() {
        if let Some(parent) = global_file.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(legacy_file, global_file).map_err(|error| error.to_string())?;
        return read_settings(global_file);
    }
    Ok(Settings::default())
}

pub fn store_settings(global_file: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = global_file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(global_file, text).map_err(|error| error.to_string())
}

fn read_settings(path: &Path) -> Result<Settings, String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let parsed: PartialSettings = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    let defaults = Settings::default();
    Ok(Settings {
        base_url: parsed.base_url.unwrap_or(defaults.base_url),
        api_key: parsed.api_key.unwrap_or(defaults.api_key),
        model: parsed.model.unwrap_or(defaults.model),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialSettings {
    base_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("maid-settings-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample(base_url: &str, api_key: &str) -> Settings {
        Settings {
            base_url: base_url.to_string(),
            api_key: api_key.to_string(),
            model: "example-model".to_string(),
        }
    }

    #[test]
    fn global_file_wins_and_legacy_is_ignored() {
        let dir = temp_dir("global");
        let global = dir.join("settings.json");
        let legacy = dir.join("project/.maid/settings.json");
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        store_settings(&global, &sample("https://global.example/v1", "global-key")).unwrap();
        fs::write(
            &legacy,
            serde_json::to_string(&sample("https://legacy.example/v1", "legacy-key")).unwrap(),
        )
        .unwrap();
        let state = dir.join("state.json");
        fs::write(&state, "{\"selection\":null}").unwrap();

        let loaded = resolve_settings(&global, &legacy).unwrap();
        assert_eq!(loaded.base_url, "https://global.example/v1");
        assert_eq!(loaded.api_key, "global-key");
        assert_eq!(fs::read_to_string(&state).unwrap(), "{\"selection\":null}");
        assert!(legacy.is_file());
    }

    #[test]
    fn legacy_project_file_is_copied_once() {
        let dir = temp_dir("migrate");
        let global = dir.join("settings.json");
        let legacy = dir.join("project/.maid/settings.json");
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        let legacy_body = serde_json::to_string(&sample("https://legacy.example/v1", "legacy-key")).unwrap();
        fs::write(&legacy, &legacy_body).unwrap();

        let loaded = resolve_settings(&global, &legacy).unwrap();
        assert_eq!(loaded.base_url, "https://legacy.example/v1");
        assert_eq!(loaded.api_key, "legacy-key");
        assert!(global.is_file());
        assert_eq!(fs::read_to_string(&legacy).unwrap(), legacy_body);

        fs::write(
            &legacy,
            serde_json::to_string(&sample("https://other.example/v1", "other-key")).unwrap(),
        )
        .unwrap();
        let again = resolve_settings(&global, &legacy).unwrap();
        assert_eq!(again.base_url, "https://legacy.example/v1");
        assert_eq!(again.api_key, "legacy-key");
    }

    #[test]
    fn missing_files_return_default_without_creating_global() {
        let dir = temp_dir("default");
        let global = dir.join("settings.json");
        let legacy = dir.join("project/.maid/settings.json");
        let loaded = resolve_settings(&global, &legacy).unwrap();
        assert_eq!(loaded, Settings::default());
        assert!(!global.exists());
    }

    #[test]
    fn store_writes_only_the_global_file() {
        let dir = temp_dir("save");
        let global = dir.join("settings.json");
        let legacy = dir.join("project/.maid/settings.json");
        let state = dir.join("state.json");
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::write(&legacy, "{\"baseUrl\":\"https://legacy.example/v1\"}").unwrap();
        fs::write(&state, "{\"selection\":null}").unwrap();

        store_settings(&global, &sample("https://saved.example/v1", "saved-key")).unwrap();
        assert!(global.is_file());
        assert_eq!(fs::read_to_string(&legacy).unwrap(), "{\"baseUrl\":\"https://legacy.example/v1\"}");
        assert_eq!(fs::read_to_string(&state).unwrap(), "{\"selection\":null}");
        let saved = read_settings(&global).unwrap();
        assert_eq!(saved.base_url, "https://saved.example/v1");
        assert_eq!(saved.api_key, "saved-key");
    }
}
