// Coque de bureau de Pulse : affiche le studio web dans une fenêtre native
// et lui prête le moteur audio Rust (lecture temps réel sur la carte son).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use pulse_engine::{file, monitor::{Monitor, MonitorInfo}, player::Player, render};
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
    /// Moments où le mixeur n'a pas suivi (réserve vide) depuis le début de la lecture
    underruns: u64,
    /// Dernière lecture lancée avec « projet » (sons déjà gardés) ou « pulse » (tout le fichier, sons compris)
    via: String,
    /// Nombre de lectures lancées (un changement de mix pris en direct ne relance rien)
    plays: u64,
}

#[tauri::command]
fn native_info(player: State<Player>, sounds: State<Sounds>) -> Info {
    Info {
        rate: player.output_rate(),
        playing: player.is_playing(),
        position: player.position(),
        duration: player.duration(),
        error: player.take_error(),
        underruns: player.underruns(),
        via: sounds.1.lock().unwrap().clone(),
        plays: player.plays(),
    }
}

/// Reçoit un .pulse (octets bruts), le mixe à la fréquence de la carte son et le joue depuis `from` (en-tête, secondes).
#[tauri::command]
async fn native_play(player: State<'_, Player>, sounds: State<'_, Sounds>, request: Request<'_>) -> Result<f64, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("le projet doit arriver en octets bruts".into());
    };
    let bytes = bytes.clone();
    let from: f64 = request.headers().get("from").and_then(|v| v.to_str().ok()).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    // boucle « début,fin » en secondes (en-tête facultatif)
    let lp: Option<(f64, f64)> = request.headers().get("loop").and_then(|v| v.to_str().ok()).and_then(|s| {
        let (a, b) = s.split_once(',')?;
        Some((a.trim().parse().ok()?, b.trim().parse().ok()?))
    });
    play_pulse_bytes(&player, &sounds, bytes, from, lp).await
}

/// Même chose que native_play, avec le .pulse déposé morceau par morceau (stage_put) : page en ligne
#[tauri::command]
async fn native_play_staged(player: State<'_, Player>, sounds: State<'_, Sounds>, stage: State<'_, Stage>, id: String, from: f64, lp: Option<(f64, f64)>) -> Result<f64, String> {
    let bytes = stage.take(&id)?;
    play_pulse_bytes(&player, &sounds, bytes, from, lp).await
}

async fn play_pulse_bytes(player: &Player, sounds: &Sounds, bytes: Vec<u8>, from: f64, lp: Option<(f64, f64)>) -> Result<f64, String> {
    let rate = player.output_rate();
    if rate == 0 {
        return Err("aucune sortie audio trouvée — branche un casque ou des enceintes".into());
    }
    // On ne prépare que le mixeur (les sons sont décodés, rien n'est mixé d'avance) : la lecture démarre tout de suite.
    // Les sons décodés sont gardés : les relances suivantes (fader, mute…) n'envoient plus que le projet (native_play_project).
    let cache = sounds.0.clone();
    let (renderer, media) = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        let (project, media, sizes) = file::open_sized(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        *cache.lock().unwrap() = media.iter().map(|(id, s)| (id.clone(), (sizes.get(id).copied().unwrap_or(0), s.clone()))).collect();
        let r = looped_renderer(&project, &media, rate, from, lp);
        Ok((r, media))
    })
    .await
    .map_err(|e| e.to_string())??;
    *sounds.1.lock().unwrap() = "pulse".into();
    start_stream(player, renderer, media, from, rate)
}

// === Fichiers envoyés en morceaux ===
// Depuis la page en ligne (appnco.app), macOS refuse le canal rapide et Tauri passe par un canal de secours
// qui n'accepte que du texte : la page envoie alors les octets en base64, par morceaux de quelques Mo,
// recollés ici avant d'écrire le fichier ou de lancer la lecture.
struct Stage(Mutex<std::collections::HashMap<String, Vec<u8>>>);
impl Stage {
    fn take(&self, id: &str) -> Result<Vec<u8>, String> {
        self.0.lock().unwrap().remove(id).ok_or_else(|| "fichier envoyé introuvable".to_string())
    }
}

