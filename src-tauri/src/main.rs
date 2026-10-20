// Coque de bureau de Pulse : affiche le studio web dans une fenêtre native
// et lui prête le moteur audio Rust (lecture temps réel sur la carte son).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use pulse_engine::{file, player::Player, render};
use serde::Serialize;
use std::io::Cursor;
use std::sync::Mutex;
use tauri::{ipc::{InvokeBody, Request}, Emitter, Manager, State};

#[derive(Serialize)]
struct Info {
    /// Fréquence de la sortie audio (0 = aucune sortie)
    rate: u32,
    playing: bool,
    position: f64,
    duration: f64,
    error: Option<String>,
}

#[tauri::command]
fn native_info(player: State<Player>) -> Info {
    Info {
        rate: player.output_rate(),
        playing: player.is_playing(),
        position: player.position(),
        duration: player.duration(),
        error: player.take_error(),
    }
}

/// Reçoit un .pulse (octets bruts), le mixe à la fréquence de la carte son et le joue depuis `from` (en-tête, secondes).
#[tauri::command]
async fn native_play(player: State<'_, Player>, request: Request<'_>) -> Result<f64, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("le projet doit arriver en octets bruts".into());
    };
    let bytes = bytes.clone();
    let from: f64 = request.headers().get("from").and_then(|v| v.to_str().ok()).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let rate = player.output_rate();
    if rate == 0 {
        return Err("aucune sortie audio trouvée — branche un casque ou des enceintes".into());
    }
    let (left, right) = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        let (project, media) = file::open(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        let opts = render::RenderOptions { sample_rate: rate, ..Default::default() };
        Ok(render::render(&project, &media, &opts))
    })
    .await
    .map_err(|e| e.to_string())??;
    if left.is_empty() {
        return Err("le projet ne contient aucun son à jouer".into());
    }
    let duration = left.len() as f64 / rate as f64;
    player.play(left, right, (from.max(0.0) * rate as f64) as usize);
    Ok(duration)
}

#[tauri::command]
fn native_stop(player: State<Player>) {
    player.stop();
}

// === Claviers MIDI USB ===
// La fenêtre de l'appli (WebKit) n'a pas « Web MIDI » : Rust écoute les claviers (CoreMIDI) et envoie chaque message
// à la page par l'événement `pulse-midi`, comme le ferait le navigateur.
#[derive(Serialize, Clone)]
struct MidiMsg {
    port: usize,
    data: Vec<u8>,
}

struct Midi(Mutex<Vec<midir::MidiInputConnection<()>>>);

fn midi_names() -> Vec<String> {
    let Ok(probe) = midir::MidiInput::new("Pulse") else { return vec![] };
    probe.ports().iter().filter_map(|p| probe.port_name(p).ok()).collect()
}

/// Noms des claviers branchés (dans l'ordre des ports)
#[tauri::command]
fn midi_ports() -> Vec<String> {
    midi_names()
}

/// (Ré)ouvre tous les claviers branchés ; renvoie leurs noms
#[tauri::command]
fn midi_start(app: tauri::AppHandle, midi: State<Midi>) -> Vec<String> {
    let mut conns = midi.0.lock().unwrap();
    conns.clear(); // fermer les anciennes connexions
    let names = midi_names();
    for i in 0..names.len() {
        let Ok(mut input) = midir::MidiInput::new("Pulse (entrée)") else { continue };
        input.ignore(midir::Ignore::TimeAndActiveSense);
        let ports = input.ports();
        let Some(port) = ports.get(i) else { continue };
        let handle = app.clone();
        if let Ok(conn) = input.connect(port, &format!("pulse-{i}"), move |_, msg, _| {
            let _ = handle.emit("pulse-midi", MidiMsg { port: i, data: msg.to_vec() });
        }, ()) {
            conns.push(conn);
        }
    }
    names
}

// === Dossier de projet (façon Logic) ===
// Le studio (page web) n'a pas le droit d'écrire sur le disque : c'est Rust qui le fait, mais seulement
//  - dans un dossier que l'utilisateur vient de choisir lui-même (boîte de dialogue du système),
//  - ou dans un dossier de projet Pulse déjà créé (il porte un fichier repère `.pulse-projet`).
const MARKER: &str = ".pulse-projet";

/// Dossier parent choisi dans la boîte de dialogue (c'est le seul endroit où l'on peut créer un dossier de projet)
struct PickedRoot(Mutex<Option<std::path::PathBuf>>);

