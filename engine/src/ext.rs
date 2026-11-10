//! Plugins externes (VST3 : FabFilter, Waves…) : chaque instance vit dans un registre partagé entre l'appli
//! (fenêtre du plugin, sauvegarde de ses réglages) et le moteur (le son). Le moteur ne fait jamais attendre le son :
//! si l'instance est occupée (fenêtre qui s'ouvre, réglages en cours d'enregistrement), ce bloc passe tel quel.
//! Sans la fonction « ext » (plugins Pulse, tests), un plugin externe laisse simplement passer le son.

/// Taille maximale d'un bloc donné au plugin (les blocs plus longs sont coupés en morceaux)
pub const MAX_BLOCK: usize = 1024;

#[cfg(feature = "ext")]
mod imp {
    use super::MAX_BLOCK;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, OnceLock};
    pub use vst3_host::Plugin;
    pub use vst3_host;
    #[cfg(target_os = "macos")]
    pub use rack;

    /// Une instance de plugin externe : VST3 (Mac et Windows) ou Audio Unit (Mac)
    pub enum Inst {
        /// partagé à part : la fenêtre VST3 (vst3_host::PluginWindow) veut son propre accès au plugin
        Vst(Arc<Mutex<Plugin>>),
        #[cfg(target_os = "macos")]
        Au(Box<rack::au::AudioUnitPlugin>, Vec<f32>, Vec<f32>),
    }
    impl Inst {
        pub fn latency(&self) -> u32 { match self { Inst::Vst(p) => p.lock().map(|g| g.latency_samples()).unwrap_or(0), #[cfg(target_os = "macos")] Inst::Au(p, ..) => p.latency_samples() } }
        /// Réglage n° `id` à `v` (0..1), pour l'automation
        pub fn set_param(&mut self, id: u32, v: f64) {
            match self {
                Inst::Vst(p) => { if let Some(mut g) = lock_soon(p, 3000) { let _ = g.set_parameter_at(id, v, 0); } }
                #[cfg(target_os = "macos")]
                Inst::Au(p, ..) => { use rack::PluginInstance; let _ = p.set_parameter(id as usize, v as f32); }
            }
        }
    }
    pub type Shared = Arc<Mutex<Inst>>;
    /// Nombre de blocs passés SANS le plugin parce que l'appli le tenait (doit rester à 0 : chaque bloc sauté s'entend)
    pub static MISSES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    fn miss() { MISSES.fetch_add(1, std::sync::atomic::Ordering::Relaxed); }
    /// Prend le verrou en patientant au plus `max_us` microsecondes (l'appli ne le garde que très peu de temps :
    /// lire les réglages, enregistrer l'état). Sans ça, le bloc passait sans le plugin → petit accroc audible.
    pub fn lock_soon<T>(m: &Mutex<T>, max_us: u64) -> Option<std::sync::MutexGuard<'_, T>> {
        let t0 = std::time::Instant::now();
        loop {
            if let Ok(g) = m.try_lock() { return Some(g); }
            if t0.elapsed().as_micros() as u64 > max_us { return None; }
            std::thread::yield_now();
        }
    }

    fn reg() -> &'static Mutex<HashMap<String, Shared>> {
        static R: OnceLock<Mutex<HashMap<String, Shared>>> = OnceLock::new();
        R.get_or_init(|| Mutex::new(HashMap::new()))
    }
    /// Range une instance prête (chargée, réglée à la bonne fréquence, en marche) sous son identifiant (« vst#k3j2 »)
    pub fn insert(id: &str, p: Inst) -> Shared { let s = Arc::new(Mutex::new(p)); reg().lock().unwrap().insert(id.to_owned(), s.clone()); s }
    pub fn get(id: &str) -> Option<Shared> { reg().lock().unwrap().get(id).cloned() }
    pub fn remove(id: &str) -> Option<Shared> { reg().lock().unwrap().remove(id) }
    pub fn ids() -> Vec<String> { reg().lock().unwrap().keys().cloned().collect() }
    /// Retard du plugin (échantillons) : compensé par le moteur comme celui du Pitch et des machines analogiques
    pub fn latency(id: &str) -> u32 { get(id).and_then(|s| s.lock().ok().map(|g| g.latency())).unwrap_or(0) }

    // Génération de chaque instance : à chaque nouveau mixeur (fondu entre l'ancien et le nouveau), seul le plus récent
    // fait passer le son dans le plugin ; l'ancien laisse passer le son tel quel le temps du fondu (sinon deux sons
    // différents traverseraient le même plugin dans le même bloc → clic)
    fn gens() -> &'static Mutex<HashMap<String, Arc<std::sync::atomic::AtomicU64>>> {
        static G: OnceLock<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicU64>>>> = OnceLock::new();
        G.get_or_init(|| Mutex::new(HashMap::new()))
    }
    pub struct ExtSlot { inst: Option<Shared>, buf: vst3_host::AudioBuffers, gen: u64, latest: Arc<std::sync::atomic::AtomicU64>,
        /// automation : (réglage du plugin, courbe 0..1), position en échantillons depuis `from` (secondes)
        auto: Vec<(u32, crate::model::Curve, f64)>, pos: usize, from: f64, sr: f64 }
    impl ExtSlot {
        pub fn new(id: &str, sr: f64) -> Self {
            let latest = gens().lock().unwrap().entry(id.to_owned()).or_default().clone();
            let gen = latest.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            Self { inst: get(id), buf: vst3_host::AudioBuffers::new(2, 2, MAX_BLOCK, sr), gen, latest, auto: Vec::new(), pos: 0, from: 0.0, sr }
        }
        pub fn is_live(&self) -> bool { self.inst.is_some() }
        /// Courbes « fx:vst#…:<n° du réglage> » (valeurs 0..1 = valeurs du plugin)
        pub fn set_auto(&mut self, curves: Vec<(u32, crate::model::Curve)>, from: f64) { self.auto = curves.into_iter().map(|(p, c)| (p, c, -1.0)).collect(); self.from = from; self.pos = 0; }
        pub fn seek(&mut self, t: f64) { self.from = t; self.pos = 0; }
        pub fn process(&mut self, left: &mut [f32], right: &mut [f32], mono: bool) {
            let Some(p) = &self.inst else { if mono { right.copy_from_slice(left); } return };
            if self.latest.load(std::sync::atomic::Ordering::SeqCst) != self.gen { if mono { right.copy_from_slice(left); } return; }
            let Some(mut g) = lock_soon(p, 3000) else { miss(); if mono { right.copy_from_slice(left); } return };
            let mut at = 0;
            while at < left.len() {
                let n = (left.len() - at).min(MAX_BLOCK);
                // longueur des tampons = taille du bloc pour le plugin ; capacité déjà réservée : aucune allocation
                for ch in 0..2 { self.buf.inputs[ch].resize(n, 0.0); self.buf.outputs[ch].resize(n, 0.0); }
                self.buf.block_size = n;
                // automation : valeur de la courbe au début du bloc (envoyée seulement si elle bouge)
                if !self.auto.is_empty() {
                    let t = self.from + (self.pos + at) as f64 / self.sr;
                    for a in &mut self.auto { let v = a.1.at(t).clamp(0.0, 1.0); if (v - a.2).abs() > 1e-6 { a.2 = v; g.set_param(a.0, v); } }
                }
                let ok = match &mut *g {
                    Inst::Vst(p) => {
                        let Some(mut p) = lock_soon(p, 3000) else { miss(); if mono { right[at..at + n].copy_from_slice(&left[at..at + n]); } at += n; continue; };
                        self.buf.inputs[0].copy_from_slice(&left[at..at + n]);
                        self.buf.inputs[1].copy_from_slice(if mono { &left[at..at + n] } else { &right[at..at + n] });
                        if p.process_audio(&mut self.buf).is_ok() {
                            left[at..at + n].copy_from_slice(&self.buf.outputs[0]);
                            right[at..at + n].copy_from_slice(&self.buf.outputs[1]);
                            true
                        } else { false }
                    }
                    #[cfg(target_os = "macos")]
                    Inst::Au(p, ol, or) => {
                        use rack::PluginInstance;
                        let (il, ir) = (&left[at..at + n], if mono { &left[at..at + n] } else { &right[at..at + n] });
                        let r = p.process(&[il, ir], &mut [&mut ol[..n], &mut or[..n]], n);
                        if r.is_ok() { left[at..at + n].copy_from_slice(&ol[..n]); right[at..at + n].copy_from_slice(&or[..n]); true } else { false }
                    }
                };
                if !ok && mono { right[at..at + n].copy_from_slice(&left[at..at + n]); }
                at += n;
            }
            self.pos += left.len();
        }
    }
}

#[cfg(not(feature = "ext"))]
mod imp {
    pub struct ExtSlot;
    pub fn latency(_id: &str) -> u32 { 0 }
    impl ExtSlot {
        pub fn new(_id: &str, _sr: f64) -> Self { ExtSlot }
        pub fn is_live(&self) -> bool { false }
        pub fn process(&mut self, left: &mut [f32], right: &mut [f32], mono: bool) { if mono { right.copy_from_slice(left); } }
        pub fn set_auto(&mut self, _c: Vec<(u32, crate::model::Curve)>, _from: f64) {}
        pub fn seek(&mut self, _t: f64) {}
    }
}

pub use imp::*;
