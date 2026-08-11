use anyhow::{Context, Result};
use calamine::{open_workbook_auto, DataType, Reader};
use clap::{Parser, Subcommand};
use pdf_extract::extract_text as extract_pdf_text;
use quick_xml::Reader as XmlReader;
use quick_xml::events::Event;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH, Instant};
use std::thread;
use walkdir::WalkDir;
use zip::ZipArchive;

const MAX_FILES: usize = usize::MAX;
const MAX_FILE_SIZE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 20_000;
const RATE_LIMIT_BATCH: usize = 400;
const RATE_LIMIT_WINDOW_MS: u64 = 90_000;

fn unlimited_indexing() -> bool {
    std::env::var("INDEXER_UNLIMITED").ok().as_deref() == Some("1")
}

fn max_file_size_bytes() -> u64 {
    std::env::var("INDEXER_MAX_FILE_SIZE_MB")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(|mb| mb.max(1) * 1024 * 1024)
        .unwrap_or(MAX_FILE_SIZE_BYTES)
}

#[derive(Parser)]
#[command(name = "rust-indexer")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Index {
        #[arg(long)]
        index: String,
        #[arg(long)]
        root: Vec<String>,
    },
    Search {
        #[arg(long)]
        index: String,
        #[arg(long)]
        query: String,
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
}

#[derive(Serialize, Deserialize, Clone)]
struct FileRecord {
    path: String,
    name: String,
    ext: String,
    size: u64,
    mtime_ms: i64,
    text: String,
}

#[derive(Serialize, Deserialize)]
struct IndexData {
    version: u32,
    updated_at: String,
    files: HashMap<String, FileRecord>,
}

fn is_supported(ext: &str) -> bool {
    matches!(ext, ".txt" | ".md" | ".pdf" | ".docx" | ".xlsx")
}

fn should_ignore(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | ".svn"
            | ".hg"
            | ".DS_Store"
            | "Library"
            | "System Volume Information"
            | "$RECYCLE.BIN"
    )
}


fn now_ts() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}", ms)
}

fn mtime_ms(path: &Path) -> Result<i64> {
    let metadata = fs::metadata(path)?;
    let modified = metadata.modified()?;
    let duration = modified.duration_since(UNIX_EPOCH)?;
    Ok(duration.as_millis() as i64)
}

fn read_txt(path: &Path) -> Result<String> {
    let text = fs::read_to_string(path)?;
    Ok(text.chars().take(MAX_TEXT_CHARS).collect())
}

fn read_pdf(path: &Path) -> Result<String> {
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let text = std::panic::catch_unwind(|| extract_pdf_text(path))
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or_default();
    std::panic::set_hook(prev_hook);
    Ok(text.chars().take(MAX_TEXT_CHARS).collect())
}



fn read_docx(path: &Path) -> Result<String> {
    let file = fs::File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut doc = archive.by_name("word/document.xml")?;
    let mut xml = String::new();
    doc.read_to_string(&mut xml)?;

    let mut reader = XmlReader::from_str(&xml);
    reader.trim_text(true);
    let mut buf = Vec::new();
    let mut out = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Text(e)) => {
                if let Ok(text) = e.unescape() {
                    out.push_str(&text);
                    out.push_str(" ");
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
        if out.len() >= MAX_TEXT_CHARS {
            break;
        }
    }

    Ok(out.chars().take(MAX_TEXT_CHARS).collect())
}

fn read_xlsx(path: &Path) -> Result<String> {
    let mut workbook = open_workbook_auto(path)?;
    let mut out = String::new();

    for sheet_name in workbook.sheet_names().to_owned() {
        if let Some(Ok(range)) = workbook.worksheet_range(&sheet_name) {
            for row in range.rows() {
                for cell in row {
                    match cell {
                        DataType::String(s) => {
                            out.push_str(s);
                            out.push_str(" ");
                        }
                        DataType::Float(f) => {
                            out.push_str(&f.to_string());
                            out.push_str(" ");
                        }
                        DataType::Int(i) => {
                            out.push_str(&i.to_string());
                            out.push_str(" ");
                        }
                        DataType::Bool(b) => {
                            out.push_str(&b.to_string());
                            out.push_str(" ");
                        }
                        _ => {}
                    }
                }
                if out.len() >= MAX_TEXT_CHARS {
                    break;
                }
            }
        }
        if out.len() >= MAX_TEXT_CHARS {
            break;
        }
    }

    Ok(out.chars().take(MAX_TEXT_CHARS).collect())
}