/// Ajoute un morceau (base64) au fichier en cours d'envoi `id` ; `first` = on repart de zéro
#[tauri::command]
fn stage_put(stage: State<Stage>, id: String, first: bool, data: String) -> Result<usize, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(|e| format!("morceau abîmé : {e}"))?;
    let mut map = stage.0.lock().unwrap();
    if first {
        map.retain(|k, _| k == &id); // un envoi interrompu ne garde pas sa mémoire
        map.insert(id.clone(), Vec::new());
    }
    let buf = map.get_mut(&id).ok_or("envoi non commencé")?;
    buf.extend_from_slice(&bytes);
    Ok(buf.len())
}

/// Sons du projet déjà décodés (identifiant → taille du WAV, son), gardés entre deux lectures
struct Sounds(std::sync::Arc<Mutex<std::collections::HashMap<String, (u64, render::Source)>>>, Mutex<String>);

/// Relance la lecture avec le projet seul (JSON) et les sons déjà gardés. `sizes` = taille du WAV de chaque son utilisé :
/// s'il en manque un (ou qu'il a changé), erreur « sons manquants » et la page renvoie tout le .pulse.
#[tauri::command]
async fn native_play_project(player: State<'_, Player>, sounds: State<'_, Sounds>, json: String, sizes: std::collections::HashMap<String, u64>, from: f64, lp: Option<(f64, f64)>) -> Result<f64, String> {
    let rate = player.output_rate();
    if rate == 0 {
        return Err("aucune sortie audio trouvée — branche un casque ou des enceintes".into());
    }
    let cache = sounds.0.clone();
    let (renderer, media) = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        let project: pulse_engine::model::Project = serde_json::from_str(&json).map_err(|e| format!("projet illisible : {e}"))?;
        let media: render::Media = {
            let c = cache.lock().unwrap();
            let mut m = render::Media::new();
            for (id, size) in &sizes {
                match c.get(id) {
                    Some((s, src)) if s == size => { m.insert(id.clone(), src.clone()); }
                    _ => return Err("sons manquants".to_string()),
                }
            }
            m
        };
        let r = looped_renderer(&project, &media, rate, from, lp);
        Ok((r, media))
    })
    .await
    .map_err(|e| e.to_string())??;
    *sounds.1.lock().unwrap() = "projet".into();
    start_stream(&player, renderer, media, from, rate)
}

/// Projet changé pendant la lecture (effet ajouté, réglage de plugin, région…) : nouveau mixeur pris en fondu enchaîné
/// de 20 ms, même position, même boucle, sans arrêt. Erreur « sons manquants » ou « pas en lecture » → la page relance normalement.
#[tauri::command]
async fn native_swap(player: State<'_, Player>, sounds: State<'_, Sounds>, json: String, sizes: std::collections::HashMap<String, u64>) -> Result<(), String> {
    let rate = player.output_rate();
    if rate == 0 || !player.is_playing() { return Err("pas en lecture".into()); }
    let cache = sounds.0.clone();
    let (renderer, media) = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        let project: pulse_engine::model::Project = serde_json::from_str(&json).map_err(|e| format!("projet illisible : {e}"))?;
        let media: render::Media = {
            let c = cache.lock().unwrap();
            let mut m = render::Media::new();
            for (id, size) in &sizes {
                match c.get(id) {
                    Some((s, src)) if s == size => { m.insert(id.clone(), src.clone()); }
                    _ => return Err("sons manquants".to_string()),
                }
            }
            m
        };
        // part du début du morceau : le lecteur le cale lui-même sur l'instant en cours
        let opts = render::RenderOptions { sample_rate: rate, start: 0.0, ..Default::default() };
        Ok((render::Renderer::new(&project, &media, &opts), media))
    })
    .await
    .map_err(|e| e.to_string())??;
    if player.swap(renderer, std::sync::Arc::new(media)) { Ok(()) } else { Err("pas en lecture".into()) }
}

