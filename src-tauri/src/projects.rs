use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TreeNode {
    pub path: String,
    pub kind: String,
}

pub fn validate_entry_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("名称无效".to_string());
    }
    let invalid = name == "."
        || name == ".."
        || name.starts_with('.')
        || name.chars().any(|ch| matches!(ch, '/' | '\\' | '\0') || ch.is_control());
    if invalid {
        return Err("名称无效".to_string());
    }
    Ok(name.to_string())
}

pub fn markdown_file_name(name: &str) -> Result<String, String> {
    let name = validate_entry_name(name)?;
    let lower = name.to_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        Ok(name)
    } else {
        Ok(format!("{name}.md"))
    }
}

pub fn child_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

pub fn parent_path(relative: &str) -> String {
    match relative.rsplit_once('/') {
        Some((parent, _)) => parent.to_string(),
        None => String::new(),
    }
}

pub fn retarget_path(path: &str, from: &str, to: &str) -> String {
    if path == from {
        return to.to_string();
    }
    let prefix = format!("{from}/");
    if let Some(rest) = path.strip_prefix(&prefix) {
        return format!("{to}/{rest}");
    }
    path.to_string()
}

pub fn list_tree(root: &Path) -> Result<Vec<TreeNode>, String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let mut nodes = Vec::new();
    walk_tree(root, root, &mut nodes)?;
    nodes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(nodes)
}

pub fn create_folder(root: &Path, parent: &str, name: &str) -> Result<String, String> {
    let name = validate_entry_name(name)?;
    let relative = child_path(parent, &name);
    let path = prepare_child(root, parent, &relative)?;
    if path.exists() {
        return Err("已存在".to_string());
    }
    fs::create_dir(&path).map_err(|error| error.to_string())?;
    Ok(relative)
}

pub fn create_markdown(root: &Path, parent: &str, name: &str, body: &str) -> Result<String, String> {
    let name = markdown_file_name(name)?;
    let relative = child_path(parent, &name);
    let path = prepare_child(root, parent, &relative)?;
    if path.exists() {
        return Err("已存在".to_string());
    }
    fs::write(&path, body).map_err(|error| error.to_string())?;
    Ok(relative)
}

pub fn rename_in_place(root: &Path, from: &str, new_name: &str) -> Result<String, String> {
    ensure_user_path(from)?;
    let source = existing_inside(root, from)?;
    let new_name = if source.is_dir() {
        validate_entry_name(new_name)?
    } else {
        markdown_file_name(new_name)?
    };
    let to = child_path(&parent_path(from), &new_name);
    if to == from {
        return Ok(to);
    }
    if parent_path(&to) != parent_path(from) {
        return Err("不支持移动".to_string());
    }
    let target = prepare_child(root, &parent_path(from), &to)?;
    if target.exists() {
        return Err("已存在".to_string());
    }
    fs::rename(&source, &target).map_err(|error| error.to_string())?;
    rewrite_index(root, |index| rename_index(index, from, &to))?;
    Ok(to)
}

pub fn remove_entry(root: &Path, relative: &str) -> Result<(), String> {
    ensure_user_path(relative)?;
    let path = existing_inside(root, relative)?;
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
    } else {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    rewrite_index(root, |index| remove_index(index, relative))?;
    Ok(())
}

pub fn read_text(root: &Path, relative: &str) -> Result<String, String> {
    let path = existing_inside(root, relative)?;
    fs::read_to_string(path).map_err(|error| error.to_string())
}

