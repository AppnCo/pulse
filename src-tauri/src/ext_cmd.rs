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
    if force { forget_bad_verdicts(&app); }   // « chercher à nouveau » redonne leur chance aux plugins mis de côté
    if !force {
        if let Some(l) = list.0.lock().unwrap().clone() { return Ok(l); }
        if let Some(f) = cache_file(&app) { if let Ok(t) = std::fs::read_to_string(&f) { if let Ok(l) = serde_json::from_str::<Vec<ExtInfo>>(&t) { *list.0.lock().unwrap() = Some(l.clone()); return Ok(l); } } }
    }
    let found = tauri::async_runtime::spawn_blocking(|| -> Result<Vec<ExtInfo>, String> {
        #[allow(unused_mut)]
        let mut out = scan_folders();
        #[cfg(target_os = "macos")]
        {
            // même plugin en VST3 et en AU : on garde le VST3 (sa latence est compensée)
            let key = |n: &str| n.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>();
            let have: std::collections::HashSet<String> = out.iter().map(|p| key(&p.name)).collect();
            let vendor_name: std::collections::HashSet<String> = out.iter().map(|p| key(&format!("{}{}", p.vendor, p.name))).collect();
            for a in scan_au() { if !have.contains(&key(&a.name)) && !vendor_name.contains(&key(&format!("{}{}", a.vendor, a.name))) && !have.contains(&key(&format!("{} {}", a.vendor, a.name))) { out.push(a); } }
            out.sort_by(|a, b| a.vendor.to_lowercase().cmp(&b.vendor.to_lowercase()).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        }
        Ok(out)
    }).await.map_err(|e| e.to_string())??;
    if let Some(f) = cache_file(&app) { let _ = std::fs::create_dir_all(f.parent().unwrap()); let _ = std::fs::write(&f, serde_json::to_string(&found).unwrap_or_default()); }
    *list.0.lock().unwrap() = Some(found.clone());
    Ok(found)
}

#[derive(serde::Serialize)]
pub struct ExtLoaded { pub name: String, pub latency: u32, pub editor: bool }

/// Audio Units (Mac) trouvées à la dernière recherche : identifiant → fiche (pour les recharger)
#[cfg(target_os = "macos")]
fn au_infos() -> &'static Mutex<HashMap<String, ext::rack::PluginInfo>> {
    static M: std::sync::OnceLock<Mutex<HashMap<String, ext::rack::PluginInfo>>> = std::sync::OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}
/// Audio Units d'effet (Mac) : « FabFilter: Pro-C 2 » → marque FabFilter, nom Pro-C 2 ; chemin « au:<identifiant> »
#[cfg(target_os = "macos")]
fn scan_au() -> Vec<ExtInfo> {
    use ext::rack::PluginScanner;
    let Ok(sc) = ext::rack::au::AudioUnitScanner::new() else { return Vec::new() };
    let Ok(list) = sc.scan() else { return Vec::new() };
    let mut m = au_infos().lock().unwrap();
    list.into_iter().filter(|i| matches!(i.plugin_type, ext::rack::PluginType::Effect)).map(|i| {
        let (vendor, name) = match i.name.split_once(": ") { Some((v, n)) => (v.trim().to_owned(), n.trim().to_owned()), None => (i.manufacturer.clone(), i.name.clone()) };
        m.insert(i.unique_id.clone(), i.clone());
        ExtInfo { name, vendor, path: format!("au:{}", i.unique_id), category: "Fx|AU".into(), version: i.version.to_string(), editor: true }
    }).collect()
}