/// Mixeur qui part de `from` ; avec une boucle qui commence avant, il démarre au début de la boucle puis saute à `from`
/// (pour que le premier tour de boucle ait bien tous les sons)
fn looped_renderer(project: &pulse_engine::model::Project, media: &render::Media, rate: u32, from: f64, lp: Option<(f64, f64)>) -> render::Renderer {
    let from = from.max(0.0);
    let lp = lp.map(|(a, b)| (a.min(b).max(0.0), a.max(b))).filter(|(a, b)| b - a >= 0.05);
    let first = lp.map_or(from, |(a, _)| a.min(from));
    let opts = render::RenderOptions { sample_rate: rate, start: first, ..Default::default() };
    let mut r = render::Renderer::new(project, media, &opts);
    if first < from { r.seek(from); }
    if lp.is_some() { r.set_loop(lp); }
    r
}

fn start_stream(player: &Player, renderer: render::Renderer, media: render::Media, from: f64, rate: u32) -> Result<f64, String> {
    if renderer.frames() == 0 && from <= 0.0 {
        return Err("le projet ne contient aucun son à jouer".into());
    }
    let start = (from.max(0.0) * rate as f64).round() as usize;
    let duration = (start + renderer.frames()) as f64 / rate as f64;
    player.play_stream(renderer, std::sync::Arc::new(media), start);
    Ok(duration)
}

/// Nouveau mix pendant la lecture (volumes, pan, mute / solo, envois, groupes, Master) : pris en direct, sans relancer
#[tauri::command]
fn native_mix(player: State<Player>, json: String) -> Result<(), String> {
    let project: pulse_engine::model::Project = serde_json::from_str(&json).map_err(|e| format!("projet illisible : {e}"))?;
    player.set_mix(project);
    Ok(())
}

/// Boucle posée, changée ou enlevée pendant la lecture (le mixeur la prend au bloc suivant)
#[tauri::command]
fn native_loop(player: State<Player>, lp: Option<(f64, f64)>) {
    player.set_loop(lp);
}

/// Position dans le morceau + niveaux de ce qu'on entend (vumètres) + boucle tenue par le moteur
#[derive(serde::Serialize)]
struct Live { position: f64, playing: bool, looping: bool, levels: Option<pulse_engine::player::Levels> }

#[tauri::command]
fn native_live(player: State<Player>) -> Live {
    Live { position: player.position(), playing: player.is_playing(), looping: player.loop_ok(), levels: player.levels() }
}

/// Spectre d'une fenêtre de plugin : piste (bus=false, indice) ou groupe (bus=true, indice) ; None = plus de spectre
#[tauri::command]
fn native_scope(player: State<Player>, target: Option<(bool, usize)>) {
    player.set_scope(target);
}

#[tauri::command]
fn native_stop(player: State<Player>) {
    player.stop();
}

// === Retour casque direct ===
// Le micro va droit dans le casque par le moteur natif (tampon de 64 à 256 échantillons) au lieu du moteur web.
// La page garde l'enregistrement ; ici on ne fait que le retour, qui n'entre jamais dans le mix.
#[tauri::command]
async fn monitor_start(monitor: State<'_, Monitor>, device: String, channel: usize, buffer: u32) -> Result<MonitorInfo, String> {
    let dev = if device.trim().is_empty() { None } else { Some(device) };
    let info = monitor.start(dev, channel, buffer.clamp(16, 2048));
    match &info.error { Some(e) => Err(e.clone()), None => Ok(info) }
}

#[tauri::command]
fn monitor_stop(monitor: State<Monitor>) {
    monitor.stop();
}

