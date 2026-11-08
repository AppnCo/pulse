//! Plugins externes (VST3) : liste des plugins installés, chargement, fenêtre du plugin, réglages (état) en base64.
//! Les instances vivent dans le registre du moteur (pulse_engine::ext) sous l'identifiant de l'effet (« vst#k3j2 »).
use base64::Engine as _;
use pulse_engine::ext::{self, vst3_host};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ExtInfo { pub name: String, pub vendor: String, pub path: String, pub category: String, pub version: String, pub editor: bool }

/// Liste en mémoire (le premier scan prend quelques secondes ; ensuite instantané)
#[derive(Default)]
pub struct ExtList(pub Mutex<Option<Vec<ExtInfo>>>);
// Fenêtres de plugin ouvertes (par identifiant) : elles ne vivent que sur le fil de l'interface
thread_local! { static WINDOWS: std::cell::RefCell<HashMap<String, vst3_host::PluginWindow>> = std::cell::RefCell::new(HashMap::new()); }

fn cache_file(app: &AppHandle) -> Option<std::path::PathBuf> { app.path().app_data_dir().ok().map(|d| d.join("plugins-externes.json")) }

/// Plugins installés (VST3). `force` = refaire la recherche (nouveau plugin installé)
#[tauri::command]
pub async fn ext_scan(app: AppHandle, list: State<'_, ExtList>, force: bool) -> Result<Vec<ExtInfo>, String> {
    if !force {
        if let Some(l) = list.0.lock().unwrap().clone() { return Ok(l); }
        if let Some(f) = cache_file(&app) { if let Ok(t) = std::fs::read_to_string(&f) { if let Ok(l) = serde_json::from_str::<Vec<ExtInfo>>(&t) { *list.0.lock().unwrap() = Some(l.clone()); return Ok(l); } } }
    }
    let found = tauri::async_runtime::spawn_blocking(|| -> Result<Vec<ExtInfo>, String> { Ok(scan_folders()) }).await.map_err(|e| e.to_string())??;
    if let Some(f) = cache_file(&app) { let _ = std::fs::create_dir_all(f.parent().unwrap()); let _ = std::fs::write(&f, serde_json::to_string(&found).unwrap_or_default()); }
    *list.0.lock().unwrap() = Some(found.clone());
    Ok(found)
}

#[derive(serde::Serialize)]
pub struct ExtLoaded { pub name: String, pub latency: u32, pub editor: bool }

/// Charge un plugin sous l'identifiant `id`, à la fréquence du son de l'appli, avec ses réglages (`state`, base64) s'il y en a
#[tauri::command]
pub async fn ext_create(player: State<'_, pulse_engine::player::Player>, id: String, path: String, state: Option<String>) -> Result<ExtLoaded, String> {
    if let Some(sh) = ext::get(&id) { let g = sh.lock().unwrap(); return Ok(ExtLoaded { name: g.info().name.clone(), latency: g.latency_samples(), editor: g.has_editor() }); }
    let rate = match player.output_rate() { 0 => 48_000, r => r } as f64;
    tauri::async_runtime::spawn_blocking(move || -> Result<ExtLoaded, String> {
        let mut p = vst3_host::simple::load_plugin(&path).map_err(|e| format!("plugin illisible : {e}"))?;
        if p.info().audio_inputs == 0 { return Err("c'est un instrument (pas encore pris en charge) : seuls les effets se posent sur une piste".into()); }
        p.reconfigure(rate, ext::MAX_BLOCK).map_err(|e| e.to_string())?;
        if let Some(s) = state { if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(s) { let _ = p.load_state(&bytes); } }
        p.start_processing().map_err(|e| e.to_string())?;
        let out = ExtLoaded { name: p.info().name.clone(), latency: p.latency_samples(), editor: p.has_editor() };
        ext::insert(&id, p);
        Ok(out)
    }).await.map_err(|e| e.to_string())?
}

/// Réglages actuels du plugin (base64), pour les ranger dans le projet
#[tauri::command]
pub fn ext_state(id: String) -> Result<String, String> {
    let sh = ext::get(&id).ok_or("plugin absent")?;
    let g = sh.lock().unwrap();
    let st = g.save_state().map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(st))
}

/// Ouvre (ou ramène devant) la vraie fenêtre du plugin — sur le fil de l'interface, comme l'exigent les plugins
#[tauri::command]
pub fn ext_editor(app: AppHandle, id: String) -> Result<(), String> {
    let sh = ext::get(&id).ok_or("plugin absent")?;
    app.run_on_main_thread(move || WINDOWS.with(|w| {
        let mut w = w.borrow_mut();
        if let Some(win) = w.get(&id) { if win.is_open() && !win.closed_by_user() { return; } }
        w.remove(&id);
        let mut win = vst3_host::PluginWindow::new(sh);
        if win.open().is_ok() { w.insert(id, win); }
    })).map_err(|e| e.to_string())
}

/// Retire un plugin (fenêtre fermée, instance libérée)
#[tauri::command]
pub fn ext_remove(app: AppHandle, id: String) -> Result<(), String> {
    let id2 = id.clone();
    let _ = app.run_on_main_thread(move || WINDOWS.with(|w| { if let Some(mut win) = w.borrow_mut().remove(&id2) { win.close(); } }));
    ext::remove(&id);
    Ok(())
}

/// Retard actuel de chaque plugin chargé (échantillons) : il change si on passe un EQ en phase linéaire, par exemple
#[tauri::command]
pub fn ext_latencies() -> HashMap<String, u32> { ext::ids().into_iter().map(|id| { let l = ext::latency(&id); (id, l) }).collect() }