/// Charge un plugin (Audio Unit « au:… » ou VST3) à la fréquence `rate`, avec ses réglages s'il y en a
fn load_inst(path: &str, rate: f64, bytes: &Option<Vec<u8>>) -> Result<(ext::Inst, ExtLoaded), String> {
    #[cfg(target_os = "macos")]
    if let Some(uid) = path.strip_prefix("au:") {
        use ext::rack::{PluginInstance, PluginScanner};
        if au_infos().lock().unwrap().get(uid).is_none() { scan_au(); }
        let info = au_infos().lock().unwrap().get(uid).cloned().ok_or("Audio Unit introuvable (désinstallée ?)")?;
        let sc = ext::rack::au::AudioUnitScanner::new().map_err(|e| e.to_string())?;
        let mut p = sc.load(&info).map_err(|e| format!("plugin illisible : {e}"))?;
        p.initialize(rate, ext::MAX_BLOCK).map_err(|e| e.to_string())?;
        if let Some(b) = bytes { let _ = p.set_state(b); }
        let latency = p.latency_samples();
        return Ok((ext::Inst::Au(Box::new(p), vec![0.0; ext::MAX_BLOCK], vec![0.0; ext::MAX_BLOCK]), ExtLoaded { name: info.name.clone(), latency, editor: true }));
    }
    let mut p = vst3_host::simple::load_plugin(path).map_err(|e| format!("plugin illisible : {e}"))?;
    if p.info().audio_inputs == 0 { return Err("c'est un instrument (pas encore pris en charge) : seuls les effets se posent sur une piste".into()); }
    p.reconfigure(rate, ext::MAX_BLOCK).map_err(|e| e.to_string())?;
    if let Some(b) = bytes { let _ = p.load_state(b); }
    p.start_processing().map_err(|e| e.to_string())?;
    let out = ExtLoaded { name: p.info().name.clone(), latency: p.latency_samples(), editor: p.has_editor() };
    Ok((ext::Inst::Vst(std::sync::Arc::new(Mutex::new(p))), out))
}

// === Vérification à part ===
// Un plugin externe qui plante emporte toute l'appli (et la séance en cours). Avant de charger un plugin pour la première
// fois, Pulse se relance lui-même à côté (PULSE_EXT_CHECK=<chemin>) : ce double charge le plugin, lui fait passer du son,
// lit ses réglages, puis se ferme. S'il plante ou se bloque, le plugin est mis de côté ; le verdict est retenu
// (par plugin et par date du fichier : une mise à jour du plugin relance la vérification).

/// Ferme le double tout de suite, sans laisser le plugin « ranger ses affaires » (certains plantent à la fermeture : ça ne dit rien du chargement)
pub fn quit_now(code: i32) -> ! {
    #[cfg(unix)]
    { extern "C" { fn _exit(code: i32) -> !; } unsafe { _exit(code) } }
    #[cfg(not(unix))]
    std::process::exit(code)
}
/// Le double : ne revient jamais. Code de sortie 0 = bon, 2 = refus propre (instrument, illisible), autre / signal = plantage.
pub fn check_main(path: String) -> ! {
    std::thread::spawn(|| { std::thread::sleep(std::time::Duration::from_secs(25)); std::process::exit(4); });
    let path_is_au = path.starts_with("au:");
    let work = move || {
        let code = match load_inst(&path, 48_000.0, &None) {
            Err(_) => 2,
            Ok((inst, _)) => {
                ext::insert("vst#check", inst);
                let mut slot = ext::ExtSlot::new("vst#check", 48_000.0);
                let (mut l, mut r) = (vec![0.01f32; 512], vec![0.01f32; 512]);
                for _ in 0..8 { slot.process(&mut l, &mut r, false); }
                let _ = ext_state("vst#check".into());
                0
            }
        };
        quit_now(code);
    };
    // comme dans l'appli : un VST3 se charge sur le fil principal (c'est la règle du format ; certains plantent sinon), une Audio Unit à côté
    let on_main = !path_is_au;
    let mut work = Some(work);
    if !on_main { let w = work.take().unwrap(); std::thread::spawn(move || { std::thread::sleep(std::time::Duration::from_millis(600)); w() }); }
    // les plugins ont besoin d'une vraie boucle d'application sur le fil principal (fenêtres de licence, minuteries…)
    let mut el = tao::event_loop::EventLoopBuilder::<()>::new().build();
    #[cfg(target_os = "macos")]
    { use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS}; el.set_activation_policy(ActivationPolicy::Accessory); }
    el.run(move |ev, _, flow| { *flow = tao::event_loop::ControlFlow::Wait; if let tao::event::Event::MainEventsCleared = ev { if let Some(w) = work.take() { w(); } } })
}