#[tauri::command]
fn monitor_gain(monitor: State<Monitor>, gain: f32) {
    monitor.set_gain(gain);
}

/// Piste écoutée au retour (effets, volume, pan) : `{ "track": …, "bpm": … }` ; vide = retour sec
#[tauri::command]
fn monitor_track(monitor: State<Monitor>, json: String) -> Result<(), String> {
    if json.trim().is_empty() { monitor.clear_track(); Ok(()) } else { monitor.set_track(&json) }
}

#[tauri::command]
fn monitor_info(monitor: State<Monitor>) -> MonitorInfo {
    monitor.info()
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
    write_project_file(header("dir"), header("path"), bytes.clone()).await
}

/// Même chose que save_file, avec le fichier déposé morceau par morceau (stage_put) : page en ligne
#[tauri::command]
async fn save_file_staged(stage: State<'_, Stage>, dir: String, path: String, id: String) -> Result<String, String> {
    let bytes = stage.take(&id)?;
    write_project_file(dir, path, bytes).await
}

async fn write_project_file(dir: String, rel: String, bytes: Vec<u8>) -> Result<String, String> {
    let dir = std::path::PathBuf::from(dir);
    if !dir.join(MARKER).is_file() {
        return Err("ce n'est pas un dossier de projet Pulse".into());
    }
    let rel_path = std::path::Path::new(&rel);
    if rel.is_empty() || rel_path.is_absolute() || rel_path.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return Err("chemin de fichier refusé".into());
    }
    let target = dir.join(rel_path);
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

/// Taille d'un fichier du dossier de projet (rien s'il n'existe pas) : pour ne pas réécrire un morceau de sons inchangé
#[tauri::command]
fn project_file_size(dir: String, path: String) -> Option<u64> {
    let dir = std::path::PathBuf::from(dir);
    let rel = std::path::Path::new(&path);
    if !dir.join(MARKER).is_file() || rel.is_absolute() || rel.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return None;
    }
    std::fs::metadata(dir.join(rel)).ok().filter(|m| m.is_file()).map(|m| m.len())
}

