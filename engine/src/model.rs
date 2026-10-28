//! Modèle de projet — même JSON que le prototype web (project.json dans un .pulse).
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub bpm: f64,
    pub tracks: Vec<Track>,
    pub buses: Vec<Bus>,
    /// Envois : effets communs à 100 % d'effet, dosés piste par piste
    pub sends: Vec<Send>,
    /// Plafond du limiteur de sécurité en dB (-0,3 par défaut)
    #[serde(rename = "ceilingDb")]
    pub ceiling_db: Option<f64>,
    /// Changements de tempo en cours de morceau (paliers) : `beat` = noires depuis le début (tempo.js)
    pub tempos: Vec<TempoChange>,
    /// Fader Master (100 = 0 dB affiché, comme `masterVolume` du navigateur)
    #[serde(rename = "masterVolume")]
    pub master_volume: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct TempoChange {
    pub beat: f64,
    pub bpm: f64,
}

impl Project {
    pub fn ceiling(&self) -> f64 {
        self.ceiling_db.unwrap_or(-0.3).clamp(-6.0, 0.0)
    }
    /// Paliers de tempo `(seconde de début, bpm)`, le premier à 0 s — même calcul que `tempoSegments` de tempo.js
    pub fn tempo_segments(&self) -> Vec<(f64, f64)> {
        let clamp = |b: f64| if b.is_finite() && b != 0.0 { b.clamp(20.0, 400.0) } else { 120.0 };
        let mut list: Vec<(f64, f64)> = self.tempos.iter().filter(|e| e.beat.is_finite() && e.beat >= 0.0).map(|e| (e.beat, clamp(e.bpm))).collect();
        list.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        if list.is_empty() || list[0].0 > 1e-9 { list.insert(0, (0.0, clamp(self.bpm))); }
        let mut segs: Vec<(f64, f64, f64)> = Vec::new();   // (beat, bpm, sec)
        for (i, (beat, bpm)) in list.iter().enumerate() {
            if i > 0 && beat - list[i - 1].0 < 1e-9 { if let Some(l) = segs.last_mut() { l.1 = *bpm; } continue; }
            let sec = segs.last().map_or(0.0, |p| p.2 + (beat - p.0) * 60.0 / p.1);
            segs.push((*beat, *bpm, sec));
        }
        segs.into_iter().map(|(_, b, s)| (s, b)).collect()
    }
    /// Tempo à l'instant `sec`
    pub fn bpm_at(&self, sec: f64) -> f64 {
        let segs = self.tempo_segments();
        segs.iter().rev().find(|s| s.0 <= sec + 1e-9).map_or(segs[0].1, |s| s.1)
    }
}