fn extract_text(path: &Path, ext: &str) -> Result<String> {
    match ext {
        ".txt" | ".md" => read_txt(path),
        ".pdf" => read_pdf(path),
        ".docx" => read_docx(path),
        ".xlsx" => read_xlsx(path),
        _ => Ok(String::new()),
    }
}

fn walk_candidates(roots: &[String], max_size: u64) -> (Vec<PathBuf>, HashMap<String, usize>) {
    let mut files = Vec::new();
    let mut by_ext: HashMap<String, usize> = HashMap::new();
    for root in roots {
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if entry.file_type().is_dir() {
                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                    if should_ignore(name) {
                        continue;
                    }
                }
                continue;
            }
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                if name.starts_with(".") || should_ignore(name) {
                    continue;
                }
            }
            let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
            let ext = format!(".{}", ext.to_lowercase());
            if !is_supported(&ext) {
                continue;
            }
            if let Ok(meta) = fs::metadata(path) {
                if meta.len() > max_size {
                    continue;
                }
            }
            let ext_key = ext.clone();
            *by_ext.entry(ext_key).or_insert(0) += 1;
            files.push(path.to_path_buf());
        }
    }
    (files, by_ext)
}

fn load_index(index_path: &Path) -> IndexData {
    if let Ok(raw) = fs::read_to_string(index_path) {
        if let Ok(index) = serde_json::from_str(&raw) {
            return index;
        }
    }
    IndexData {
        version: 1,
        updated_at: now_ts(),
        files: HashMap::new(),
    }
}

fn save_index(index_path: &Path, index: &IndexData) -> Result<()> {
    if let Some(parent) = index_path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string(index)?;
    fs::write(index_path, json)?;
    Ok(())
}

fn write_report(index_path: &Path, scanned: usize, total: usize, by_ext: &HashMap<String, usize>, scanned_by_ext: &HashMap<String, usize>) {
    let report = serde_json::json!({
        "updatedAt": now_ts(),
        "scanned": scanned,
        "total": total,
        "byExt": by_ext,
        "scannedByExt": scanned_by_ext
    });
    let report_path = index_path.with_file_name(
        index_path.file_stem().unwrap_or_default().to_string_lossy().to_string() + "-report.json"
    );
    let _ = fs::write(report_path, serde_json::to_string_pretty(&report).unwrap_or_default());
}