pub fn write_text(root: &Path, relative: &str, content: &str) -> Result<(), String> {
    let path = prepare_write(root, relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

/// 第一次打开且根上还没有索引时，把每个旧项目目录里的索引归并到存储根。
pub fn merge_legacy_indexes(root: &Path) -> Result<Vec<String>, String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let index_path = root.join(".maid").join("index.json");
    if index_path.exists() {
        return Ok(Vec::new());
    }
    let mut children = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let legacy = entry.path().join(".maid").join("index.json");
        if legacy.is_file() {
            children.push((name, legacy));
        }
    }
    children.sort_by(|left, right| left.0.cmp(&right.0));
    let mut warnings = Vec::new();
    let mut merged = json!({ "version": 1, "files": [], "unmatched": [] });
    let mut seen_file_ids = HashSet::new();
    let mut seen_unmatched_ids = HashSet::new();
    for (name, legacy) in &children {
        let text = fs::read_to_string(legacy).map_err(|error| error.to_string())?;
        let value: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
        let mut accepted_here = HashSet::new();
        if let Some(files) = value.get("files").and_then(Value::as_array) {
            for file in files {
                let mut file = file.clone();
                let id = file.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                if !id.is_empty() && !seen_file_ids.insert(id.clone()) {
                    warnings.push(format!("跳过重复文件 {id}"));
                    continue;
                }
                if !id.is_empty() {
                    accepted_here.insert(id);
                }
                if let Some(path) = file.get("path").and_then(Value::as_str) {
                    file["path"] = json!(format!("{name}/{path}"));
                }
                merged["files"].as_array_mut().expect("files").push(file);
            }
        }
        if let Some(items) = value.get("unmatched").and_then(Value::as_array) {
            for item in items {
                let mut item = item.clone();
                let id = item.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                let file_id = item.get("fileId").and_then(Value::as_str).unwrap_or("").to_string();
                if !file_id.is_empty() && !accepted_here.contains(&file_id) {
                    warnings.push(format!("跳过未匹配 {id}"));
                    continue;
                }
                if !id.is_empty() && !seen_unmatched_ids.insert(id.clone()) {
                    warnings.push(format!("跳过重复未匹配 {id}"));
                    continue;
                }
                if let Some(path) = item.get("filePath").and_then(Value::as_str) {
                    item["filePath"] = json!(format!("{name}/{path}"));
                }
                merged["unmatched"].as_array_mut().expect("unmatched").push(item);
            }
        }
    }
    write_json_atomic(&index_path, &merged)?;
    for (_, legacy) in &children {
        if let Some(maid_dir) = legacy.parent() {
            let _ = fs::remove_dir_all(maid_dir);
        }
    }
    Ok(warnings)
}

pub fn allocate_import_name(existing: &[String], file_name: &str) -> Result<String, String> {
    let file_name = Path::new(file_name)
        .file_name()
        .ok_or_else(|| "非法文件名".to_string())?
        .to_string_lossy()
        .to_string();
    if file_name.is_empty() || file_name.starts_with('.') || file_name.contains('/') || file_name.contains('\\') {
        return Err("非法文件名".to_string());
    }
    let lower = file_name.to_lowercase();
    if !(lower.ends_with(".md") || lower.ends_with(".markdown")) {
        return Err("只能导入 Markdown".to_string());
    }
    if !existing.iter().any(|item| item == &file_name) {
        return Ok(file_name);
    }
    let dot = file_name.rfind('.').ok_or_else(|| "非法文件名".to_string())?;
    let stem = &file_name[..dot];
    let ext = &file_name[dot + 1..];
    for index in 2..10_000 {
        let candidate = format!("{stem}-{index}.{ext}");
        if !existing.iter().any(|item| item == &candidate) {
            return Ok(candidate);
        }
    }
    Err("无法生成导入文件名".to_string())
}

/// 只写入 Markdown 正文。调用方传入单个文件；旁边的索引目录不会被带进来。
pub fn copy_markdown_body(directory: &Path, source: &Path, existing: &mut Vec<String>) -> Result<String, String> {
    let file_name = source.file_name().ok_or_else(|| "非法文件名".to_string())?.to_string_lossy().to_string();
    let name = allocate_import_name(existing, &file_name)?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let destination = directory.join(&name);
    if destination.parent() != Some(directory) {
        return Err("非法文件名".to_string());
    }
    let body = fs::read_to_string(source).map_err(|error| error.to_string())?;
    fs::write(destination, body).map_err(|error| error.to_string())?;
    existing.push(name.clone());
    Ok(name)
}