/// Montre le dossier du projet dans le Finder / l'Explorateur
#[tauri::command]
fn reveal_project_folder(dir: String) -> Result<(), String> {
    let d = std::path::PathBuf::from(&dir);
    if !d.join(MARKER).is_file() {
        return Err("ce n'est pas un dossier de projet Pulse".into());
    }
    // tests automatiques : ne pas ouvrir de fenêtres du Finder sur l'écran
    if std::env::var_os("PULSE_TEST").is_some() {
        return Ok(());
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
    let p = pulse_file_path(&path)?;
    let bytes = std::fs::read(p).map_err(|e| format!("lecture impossible : {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn pulse_file_path(path: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::PathBuf::from(path);
    if p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("pulse")) != Some(true) {
        return Err("ce n'est pas un fichier .pulse".into());
    }
    Ok(p)
}

#[derive(serde::Serialize)]
struct FilePart { size: u64, data: String }

/// Lecture d'un fichier par morceaux en base64 (page en ligne : le canal de secours ne sait pas renvoyer d'octets).
/// kind = "pulse" (un .pulse) ou "import" (un son téléchargé par lien) — mêmes règles que read_pulse_file / read_import_file.
#[tauri::command]
async fn read_file_part(kind: String, path: String, offset: u64, len: u64) -> Result<FilePart, String> {
    let p = match kind.as_str() {
        "pulse" => pulse_file_path(&path)?,
        "import" => import_file_path(&path)?,
        _ => return Err("lecture refusée".into()),
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<FilePart, String> {
        use base64::Engine;
        use std::io::{Read, Seek, SeekFrom};
        let mut f = std::fs::File::open(&p).map_err(|e| format!("lecture impossible : {e}"))?;
        let size = f.metadata().map_err(|e| e.to_string())?.len();
        f.seek(SeekFrom::Start(offset.min(size))).map_err(|e| e.to_string())?;
        let mut buf = Vec::with_capacity(len.min(size.saturating_sub(offset)) as usize);
        f.take(len).read_to_end(&mut buf).map_err(|e| format!("lecture impossible : {e}"))?;
        Ok(FilePart { size, data: base64::engine::general_purpose::STANDARD.encode(&buf) })
    })
    .await
    .map_err(|e| e.to_string())?
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
        // macOS : le m4a « DASH » de YouTube n'est pas décodable par la webview → conversion en WAV avec afconvert (livré avec macOS)
        #[cfg(target_os = "macos")]
        {
            let wav = file.with_extension("wav");
            let ok = Command::new("/usr/bin/afconvert")
                .args(["-f", "WAVE", "-d", "LEI16"]).arg(&file).arg(&wav)
                .status().map(|s| s.success()).unwrap_or(false);
            if ok && wav.is_file() {
                let _ = std::fs::remove_file(&file);
                return Ok(wav.to_string_lossy().into_owned());
            }
        }
        Ok(file.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Range un fichier converti (octets bruts) dans le dossier Téléchargements et le montre. En-tête : `name` (encodé)
#[tauri::command]
async fn save_download(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("le fichier doit arriver en octets bruts".into());
    };
    let name = request.headers().get("name").and_then(|v| v.to_str().ok()).map(percent_decode).unwrap_or_default();
    write_download(name, bytes.clone()).await
}

/// Même chose que save_download, avec le fichier déposé morceau par morceau (stage_put) : page en ligne
#[tauri::command]
async fn save_download_staged(stage: State<'_, Stage>, name: String, id: String) -> Result<String, String> {
    let bytes = stage.take(&id)?;
    write_download(name, bytes).await
}

async fn write_download(name: String, bytes: Vec<u8>) -> Result<String, String> {
    let clean: String = name.chars().map(|c| if c.is_alphanumeric() || " ._-()".contains(c) { c } else { '_' }).collect();
    let clean = clean.trim_matches(|c| c == '.' || c == ' ').to_string();
    if clean.is_empty() { return Err("nom de fichier refusé".into()); }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok_or("dossier personnel introuvable")?;
    let dir = std::path::PathBuf::from(home).join("Downloads");
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let (stem, ext) = match clean.rsplit_once('.') { Some((a, b)) => (a.to_string(), format!(".{b}")), None => (clean.clone(), String::new()) };
        let mut target = dir.join(&clean);
        let mut n = 2;
        while target.exists() { target = dir.join(format!("{stem} ({n}){ext}")); n += 1; }
        std::fs::write(&target, &bytes).map_err(|e| format!("écriture impossible : {e}"))?;
        #[cfg(target_os = "macos")]
        let _ = std::process::Command::new("open").arg("-R").arg(&target).spawn();
        #[cfg(target_os = "windows")]
        let _ = std::process::Command::new("explorer").arg(format!("/select,{}", target.display())).spawn();
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Lit le fichier téléchargé par import_url (octets bruts) — seulement dans le dossier d'import de Pulse
#[tauri::command]
fn read_import_file(path: String) -> Result<tauri::ipc::Response, String> {
    let p = import_file_path(&path)?;
    let bytes = std::fs::read(&p).map_err(|e| format!("lecture impossible : {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn import_file_path(path: &str) -> Result<std::path::PathBuf, String> {
    let root = std::fs::canonicalize(import_dir()).map_err(|_| "aucun import en cours".to_string())?;
    let p = std::fs::canonicalize(path).map_err(|e| format!("fichier introuvable : {e}"))?;
    if !p.starts_with(&root) {
        return Err("fichier hors du dossier d'import".into());
    }
    Ok(p)
}

// === Pulse servi depuis l'ordinateur (pulse://localhost/…) ===
// Comme un vrai logiciel : les pages viennent du disque, pas d'Internet. Depuis une page en ligne, macOS bloquait
// le canal rapide page ↔ appli (sauvegarde lente, moteur natif impossible). Les mises à jour restent automatiques :
// au lancement, `web_update` compare la liste en ligne (web-manifest.json, empreinte de chaque fichier) avec la copie
// locale et ne télécharge que ce qui a changé. Sans Internet : la dernière copie téléchargée, sinon celle embarquée.
const WEB_BASE: &str = "https://appnco.app/pulse/";
/// Adresse du site (PULSE_WEB_BASE pour les tests seulement)
fn web_base() -> String {
    match std::env::var("PULSE_WEB_BASE") {
        Ok(b) if std::env::var_os("PULSE_TEST").is_some() => b,
        _ => WEB_BASE.to_string(),
    }
}

/// Dossier des données de l'appli (PULSE_DATA_DIR pour les tests : jamais celui de l'utilisateur)
fn data_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> std::path::PathBuf {
    if let Some(d) = std::env::var_os("PULSE_DATA_DIR") {
        return std::path::PathBuf::from(d);
    }
    app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("pulse-data"))
}

fn safe_rel(rel: &str) -> bool {
    !rel.is_empty() && !rel.starts_with('/') && !rel.contains('\\') && !rel.split('/').any(|c| c.is_empty() || c == "." || c == "..")
}

fn mime_of(rel: &str) -> &'static str {
    match rel.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn serve_pulse<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &str) -> tauri::http::Response<Vec<u8>> {
    let rel = percent_decode(path.trim_start_matches('/'));
    let rel = if rel.is_empty() { "studio.html".to_string() } else { rel };
    let not_found = || tauri::http::Response::builder().status(404).body(b"introuvable".to_vec()).unwrap();
    if !safe_rel(&rel) {
        return not_found();
    }
    // copie téléchargée (complète : son web-manifest.json est écrit en dernier), sinon copie embarquée
    let web = data_dir(app).join("web");
    if web.join("web-manifest.json").is_file() {
        if let Ok(bytes) = std::fs::read(web.join(&rel)) {
            return tauri::http::Response::builder().header("Content-Type", mime_of(&rel)).header("Cache-Control", "no-store").body(bytes).unwrap();
        }
    }
    match app.asset_resolver().get(rel.clone()) {
        Some(a) => tauri::http::Response::builder().header("Content-Type", a.mime_type).header("Cache-Control", "no-store").body(a.bytes).unwrap(),
        None => not_found(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn curl_get(url: &str, out: &std::path::Path, secs: u32) -> Result<(), String> {
    let st = quiet(Command::new("curl").args(["-L", "--fail", "-s", "--max-time", &secs.to_string(), "-o"]).arg(out).arg(url))
        .status()
        .map_err(|e| format!("curl : {e}"))?;
    if st.success() { Ok(()) } else { Err(format!("téléchargement impossible : {url}")) }
}

/// Met la copie locale de Pulse à jour depuis le site. Renvoie « à jour », « mis à jour (N fichiers) » ou une erreur (on garde l'ancienne copie).
#[tauri::command]
async fn web_update(app: tauri::AppHandle) -> Result<String, String> {
    let dir = data_dir(&app);
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        static BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if BUSY.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return Ok("déjà en cours".into());
        }
        let r = web_update_inner(&app, &dir);
        BUSY.store(false, std::sync::atomic::Ordering::SeqCst);
        r
    })
    .await
    .map_err(|e| e.to_string())?
}

fn web_update_inner<R: tauri::Runtime>(app: &tauri::AppHandle<R>, dir: &std::path::Path) -> Result<String, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let web = dir.join("web");
    let tmp_manifest = dir.join("web-manifest.download");
    curl_get(&format!("{}web-manifest.json?t={}", web_base(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)), &tmp_manifest, 6)?;
    let raw = std::fs::read(&tmp_manifest).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp_manifest);
    let manifest: serde_json::Value = serde_json::from_slice(&raw).map_err(|_| "liste des fichiers illisible".to_string())?;
    let files = manifest.get("files").and_then(|f| f.as_object()).ok_or("liste des fichiers vide")?;
    if !files.contains_key("studio.html") || files.len() < 5 {
        return Err("liste des fichiers incomplète".into());
    }
    if std::fs::read(web.join("web-manifest.json")).ok().as_deref() == Some(&raw[..]) {
        return Ok("à jour".into());
    }
    let new = dir.join("web.new");
    let _ = std::fs::remove_dir_all(&new);
    let mut downloaded = 0;
    for (rel, sum) in files {
        let sum = sum.as_str().ok_or("empreinte manquante")?;
        if !safe_rel(rel) {
            return Err(format!("chemin refusé : {rel}"));
        }
        let target = new.join(rel);
        if let Some(p) = target.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        // déjà là à l'identique (copie locale ou embarquée) : pas de téléchargement
        let local = std::fs::read(web.join(rel)).ok().filter(|b| sha256_hex(b) == sum)
            .or_else(|| app.asset_resolver().get(rel.clone()).map(|a| a.bytes).filter(|b| sha256_hex(b) == sum));
        let bytes = match local {
            Some(b) => b,
            None => {
                let url = format!("{}{}?v={}", web_base(), rel.split('/').map(|c| c.replace(' ', "%20")).collect::<Vec<_>>().join("/"), &sum[..12.min(sum.len())]);
                curl_get(&url, &target, 30)?;
                let b = std::fs::read(&target).map_err(|e| e.to_string())?;
                if sha256_hex(&b) != sum {
                    let _ = std::fs::remove_dir_all(&new);
                    return Err(format!("fichier abîmé pendant le téléchargement : {rel}"));
                }
                downloaded += 1;
                b
            }
        };
        std::fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    }
    std::fs::write(new.join("web-manifest.json"), &raw).map_err(|e| e.to_string())?;
    // bascule : l'ancienne copie n'est retirée qu'une fois la nouvelle en place
    let old = dir.join("web.old");
    let _ = std::fs::remove_dir_all(&old);
    if web.exists() {
        std::fs::rename(&web, &old).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&new, &web).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&old);
    Ok(format!("mis à jour ({downloaded} fichier{})", if downloaded > 1 { "s" } else { "" }))
}

// === Transfert unique des projets : ancienne adresse (page en ligne) → nouvelle (pulse://) ===
// Les deux adresses ont chacune leur propre stockage. La page en ligne écrit tout (projets, sons, réglages) dans
// <données>/migration/, puis la page locale le relit. L'ancien stockage n'est jamais effacé (secours).
fn migration_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> std::path::PathBuf {
    data_dir(app).join("migration")
}
fn migration_name_ok(name: &str) -> bool {
    !name.is_empty() && name.len() < 120 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) && !name.starts_with('.')
}