fn verdict_file(app: &AppHandle) -> Option<std::path::PathBuf> { app.path().app_data_dir().ok().map(|d| d.join("plugins-verdicts.json")) }
fn verdict_key(path: &str) -> String {
    let m = std::fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    format!("{path}|{m}")
}
static CHECKING: Mutex<()> = Mutex::new(());
/// Vérifie le plugin à part s'il n'a jamais été vu. Err = mis de côté (message pour l'utilisateur).
fn verdict(app: &AppHandle, path: &str) -> Result<(), String> {
    if std::env::var_os("PULSE_EXT_NOCHECK").is_some() { return Ok(()); }
    let _one = CHECKING.lock().unwrap_or_else(|e| e.into_inner());
    let Some(file) = verdict_file(app) else { return Ok(()) };
    let mut map: HashMap<String, String> = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let key = verdict_key(path);
    let msg = |v: &str| if v == "bloque" { "ce plugin reste bloqué au chargement : Pulse l'a mis de côté pour protéger ta séance".to_string() }
        else { "ce plugin plante au chargement : Pulse l'a mis de côté pour protéger ta séance".to_string() };
    match map.get(&key).map(String::as_str) { Some("ok") => return Ok(()), Some(v) => return Err(msg(v)), None => {} }
    let Ok(exe) = std::env::current_exe() else { return Ok(()) };
    let Ok(mut child) = std::process::Command::new(exe).env("PULSE_EXT_CHECK", path).env_remove("PULSE_TEST")
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn() else { return Ok(()) };
    let t0 = std::time::Instant::now();
    let v = loop {
        match child.try_wait() {
            Ok(Some(st)) => break match st.code() { Some(0) => "ok", Some(2) => "refus", Some(4) => "bloque", _ => "plante" },
            Ok(None) => { if t0.elapsed().as_secs() > 30 { let _ = child.kill(); let _ = child.wait(); break "bloque"; } std::thread::sleep(std::time::Duration::from_millis(40)); }
            Err(_) => break "refus",
        }
    };
    if v == "refus" { return Ok(()); }   // refus propre : le chargement normal donnera le même message, sans danger
    map.insert(key, v.to_string());
    if let Some(d) = file.parent() { let _ = std::fs::create_dir_all(d); }
    let _ = std::fs::write(&file, serde_json::to_string(&map).unwrap_or_default());
    crate::journal_write("plugin-externe", &format!("vérification de {path} : {v}"));
    if v == "ok" { Ok(()) } else { Err(msg(v)) }
}
/// Verdicts connus (chemin → « ok » / « plante » / « bloque ») pour l'afficher dans la liste
#[tauri::command]
pub fn ext_verdicts(app: AppHandle) -> HashMap<String, String> {
    let map: HashMap<String, String> = verdict_file(&app).and_then(|f| std::fs::read_to_string(f).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    map.into_iter().filter_map(|(k, v)| k.rsplit_once('|').map(|(p, _)| (p.to_string(), v))).collect()
}
/// Oublie les plugins mis de côté (ils seront revérifiés au prochain chargement)
fn forget_bad_verdicts(app: &AppHandle) {
    let Some(file) = verdict_file(app) else { return };
    let mut map: HashMap<String, String> = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    map.retain(|_, v| v == "ok");
    let _ = std::fs::write(&file, serde_json::to_string(&map).unwrap_or_default());
}

/// Charge un plugin sous l'identifiant `id`, à la fréquence du son de l'appli, avec ses réglages (`state`, base64) s'il y en a
#[tauri::command]
pub async fn ext_create(app: AppHandle, player: State<'_, pulse_engine::player::Player>, id: String, path: String, state: Option<String>) -> Result<ExtLoaded, String> {
    if ext::get(&id).is_some() { return Ok(ExtLoaded { name: String::new(), latency: ext::latency(&id), editor: true }); }
    let rate = match player.output_rate() { 0 => 48_000, r => r } as f64;
    let bytes = state.and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok());
    tauri::async_runtime::spawn_blocking(move || -> Result<ExtLoaded, String> {
        verdict(&app, &path)?;
        if path.starts_with("au:") {
            let (inst, out) = load_inst(&path, rate, &bytes)?;
            ext::insert(&id, inst);
            return Ok(out);
        }
        // VST3 : chargé sur le fil principal (règle du format : certains plugins plantent ou se bloquent sinon)
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let r = load_inst(&path, rate, &bytes).map(|(inst, out)| { ext::insert(&id, inst); out });
            let _ = tx.send(r);
        }).map_err(|e| e.to_string())?;
        rx.recv().map_err(|_| "le chargement du plugin a été interrompu".to_string())?
    }).await.map_err(|e| e.to_string())?
}

