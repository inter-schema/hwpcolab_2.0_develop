use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Instant, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ClawExecResult {
    pub ok: bool,
    pub stdout_json: serde_json::Value,
    pub stderr: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StagingStatusResult {
    pub exists: bool,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: u64,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AgentCliExecResult {
    pub ok: bool,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    #[serde(rename = "stagingModified")]
    pub staging_modified: bool,
    #[serde(rename = "stagingMtimeMs")]
    pub staging_mtime_ms: u64,
}

fn resolve_node_binary() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let next_to_exe = exe_dir.join("node.exe");
                if next_to_exe.is_file() {
                    return next_to_exe;
                }
                let in_res = exe_dir.join("resources").join("node.exe");
                if in_res.is_file() {
                    return in_res;
                }
                let in_claw = exe_dir.join("resources").join("claw-hwp").join("node.exe");
                if in_claw.is_file() {
                    return in_claw;
                }
            }
        }
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            let p = PathBuf::from(local_app)
                .join("Programs")
                .join("nodejs")
                .join("node.exe");
            if p.is_file() {
                return p;
            }
        }
        for candidate in &[
            r"C:\Program Files\nodejs\node.exe",
            r"C:\Program Files (x86)\nodejs\node.exe",
        ] {
            let p = PathBuf::from(candidate);
            if p.is_file() {
                return p;
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let next_to_exe = exe_dir.join("node");
                if next_to_exe.is_file() {
                    return next_to_exe;
                }
                let in_res = exe_dir.join("resources").join("node");
                if in_res.is_file() {
                    return in_res;
                }
                let in_claw = exe_dir.join("resources").join("claw-hwp").join("node");
                if in_claw.is_file() {
                    return in_claw;
                }
            }
        }
        for candidate in &["/usr/local/bin/node", "/usr/bin/node"] {
            let p = PathBuf::from(candidate);
            if p.is_file() {
                return p;
            }
        }
    }
    PathBuf::from("node")
}

#[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
fn new_node_command() -> Command {
    let node_bin = resolve_node_binary();
    let mut cmd = Command::new(node_bin);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn strip_unc_prefix(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", stripped))
    } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}

fn resolve_script_path_inner(app: &AppHandle, script_name: &str) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let up_candidate = resource_dir
            .join("_up_")
            .join("resources")
            .join("claw-hwp")
            .join("scripts")
            .join(script_name);
        if up_candidate.exists() {
            return Ok(up_candidate);
        }

        let candidate = resource_dir
            .join("resources")
            .join("claw-hwp")
            .join("scripts")
            .join(script_name);
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let portable_candidate = exe_dir
                .join("resources")
                .join("claw-hwp")
                .join("scripts")
                .join(script_name);
            if portable_candidate.exists() {
                return Ok(portable_candidate);
            }
            let portable_up = exe_dir
                .join("_up_")
                .join("resources")
                .join("claw-hwp")
                .join("scripts")
                .join(script_name);
            if portable_up.exists() {
                return Ok(portable_up);
            }
        }
    }
    let current = std::env::current_dir().map_err(|e| e.to_string())?;
    let root = if current.ends_with("src-tauri") {
        current.parent().unwrap_or(&current).to_path_buf()
    } else {
        current
    };
    let dev_path = root
        .join("resources")
        .join("claw-hwp")
        .join("scripts")
        .join(script_name);
    if dev_path.exists() {
        return Ok(dev_path);
    }
    Err(format!(
        "Script not found: {} (tried: {:?})",
        script_name, dev_path
    ))
}

fn resolve_script_path(app: &AppHandle, script_name: &str) -> Result<PathBuf, String> {
    let p = resolve_script_path_inner(app, script_name)?;
    Ok(strip_unc_prefix(p))
}

fn file_mtime_ms(path: &PathBuf) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn check_staging_status(file_path: String) -> Result<StagingStatusResult, String> {
    let p = strip_unc_prefix(PathBuf::from(file_path));
    if !p.exists() {
        return Ok(StagingStatusResult {
            exists: false,
            mtime_ms: 0,
            size: 0,
        });
    }
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    let mtime_ms = file_mtime_ms(&p);
    Ok(StagingStatusResult {
        exists: true,
        mtime_ms,
        size: meta.len(),
    })
}