/// « fait » si les projets ont déjà été transférés (ou qu'il n'y avait rien), sinon « à faire »
#[tauri::command]
fn migration_state(app: tauri::AppHandle) -> String {
    if migration_dir(&app).join("fait").is_file() { "fait".into() } else { "à faire".into() }
}

/// Range un fichier du transfert (envoyé par morceaux avec stage_put)
#[tauri::command]
async fn migration_put(app: tauri::AppHandle, stage: State<'_, Stage>, name: String, id: String) -> Result<u64, String> {
    if !migration_name_ok(&name) {
        return Err("nom refusé".into());
    }
    let bytes = stage.take(&id)?;
    let dir = migration_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let n = bytes.len() as u64;
    std::fs::write(dir.join(&name), bytes).map_err(|e| format!("écriture impossible : {e}"))?;
    Ok(n)
}

/// Relit un fichier du transfert (page locale : octets bruts)
#[tauri::command]
fn migration_read(app: tauri::AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    if !migration_name_ok(&name) {
        return Err("nom refusé".into());
    }
    let bytes = std::fs::read(migration_dir(&app).join(&name)).map_err(|e| format!("lecture impossible : {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Transfert terminé : on le note et on libère la place prise par les fichiers recopiés
#[tauri::command]
fn migration_done(app: tauri::AppHandle) -> Result<(), String> {
    let dir = migration_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
    std::fs::write(dir.join("fait"), b"projets transferes\n").map_err(|e| e.to_string())
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

/// Journal des problèmes sur le disque (lisible sans Pulse) : macOS ~/Library/Logs/Pulse/journal.log,
/// Windows %LOCALAPPDATA%\\Pulse\\journal.log. Plantages du moteur (Rust) + journal de la page (redémarrages, erreurs, trous).
fn journal_path() -> Option<std::path::PathBuf> {
    // tests automatiques : jamais dans le journal de l'utilisateur
    if std::env::var_os("PULSE_TEST").is_some() {
        return Some(std::env::temp_dir().join("pulse-test-journal.log"));
    }
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("LOCALAPPDATA").map(|d| std::path::PathBuf::from(d).join("Pulse"));
    #[cfg(not(target_os = "windows"))]
    let base = std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join("Library/Logs/Pulse"));
    let dir = base?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("journal.log"))
}
fn journal_write(kind: &str, detail: &str) {
    use std::io::Write;
    let Some(p) = journal_path() else { return };
    // au-delà d'1 Mo, l'ancien journal passe en journal.old.log
    if std::fs::metadata(&p).map(|m| m.len() > 1 << 20).unwrap_or(false) { let _ = std::fs::rename(&p, p.with_extension("old.log")); }
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let _ = writeln!(f, "{t}\t{kind}\t{}", detail.replace('\n', " | "));
    }
}

/// Une ligne du journal de la page (redémarrage, erreur, trous dans le son…)
#[tauri::command]
fn diag_write(kind: String, detail: String) {
    journal_write(&kind, &detail.chars().take(600).collect::<String>());
}

fn main() {
    // un plantage du moteur est noté avant que l'appli ne se ferme
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let th = std::thread::current().name().unwrap_or("?").to_string();
        journal_write("plantage-moteur", &format!("fil {th} : {info}"));
        prev(info);
    }));
    journal_write("démarrage", env!("CARGO_PKG_VERSION"));
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
        .manage(Monitor::new())
        .manage(Sounds(std::sync::Arc::new(Mutex::new(std::collections::HashMap::new())), Mutex::new(String::new())))
        .manage(PendingOpen(Mutex::new(pending)))
        .manage(Midi(Mutex::new(Vec::new())))
        .manage(PickedRoot(Mutex::new(None)))
        .manage(Stage(Mutex::new(std::collections::HashMap::new())))
        // Pulse servi depuis le Mac (pulse://localhost/…) : copie téléchargée de la dernière version, sinon copie embarquée
        .register_uri_scheme_protocol("pulse", |ctx, request| serve_pulse(ctx.app_handle(), request.uri().path()))
        .setup(|app| {
            // Test automatique : un script à lancer dans la page une fois chargée (PULSE_TEST_EVAL = chemin du fichier .js)
            if std::env::var_os("PULSE_TEST").is_some() {
                if let Some(js) = std::env::var_os("PULSE_TEST_EVAL").and_then(|p| std::fs::read_to_string(p).ok()) {
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(6));
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.eval(&js);
                        }
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![native_info, native_play, native_play_staged, stage_put, save_file_staged, save_download_staged, read_file_part, project_file_size, web_update, migration_state, migration_put, migration_read, migration_done, native_play_project, native_mix, native_swap, native_loop, native_live, native_scope, native_stop, diag_write, monitor_start, monitor_stop, monitor_gain, monitor_track, monitor_info, midi_ports, midi_start, pick_folder, create_project_folder, project_folder_ok, save_file, reveal_project_folder, take_pending_open, read_pulse_file, import_url, read_import_file, save_download, test_log, test_exit])
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