/// Réglages actuels du plugin (base64), pour les ranger dans le projet
#[tauri::command]
pub fn ext_state(id: String) -> Result<String, String> {
    let sh = ext::get(&id).ok_or("plugin absent")?;
    let vst = match &*sh.lock().unwrap() { ext::Inst::Vst(p) => Some(p.clone()), #[cfg(target_os = "macos")] _ => None };
    if let Some(p) = vst { let st = p.lock().unwrap().save_state().map_err(|e| e.to_string())?; return Ok(base64::engine::general_purpose::STANDARD.encode(st)); }
    let g = sh.lock().unwrap();
    let st: Vec<u8> = match &*g {
        ext::Inst::Vst(_) => unreachable!(),
        #[cfg(target_os = "macos")]
        ext::Inst::Au(p, ..) => { use ext::rack::PluginInstance; p.get_state().map_err(|e| e.to_string())? }
    };
    Ok(base64::engine::general_purpose::STANDARD.encode(st))
}

// Fenêtres des Audio Units ouvertes (fil de l'interface)
#[cfg(target_os = "macos")]
thread_local! { static AU_GUIS: std::cell::RefCell<HashMap<String, ext::rack::au::AudioUnitGui>> = std::cell::RefCell::new(HashMap::new()); }

/// Ouvre (ou ramène devant) la vraie fenêtre du plugin — sur le fil de l'interface, comme l'exigent les plugins
#[tauri::command]
pub fn ext_editor(app: AppHandle, id: String, title: Option<String>) -> Result<(), String> {
    let sh = ext::get(&id).ok_or("plugin absent")?;
    let vst = match &*sh.lock().unwrap() { ext::Inst::Vst(p) => Some(p.clone()), #[cfg(target_os = "macos")] _ => None };
    if let Some(p) = vst {
        return app.run_on_main_thread(move || WINDOWS.with(|w| {
            let mut w = w.borrow_mut();
            if let Some(win) = w.get(&id) { if win.is_open() && !win.closed_by_user() { return; } }
            w.remove(&id);
            let mut win = vst3_host::PluginWindow::new(p);
            if win.open().is_ok() { w.insert(id, win); }
        })).map_err(|e| e.to_string());
    }
    #[cfg(target_os = "macos")]
    {
        let sh2 = sh.clone();
        return app.run_on_main_thread(move || {
            // déjà ouverte : on la remontre
            let shown = AU_GUIS.with(|m| m.borrow().get(&id).map(|g| g.show_window(title.as_deref()).is_ok()).unwrap_or(false));
            if shown { return; }
            let mut g = sh2.lock().unwrap();
            if let ext::Inst::Au(p, ..) = &mut *g {
                let (id2, t2) = (id.clone(), title.clone());
                p.create_gui(move |res| {
                    if let Ok(gui) = res { let _ = gui.show_window(t2.as_deref()); AU_GUIS.with(|m| { m.borrow_mut().insert(id2, gui); }); }
                    Ok(())
                });
            }
        }).map_err(|e| e.to_string());
    }
    #[allow(unreachable_code)]
    Ok(())
}

/// Retire un plugin (fenêtre fermée, instance libérée)
#[tauri::command]
pub fn ext_remove(app: AppHandle, id: String) -> Result<(), String> {
    let id2 = id.clone();
    let _ = app.run_on_main_thread(move || {
        WINDOWS.with(|w| { if let Some(mut win) = w.borrow_mut().remove(&id2) { win.close(); } });
        #[cfg(target_os = "macos")]
        AU_GUIS.with(|m| { m.borrow_mut().remove(&id2); });
    });
    // Le plugin n'est pas détruit tout de suite : certains travaillent encore en coulisse juste après leur chargement et
    // plantent si on les détruit à ce moment-là (vécu : UAD AMS RMX16), et le mixeur en cours peut encore le tenir
    // (il ne faut jamais qu'un plugin soit détruit sur le fil du son). Il attend 20 s puis part sur le fil principal.
    if let Some(sh) = ext::remove(&id) {
        GRAVE.lock().unwrap_or_else(|e| e.into_inner()).push((std::time::Instant::now(), Gone(sh)));
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(20));
            let _ = app.run_on_main_thread(|| {
                let mut g = GRAVE.lock().unwrap_or_else(|e| e.into_inner());
                let (old, keep): (Vec<_>, Vec<_>) = std::mem::take(&mut *g).into_iter().partition(|(t, s)| t.elapsed().as_secs() >= 19 && std::sync::Arc::strong_count(&s.0) == 1);
                *g = keep;
                drop(g);
                drop(old);
            });
        });
    }
    Ok(())
}
/// Reste-t-il des plugins chargés ou en attente de destruction ?
pub fn any_alive() -> bool { !ext::ids().is_empty() || !GRAVE.lock().unwrap_or_else(|e| e.into_inner()).is_empty() }
struct Gone(ext::Shared);
// les instances ne sont touchées que sous leur verrou ; elles voyagent déjà entre fils dans le registre du moteur
unsafe impl Send for Gone {}
static GRAVE: Mutex<Vec<(std::time::Instant, Gone)>> = Mutex::new(Vec::new());