fn clean_prompt(s: &str) -> String {
    s.chars().filter(|c| !matches!(c, '"' | '\\' | '\'' | '`' | '$' | '\n' | '\r')).take(120).collect()
}

fn choose_folder(prompt: &str) -> Option<String> {
    let prompt = clean_prompt(prompt);
    #[cfg(target_os = "macos")]
    {
        let script = format!("POSIX path of (choose folder with prompt \"{prompt}\")");
        let out = std::process::Command::new("osascript").arg("-e").arg(script).output().ok()?;
        if !out.status.success() {
            return None; // « Annuler »
        }
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        return if p.is_empty() { None } else { Some(p) };
    }
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '{prompt}'; if ($d.ShowDialog() -eq 'OK') {{ $d.SelectedPath }}"
        );
        let out = std::process::Command::new("powershell").args(["-NoProfile", "-STA", "-Command", &script]).output().ok()?;
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        return if p.is_empty() { None } else { Some(p) };
    }
    #[allow(unreachable_code)]
    {
        let _ = prompt;
        None
    }
}

/// Boîte de dialogue « choisir un dossier » ; renvoie son chemin, ou rien si on annule
#[tauri::command]
async fn pick_folder(root: State<'_, PickedRoot>, prompt: String) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || choose_folder(&prompt)).await.map_err(|e| e.to_string())?;
    if let Some(p) = &picked {
        *root.0.lock().unwrap() = Some(std::path::PathBuf::from(p));
    }
    Ok(picked)
}

fn safe_name(name: &str) -> String {
    let n: String = name.chars().map(|c| if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '\'' | '(' | ')') { c } else { '_' }).collect();
    let n = n.trim().trim_matches('.').to_string();
    if n.is_empty() { "Projet Pulse".into() } else { n.chars().take(80).collect() }
}

/// Crée « <parent>/<nom>/ » avec Bounces/ (un numéro est ajouté si le nom existe déjà) ; renvoie son chemin
#[tauri::command]
fn create_project_folder(root: State<PickedRoot>, parent: String, name: String) -> Result<String, String> {
    let parent = std::path::PathBuf::from(parent);
    if root.0.lock().unwrap().as_ref() != Some(&parent) {
        return Err("choisis d'abord l'endroit où ranger le projet".into());
    }
    let base = safe_name(&name);
    let mut dir = parent.join(&base);
    let mut n = 2;
    while dir.exists() {
        dir = parent.join(format!("{base} {n}"));
        n += 1;
    }
    // Audio/ n'est créé que si l'utilisateur demande les copies WAV (le .pulse contient déjà les sons)
    std::fs::create_dir_all(dir.join("Bounces")).map_err(|e| format!("impossible de créer le dossier : {e}"))?;
    std::fs::write(dir.join(MARKER), b"Dossier de projet Pulse\n").map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Ce dossier de projet existe-t-il encore (et est-ce bien un dossier Pulse) ?
#[tauri::command]
fn project_folder_ok(dir: String) -> bool {
    std::path::Path::new(&dir).join(MARKER).is_file()
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 3 <= b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Écrit un fichier (octets bruts) dans un dossier de projet Pulse. En-têtes : `dir` (dossier du projet), `path` (chemin relatif, encodé)
#[tauri::command]
async fn save_file(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("le fichier doit arriver en octets bruts".into());
    };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(percent_decode).unwrap_or_default();
    let dir = std::path::PathBuf::from(header("dir"));
    let rel = header("path");
    if !dir.join(MARKER).is_file() {
        return Err("ce n'est pas un dossier de projet Pulse".into());
    }
    let rel_path = std::path::Path::new(&rel);
    if rel.is_empty() || rel_path.is_absolute() || rel_path.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return Err("chemin de fichier refusé".into());
    }
    let target = dir.join(rel_path);
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, &bytes).map_err(|e| format!("écriture impossible : {e}"))?;
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Montre le dossier du projet dans le Finder / l'Explorateur
#[tauri::command]
fn reveal_project_folder(dir: String) -> Result<(), String> {
    let d = std::path::PathBuf::from(&dir);
    if !d.join(MARKER).is_file() {
        return Err("ce n'est pas un dossier de projet Pulse".into());
    }
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd).arg(d).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// === Ouvrir un fichier .pulse en double-cliquant dessus (Finder / Explorateur) ===
// Le système donne le chemin à l'appli (macOS : événement « Opened » ; Windows : argument de la ligne de commande).
// On le garde en réserve (la page n'est peut-être pas encore chargée) et on prévient la page par l'événement `pulse-open-file`.
struct PendingOpen(Mutex<Vec<String>>);