fn walk_tree(root: &Path, current: &Path, nodes: &mut Vec<TreeNode>) -> Result<(), String> {
    let entries = fs::read_dir(current).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let path = entry.path();
        let relative = relative_of(root, &path)?;
        if path.is_dir() {
            nodes.push(TreeNode { path: relative, kind: "folder".to_string() });
            walk_tree(root, &path, nodes)?;
            continue;
        }
        let lower = name.to_lowercase();
        if lower.ends_with(".md") || lower.ends_with(".markdown") {
            nodes.push(TreeNode { path: relative, kind: "file".to_string() });
        }
    }
    Ok(())
}

fn relative_of(root: &Path, path: &Path) -> Result<String, String> {
    Ok(path
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

fn prepare_child(root: &Path, parent: &str, relative: &str) -> Result<PathBuf, String> {
    ensure_user_path(relative)?;
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    if !parent.is_empty() {
        let parent_path = existing_inside(&root, parent)?;
        if !parent_path.is_dir() {
            return Err("不是文件夹".to_string());
        }
    }
    let path = root.join(relative);
    if !path.starts_with(&root) {
        return Err("路径超出存储".to_string());
    }
    Ok(path)
}

fn prepare_write(root: &Path, relative: &str) -> Result<PathBuf, String> {
    ensure_storage_path(relative)?;
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let path = root.join(relative);
    if !path.starts_with(&root) {
        return Err("路径超出存储".to_string());
    }
    Ok(path)
}

fn existing_inside(root: &Path, relative: &str) -> Result<PathBuf, String> {
    ensure_storage_path(relative)?;
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let path = fs::canonicalize(root.join(relative)).map_err(|_| "找不到路径".to_string())?;
    if path == root || !path.starts_with(&root) {
        return Err("路径超出存储".to_string());
    }
    Ok(path)
}

fn ensure_user_path(relative: &str) -> Result<(), String> {
    ensure_storage_path(relative)?;
    if relative.split('/').any(|part| part.starts_with('.')) {
        return Err("非法路径".to_string());
    }
    Ok(())
}

fn ensure_storage_path(relative: &str) -> Result<(), String> {
    if relative.is_empty()
        || relative.starts_with('/')
        || relative.split(['/', '\\']).any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("非法路径".to_string());
    }
    Ok(())
}

fn rewrite_index(root: &Path, edit: impl FnOnce(&mut Value)) -> Result<(), String> {
    let index_path = root.join(".maid").join("index.json");
    if !index_path.exists() {
        return Ok(());
    }
    let text = fs::read_to_string(&index_path).map_err(|error| error.to_string())?;
    let mut index: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    edit(&mut index);
    write_json_atomic(&index_path, &index)
}

fn rename_index(index: &mut Value, from: &str, to: &str) {
    if let Some(files) = index.get_mut("files").and_then(Value::as_array_mut) {
        for file in files {
            if let Some(path) = file.get("path").and_then(Value::as_str) {
                let next = retarget_path(path, from, to);
                file["path"] = json!(next);
            }
        }
    }
    if let Some(items) = index.get_mut("unmatched").and_then(Value::as_array_mut) {
        for item in items {
            if let Some(path) = item.get("filePath").and_then(Value::as_str) {
                item["filePath"] = json!(retarget_path(path, from, to));
            }
        }
    }
}

fn remove_index(index: &mut Value, relative: &str) {
    let mut removed_ids = HashSet::new();
    if let Some(files) = index.get_mut("files").and_then(Value::as_array_mut) {
        files.retain(|file| {
            let path = file.get("path").and_then(Value::as_str).unwrap_or("");
            let scoped = path == relative || path.starts_with(&format!("{relative}/"));
            if scoped {
                if let Some(id) = file.get("id").and_then(Value::as_str) {
                    removed_ids.insert(id.to_string());
                }
                return false;
            }
            true
        });
    }
    if let Some(items) = index.get_mut("unmatched").and_then(Value::as_array_mut) {
        items.retain(|item| {
            let path = item.get("filePath").and_then(Value::as_str).unwrap_or("");
            let file_id = item.get("fileId").and_then(Value::as_str).unwrap_or("");
            !(path == relative || path.starts_with(&format!("{relative}/")) || removed_ids.contains(file_id))
        });
    }
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    let mut file = fs::File::create(&temp).map_err(|error| error.to_string())?;
    file.write_all(text.as_bytes()).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    fs::rename(&temp, path).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("maid-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ed06_folders_stay_inside_storage_without_projects() {
        let storage = temp_dir("ed06");
        let root = storage.join("projects");
        let folder = create_folder(&root, "", " 立项 ").unwrap();
        assert_eq!(folder, "立项");
        assert!(root.join("立项").is_dir());
        assert!(create_folder(&root, "", "../outside").is_err());
        assert!(create_folder(&root, "", "立项").is_err());
        assert!(!storage.join("outside").exists());
        let file = create_markdown(&root, "立项", "想法", "# \n\n").unwrap();
        assert_eq!(file, "立项/想法.md");
        assert!(root.join("立项/想法.md").is_file());
        let nested = create_folder(&root, "立项", "调研").unwrap();
        assert_eq!(nested, "立项/调研");
        let tree = list_tree(&root).unwrap();
        assert!(tree.iter().any(|node| node.path == "立项" && node.kind == "folder"));
        assert!(tree.iter().any(|node| node.path == "立项/想法.md" && node.kind == "file"));
        let canonical = fs::canonicalize(&root).unwrap();
        assert!(fs::canonicalize(root.join("立项/想法.md")).unwrap().starts_with(&canonical));
        assert!(fs::read_to_string(root.join(".maid/index.json")).is_err());
        let _ = fs::remove_dir_all(&storage);
    }

    #[test]
    fn ed04_new_markdown_stays_in_selected_folder() {
        let storage = temp_dir("ed04");
        let root = storage.join("projects");
        create_folder(&root, "", "笔记").unwrap();
        let path = create_markdown(&root, "笔记", "idea.md", "# \n\n").unwrap();
        fs::write(root.join(&path), "# 一段文字\n").unwrap();
        assert_eq!(read_text(&root, &path).unwrap(), "# 一段文字\n");
        assert_eq!(list_tree(&root).unwrap().iter().filter(|node| node.kind == "file").count(), 1);
        let _ = fs::remove_dir_all(&storage);
    }

    #[test]
    fn fl01_rename_folder_keeps_file_id_and_stays_inside() {
        let storage = temp_dir("fl01");
        let root = storage.join("projects");
        create_folder(&root, "", "调研").unwrap();
        create_markdown(&root, "调研", "note.md", "# 正文\n").unwrap();
        create_folder(&root, "", "调研笔记").unwrap();
        create_markdown(&root, "调研笔记", "other.md", "# 别的\n").unwrap();
        write_text(
            &root,
            ".maid/index.json",
            r#"{"version":1,"files":[{"id":"file-1","path":"调研/note.md"},{"id":"file-2","path":"调研笔记/other.md"}],"unmatched":[{"id":"u-1","fileId":"file-1","filePath":"调研/note.md"}]}"#,
        )
        .unwrap();
        let renamed = rename_in_place(&root, "调研", "调研二").unwrap();
        assert_eq!(renamed, "调研二");
        assert_eq!(read_text(&root, "调研二/note.md").unwrap(), "# 正文\n");
        assert!(rename_in_place(&root, "调研二", "../outside").is_err());
        assert!(!storage.join("outside").exists());
        let index: Value = serde_json::from_str(&read_text(&root, ".maid/index.json").unwrap()).unwrap();
        let files = index["files"].as_array().unwrap();
        assert_eq!(files[0]["id"], "file-1");
        assert_eq!(files[0]["path"], "调研二/note.md");
        assert_eq!(files[1]["path"], "调研笔记/other.md");
        assert_eq!(index["unmatched"][0]["filePath"], "调研二/note.md");
        let file_renamed = rename_in_place(&root, "调研二/note.md", "记录").unwrap();
        assert_eq!(file_renamed, "调研二/记录.md");
        assert!(rename_in_place(&root, "调研二/记录.md", "别的/记录.md").is_err());
        let _ = fs::remove_dir_all(&storage);
    }

    #[test]
    fn fl02_delete_folder_clears_nested_index() {
        let storage = temp_dir("fl02");
        let root = storage.join("projects");
        create_folder(&root, "", "调研").unwrap();
        create_markdown(&root, "调研", "note.md", "# 正文\n").unwrap();
        write_text(
            &root,
            ".maid/index.json",
            r#"{"version":1,"files":[{"id":"file-1","path":"调研/note.md"},{"id":"file-2","path":"旁白.md"}],"unmatched":[{"id":"u-1","fileId":"file-1","filePath":"调研/note.md"}]}"#,
        )
        .unwrap();
        create_markdown(&root, "", "旁白.md", "# 旁白\n").unwrap();
        remove_entry(&root, "调研").unwrap();
        assert!(!root.join("调研").exists());
        let index: Value = serde_json::from_str(&read_text(&root, ".maid/index.json").unwrap()).unwrap();
        assert_eq!(index["files"].as_array().unwrap().len(), 1);
        assert_eq!(index["files"][0]["path"], "旁白.md");
        assert_eq!(index["unmatched"].as_array().unwrap().len(), 0);
        let _ = fs::remove_dir_all(&storage);
    }

    #[test]
    fn fl05_import_copies_markdown_body_without_sidecar() {
        let storage = temp_dir("fl05");
        let root = storage.join("projects");
        let external = storage.join("external");
        fs::create_dir_all(external.join(".maid")).unwrap();
        fs::write(external.join("note.md"), "# 正文\n").unwrap();
        fs::write(external.join(".maid/index.json"), "{\"tags\":[\"不应导入\"]}").unwrap();
        create_folder(&root, "", "立项").unwrap();
        let directory = root.join("立项");
        let mut existing = Vec::new();
        let imported = copy_markdown_body(&directory, &external.join("note.md"), &mut existing).unwrap();
        assert_eq!(imported, "note.md");
        assert_eq!(fs::read_to_string(directory.join("note.md")).unwrap(), "# 正文\n");
        assert!(!directory.join(".maid").exists());
        assert!(external.join(".maid/index.json").is_file());
        assert_ne!(fs::canonicalize(&external).unwrap(), fs::canonicalize(&root).unwrap());
        let again = copy_markdown_body(&directory, &external.join("note.md"), &mut existing).unwrap();
        assert_eq!(again, "note-2.md");
        let _ = fs::remove_dir_all(&storage);
    }

    #[test]
    fn legacy_indexes_merge_once_into_storage_root() {
        let storage = temp_dir("merge");
        let root = storage.join("projects");
        let legacy = root.join("alpha/.maid");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(
            legacy.join("index.json"),
            r#"{"version":1,"files":[{"id":"file-1","path":"note.md"}],"unmatched":[{"id":"u-1","fileId":"file-1","filePath":"note.md"}]}"#,
        )
        .unwrap();
        let other = root.join("beta/.maid");
        fs::create_dir_all(&other).unwrap();
        fs::write(
            other.join("index.json"),
            r#"{"version":1,"files":[{"id":"file-1","path":"late.md"},{"id":"file-2","path":"keep.md"}],"unmatched":[]}"#,
        )
        .unwrap();
        let warnings = merge_legacy_indexes(&root).unwrap();
        assert!(warnings.iter().any(|item| item.contains("file-1")));
        let index: Value = serde_json::from_str(&fs::read_to_string(root.join(".maid/index.json")).unwrap()).unwrap();
        let files = index["files"].as_array().unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0]["id"], "file-1");
        assert_eq!(files[0]["path"], "alpha/note.md");
        assert_eq!(files[1]["id"], "file-2");
        assert_eq!(files[1]["path"], "beta/keep.md");
        assert_eq!(index["unmatched"][0]["filePath"], "alpha/note.md");
        assert!(!legacy.exists());
        fs::create_dir_all(root.join("后来/.maid")).unwrap();
        fs::write(root.join("后来/.maid/index.json"), r#"{"version":1,"files":[{"id":"file-9","path":"x.md"}],"unmatched":[]}"#).unwrap();
        let again = merge_legacy_indexes(&root).unwrap();
        assert!(again.is_empty());
        let stored = fs::read_to_string(root.join(".maid/index.json")).unwrap();
        assert!(!stored.contains("file-9"));
        assert!(root.join("后来/.maid/index.json").is_file());
        let _ = fs::remove_dir_all(&storage);
    }
}