/// Un envoi : `kind` = "reverb" ou "delay". Temps de l'écho en `ms` ou en `beats` ; `pre` = pré-délai de la reverb (ms).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct Send {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub size: Option<f64>,
    pub pre: Option<f64>,
    pub beats: Option<f64>,
    pub ms: Option<f64>,
    pub feedback: Option<f64>,
    pub pp: Option<f64>,
    pub volume: Option<f64>,
    pub muted: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Track {
    pub name: String,
    /// Délai de piste en ms (+ = plus tard, − = plus tôt) : décale le son, pas l'automation (comme audio.js)
    pub delay_ms: Option<f64>,
    pub volume: Option<f64>, // 0–100, défaut 100 (0 dB)
    pub pan: Option<f64>,    // -100 … 100
    /// Piste forcée en mono (les deux côtés mélangés avant les effets), comme le bouton Mono / Stéréo de Logic
    pub mono: Option<bool>,
    pub muted: bool,
    pub solo: bool,
    pub output: Option<String>,
    /// Ordre des effets choisi par l'utilisateur (vide = ordre habituel)
    pub fx_order: Vec<String>,
    /// Dose envoyée dans chaque envoi (identifiant → 0-100), prise après le volume et le pan
    pub sends: std::collections::HashMap<String, f64>,
    /// Envois vers un groupe (identifiant du groupe → 0-100), comme un Aux de Logic
    pub bus_sends: std::collections::HashMap<String, f64>,
    /// Envois pris avant le fader (« send:<id> » ou « busSend:<id> » → true), comme le Pre de Logic
    pub pre_sends: std::collections::HashMap<String, bool>,
    pub clips: Vec<Clip>,
    /// Effets actifs : "eq", "sat", "deess", "comp", "reverb"
    pub effects: Vec<String>,
    pub effect_params: EffectParams,
    pub automation: Automation,
    /// Piste gelée : son rendu (régions + effets, avant le fader) joué à la place (voir render::with_frozen)
    pub frozen: Option<Frozen>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Frozen {
    pub id: String,
    /// Facteur à réappliquer (le rendu est ramené sous 0 dBFS pour le WAV 16 bits)
    pub gain: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct EffectParams {
    pub filter: Option<FilterParams>,
    pub gate: Option<GateParams>,
    pub chorus: Option<ModParams>,
    pub flanger: Option<ModParams>,
    pub phaser: Option<ModParams>,
    pub tremolo: Option<ModParams>,
    pub doubler: Option<ModParams>,
    pub slapback: Option<ModParams>,
    pub crush: Option<CrushParams>,
    pub util: Option<UtilParams>,
    pub width: Option<WidthParams>,
    pub eq: Option<EqParams>,
    pub sat: Option<SatParams>,
    pub deess: Option<DeessParams>,
    pub comp: Option<CompParams>,
    pub mband: Option<MbandParams>,
    pub msat: Option<MsatParams>,
    pub reverb: Option<ReverbParams>,
    pub delay: Option<DelayParams>,
    pub master: Option<MasterParams>,
    pub limit: Option<LimitParams>,
    pub pitch: Option<PitchParams>,
}

/// Saturation multibande : bande de départ (`base`, le reste du son) + jusqu'à 6 bandes libres ; mélange (%) et sortie (dB) globaux,
/// `ag` = auto gain (par défaut oui)
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct MsatParams {
    pub bands: Vec<MsatBand>,
    pub mix: Option<f64>,
    pub out: Option<f64>,
    pub ag: Option<bool>,
}
/// Une bande : style (bande, lampe, ampli, transfo, repli, lofi) et variante (0-2), chaleur (0-100), dynamique (-50 aère … +50 tasse),
/// résonance (0-100), ton du son saturé (dB : grave, médium, aigu, présence), mélange (%), niveau (dB), pente (12/24/48)
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct MsatBand {
    pub base: Option<bool>,
    pub lo: Option<f64>,
    pub hi: Option<f64>,
    pub sty: Option<String>,
    pub va: Option<f64>,
    pub heat: Option<f64>,
    #[serde(rename = "dyn")]
    pub dynamics: Option<f64>,
    pub fb: Option<f64>,
    pub lo2: Option<f64>,
    pub md: Option<f64>,
    pub hi2: Option<f64>,
    pub pr: Option<f64>,
    pub mix: Option<f64>,
    pub out: Option<f64>,
    pub solo: Option<bool>,
    pub mute: Option<bool>,
    pub slope: Option<f64>,
    pub on: Option<bool>,
}

/// Multibande à bandes libres (jusqu'à 6)
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct MbandParams {
    pub bands: Vec<MbandBand>,
}
/// Une bande : limites (Hz ; 20 / 20000 = pas de limite), seuil (dB), plage (dB : négatif = compresser, positif = remonter),
/// attaque / relâchement (ms), sortie (dB), solo, muet
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct MbandBand {
    pub lo: Option<f64>,
    pub hi: Option<f64>,
    pub thr: Option<f64>,
    pub range: Option<f64>,
    pub att: Option<f64>,
    pub rel: Option<f64>,
    pub out: Option<f64>,
    pub solo: Option<bool>,
    pub mute: Option<bool>,
    pub on: Option<bool>,
}

/// Pitch : `semi` en demi-tons (-12 à +12), `mix` en pourcentage (100 = seulement la voix transposée).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct PitchParams {
    pub semi: Option<f64>,
    pub mix: Option<f64>,
}

/// Filtre : coupe-bas `hpf` et coupe-haut `lpf` en Hz (≤ 20 et ≥ 20 000 = éteint), pente 12 ou 24 dB par octave.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct FilterParams {
    pub hpf: Option<f64>,
    pub lpf: Option<f64>,
    pub slope: Option<f64>,
}

/// Effets de mouvement (chorus, flanger, phaser, trémolo, doubleur, slapback) : tous les curseurs sont optionnels,
/// chaque effet a ses valeurs de départ (mêmes que dans audio.js).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct ModParams {
    pub rate: Option<f64>,
    pub depth: Option<f64>,
    pub feedback: Option<f64>,
    pub mix: Option<f64>,
    pub time: Option<f64>,
    pub width: Option<f64>,
}