#[tauri::command]
pub async fn sync_writing_memory_file(
    content: String,
    masked: Option<bool>,
) -> Result<String, String> {
    let dir = std::env::temp_dir().join("hop-claw-staging");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file_name = if masked.unwrap_or(false) {
        "active_writing_memory.masked.md"
    } else {
        "active_writing_memory.md"
    };
    let file_path = dir.join(file_name);
    std::fs::write(&file_path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn execute_agent_cli_command(
    command: String,
    staging_path: Option<String>,
    writing_memory_path: Option<String>,
    selection_json: Option<String>,
) -> Result<AgentCliExecResult, String> {
    let start = Instant::now();
    let staging_str = staging_path.unwrap_or_default();
    let staging_buf = PathBuf::from(&staging_str);
    let before_mtime = if !staging_str.is_empty() && staging_buf.exists() {
        file_mtime_ms(&staging_buf)
    } else {
        0
    };

    let current = std::env::current_dir().map_err(|e| e.to_string())?;
    let root = if current.ends_with("src-tauri") {
        current.parent().unwrap_or(&current).to_path_buf()
    } else {
        current
    };
    let skills_bin = root.join("resources").join("skills").join("bin");
    let old_path = std::env::var("PATH").unwrap_or_default();
    let sep = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    let new_path = format!("{}{}{}", skills_bin.to_string_lossy(), sep, old_path);

    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(&command);
        c
    } else {
        let mut c = Command::new("bash");
        c.arg("-c").arg(&command);
        c
    };

    cmd.current_dir(&root)
        .env("PATH", new_path)
        .env("HWP_STAGING_PATH", &staging_str)
        .env(
            "HWP_WRITING_MEMORY_PATH",
            writing_memory_path.unwrap_or_default(),
        )
        .env("HWP_SELECTION_JSON", selection_json.unwrap_or_default())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().await.map_err(|e| e.to_string())?;
    let duration_ms = start.elapsed().as_millis() as u64;
    let after_mtime = if !staging_str.is_empty() && staging_buf.exists() {
        file_mtime_ms(&staging_buf)
    } else {
        0
    };

    Ok(AgentCliExecResult {
        ok: output.status.success(),
        exit_code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        duration_ms,
        staging_modified: before_mtime > 0 && after_mtime > before_mtime,
        staging_mtime_ms: after_mtime,
    })
}

fn resolve_skill_script(app: &AppHandle, skill: &str) -> Result<PathBuf, String> {
    let rel_parts: &[&str] = match skill {
        "ref-extract" => &[
            "resources",
            "skills",
            "reference-extractor",
            "ref-extract.mjs",
        ],
        "hwp-cli" => &["resources", "skills", "hwp-document-editor", "hwp-cli.mjs"],
        _ => return Err(format!("허용되지 않은 내장 스킬입니다: {}", skill)),
    };

    if let Ok(resource_dir) = app.path().resource_dir() {
        let mut up_candidate = resource_dir.join("_up_");
        for part in rel_parts {
            up_candidate = up_candidate.join(part);
        }
        if up_candidate.exists() {
            return Ok(strip_unc_prefix(up_candidate));
        }

        let mut direct_candidate = resource_dir;
        for part in rel_parts {
            direct_candidate = direct_candidate.join(part);
        }
        if direct_candidate.exists() {
            return Ok(strip_unc_prefix(direct_candidate));
        }
    }

    let current = std::env::current_dir().map_err(|e| e.to_string())?;
    let root = if current.ends_with("src-tauri") {
        current.parent().unwrap_or(&current).to_path_buf()
    } else {
        current
    };
    let mut dev_path = root;
    for part in rel_parts {
        dev_path = dev_path.join(part);
    }
    if dev_path.exists() {
        return Ok(strip_unc_prefix(dev_path));
    }
    Err(format!(
        "Skill script not found: {} ({:?})",
        skill, dev_path
    ))
}

/// 구조화된 인자 배열로 내장 스킬(ref-extract / hwp-cli) 직접 실행 (셸 미경유, 파일명 주입 원천 차단)
#[tauri::command]
pub async fn execute_skill_command(
    app: AppHandle,
    skill: String,
    args: Vec<String>,
    staging_path: Option<String>,
    writing_memory_path: Option<String>,
    selection_json: Option<String>,
) -> Result<AgentCliExecResult, String> {
    let start = Instant::now();
    let script_path = resolve_skill_script(&app, &skill)?;
    let staging_str = staging_path.unwrap_or_default();
    let staging_buf = PathBuf::from(&staging_str);
    let before_mtime = if !staging_str.is_empty() && staging_buf.exists() {
        file_mtime_ms(&staging_buf)
    } else {
        0
    };

    let current = std::env::current_dir().map_err(|e| e.to_string())?;
    let root = if current.ends_with("src-tauri") {
        current.parent().unwrap_or(&current).to_path_buf()
    } else {
        current
    };
    let skills_bin = root.join("resources").join("skills").join("bin");
    let old_path = std::env::var("PATH").unwrap_or_default();
    let sep = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    let new_path = format!("{}{}{}", skills_bin.to_string_lossy(), sep, old_path);

    let mut cmd = new_node_command();
    cmd.arg(&script_path)
        .args(&args)
        .current_dir(&root)
        .env("PATH", new_path)
        .env("HWP_STAGING_PATH", &staging_str)
        .env(
            "HWP_WRITING_MEMORY_PATH",
            writing_memory_path.unwrap_or_default(),
        )
        .env("HWP_SELECTION_JSON", selection_json.unwrap_or_default())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().await.map_err(|e| e.to_string())?;
    let duration_ms = start.elapsed().as_millis() as u64;
    let after_mtime = if !staging_str.is_empty() && staging_buf.exists() {
        file_mtime_ms(&staging_buf)
    } else {
        0
    };

    Ok(AgentCliExecResult {
        ok: output.status.success(),
        exit_code: output.status.code().unwrap_or(1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        duration_ms,
        staging_modified: before_mtime > 0 && after_mtime > before_mtime,
        staging_mtime_ms: after_mtime,
    })
}

/// 1) 문서 구조 및 셀 텍스트 전수 검사 (extract_text.js --inspect --with-cell-text)
#[tauri::command]
pub async fn inspect_document(
    app: AppHandle,
    file_path: String,
) -> Result<serde_json::Value, String> {
    let script = resolve_script_path(&app, "extract_text.js")?;
    let file_path = strip_unc_prefix(PathBuf::from(file_path));
    let output = new_node_command()
        .arg(&script)
        .arg("--inspect")
        .arg("--with-cell-text")
        .arg(&file_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to spawn node extract_text.js: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let stdout_str = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout_str)
        .map_err(|e| format!("Invalid JSON from inspect: {} (raw: {})", e, stdout_str))
}

/// 2) 문서 마크다운 텍스트 추출 (extract_text.js --format markdown)
#[tauri::command]
pub async fn extract_markdown(app: AppHandle, file_path: String) -> Result<String, String> {
    let script = resolve_script_path(&app, "extract_text.js")?;
    let file_path = strip_unc_prefix(PathBuf::from(file_path));
    let output = new_node_command()
        .arg(&script)
        .arg("--format")
        .arg("markdown")
        .arg(&file_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to spawn node extract_text.js: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// 3) .hwp (create.js) 또는 .hwpx (hwpx-edit.js) 배치 패치 실행
#[tauri::command]
pub async fn execute_claw_ops(
    app: AppHandle,
    is_hwpx: bool,
    payload_json: String,
) -> Result<ClawExecResult, String> {
    let script_name = if is_hwpx { "hwpx-edit.js" } else { "create.js" };
    let script = resolve_script_path(&app, script_name)?;

    let mut cmd = new_node_command();
    cmd.kill_on_drop(true);
    let mut child = cmd
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", script_name, e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(payload_json.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        stdin.shutdown().await.map_err(|e| e.to_string())?;
    }

    let output =
        match tokio::time::timeout(std::time::Duration::from_secs(30), child.wait_with_output())
            .await
        {
            Ok(res) => res.map_err(|e| e.to_string())?,
            Err(_) => {
                return Err(
                    "claw 실행 타임아웃: 30초 내에 프로세스가 응답하지 않았습니다.".to_string(),
                );
            }
        };
    let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();

    let parsed: serde_json::Value = serde_json::from_str(&stdout_str).unwrap_or_else(|_| {
        serde_json::json!({ "status": "error", "raw_stdout": stdout_str, "stderr": stderr_str })
    });

    let ok = output.status.success()
        && (parsed.get("status").and_then(|v| v.as_str()) == Some("success")
            || parsed.get("ok").and_then(|v| v.as_bool()) == Some(true));

    Ok(ClawExecResult {
        ok,
        stdout_json: parsed,
        stderr: stderr_str,
    })
}
