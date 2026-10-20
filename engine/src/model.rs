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
}

impl Project {
    pub fn ceiling(&self) -> f64 {
        self.ceiling_db.unwrap_or(-0.3).clamp(-6.0, 0.0)
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
    pub volume: Option<f64>,
    pub muted: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Track {
    pub name: String,
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
    pub clips: Vec<Clip>,
    /// Effets actifs : "eq", "sat", "deess", "comp", "reverb"
    pub effects: Vec<String>,
    pub effect_params: EffectParams,
    pub automation: Automation,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct EffectParams {
    pub eq: Option<EqParams>,
    pub sat: Option<SatParams>,
    pub deess: Option<DeessParams>,
    pub comp: Option<CompParams>,
    pub reverb: Option<ReverbParams>,
    pub delay: Option<DelayParams>,
    pub master: Option<MasterParams>,
    pub limit: Option<LimitParams>,
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
}

/// Écho. `wet` et `feedback` en pourcentage ; le temps est soit `ms`, soit `beats` (nombre de temps, suit le tempo).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct DelayParams {
    pub wet: Option<f64>,
    pub feedback: Option<f64>,
    pub ms: Option<f64>,
    pub beats: Option<f64>,
}

/// `wet` en pourcentage (0-100), `size` de 1.2 (petite pièce) à 3.2 (grande salle).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct ReverbParams {
    pub wet: Option<f64>,
    pub size: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct DeessParams {
    pub amount: f64,
    pub freq: Option<f64>,
}

/// Seuil en dB, attaque et relâchement en millisecondes.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct CompParams {
    pub threshold: Option<f64>,
    pub ratio: Option<f64>,
    pub attack: Option<f64>,
    pub release: Option<f64>,
    pub makeup: Option<f64>,
    /// Mélange compressé / d'origine, 0–100 (défaut 100)
    pub mix: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EqParams {
    /// EQ libre : si présent, remplace les quatre bandes fixes ci-dessous.
    pub bands: Option<Vec<EqBand>>,
    pub hpf: Option<f64>,
    pub mid_gain: Option<f64>,
    pub presence: Option<f64>,
    pub air: Option<f64>,
    pub lpf: Option<f64>,
}

/// Une bande de l'EQ libre : "bell", "lowshelf", "highshelf", "hpf" ou "lpf". `q` est linéaire.
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct EqBand {
    #[serde(rename = "type")]
    pub kind: String,
    pub freq: f64,
    pub gain: f64,
    pub q: f64,
    pub on: Option<bool>,
}
impl Default for EqBand {
    fn default() -> Self { Self { kind: "bell".into(), freq: 1000.0, gain: 0.0, q: 1.0, on: None } }
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
}

impl Bus {
    /// Un groupe est une étape de mixage à part entière s'il a des effets, une courbe de volume, un pan ou des envois.
    pub fn is_stage(&self) -> bool {
        !self.effects.is_empty()
            || self.automation.volume.as_ref().is_some_and(|c| !c.points.is_empty())
            || self.pan.is_some_and(|p| p != 0.0)
            || self.sends.values().any(|l| *l > 0.0)
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