#[derive(serde::Serialize)]
pub struct ExtParam { pub id: u32, pub name: String, pub value: f64 }

/// Réglages automatisables du plugin (valeur 0..1)
#[tauri::command]
pub fn ext_params(id: String) -> Result<Vec<ExtParam>, String> {
    let sh = ext::get(&id).ok_or("plugin absent")?;
    let g = sh.lock().unwrap();
    Ok(g.get_parameters().map_err(|e| e.to_string())?.into_iter()
        .filter(|q| q.can_automate && !q.is_read_only && !q.is_bypass)
        .map(|q| ExtParam { id: q.id, name: q.name, value: q.value }).collect())
}

/// Réglages touchés dans la fenêtre du plugin depuis la dernière fois (n°, valeur 0..1) : en mode automation,
/// toucher un bouton du plugin affiche sa courbe (comme Logic) et l'écriture suit le geste
#[tauri::command]
pub fn ext_edits(id: String) -> Result<Vec<(u32, f64)>, String> {
    let sh = ext::get(&id).ok_or("plugin absent")?;
    let mut g = sh.lock().unwrap();
    Ok(g.take_parameter_edits().into_iter().filter_map(|e| e.value.map(|v| (e.id, v))).collect())
}

/// Plugins chargés en ce moment (identifiants)
#[tauri::command]
pub fn ext_loaded() -> Vec<String> { ext::ids() }

/// Dossiers VST3 standard (Mac : système + utilisateur ; Windows : Common Files)
fn vst3_dirs() -> Vec<std::path::PathBuf> {
    let mut v: Vec<std::path::PathBuf> = Vec::new();
    #[cfg(target_os = "macos")] {
        v.push("/Library/Audio/Plug-Ins/VST3".into());
        if let Some(h) = std::env::var_os("HOME") { v.push(std::path::PathBuf::from(h).join("Library/Audio/Plug-Ins/VST3")); }
    }
    #[cfg(target_os = "windows")] {
        for k in ["CommonProgramFiles", "CommonProgramFiles(x86)"] { if let Some(d) = std::env::var_os(k) { v.push(std::path::PathBuf::from(d).join("VST3")); } }
        if let Some(d) = std::env::var_os("LOCALAPPDATA") { v.push(std::path::PathBuf::from(d).join("Programs/Common/VST3")); }
    }
    v
}

/// Recherche SANS ouvrir les plugins (rapide, aucun risque de plantage) : nom et marque lus dans la fiche du plugin
/// (moduleinfo.json, sinon Info.plist sur Mac, sinon le nom du fichier) ; la marque = le dossier qui le range s'il y en a un
fn scan_folders() -> Vec<ExtInfo> {
    let mut out = Vec::new();
    for root in vst3_dirs() {
        let mut stack = vec![(root.clone(), 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for e in rd.flatten() {
                let p = e.path();
                let is_vst = p.extension().map_or(false, |x| x.eq_ignore_ascii_case("vst3"));
                if !is_vst { if p.is_dir() && depth < 3 { stack.push((p, depth + 1)); } continue; }
                let file_name = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                let folder_vendor = if dir != root { dir.file_name().map(|s| s.to_string_lossy().into_owned()) } else { None };
                let (mut name, mut vendor, mut version, mut category) = (file_name.clone(), String::new(), String::new(), String::from("Fx"));
                if let Ok(t) = std::fs::read_to_string(p.join("Contents/Resources/moduleinfo.json")) {
                    if let Ok(j) = serde_json::from_str::<serde_json::Value>(&t) {
                        if let Some(v) = j.pointer("/Factory Info/Vendor").and_then(|v| v.as_str()) { vendor = v.to_owned(); }
                        if let Some(v) = j.get("Version").and_then(|v| v.as_str()) { version = v.to_owned(); }
                        if let Some(c) = j.get("Classes").and_then(|c| c.as_array()).and_then(|c| c.iter().find(|k| k.get("Category").and_then(|x| x.as_str()) == Some("Audio Module Class"))) {
                            if let Some(n) = c.get("Name").and_then(|v| v.as_str()) { name = n.to_owned(); }
                            if let Some(sc) = c.get("Sub Categories").and_then(|v| v.as_array()) { category = sc.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join("|"); }
                        }
                    }
                }
                #[cfg(target_os = "macos")]
                if vendor.is_empty() {
                    if let Ok(pl) = plist::Value::from_file(p.join("Contents/Info.plist")) {
                        if let Some(d) = pl.as_dictionary() {
                            if let Some(v) = d.get("CFBundleShortVersionString").and_then(|v| v.as_string()) { version = v.to_owned(); }
                            if let Some(id) = d.get("CFBundleIdentifier").and_then(|v| v.as_string()) {
                                let part = id.split('.').nth(1).unwrap_or("").to_owned();
                                // même mot au début du nom : on garde son écriture (« fabfilter » → « FabFilter »)
                                let first = name.split_whitespace().next().unwrap_or("").to_owned();
                                vendor = if !part.is_empty() && first.eq_ignore_ascii_case(&part) { first } else { part };
                            }
                        }
                    }
                }
                if let Some(fv) = folder_vendor { vendor = fv; }
                if category.to_lowercase().contains("instrument") { continue; }   // pour l'instant : effets seulement
                if vendor.is_empty() { vendor = "Autres".into(); }
                out.push(ExtInfo { name, vendor, path: p.to_string_lossy().into_owned(), category, version, editor: true });
            }
        }
    }
    out.sort_by(|a, b| a.vendor.to_lowercase().cmp(&b.vendor.to_lowercase()).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out.dedup_by(|a, b| a.name == b.name && a.vendor == b.vendor);
    out
}