fn run_index(index_path: &Path, roots: &[String]) -> Result<()> {
    let mut index = load_index(index_path);
    let max_size = max_file_size_bytes();
    let (candidates, by_ext) = walk_candidates(roots, max_size);
    let total = candidates.len().min(MAX_FILES);
    let mut seen = HashSet::new();
    let mut scanned = 0usize;
    let mut scanned_by_ext: HashMap<String, usize> = HashMap::new();
    let mut batch_start = Instant::now();
    let mut batch_count = 0usize;
    println!("{}", serde_json::json!({"type":"progress","scanned":0,"total":total,"byExt":by_ext,"scannedByExt":scanned_by_ext}).to_string());

    for path in candidates.into_iter().take(MAX_FILES) {
        let meta = fs::metadata(&path)?;
        let mtime = mtime_ms(&path)?;
        let ext = format!(
            ".{}",
            path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase()
        );
        let ext_key = ext.clone();
        let key = path.to_string_lossy().to_string();
        seen.insert(key.clone());

        if let Some(existing) = index.files.get(&key) {
            if existing.mtime_ms == mtime && existing.size == meta.len() {
                scanned += 1;
                *scanned_by_ext.entry(ext_key.clone()).or_insert(0) += 1;
                batch_count += 1;
                if batch_count >= RATE_LIMIT_BATCH {
                    let elapsed = batch_start.elapsed().as_millis() as u64;
                    if !unlimited_indexing() && elapsed < RATE_LIMIT_WINDOW_MS {
                    let wait_ms = RATE_LIMIT_WINDOW_MS - elapsed;
                    println!("{}", serde_json::json!({"type":"throttle","waitMs":wait_ms}).to_string());
                    thread::sleep(std::time::Duration::from_millis(wait_ms));
                }                    batch_start = Instant::now();
                    batch_count = 0;
                }
                if scanned % 50 == 0 {
                    println!("{}", serde_json::json!({"type":"progress","scanned":scanned,"total":total,"byExt":by_ext,"scannedByExt":scanned_by_ext}).to_string());
                }
                continue;
            }
        }

        let text = extract_text(&path, &ext).unwrap_or_default();
        let record = FileRecord {
            path: key.clone(),
            name: path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string(),
            ext,
            size: meta.len(),
            mtime_ms: mtime,
            text,
        };
        index.files.insert(key, record);

        scanned += 1;
        *scanned_by_ext.entry(ext_key.clone()).or_insert(0) += 1;
        batch_count += 1;
        if batch_count >= RATE_LIMIT_BATCH {
            let elapsed = batch_start.elapsed().as_millis() as u64;
            if !unlimited_indexing() && elapsed < RATE_LIMIT_WINDOW_MS {
                    let wait_ms = RATE_LIMIT_WINDOW_MS - elapsed;
                    println!("{}", serde_json::json!({"type":"throttle","waitMs":wait_ms}).to_string());
                    thread::sleep(std::time::Duration::from_millis(wait_ms));
                }            batch_start = Instant::now();
            batch_count = 0;
        }
        if scanned % 50 == 0 {
            println!("{}", serde_json::json!({"type":"progress","scanned":scanned,"total":total,"byExt":by_ext,"scannedByExt":scanned_by_ext}).to_string());
        }
    }

    index.files.retain(|k, _| seen.contains(k));
    index.updated_at = now_ts();

    save_index(index_path, &index)?;
    write_report(index_path, scanned, total, &by_ext, &scanned_by_ext);
    println!("{}", serde_json::json!({"type":"progress","scanned":scanned,"total":total,"byExt":by_ext,"scannedByExt":scanned_by_ext}).to_string());
    println!("{}", serde_json::json!({"type":"status","state":"ready"}).to_string());
    Ok(())
}

fn run_search(index_path: &Path, query: &str, limit: usize) -> Result<()> {
    let index = load_index(index_path);
    let q = query.to_lowercase();
    let mut results: Vec<(i32, &FileRecord)> = Vec::new();

    for item in index.files.values() {
        let name_match = item.name.to_lowercase().contains(&q);
        let path_match = item.path.to_lowercase().contains(&q);
        let text_match = item.text.to_lowercase().contains(&q);
        if name_match || path_match || text_match {
            let score = (name_match as i32) * 3 + (path_match as i32) + (text_match as i32);
            results.push((score, item));
        }
    }

    results.sort_by(|a, b| b.0.cmp(&a.0));
    let payload: Vec<serde_json::Value> = results
        .into_iter()
        .take(limit)
        .map(|(score, item)| {
            let snippet = if item.text.is_empty() {
                String::new()
            } else {
                let lower = item.text.to_lowercase();
                if let Some(idx) = lower.find(&q) {
                    let start = idx.saturating_sub(60);
                    let end = (idx + q.len() + 80).min(item.text.len());
                    item.text[start..end].replace("\n", " ")
                } else {
                    item.text.chars().take(160).collect()
                }
            };
            serde_json::json!({
                "title": item.name,
                "path": item.path,
                "snippet": snippet,
                "score": score
            })
        })
        .collect();

    println!("{}", serde_json::to_string(&payload)?);
    Ok(())
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Index { index, root } => {
            let index_path = PathBuf::from(index);
            run_index(&index_path, &root).context("index failed")?;
        }
        Commands::Search { index, query, limit } => {
            let index_path = PathBuf::from(index);
            run_search(&index_path, &query, limit).context("search failed")?;
        }
    }
    Ok(())
}