/// Les fichiers .pulse reçus du système pendant que la page se chargeait (la liste se vide à la lecture)
#[tauri::command]
fn take_pending_open(p: State<PendingOpen>) -> Vec<String> {
    std::mem::take(&mut *p.0.lock().unwrap())
}

/// Lit un fichier .pulse (octets bruts, sans passer par du JSON)
#[tauri::command]
fn read_pulse_file(path: String) -> Result<tauri::ipc::Response, String> {
    let p = std::path::Path::new(&path);
    if p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("pulse")) != Some(true) {
        return Err("ce n'est pas un fichier .pulse".into());
    }
    let bytes = std::fs::read(p).map_err(|e| format!("lecture impossible : {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

// === Import d'une instru par lien (YouTube / SoundCloud) avec yt-dlp ===
// yt-dlp n'est pas dans l'installateur : on le cherche à côté de Pulse, puis dans le dossier de Pulse
// (téléchargé une seule fois depuis le dépôt officiel au 1er usage), puis dans le PATH.
// On prend la meilleure piste audio en .m4a (AAC) : lisible par Chrome, WebView2 et WebKit, sans ffmpeg.
use std::path::PathBuf;
use std::process::Command;

fn ytdlp_name() -> &'static str { if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" } }

fn ytdlp_download_url() -> Option<&'static str> {
    if cfg!(target_os = "windows") { Some("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe") }
    else if cfg!(target_os = "macos") { Some("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos") }
    else if cfg!(target_os = "linux") { Some("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux") }
    else { None }
}

/// Sous Windows, une commande lancée depuis l'appli ne doit pas ouvrir de fenêtre noire
fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn find_ytdlp(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.to_path_buf())) {
        let p = dir.join(ytdlp_name());
        if p.is_file() { return Some(p); }
    }
    if let Ok(dir) = app.path().app_local_data_dir() {
        let p = dir.join(ytdlp_name());
        if p.is_file() { return Some(p); }
    }
    let probe = quiet(Command::new(ytdlp_name()).arg("--version")).output();
    if matches!(probe, Ok(ref o) if o.status.success()) { return Some(PathBuf::from(ytdlp_name())); }
    None
}