/// Bitcrusher : bits conservés, un échantillon sur `down`, mélange en %.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct CrushParams {
    pub bits: Option<f64>,
    pub down: Option<f64>,
    pub mix: Option<f64>,
}

/// Utilitaire : volume en dB, inversion de phase et mono (0 ou 1).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct UtilParams {
    pub gain: Option<f64>,
    pub invert: Option<f64>,
    pub mono: Option<f64>,
}

/// Largeur stéréo en % (100 = inchangé, 0 = mono).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct WidthParams {
    pub width: Option<f64>,
}

/// Gate : seuil en dB, retour du son en ms, coupure en dB (positive = de combien on baisse).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct GateParams {
    pub threshold: Option<f64>,
    pub release: Option<f64>,
    pub reduction: Option<f64>,
    /// Ratio (absent = gate franc), genou (dB), attaque et maintien (ms), filtre du déclencheur (Hz)
    pub ratio: Option<f64>,
    pub knee: Option<f64>,
    pub attack: Option<f64>,
    pub hold: Option<f64>,
    pub hp: Option<f64>,
    pub lp: Option<f64>,
}

/// Finition (premaster) : graves et clarté en dB, colle et chaleur de 0 à 100, largeur (1 = inchangé), volume en dB.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct MasterParams {
    pub body: f64,
    pub air: f64,
    pub glue: f64,
    pub warm: f64,
    pub width: Option<f64>,
    pub push: f64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct LimitParams {
    pub ceiling: Option<f64>,
    /// Gain d'entrée (dB), relâchement (ms, 120 par défaut), anticipation (ms, 1,5 par défaut), pic réel (1 = oui)
    pub gain: Option<f64>,
    pub release: Option<f64>,
    pub lookahead: Option<f64>,
    pub tp: Option<f64>,
    /// Style : 0 Transparent, 1 Doux, 2 Franc
    pub style: Option<f64>,
}

/// Écho. `wet` et `feedback` en pourcentage ; le temps est soit `ms`, soit `beats` (nombre de temps, suit le tempo).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct DelayParams {
    pub wet: Option<f64>,
    pub feedback: Option<f64>,
    pub ms: Option<f64>,
    pub beats: Option<f64>,
    /// Ping-pong : 1 = les répétitions alternent gauche / droite
    pub pp: Option<f64>,
    /// Voix d'origine en pourcentage (100 par défaut ; 0 = seulement l'écho, pour une piste d'effet ponctuel)
    pub dry: Option<f64>,
    /// Coupe-bas sur ce qui entre dans l'écho (Hz, 0 = rien) et coupe-haut des répétitions (Hz, 4000 par défaut)
    pub hpf: Option<f64>,
    pub lpf: Option<f64>,
    /// Ducking (0-100 %) : l'écho se pousse quand la voix joue
    pub duck: Option<f64>,
    /// EQ de l'écho : il colore les répétitions, pas la voix d'origine
    pub eq: Option<Vec<EqBand>>,
}

/// `wet` en pourcentage (0-100), `size` de 1.2 (petite pièce) à 3.2 (grande salle).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct ReverbParams {
    pub wet: Option<f64>,
    pub size: Option<f64>,
    /// Déclin de 0,5 à 5 (2,5 = neutre) : queue plus courte ou plus longue
    pub decay: Option<f64>,
    /// Pré-délai (ms), grave / aigu retirés de ce qui entre (Hz, 0 = rien), ducking (0-100 %)
    pub pre: Option<f64>,
    pub low: Option<f64>,
    pub high: Option<f64>,
    pub duck: Option<f64>,
    /// Sortie de l'effet (dB, 0 = normal) : un bus d'envoi Reverb la met à -9,5 dB pour sonner comme un retour
    pub out: Option<f64>,
    /// Brillance de la queue (0 sombre … 100 brillant, 50 = neutre)
    pub bright: Option<f64>,
    /// Largeur de la queue (0 mono, 100 normal, 150 plus large)
    pub width: Option<f64>,
    /// EQ de la reverb : il ne touche que l'effet
    pub eq: Option<Vec<EqBand>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct DeessParams {
    pub amount: f64,
    pub freq: Option<f64>,
    /// Nouveau De-esser (dès que `thr` est donné) : seuil (dB), plage (dB), zone des « s » (Hz),
    /// Large (baisse toute la voix) au lieu de Séparé, Tout-terrain (`rel`, niveau relatif) au lieu de Voix seule
    pub thr: Option<f64>,
    pub range: Option<f64>,
    pub lo: Option<f64>,
    pub hi: Option<f64>,
    pub wide: Option<bool>,
    pub rel: Option<bool>,
}

