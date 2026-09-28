mod projects;

use projects::{copy_markdown_body, TreeNode};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Deserialize, Clone)]
struct Selection {
    kind: String,
    path: String,
}

#[derive(Serialize, Deserialize, Default)]
struct StoreState {
    selection: Option<Selection>,
}

#[derive(Serialize)]
struct Session {
    selection: Option<Selection>,
    warnings: Vec<String>,
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn projects_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data(app)?.join("projects");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn open_root(app: &AppHandle) -> Result<(PathBuf, Vec<String>), String> {
    let root = projects_dir(app)?;
    let warnings = projects::merge_legacy_indexes(&root)?;
    Ok((root, warnings))
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data(app)?.join("state.json"))
}

fn read_state(app: &AppHandle) -> Result<StoreState, String> {
    let path = state_path(app)?;
    if !path.exists() {
        return Ok(StoreState::default());
    }
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn write_state(app: &AppHandle, state: &StoreState) -> Result<(), String> {
    let path = state_path(app)?;
    let text = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

#[tauri::command]
fn session(app: AppHandle) -> Result<Session, String> {
    let (root, warnings) = open_root(&app)?;
    let mut selection = read_state(&app)?.selection;
    if let Some(current) = &selection {
        let path = root.join(&current.path);
        let still_there = path.exists() && ((current.kind == "folder" && path.is_dir()) || (current.kind == "file" && path.is_file()));
        if !still_there {
            selection = None;
        }
    }
    Ok(Session { selection, warnings })
}

#[tauri::command]
fn remember_selection(app: AppHandle, kind: String, path: String) -> Result<(), String> {
    if kind != "file" && kind != "folder" {
        return Err("无法记住选中".to_string());
    }
    if !path.is_empty() {
        let (root, _) = open_root(&app)?;
        let root = fs::canonicalize(&root).map_err(|error| error.to_string())?;
        let target = fs::canonicalize(root.join(&path)).map_err(|_| "找不到路径".to_string())?;
        if target == root || !target.starts_with(&root) {
            return Err("路径超出存储".to_string());
        }
    }
    write_state(&app, &StoreState { selection: Some(Selection { kind, path }) })
}

#[tauri::command(async)]
fn list_tree(app: AppHandle) -> Result<Vec<TreeNode>, String> {
    projects::list_tree(&open_root(&app)?.0)
}

#[tauri::command]
fn create_folder(app: AppHandle, parent: String, name: String) -> Result<String, String> {
    projects::create_folder(&open_root(&app)?.0, &parent, &name)
}

#[tauri::command]
fn create_file(app: AppHandle, parent: String, name: String) -> Result<String, String> {
    projects::create_markdown(&open_root(&app)?.0, &parent, &name, "# \n\n")
}

/// 必须是 async：同步命令在主线程执行，`blocking_pick_files` 会卡死窗口。
#[tauri::command]
async fn import_markdown(app: AppHandle, parent: String) -> Result<Vec<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_files();
    let Some(picked) = picked else {
        return Ok(Vec::new());
    };
    let (root, _) = open_root(&app)?;
    let directory = if parent.is_empty() {
        root.clone()
    } else {
        let path = root.join(&parent);
        if !path.is_dir() {
            return Err("不是文件夹".to_string());
        }
        path
    };
    let mut existing = fs::read_dir(&directory)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    let mut imported = Vec::new();
    for file in picked {
        let path = file.into_path().map_err(|error| format!("{error:?}"))?;
        if !path.is_file() {
            continue;
        }
        let name = copy_markdown_body(&directory, &path, &mut existing)?;
        imported.push(projects::child_path(&parent, &name));
    }
    Ok(imported)
}

#[tauri::command]
fn read_text(app: AppHandle, relative_path: String) -> Result<String, String> {
    projects::read_text(&open_root(&app)?.0, &relative_path)
}

#[tauri::command]
fn write_text(app: AppHandle, relative_path: String, content: String) -> Result<(), String> {
    projects::write_text(&open_root(&app)?.0, &relative_path, &content)
}

#[tauri::command]
fn remove_path(app: AppHandle, relative_path: String) -> Result<(), String> {
    projects::remove_entry(&open_root(&app)?.0, &relative_path)
}

#[tauri::command]
fn rename_path(app: AppHandle, from: String, name: String) -> Result<String, String> {
    projects::rename_in_place(&open_root(&app)?.0, &from, &name)
}

/// 必须是 async：同步命令在主线程执行，`blocking_save_file` 会卡死窗口。
#[tauri::command]
async fn export_text(app: tauri::AppHandle, default_name: String, content: String) -> Result<bool, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter("Markdown", &["md"])
        .blocking_save_file();
    let Some(picked) = picked else {
        return Ok(false);
    };
    let path = picked.into_path().map_err(|error| format!("{error:?}"))?;
    fs::write(path, content).map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            session,
            remember_selection,
            list_tree,
            create_folder,
            create_file,
            import_markdown,
            read_text,
            write_text,
            remove_path,
            rename_path,
            export_text
        ])
        .run(tauri::generate_context!())
        .expect("启动 Maid 失败");
}

#[cfg(test)]
mod tests {
    #[test]
    fn storage_commands_do_not_open_projects_or_block() {
        let source = include_str!("lib.rs");
        let open_folder = ["pick", "_folder"].join("");
        assert!(
            !source.contains(&format!("fn {open_folder}(")) && !source.contains(&format!("blocking_{open_folder}(")),
            "不能再提供打开任意文件夹"
        );
        let create_project = ["fn create", "_project("].join("");
        let list_projects = ["fn list", "_projects("].join("");
        assert!(!source.contains(&create_project), "不能再提供新建项目");
        assert!(!source.contains(&list_projects), "不能再提供项目列表");
        assert!(command_is_async(source, "import_markdown"), "导入文件的对话框不能跑在主线程上");
        assert!(command_is_async(source, "export_text"), "导出对话框不能跑在主线程上");
        assert!(command_is_async(source, "list_tree"), "文件树扫描不能堵住主线程");
    }

    fn command_is_async(source: &str, name: &str) -> bool {
        let mut previous_is_async_attr = false;
        for line in source.lines() {
            let line = line.trim();
            if line.starts_with(&format!("async fn {name}(")) {
                return true;
            }
            if line.starts_with(&format!("fn {name}(")) {
                return previous_is_async_attr;
            }
            previous_is_async_attr = line.contains("command(async)");
        }
        false
    }
}