fn install_ytdlp(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let url = ytdlp_download_url().ok_or("l'import par lien n'est pas disponible sur ce système")?;
    let dir = app.path().app_local_data_dir().map_err(|e| format!("dossier de Pulse introuvable : {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("dossier de Pulse impossible à créer : {e}"))?;
    let target = dir.join(ytdlp_name());
    let tmp = dir.join(format!("{}.part", ytdlp_name()));
    let status = quiet(Command::new("curl").args(["-L", "--fail", "-s", "-o"]).arg(&tmp).arg(url))
        .status()
        .map_err(|e| format!("curl introuvable : {e}"))?;
    if !status.success() || !tmp.is_file() {
        let _ = std::fs::remove_file(&tmp);
        return Err("impossible de télécharger l'outil d'import (vérifie ta connexion internet)".into());
    }
    std::fs::rename(&tmp, &target).map_err(|e| format!("installation de l'outil d'import impossible : {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    }
    Ok(target)
}

/// Seulement YouTube et SoundCloud, en https
fn url_allowed(url: &str) -> bool {
    let Some(rest) = url.trim().strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    matches!(host, "youtube.com" | "m.youtube.com" | "music.youtube.com" | "youtu.be" | "soundcloud.com" | "m.soundcloud.com" | "on.soundcloud.com")
}

fn import_dir() -> PathBuf { std::env::temp_dir().join("pulse-import") }

/// Télécharge la piste audio d'un lien et renvoie le chemin du fichier (dans un dossier temporaire réservé à Pulse)
#[tauri::command]
async fn import_url(app: tauri::AppHandle, url: String) -> Result<String, String> {
    if !url_allowed(&url) {
        return Err("lien non accepté : colle un lien YouTube ou SoundCloud (https://…)".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let bin = match find_ytdlp(&app) { Some(b) => b, None => install_ytdlp(&app)? };
        let dir = import_dir();
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| format!("dossier temporaire impossible à créer : {e}"))?;
        // --force-ipv4 : sur certains réseaux, yt-dlp reste bloqué indéfiniment en IPv6 (constaté sur le PC le 18/10/2026)
        // Les messages d'erreur vont dans un fichier (lire stdout/stderr pendant l'attente pourrait tout bloquer)
        let log = std::env::temp_dir().join("pulse-import.log");
        let log_file = std::fs::File::create(&log).map_err(|e| format!("journal d'import impossible à créer : {e}"))?;
        let mut child = quiet(Command::new(&bin)
            .args(["-f", "bestaudio[ext=m4a]/bestaudio", "--no-playlist", "--no-progress", "--restrict-filenames",
                   "--force-ipv4", "--socket-timeout", "20", "--retries", "3", "-o"])
            .arg(dir.join("%(title).80s.%(ext)s"))
            .arg(url.trim())
            .stdout(std::process::Stdio::null())
            .stderr(log_file))
            .spawn()
            .map_err(|e| format!("l'outil d'import n'a pas pu démarrer : {e}"))?;
        // Jamais plus de 5 minutes : au-delà, on arrête et on le dit
        let start = std::time::Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(st)) => break st,
                Ok(None) if start.elapsed() > std::time::Duration::from_secs(300) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("le téléchargement prend trop de temps (plus de 5 minutes) : réessaie, ou télécharge l'instru et dépose le fichier".into());
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(250)),
                Err(e) => return Err(format!("l'outil d'import s'est arrêté : {e}")),
            }
        };
        if !status.success() {
            let err = std::fs::read_to_string(&log).unwrap_or_default();
            let last = err.lines().filter(|l| l.contains("ERROR")).last()
                .or_else(|| err.lines().filter(|l| !l.trim().is_empty()).last())
                .unwrap_or("erreur inconnue").trim().to_string();
            return Err(format!("téléchargement impossible : {last}"));
        }
        let file = std::fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .find(|p| p.is_file() && p.extension().and_then(|x| x.to_str()) != Some("part"))
            .ok_or("le son n'a pas été trouvé après le téléchargement")?;
        Ok(file.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lit le fichier téléchargé par import_url (octets bruts) — seulement dans le dossier d'import de Pulse
#[tauri::command]
fn read_import_file(path: String) -> Result<tauri::ipc::Response, String> {
    let root = std::fs::canonicalize(import_dir()).map_err(|_| "aucun import en cours".to_string())?;
    let p = std::fs::canonicalize(&path).map_err(|e| format!("fichier introuvable : {e}"))?;
    if !p.starts_with(&root) {
        return Err("fichier hors du dossier d'import".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| format!("lecture impossible : {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Pour les tests automatiques (PULSE_TEST=1) : écrit une ligne sur la sortie standard
#[tauri::command]
fn test_log(text: String) {
    if std::env::var_os("PULSE_TEST").is_some() {
        println!("{text}");
    }
}

#[tauri::command]
fn test_exit(app: tauri::AppHandle) {
    if std::env::var_os("PULSE_TEST").is_some() {
        app.exit(0);
    }
}

fn main() {
    let mut context = tauri::generate_context!();
    // Test automatique : fenêtre invisible, pour ne rien afficher à l'écran
    if std::env::var_os("PULSE_TEST").is_some() {
        for w in context.config_mut().app.windows.iter_mut() {
            w.visible = false;
        }
    }
    // Windows / Linux : le fichier double-cliqué arrive en argument
    let pending: Vec<String> = std::env::args().skip(1).filter(|a| a.to_lowercase().ends_with(".pulse")).collect();
    tauri::Builder::default()
        .manage(Player::new())
        .manage(PendingOpen(Mutex::new(pending)))
        .manage(Midi(Mutex::new(Vec::new())))
        .manage(PickedRoot(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![native_info, native_play, native_stop, midi_ports, midi_start, pick_folder, create_project_folder, project_folder_ok, save_file, reveal_project_folder, take_pending_open, read_pulse_file, import_url, read_import_file, test_log, test_exit])
        .build(context)
        .expect("Pulse n'a pas pu démarrer la fenêtre")
        .run(|app, event| {
            // macOS : double-clic sur un .pulse (appli fermée ou déjà ouverte)
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for u in urls {
                    if let Ok(path) = u.to_file_path() {
                        let path = path.to_string_lossy().into_owned();
                        if path.to_lowercase().ends_with(".pulse") {
                            app.state::<PendingOpen>().0.lock().unwrap().push(path.clone());
                            let _ = app.emit("pulse-open-file", path);
                        }
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
