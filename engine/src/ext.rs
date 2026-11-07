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
    pub type Shared = Arc<Mutex<Plugin>>;

    fn reg() -> &'static Mutex<HashMap<String, Shared>> {
        static R: OnceLock<Mutex<HashMap<String, Shared>>> = OnceLock::new();
        R.get_or_init(|| Mutex::new(HashMap::new()))
    }
    /// Range une instance prête (chargée, réglée à la bonne fréquence, en marche) sous son identifiant (« vst#k3j2 »)
    pub fn insert(id: &str, p: Plugin) -> Shared { let s = Arc::new(Mutex::new(p)); reg().lock().unwrap().insert(id.to_owned(), s.clone()); s }
    pub fn get(id: &str) -> Option<Shared> { reg().lock().unwrap().get(id).cloned() }
    pub fn remove(id: &str) -> Option<Shared> { reg().lock().unwrap().remove(id) }
    pub fn ids() -> Vec<String> { reg().lock().unwrap().keys().cloned().collect() }
    /// Retard du plugin (échantillons) : compensé par le moteur comme celui du Pitch et des machines analogiques
    pub fn latency(id: &str) -> u32 { get(id).and_then(|s| s.lock().ok().map(|g| g.latency_samples())).unwrap_or(0) }

    // Génération de chaque instance : à chaque nouveau mixeur (fondu entre l'ancien et le nouveau), seul le plus récent
    // fait passer le son dans le plugin ; l'ancien laisse passer le son tel quel le temps du fondu (sinon deux sons
    // différents traverseraient le même plugin dans le même bloc → clic)
    fn gens() -> &'static Mutex<HashMap<String, Arc<std::sync::atomic::AtomicU64>>> {
        static G: OnceLock<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicU64>>>> = OnceLock::new();
        G.get_or_init(|| Mutex::new(HashMap::new()))
    }
    pub struct ExtSlot { inst: Option<Shared>, buf: vst3_host::AudioBuffers, gen: u64, latest: Arc<std::sync::atomic::AtomicU64> }
    impl ExtSlot {
        pub fn new(id: &str, sr: f64) -> Self {
            let latest = gens().lock().unwrap().entry(id.to_owned()).or_default().clone();
            let gen = latest.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            Self { inst: get(id), buf: vst3_host::AudioBuffers::new(2, 2, MAX_BLOCK, sr), gen, latest }
        }
        pub fn is_live(&self) -> bool { self.inst.is_some() }
        pub fn process(&mut self, left: &mut [f32], right: &mut [f32], mono: bool) {
            let Some(p) = &self.inst else { if mono { right.copy_from_slice(left); } return };
            if self.latest.load(std::sync::atomic::Ordering::SeqCst) != self.gen { if mono { right.copy_from_slice(left); } return; }
            let Ok(mut g) = p.try_lock() else { if mono { right.copy_from_slice(left); } return };
            let mut at = 0;
            while at < left.len() {
                let n = (left.len() - at).min(MAX_BLOCK);
                // longueur des tampons = taille du bloc pour le plugin ; capacité déjà réservée : aucune allocation
                for ch in 0..2 { self.buf.inputs[ch].resize(n, 0.0); self.buf.outputs[ch].resize(n, 0.0); }
                self.buf.block_size = n;
                self.buf.inputs[0].copy_from_slice(&left[at..at + n]);
                self.buf.inputs[1].copy_from_slice(if mono { &left[at..at + n] } else { &right[at..at + n] });
                if g.process_audio(&mut self.buf).is_ok() {
                    left[at..at + n].copy_from_slice(&self.buf.outputs[0]);
                    right[at..at + n].copy_from_slice(&self.buf.outputs[1]);
                } else if mono { right[at..at + n].copy_from_slice(&left[at..at + n]); }
                at += n;
            }
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
    }
}

pub use imp::*;
