//! Native save/open dialogs for the JSON backup Settings -> Data already
//! builds and parses — the desktop shell's only job here is swapping a
//! browser download for a real file on disk. `suggested_name` is computed
//! in TypeScript (same date formatting as before) rather than duplicated
//! in Rust.

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
pub struct SaveResult {
    ok: bool,
    #[serde(rename = "filePath", skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
}

#[derive(Serialize)]
pub struct OpenResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

#[tauri::command]
pub async fn save_backup(
    app: tauri::AppHandle,
    json_text: String,
    suggested_name: String,
) -> Result<SaveResult, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Save backup")
        .set_file_name(&suggested_name)
        .add_filter("JSON backup", &["json"])
        .blocking_save_file();

    let Some(file_path) = picked else {
        return Ok(SaveResult { ok: false, file_path: None });
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, json_text).map_err(|e| e.to_string())?;
    Ok(SaveResult { ok: true, file_path: Some(path.to_string_lossy().to_string()) })
}

#[tauri::command]
pub async fn open_backup(app: tauri::AppHandle) -> Result<OpenResult, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Restore from backup")
        .add_filter("JSON backup", &["json"])
        .blocking_pick_file();

    let Some(file_path) = picked else {
        return Ok(OpenResult { ok: false, text: None });
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(OpenResult { ok: true, text: Some(text) })
}