/// Seuil en dB, attaque et relâchement en millisecondes.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct CompParams {
    pub threshold: Option<f64>,
    pub ratio: Option<f64>,
    pub attack: Option<f64>,
    pub release: Option<f64>,
    /// Genou doux en dB (défaut 10, 0 = net)
    pub knee: Option<f64>,
    pub makeup: Option<f64>,
    /// Caractère : 0 Propre, 1 Opto, 2 FET, 3 Bus (défaut 0)
    pub mode: Option<f64>,
    /// Bus : relâchement automatique (0,1 s → 1,2 s)
    #[serde(rename = "autoRel")]
    pub auto_rel: Option<f64>,
    /// Mélange compressé / d'origine, 0–100 (défaut 100)
    pub mix: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EqParams {
    /// EQ libre : si présent, remplace les quatre bandes fixes ci-dessous.
    pub bands: Option<Vec<EqBand>>,
    /// Gain de sortie de l'EQ libre (dB), réglé par l'Auto gain
    pub out: Option<f64>,
    pub hpf: Option<f64>,
    pub mid_gain: Option<f64>,
    pub presence: Option<f64>,
    pub air: Option<f64>,
    pub lpf: Option<f64>,
}

/// Une bande de l'EQ libre : "bell", "lowshelf", "highshelf", "hpf", "lpf", "notch" ou "tilt". `q` est linéaire.
/// `slope` : pente des coupe-bas / coupe-haut en dB/oct (12 par défaut, 24, 36, 48).
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct EqBand {
    #[serde(rename = "type")]
    pub kind: String,
    pub freq: f64,
    pub gain: f64,
    pub q: f64,
    pub on: Option<bool>,
    pub slope: Option<f64>,
    /// Point dynamique : jusqu'où le gain bouge (dB, négatif = creuse quand ça dépasse) ; 0 / absent = statique
    #[serde(rename = "dyn")]
    pub dyn_range: Option<f64>,
    /// Seuil du point dynamique (dB, niveau dans la zone du point)
    pub thr: Option<f64>,
}
impl Default for EqBand {
    fn default() -> Self { Self { kind: "bell".into(), freq: 1000.0, gain: 0.0, q: 1.0, on: None, slope: None, dyn_range: None, thr: None } }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct SatParams {
    pub drive: f64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct Automation {
    pub volume: Option<Curve>,
    /// Les autres réglages : « pan », « send:<id> », « busSend:<id> », « fx:<effet>:<réglage> » (valeurs entre 0 et 1)
    #[serde(flatten)]
    pub other: std::collections::HashMap<String, Curve>,
}

impl Automation {
    /// La courbe d'un réglage, points rangés dans l'ordre ; None si elle est vide
    pub fn curve(&self, key: &str) -> Option<Curve> {
        let c = if key == "volume" { self.volume.as_ref() } else { self.other.get(key) }?;
        if c.points.is_empty() {
            return None;
        }
        let mut c = c.clone();
        c.points.sort_by(|a, b| a.t.total_cmp(&b.t));
        Some(c)
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct Curve {
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, Copy, Deserialize, Default)]
#[serde(default)]
pub struct Point {
    pub t: f64,
    pub v: f64,
}

impl Curve {
    /// Valeur à l'instant `t` (droites entre les points, plateau avant et après).
    pub fn at(&self, t: f64) -> f64 {
        let p = &self.points;
        if p.is_empty() {
            return 1.0;
        }
        if t <= p[0].t {
            return p[0].v;
        }
        for w in p.windows(2) {
            if t <= w[1].t {
                let (a, b) = (w[0], w[1]);
                return if b.t == a.t { b.v } else { a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t) };
            }
        }
        p[p.len() - 1].v
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Clip {
    pub id: String,
    pub start: f64,
    pub duration: f64,
    /// Début du clip dans le fichier source (édition non destructive)
    pub offset: Option<f64>,
    pub loop_end: Option<f64>,
    pub fade_in: Option<f64>,
    pub fade_out: Option<f64>,
    /// Courbure des fondus : niveau = p^k (absent ou 1 = droit)
    pub fade_in_curve: Option<f64>,
    pub fade_out_curve: Option<f64>,
    pub gain: Option<f64>,
    pub muted: bool,
    pub recording: bool,
    /// Effets posés sur la région seule (passent avant les effets de la piste)
    pub fx: Option<ClipFx>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ClipFx {
    pub effects: Vec<String>,
    pub effect_params: EffectParams,
    pub fx_order: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Bus {
    pub id: String,
    pub name: String,
    pub output: Option<String>,
    pub volume: Option<f64>, // 0–100, défaut 100
    pub muted: bool,
    /// Effets communs du groupe (mêmes noms que sur une piste)
    pub effects: Vec<String>,
    pub fx_order: Vec<String>,
    pub effect_params: EffectParams,
    /// Courbe de volume du groupe (comme sur une piste)
    pub automation: Automation,
    /// Gauche / droite du groupe (−100 … 100), comme une piste
    pub pan: Option<f64>,
    /// Envois du groupe (reverb, écho…) : dose 0–100 par envoi, prise après son volume et son pan
    pub sends: std::collections::HashMap<String, f64>,
    /// Envois vers un autre groupe (identifiant → 0-100)
    pub bus_sends: std::collections::HashMap<String, f64>,
    /// Envois pris avant le fader (même forme que sur une piste)
    pub pre_sends: std::collections::HashMap<String, bool>,
}

impl Bus {
    /// Un groupe est une étape de mixage à part entière s'il a des effets, une courbe de volume, un pan ou des envois.
    pub fn is_stage(&self) -> bool {
        !self.effects.is_empty()
            || self.automation.volume.as_ref().is_some_and(|c| !c.points.is_empty())
            || self.automation.other.values().any(|c| !c.points.is_empty())
            || self.pan.is_some_and(|p| p != 0.0)
            || self.sends.values().any(|l| *l > 0.0)
            || self.bus_sends.values().any(|l| *l > 0.0)
    }
}

impl Clip {
    /// Fin du clip dans le projet, répétitions comprises.
    pub fn end(&self) -> f64 {
        let natural = self.start + self.duration;
        match self.loop_end {
            Some(l) if l > natural => l,
            _ => natural,
        }
    }
}

impl Project {
    pub fn end(&self) -> f64 {
        self.tracks
            .iter()
            .flat_map(|t| t.clips.iter())
            .filter(|c| !c.muted && !c.recording)
            .map(Clip::end)
            .fold(0.0, f64::max)
    }

    pub fn is_audible(&self, track: &Track) -> bool {
        let any_solo = self.tracks.iter().any(|t| t.solo);
        !track.muted && (!any_solo || track.solo)
    }

    /// Gain cumulé de la chaîne de groupes d'une piste jusqu'au master.
    /// Remonte la chaîne des groupes depuis `output` jusqu'au premier groupe qui a des effets (ou jusqu'au master).
    /// Retourne le volume cumulé sur le trajet et l'indice de ce groupe (`None` = on est arrivé au master).
    pub fn route(&self, output: Option<&str>) -> (f64, Option<usize>) {
        let mut gain = 1.0;
        let mut next = output.map(str::to_owned);
        for _ in 0..8 {
            let Some(id) = next.as_deref() else { break };
            if id == "master" {
                break;
            }
            let Some(i) = self.buses.iter().position(|b| b.id == id) else { break };
            if self.buses[i].is_stage() {
                return (gain, Some(i));
            }
            let bus = &self.buses[i];
            gain *= if bus.muted { 0.0 } else { bus.volume.unwrap_or(100.0) / 100.0 };
            next = bus.output.clone();
        }
        (gain, None)
    }

    pub fn bus_gain(&self, output: Option<&str>) -> f64 {
        let mut gain = 1.0;
        let mut next = output.map(str::to_owned);
        for _ in 0..8 {
            let Some(id) = next.as_deref() else { break };
            if id == "master" {
                break;
            }
            let Some(bus) = self.buses.iter().find(|b| b.id == id) else { break };
            gain *= if bus.muted { 0.0 } else { bus.volume.unwrap_or(100.0) / 100.0 };
            next = bus.output.clone();
        }
        gain
    }
}