/// Retard actuel de chaque plugin chargé (échantillons) : il change si on passe un EQ en phase linéaire, par exemple
#[tauri::command]
pub fn ext_latencies() -> HashMap<String, u32> { ext::ids().into_iter().map(|id| { let l = ext::latency(&id); (id, l) }).collect() }

#[derive(serde::Serialize)]
pub struct ExtParam { pub id: u32, pub name: String, pub value: f64 }

/// Réglages automatisables du plugin (valeur 0..1)
#[tauri::command]
pub fn ext_params(id: String) -> Result<Vec<ExtParam>, String> {
    let sh = ext::get(&id).ok_or("plugin absent")?;
    let vst = match &*sh.lock().unwrap() { ext::Inst::Vst(p) => Some(p.clone()), #[cfg(target_os = "macos")] _ => None };
    if let Some(p) = vst { return Ok(p.lock().unwrap().get_parameters().map_err(|e| e.to_string())?.into_iter()
            .filter(|q| q.can_automate && !q.is_read_only && !q.is_bypass)
            .map(|q| ExtParam { id: q.id, name: q.name, value: q.value }).collect()); }
    let g = sh.lock().unwrap();
    match &*g {
        ext::Inst::Vst(p) => Ok(p.lock().unwrap().get_parameters().map_err(|e| e.to_string())?.into_iter()
            .filter(|q| q.can_automate && !q.is_read_only && !q.is_bypass)
            .map(|q| ExtParam { id: q.id, name: q.name, value: q.value }).collect()),
        #[cfg(target_os = "macos")]
        ext::Inst::Au(p, ..) => {
            use ext::rack::PluginInstance;
            Ok((0..p.parameter_count()).filter_map(|i| p.parameter_info(i).ok().map(|q| ExtParam { id: i as u32, name: q.name, value: p.get_parameter(i).unwrap_or(0.0) as f64 })).collect())
        }
    }
}

/// Réglages touchés dans la fenêtre du plugin depuis la dernière fois (n°, valeur 0..1) : en mode automation,
/// toucher un bouton du plugin affiche sa courbe (comme Logic) et l'écriture suit le geste (Audio Units : valeurs comparées).
#[tauri::command]
pub fn ext_edits(id: String) -> Result<Vec<(u32, f64)>, String> {
    let sh = ext::get(&id).ok_or("plugin absent")?;
    let vst = match &*sh.lock().unwrap() { ext::Inst::Vst(p) => Some(p.clone()), #[cfg(target_os = "macos")] _ => None };
    if let Some(p) = vst { return Ok(p.lock().unwrap().take_parameter_edits().into_iter().filter_map(|e| e.value.map(|v| (e.id, v))).collect()); }
    #[cfg(target_os = "macos")]
    {
        // Audio Unit : pas d'avis de la fenêtre → on compare les valeurs à celles du dernier passage
        use ext::rack::PluginInstance;
        static LAST: std::sync::OnceLock<Mutex<HashMap<String, Vec<f32>>>> = std::sync::OnceLock::new();
        let now: Vec<f32> = { let g = sh.lock().unwrap(); if let ext::Inst::Au(p, ..) = &*g { (0..p.parameter_count()).map(|i| p.get_parameter(i).unwrap_or(0.0)).collect() } else { Vec::new() } };
        let mut last = LAST.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap();
        let prev = last.insert(id, now.clone());
        let Some(prev) = prev else { return Ok(Vec::new()) };
        return Ok(now.iter().enumerate().filter(|(i, v)| prev.get(*i).map_or(false, |p| (*p - **v).abs() > 1e-5)).map(|(i, v)| (i as u32, *v as f64)).collect());
    }
    #[allow(unreachable_code)]
    Ok(Vec::new())
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
