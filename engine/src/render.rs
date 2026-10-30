//! Mixage hors-ligne : mêmes règles que `buildGraph()` du prototype web.
//! (EQ, saturation, de-esser, compresseur, reverb et courbe de volume portés ; effets de groupe et limiteur : pas encore.)
use crate::model::{Clip, Curve, Project};
use std::collections::HashMap;
use std::f64::consts::FRAC_PI_2;

/// Audio source d'un clip : canaux séparés, à sa fréquence d'origine.
/// Les échantillons sont partagés (cloner une Source ne recopie rien) et gardés en 16 bits quand le WAV l'est
/// (les sons d'un projet Pulse sont tous en 16 bits) : moitié moins de mémoire, son identique.
#[derive(Debug, Clone)]
pub struct Source {
    pub sample_rate: u32,
    data: std::sync::Arc<Samples>,
}

#[derive(Debug)]
enum Samples {
    F32(Vec<Vec<f32>>),
    I16(Vec<Vec<i16>>),
}

impl Source {
    pub fn new(sample_rate: u32, channels: Vec<Vec<f32>>) -> Self {
        Self { sample_rate, data: std::sync::Arc::new(Samples::F32(channels)) }
    }
    pub fn from_i16(sample_rate: u32, channels: Vec<Vec<i16>>) -> Self {
        Self { sample_rate, data: std::sync::Arc::new(Samples::I16(channels)) }
    }
    pub fn n_channels(&self) -> usize {
        match &*self.data { Samples::F32(c) => c.len(), Samples::I16(c) => c.len() }
    }
    /// Échantillon `i` du canal `ch` (−1…1)
    #[inline]
    pub fn sample(&self, ch: usize, i: usize) -> Option<f32> {
        match &*self.data {
            Samples::F32(c) => c.get(ch).and_then(|d| d.get(i)).copied(),
            Samples::I16(c) => c.get(ch).and_then(|d| d.get(i)).map(|&v| v as f32 * (1.0 / 32768.0)),
        }
    }
    /// Octets gardés en mémoire
    pub fn bytes(&self) -> usize {
        match &*self.data { Samples::F32(c) => c.iter().map(|d| d.len() * 4).sum(), Samples::I16(c) => c.iter().map(|d| d.len() * 2).sum() }
    }
    pub fn frames(&self) -> usize {
        match &*self.data { Samples::F32(c) => c.first().map_or(0, Vec::len), Samples::I16(c) => c.first().map_or(0, Vec::len) }
    }
    pub fn duration(&self) -> f64 {
        self.frames() as f64 / self.sample_rate as f64
    }
    /// Échantillon à l'instant `t` (secondes), interpolé.
    fn at(&self, ch: usize, t: f64) -> f32 {
        let ch = ch.min(self.n_channels().saturating_sub(1));
        let pos = t * self.sample_rate as f64;
        if pos < 0.0 {
            return 0.0;
        }
        let i = pos.floor() as usize;
        let len = self.frames();
        if i + 1 >= len {
            return self.sample(ch, i).unwrap_or(0.0);
        }
        let frac = (pos - i as f64) as f32;
        let (a, b) = (self.sample(ch, i).unwrap_or(0.0), self.sample(ch, i + 1).unwrap_or(0.0));
        a * (1.0 - frac) + b * frac
    }
}

pub type Media = HashMap<String, Source>;

/// Balance d'un son stéréo (-1 … 1) : centre = (1, 1), à fond d'un côté = √2 de ce côté, 0 de l'autre (−3 dB compensé, comme Logic).
pub fn balance_gains(pan: f64) -> (f32, f32) {
    let a = (pan.clamp(-1.0, 1.0) + 1.0) * std::f64::consts::FRAC_PI_4;
    ((std::f64::consts::SQRT_2 * a.cos()) as f32, (std::f64::consts::SQRT_2 * a.sin()) as f32)
}

pub struct RenderOptions {
    pub sample_rate: u32,
    pub master_volume: f64,
    /// Plage à rendre (secondes) ; `None` = tout le projet.
    pub range: Option<(f64, f64)>,
    /// Ne rendre qu'une piste (stem) : ignore mute/solo et les groupes.
    pub only_track: Option<usize>,
    /// Jouer à partir de cet instant (secondes) jusqu'à la fin, queue des effets comprise (lecture de l'appli).
    /// Les effets démarrent à neuf à cet endroit, comme la lecture du navigateur. Ignoré si `range` est donné.
    pub start: f64,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self { sample_rate: 48_000, master_volume: 0.8, range: None, only_track: None, start: 0.0 }
    }
}

/// Niveau du clip (gain + fondus) à `x` secondes après son début.
/// Fondu enchaîné automatique (comme dans le navigateur) : étendue du chevauchement avec une région
/// précédente (entrée) et une région suivante (sortie) de la même piste.
fn crossfade_extents(others: &[&Clip], me: &Clip) -> (f64, f64) {
    let (start, end) = (me.start, me.end());
    let (mut xin, mut xout) = (0.0f64, 0.0f64);
    for o in others {
        if std::ptr::eq(*o, me) || o.muted || o.recording || o.duration <= 0.0 {
            continue;
        }
        let o_end = o.end();
        // chevauchement partiel seulement (une région contenue dans l'autre ne fait pas de fondu enchaîné)
        if o.start < start - 1e-6 && o_end > start + 1e-6 && o_end < end - 1e-6 {
            xin = xin.max(o_end - start);
        }
        if o.start > start + 1e-6 && o.start < end - 1e-6 && o_end > end + 1e-6 {
            xout = xout.max(end - o.start);
        }
    }
    (xin, xout)
}

fn clip_level(clip: &Clip, x: f64, xin: f64, xout: f64) -> f64 {
    let total = clip.end() - clip.start;
    let fi = clip.fade_in.unwrap_or(0.0).max(xin);
    let fo = clip.fade_out.unwrap_or(0.0).max(xout);
    let mut level = clip.gain.unwrap_or(1.0);
    let k = |c: Option<f64>| c.filter(|v| *v > 0.0).map_or(1.0, |v| v.clamp(0.25, 4.0));
    if fi > 0.0 && x < fi {
        level *= (x / fi).powf(k(clip.fade_in_curve));
    }
    if fo > 0.0 && x > total - fo {
        level *= ((total - x) / fo).max(0.0).powf(k(clip.fade_out_curve));
    }
    level
}

/// Rend le projet en stéréo. Retourne (gauche, droite).
/// Envois vers un groupe (Aux) : (dose fixe, courbe éventuelle, gain jusqu'à la destination, groupe à effets de destination)
fn aux_sends(project: &Project, sends: &HashMap<String, f64>, auto: &crate::model::Automation, pre: &HashMap<String, bool>, own_out: Option<&str>, master_volume: f64) -> Vec<(f32, Option<Curve>, f32, Option<usize>, bool)> {
    let mut ids: Vec<String> = sends.keys().cloned().collect();
    for k in auto.other.keys() {
        if let Some(id) = k.strip_prefix("busSend:") {
            if !ids.iter().any(|x| x == id) {
                ids.push(id.to_owned());
            }
        }
    }
    ids.sort();
    ids.into_iter()
        .filter(|id| Some(id.as_str()) != own_out && project.buses.iter().any(|b| &b.id == id))
        .filter_map(|id| {
            let lvl = sends.get(&id).copied().unwrap_or(0.0);
            let c = auto.curve(&format!("busSend:{id}"));
            if lvl <= 0.0 && c.is_none() {
                return None;
            }
            let (g, dest) = project.route(Some(&id));
            let g = g * if dest.is_some() { 1.0 } else { master_volume };
            Some(((lvl / 100.0) as f32, c, g as f32, dest, pre.get(&format!("busSend:{id}")).copied().unwrap_or(false)))
        })
        .collect()
}

/// Délai de piste : copie du projet où les régions des pistes à délai sont décalées (même calcul que withTrackDelays dans audio.js)
fn with_track_delays(project: &Project) -> Option<Project> {
    if !project.tracks.iter().any(|t| t.delay_ms.unwrap_or(0.0) != 0.0) { return None; }
    let mut p = project.clone();
    for t in &mut p.tracks {
        let d = t.delay_ms.unwrap_or(0.0) / 1000.0;
        if d == 0.0 { continue; }
        for c in &mut t.clips {
            c.start += d;
            if let Some(le) = c.loop_end.as_mut() { *le += d; }
        }
    }
    Some(p)
}

/// Pistes gelées : une seule région (le rendu, depuis 0 s) à la place des régions, sans effets de piste
/// (même calcul que withFrozen dans audio.js). Volume, pan, envois, sortie et délai de piste restent actifs.
fn with_frozen(project: &Project, media: &Media) -> Option<Project> {
    if !project.tracks.iter().any(|t| t.frozen.is_some()) { return None; }
    let mut p = project.clone();
    for t in &mut p.tracks {
        let Some(f) = t.frozen.take() else { continue };
        t.clips = media.get(&f.id).map(|s| Clip { id: f.id.clone(), start: 0.0, duration: s.duration(), gain: Some(f.gain.unwrap_or(1.0)), ..Default::default() }).into_iter().collect();
        t.effects.clear();
        t.mono = Some(false);
    }
    Some(p)
}

type SendTap = (usize, f32, Option<Curve>, bool);
type AuxTap = (f32, Option<Curve>, f32, Option<usize>, bool);

/// Une région prête à jouer : fondus enchaînés calculés, chaîne d'effets de région gardée d'un bloc à l'autre
struct ClipRt { clip: Clip, xin: f64, xout: f64, fx: Option<crate::fx::Chain>, src_stereo: bool, out_stereo: bool, first: usize, last: usize }

struct TrackRt {
    /// Indice de la piste dans le projet
    idx: usize,
    /// 1 = la piste s'entend, 0 = muette (mute / solo d'une autre) : elle continue de tourner pour qu'on puisse la remettre en direct
    on: f32,
    /// Valeurs entendues, qui glissent vers les réglages (≈ 10 ms) quand on les change en direct : pas de clic
    on_s: f32,
    vol_s: f64,
    pan_s: f64,
    route_s: f32,
    clips: Vec<ClipRt>,
    force_mono: bool,
    stereo_in: bool,
    mono_in: bool,
    stereo: bool,
    chain: crate::fx::Chain,
    vol: f64,
    route_gain: f32,
    dest: Option<usize>,
    sends: Vec<SendTap>,
    aux: Vec<AuxTap>,
    curve: Option<Curve>,
    pan_curve: Option<Curve>,
    pan0: f64,
}

struct BusRt {
    i: usize,
    stage_dest: Option<usize>,
    chain: crate::fx::Chain,
    own: f64,
    up: f64,
    dest: Option<usize>,
    muted: bool,
    curve: Option<Curve>,
    pan_curve: Option<Curve>,
    pan0: f64,
    law0: (f32, f32),
    own_s: f64,
    pan_s: f64,
    route_s: f32,
    aux: Vec<AuxTap>,
    sends: Vec<SendTap>,
}

/// Mixeur bloc par bloc : même calcul que `render`, mais le morceau peut être joué au fil de l'eau
/// (l'appli lit pendant qu'il mixe la suite, au lieu de tout préparer avant de jouer).
/// Les sons (`Media`) sont donnés à chaque bloc : le mixeur ne garde que le projet et l'état des effets.
pub struct Renderer {
    sr: f64,
    from: f64,
    to: f64,
    frames: usize,
    pos: usize,
    master_volume: f64,
    only_track: bool,
    n_buses: usize,
    tracks: Vec<TrackRt>,
    buses: Vec<BusRt>,
    sends: Vec<Option<crate::fx::SendFx>>,
    limiter: Option<crate::fx::Limiter>,
    /// Options d'origine (sans le fader Master du projet), pour recalculer le mix en direct
    base: RenderOptions,
    /// Boucle (cycle) en échantillons depuis `from` : arrivé à la fin, on repart du début sans trou ; les effets gardent leur état
    loop_ab: Option<(usize, usize)>,
    /// Vrai juste après un tour de boucle (lu une fois par `take_wrap`)
    wrapped: bool,
    /// Fondu d'entrée (≈ 2 ms) après un tour de boucle, jusqu'à cet échantillon : pas de clic à la reprise
    fade_in_end: Option<usize>,
    /// Niveaux du dernier bloc mixé : (piste, crête gauche, crête droite avant le pan, efficace après le pan)
    levels: Vec<(usize, f32, f32, f32)>,
    /// Niveau efficace du master sur le dernier bloc
    master_rms: f32,
    /// Réduction des compresseurs sur le dernier bloc : (groupe ?, indice, dB)
    grs: Vec<(bool, usize, f32)>,
    /// Son à afficher en spectre (fenêtre de plugin ouverte) : (groupe ?, indice), après les effets
    scope_target: Option<(bool, usize)>,
    scope: Vec<f32>,
    scope_i: usize,
}

/// Longueur du son gardé pour le spectre (comme l'analyseur du navigateur : fftSize 4096)
pub const SCOPE: usize = 4096;

/// Fondu aux bords de la boucle (échantillons)
const LOOP_FADE: usize = 96;

/// Réglages de mix d'une piste (volume, route, envois, courbes, pan) : ce qui peut changer en direct sans relancer
struct Taps { vol: f64, route_gain: f32, dest: Option<usize>, sends: Vec<SendTap>, aux: Vec<AuxTap>, curve: Option<Curve>, pan_curve: Option<Curve>, pan0: f64, on: bool }

fn track_taps(project: &Project, track: &crate::model::Track, idx: usize, opts: &RenderOptions) -> Taps {
    let stem = opts.only_track.is_some();
    let (bus, dest) = if stem { (1.0, None) } else { project.route(track.output.as_deref()) };
    let master = if stem || dest.is_some() { 1.0 } else { opts.master_volume };
    let vol = track.volume.unwrap_or(100.0) / 100.0;
    let route_gain = (bus * master) as f32; // de la sortie de la piste jusqu'à sa destination
    // Envois de cette piste : (indice de l'envoi, dose, courbe d'automation éventuelle : elle remplace la dose, comme dans le navigateur, Pre)
    let pre_of = |pre: &HashMap<String, bool>, key: String| pre.get(&key).copied().unwrap_or(false);
    let sends: Vec<SendTap> = project.sends.iter().enumerate()
        .filter(|(_, sd)| !sd.muted)
        .filter_map(|(i, sd)| {
            let lvl = track.sends.get(&sd.id).copied().unwrap_or(0.0);
            let c = track.automation.curve(&format!("send:{}", sd.id));
            (lvl > 0.0 || c.is_some()).then(|| (i, (lvl / 100.0) as f32, c, pre_of(&track.pre_sends, format!("send:{}", sd.id))))
        })
        .collect();
    let aux = if stem { Vec::new() } else { aux_sends(project, &track.bus_sends, &track.automation, &track.pre_sends, track.output.as_deref(), opts.master_volume) };
    let on = match opts.only_track { Some(only) => only == idx, None => project.is_audible(track) };
    Taps { vol, route_gain, dest, sends, aux, curve: track.automation.curve("volume"), pan_curve: track.automation.curve("pan"),
           pan0: (track.pan.unwrap_or(0.0) / 100.0).clamp(-1.0, 1.0), on }
}

/// Lissage des réglages changés en direct : ≈ 10 ms (comme setTargetAtTime du navigateur)
fn smooth_k(sr: f64) -> f64 { 1.0 - (-1.0 / (0.01 * sr)).exp() }

/// Le projet tel que le mixeur le voit : pistes gelées remplacées par leur rendu, délais de piste appliqués
fn prepared(project: &Project, media: &Media) -> Project {
    let frozen = with_frozen(project, media);
    let p = frozen.as_ref().unwrap_or(project);
    with_track_delays(p).unwrap_or_else(|| p.clone())
}

fn with_fader(project: &Project, opts: &RenderOptions) -> RenderOptions {
    // le fader Master du projet s'ajoute au niveau de sortie (même calcul que setMasterVolume d'audio.js)
    let fader = project.master_volume.filter(|v| v.is_finite()).map(|v| v.max(0.0) / 100.0).unwrap_or(1.0);
    RenderOptions { sample_rate: opts.sample_rate, master_volume: opts.master_volume * fader, range: opts.range, only_track: opts.only_track, start: opts.start }
}

impl Renderer {
    pub fn new(project: &Project, media: &Media, opts: &RenderOptions) -> Self {
        let base_opts = RenderOptions { sample_rate: opts.sample_rate, master_volume: opts.master_volume, range: opts.range, only_track: opts.only_track, start: opts.start };
        let project = &prepared(project, media);
        let opts = &with_fader(project, opts);
        let sr = opts.sample_rate as f64;
        let (from, to) = opts.range.unwrap_or((opts.start.max(0.0).min(project.end()), project.end()));
        // Queue : comme le navigateur, on laisse mourir les échos (4 s) ou la reverb (2,5 s) quand on rend tout le projet
        let uses = |name: &str| {
            let has = |fx: &[String]| fx.iter().any(|e| e == name);
            project.tracks.iter().enumerate().any(|(i, t)| opts.only_track.map_or(true, |o| o == i)
                && (has(&t.effects) || t.clips.iter().any(|c| c.fx.as_ref().is_some_and(|f| has(&f.effects)))))
                || (opts.only_track.is_none() && project.buses.iter().any(|b| has(&b.effects)))
        };
        let send_used = |delay: bool| {
            project.sends.iter().any(|sd| !sd.muted && (sd.kind == "delay") == delay
                && (project.tracks.iter().enumerate().any(|(i, t)| opts.only_track.map_or(true, |o| o == i) && t.sends.get(&sd.id).is_some_and(|l| *l > 0.0))
                    || (opts.only_track.is_none() && project.buses.iter().any(|b| b.sends.get(&sd.id).is_some_and(|l| *l > 0.0)))))
        };
        let tail = if opts.range.is_some() { 0.0 } else if uses("delay") || send_used(true) { 4.0 } else if uses("reverb") || send_used(false) { 2.5 } else { 0.0 };
        let frames = ((to - from + tail).max(0.0) * sr).ceil() as usize;

        let mut tracks = Vec::new();
        for (idx, track) in project.tracks.iter().enumerate() {
            // Une piste muette (mute, solo d'une autre) est gardée, à zéro : on peut la remettre en direct pendant la lecture
            if opts.only_track.is_some_and(|o| o != idx) {
                continue;
            }
            let taps = track_taps(project, track, idx, opts);
            // Les clips de la piste (mono tant qu'aucune source n'est stéréo, comme Web Audio)
            let clips: Vec<_> = track
                .clips
                .iter()
                .filter(|c| !c.muted && !c.recording && c.duration > 0.0)
                .filter_map(|c| media.get(&c.id).filter(|s| s.frames() > 0).map(|s| (c, s)))
                .collect();
            if clips.is_empty() {
                continue;
            }
            let force_mono = track.mono.unwrap_or(false);
            let all: Vec<&Clip> = clips.iter().map(|(c, _)| *c).collect();
            let mut rt_clips = Vec::new();
            let mut stereo_in = false;
            for (clip, src) in &clips {
                // Effets d'une région (avant ceux de la piste)
                let fx = clip.fx.as_ref().filter(|f| !f.effects.is_empty())
                    .map(|f| crate::fx::Chain::new(&f.effects, &f.effect_params, sr, project.bpm_at(clip.start), project.ceiling()).with_order(&f.fx_order));
                if !force_mono && (src.n_channels() > 1 || fx.as_ref().is_some_and(|c| c.outputs_stereo())) { stereo_in = true; }
                let (xin, xout) = crossfade_extents(&all, clip);
                let seg_start = clip.start.max(from);
                let seg_end = clip.end().min(to);
                if seg_end <= seg_start {
                    continue;
                }
                let first = ((seg_start - from) * sr).round() as usize;
                let last = (((seg_end - from) * sr).round() as usize).min(frames);
                let src_stereo = !force_mono && src.n_channels() > 1;
                let out_stereo = src_stereo || fx.as_ref().is_some_and(|c| c.outputs_stereo());
                rt_clips.push(ClipRt { clip: (*clip).clone(), xin, xout, fx, src_stereo, out_stereo, first, last });
            }
            // Effets de la piste
            let chain = crate::fx::Chain::for_track(track, sr, project.bpm).with_auto(&track.automation, from).with_tempo(project.tempo_segments(), from);
            let mono_in = !stereo_in;
            let stereo = stereo_in || chain.outputs_stereo();   // écho ping-pong aussi : une piste mono en ressort stéréo (comme le navigateur)
            tracks.push(TrackRt {
                idx, on: if taps.on { 1.0 } else { 0.0 }, on_s: if taps.on { 1.0 } else { 0.0 }, vol_s: taps.vol, pan_s: taps.pan0, route_s: taps.route_gain,
                clips: rt_clips, force_mono, stereo_in, mono_in, stereo, chain, vol: taps.vol, route_gain: taps.route_gain, dest: taps.dest,
                sends: taps.sends, aux: taps.aux, curve: taps.curve, pan_curve: taps.pan_curve, pan0: taps.pan0,
            });
        }

        // Groupes avec effets, du plus profond vers le master
        let depth = |mut i: usize| {
            let mut d = 0;
            while let (_, Some(parent)) = project.route(project.buses[i].output.as_deref()) {
                d += 1;
                i = parent;
                if d > 8 {
                    break;
                }
            }
            d
        };
        let mut order: Vec<usize> = (0..project.buses.len()).filter(|i| project.buses[*i].is_stage()).collect();
        order.sort_by_key(|i| std::cmp::Reverse(depth(*i)));
        let buses = order.into_iter().map(|i| {
            let bus = &project.buses[i];
            let (up, dest) = project.route(bus.output.as_deref());
            let pan0 = (bus.pan.unwrap_or(0.0) / 100.0).clamp(-1.0, 1.0);
            let own = if bus.muted { 0.0 } else { bus.volume.unwrap_or(100.0) / 100.0 };
            BusRt {
                i, stage_dest: dest, own_s: own, pan_s: pan0,
                route_s: (up * if dest.is_some() { 1.0 } else { opts.master_volume }) as f32,
                chain: crate::fx::Chain::new(&bus.effects, &bus.effect_params, sr, project.bpm, project.ceiling()).with_order(&bus.fx_order).with_auto(&bus.automation, from).with_tempo(project.tempo_segments(), from),
                own,
                up, dest, muted: bus.muted,
                curve: bus.automation.curve("volume"), pan_curve: bus.automation.curve("pan"),
                pan0, law0: balance_gains(pan0),
                // Envois de ce groupe vers un autre groupe (posés après le traitement ; un groupe déjà traité ne les reçoit plus)
                aux: aux_sends(project, &bus.bus_sends, &bus.automation, &bus.pre_sends, bus.output.as_deref(), opts.master_volume),
                sends: project.sends.iter().enumerate()
                    .filter(|(_, sd)| !sd.muted)
                    .filter_map(|(k, sd)| {
                        let lvl = bus.sends.get(&sd.id).copied().unwrap_or(0.0);
                        let c = bus.automation.curve(&format!("send:{}", sd.id));
                        (lvl > 0.0 || c.is_some()).then(|| (k, (lvl / 100.0) as f32, c, bus.pre_sends.get(&format!("send:{}", sd.id)).copied().unwrap_or(false)))
                    })
                    .collect(),
            }
        }).collect();
        let sends = project.sends.iter().map(|sd| (!sd.muted).then(|| crate::fx::SendFx::new(sd, sr, project.bpm))).collect();
        let limiter = opts.only_track.is_none().then(|| crate::fx::Limiter::new(project.ceiling(), sr));
        let _ = base_opts;
        Self { sr, from, to, frames, pos: 0, master_volume: opts.master_volume, only_track: opts.only_track.is_some(), n_buses: project.buses.len(), tracks, buses, sends, limiter, base: RenderOptions { sample_rate: opts.sample_rate, master_volume: base_opts.master_volume, range: opts.range, only_track: opts.only_track, start: opts.start },
               loop_ab: None, wrapped: false, fade_in_end: None, levels: Vec::new(), master_rms: 0.0,
               grs: Vec::new(), scope_target: None, scope: vec![0.0; SCOPE], scope_i: 0 }
    }

    /// Longueur totale (échantillons), queue des effets comprise
    pub fn frames(&self) -> usize { self.frames }
    pub fn sample_rate(&self) -> f64 { self.sr }
    /// Échantillons déjà mixés
    pub fn position(&self) -> usize { self.pos }
    pub fn is_done(&self) -> bool { self.pos >= self.frames && !self.loop_ab.is_some_and(|(_, b)| self.pos < b) }
    /// Instant (secondes dans le morceau) du prochain échantillon à mixer
    pub fn time(&self) -> f64 { self.from + self.pos as f64 / self.sr }
    /// Saute à l'instant `t` (secondes, pas avant le début du mixeur) ; les effets gardent leur état, leurs courbes suivent
    pub fn seek(&mut self, t: f64) {
        let t = t.max(self.from);
        self.pos = ((t - self.from) * self.sr).round() as usize;
        let t = self.time();
        for tr in &mut self.tracks { tr.chain.seek(t); }
        for b in &mut self.buses { b.chain.seek(t); }
    }
    /// Pose (ou enlève) la boucle. Refusée (false) si elle commence avant le début du mixeur : il faut alors relancer.
    /// Si la lecture est déjà après la fin de la boucle, on repart tout de suite de son début.
    pub fn set_loop(&mut self, l: Option<(f64, f64)>) -> bool {
        let Some((a, b)) = l else { self.loop_ab = None; self.fade_in_end = None; return true };
        let (a, b) = (a.min(b), a.max(b));
        if a < self.from - 1e-6 || b - a < 0.05 { return false; }
        let fa = ((a - self.from) * self.sr).round() as usize;
        let fb = ((b - self.from) * self.sr).round() as usize;
        self.loop_ab = Some((fa, fb));
        if self.pos >= fb { self.wrap(); }
        true
    }
    fn wrap(&mut self) {
        let Some((a, _)) = self.loop_ab else { return };
        let t = self.from + a as f64 / self.sr;
        self.seek(t);
        self.wrapped = true;
        self.fade_in_end = Some(a + LOOP_FADE);
    }
    pub fn has_loop(&self) -> bool { self.loop_ab.is_some() }
    /// Boucle en cours, en secondes dans le morceau
    pub fn loop_secs(&self) -> Option<(f64, f64)> { self.loop_ab.map(|(a, b)| (self.from + a as f64 / self.sr, self.from + b as f64 / self.sr)) }
    /// Vrai une fois après chaque tour de boucle
    pub fn take_wrap(&mut self) -> bool { std::mem::take(&mut self.wrapped) }
    /// Niveaux du dernier bloc : (piste, crête G, crête D, efficace) et efficace du master
    pub fn levels(&self) -> (&[(usize, f32, f32, f32)], f32) { (&self.levels, self.master_rms) }
    /// Réduction des compresseurs (groupe ?, indice, dB) sur le dernier bloc
    pub fn grs(&self) -> &[(bool, usize, f32)] { &self.grs }
    /// Choisit le son gardé pour le spectre (None = aucun)
    pub fn set_scope(&mut self, target: Option<(bool, usize)>) {
        if target != self.scope_target { self.scope_target = target; self.scope.iter_mut().for_each(|x| *x = 0.0); self.scope_i = 0; }
    }
    pub fn scope_target(&self) -> Option<(bool, usize)> { self.scope_target }
    /// Les SCOPE derniers échantillons du son choisi, du plus ancien au plus récent
    pub fn scope(&self) -> Option<Vec<f32>> {
        self.scope_target?;
        let mut v = Vec::with_capacity(SCOPE);
        v.extend_from_slice(&self.scope[self.scope_i..]);
        v.extend_from_slice(&self.scope[..self.scope_i]);
        Some(v)
    }
    fn scope_push(scope: &mut [f32], i: &mut usize, l: &[f32], r: &[f32]) {
        for m in 0..l.len() {
            scope[*i] = if r.is_empty() { l[m] } else { 0.5 * (l[m] + r[m]) };
            *i = (*i + 1) % SCOPE;
        }
    }

    /// Change en direct volumes, pan, mute / solo, doses d'envoi, volumes et pan des groupes, fader Master — sans relancer :
    /// les effets gardent leur état (une queue de reverb continue). La structure (régions, effets, sorties) doit rester la même :
    /// une piste ou un groupe dont la sortie a changé garde l'ancienne (il faut relancer la lecture pour ça).
    pub fn mix_from(&mut self, project: &Project, media: &Media) {
        let project = &prepared(project, media);
        let opts = with_fader(project, &self.base);
        self.master_volume = opts.master_volume;
        for tr in &mut self.tracks {
            let Some(track) = project.tracks.get(tr.idx) else { continue };
            let t = track_taps(project, track, tr.idx, &opts);
            if t.dest != tr.dest { continue; }
            tr.on = if t.on { 1.0 } else { 0.0 };
            tr.vol = t.vol; tr.route_gain = t.route_gain; tr.sends = t.sends; tr.aux = t.aux;
            tr.curve = t.curve; tr.pan_curve = t.pan_curve; tr.pan0 = t.pan0;
        }
        for b in &mut self.buses {
            let Some(bus) = project.buses.get(b.i) else { continue };
            let (up, dest) = project.route(bus.output.as_deref());
            if dest != b.stage_dest { continue; }
            b.up = up;
            b.muted = bus.muted;
            b.own = if bus.muted { 0.0 } else { bus.volume.unwrap_or(100.0) / 100.0 };
            b.pan0 = (bus.pan.unwrap_or(0.0) / 100.0).clamp(-1.0, 1.0);
            b.law0 = balance_gains(b.pan0);
            b.curve = bus.automation.curve("volume");
            b.pan_curve = bus.automation.curve("pan");
            b.aux = aux_sends(project, &bus.bus_sends, &bus.automation, &bus.pre_sends, bus.output.as_deref(), opts.master_volume);
            b.sends = project.sends.iter().enumerate()
                .filter(|(_, sd)| !sd.muted)
                .filter_map(|(k, sd)| {
                    let lvl = bus.sends.get(&sd.id).copied().unwrap_or(0.0);
                    let c = bus.automation.curve(&format!("send:{}", sd.id));
                    (lvl > 0.0 || c.is_some()).then(|| (k, (lvl / 100.0) as f32, c, bus.pre_sends.get(&format!("send:{}", sd.id)).copied().unwrap_or(false)))
                })
                .collect();
        }
    }

    /// Mixe le bloc suivant dans `left` / `right` (effacés d'abord) ; renvoie le nombre d'échantillons écrits (0 = fini)
    pub fn process(&mut self, media: &Media, left: &mut [f32], right: &mut [f32]) -> usize {
        // en boucle : le bloc s'arrête pile à la fin de la boucle (même au-delà de la fin du morceau)
        let limit = match self.loop_ab { Some((_, b)) if self.pos < b => b, _ => self.frames };
        let n = left.len().min(right.len()).min(limit.saturating_sub(self.pos));
        self.levels.clear();
        self.grs.clear();
        self.master_rms = 0.0;
        left.iter_mut().for_each(|x| *x = 0.0);
        right.iter_mut().for_each(|x| *x = 0.0);
        if n == 0 {
            return 0;
        }
        let (left, right) = (&mut left[..n], &mut right[..n]);
        let (sr, from, b0) = (self.sr, self.from, self.pos);
        let mut bus_in: Vec<(Vec<f32>, Vec<f32>)> = (0..self.n_buses).map(|_| (vec![0.0f32; n], vec![0.0f32; n])).collect();
        let mut send_in: Vec<(Vec<f32>, Vec<f32>)> = self.sends.iter().map(|s| if s.is_some() { (vec![0.0f32; n], vec![0.0f32; n]) } else { (Vec::new(), Vec::new()) }).collect();

        for tr in &mut self.tracks {
            // 1. Les clips de la piste, sommés
            let mut tl = vec![0.0f32; n];
            let mut trr = if tr.stereo { vec![0.0f32; n] } else { Vec::new() };
            for c in &mut tr.clips {
                let Some(src) = media.get(&c.clip.id) else { continue };
                let clip = &c.clip;
                let has_fx = c.fx.is_some();
                let (mut cl, mut cr) = if has_fx { (vec![0.0f32; n], vec![0.0f32; n]) } else { (Vec::new(), Vec::new()) };
                let offset = clip.offset.unwrap_or(0.0).max(0.0);
                let nch = src.n_channels();
                for k in c.first.max(b0)..c.last.min(b0 + n) {
                    let m = k - b0;
                    let x = from + k as f64 / sr - clip.start; // position dans le clip
                    // Répétition : on reboucle sur la portion [offset, offset + duration)
                    let in_src = offset + (x % clip.duration);
                    if in_src >= src.duration() {
                        continue;
                    }
                    let g = clip_level(clip, x, c.xin, c.xout) as f32;
                    // Piste forcée en mono : les deux côtés sont mélangés à parts égales (comme Web Audio, 2 → 1 canal)
                    let l = if tr.force_mono && nch > 1 { 0.5 * (src.at(0, in_src) + src.at(1, in_src)) * g } else { src.at(0, in_src) * g };
                    let r = if nch > 1 && !tr.force_mono { src.at(1, in_src) * g } else { l };
                    if has_fx {
                        cl[m] = l;
                        cr[m] = r;
                        continue;
                    }
                    tl[m] += l;
                    if tr.stereo_in {
                        trr[m] += r;
                    }
                }
                // La région passe dans ses effets ; l'écho / la reverb continuent après sa fin (queue)
                if let Some(chain) = c.fx.as_mut() {
                    chain.process(&mut cl, &mut cr, !c.src_stereo);
                    for m in 0..n {
                        tl[m] += cl[m];
                        if tr.stereo_in {
                            trr[m] += if c.out_stereo { cr[m] } else { cl[m] };
                        }
                    }
                }
            }
            // 2. Effets de la piste
            if !tr.chain.is_empty() {
                tr.chain.process(&mut tl, &mut trr, tr.mono_in);
                if let Some(g) = tr.chain.comp_gr() { self.grs.push((false, tr.idx, g)); }
            }
            if self.scope_target == Some((false, tr.idx)) { Self::scope_push(&mut self.scope, &mut self.scope_i, &tl, &trr); }
            // 3. Volume (fader, groupes, master, courbe) puis pan, et somme dans le mix
            let mut aux_buf: Vec<(Vec<f32>, Vec<f32>)> = tr.aux.iter().map(|_| (vec![0.0f32; n], vec![0.0f32; n])).collect();
            {
                let (dl, dr): (&mut [f32], &mut [f32]) = match tr.dest {
                    Some(i) => { let b = &mut bus_in[i]; (&mut b.0[..], &mut b.1[..]) }
                    None => (&mut *left, &mut *right),
                };
                let k = smooth_k(sr);
                let (mut pk_l, mut pk_r, mut sq) = (0.0f32, 0.0f32, 0.0f32);
                for m in 0..n {
                    let t = from + (b0 + m) as f64 / sr;
                    // réglages changés en direct : on glisse vers la nouvelle valeur (inchangé si rien ne bouge)
                    tr.vol_s += (tr.vol - tr.vol_s) * k;
                    tr.pan_s += (tr.pan0 - tr.pan_s) * k;
                    tr.on_s += (tr.on - tr.on_s) * k as f32;
                    tr.route_s += (tr.route_gain - tr.route_s) * k as f32;
                    let auto = tr.curve.as_ref().map_or(1.0, |c| c.at(t));
                    let pan = tr.pan_curve.as_ref().map_or(tr.pan_s, |c| (-1.0 + 2.0 * c.at(t)).clamp(-1.0, 1.0));
                    let g = (tr.vol_s * auto) as f32 * tr.on_s;
                    // Signal avant le fader (Pre) : après les effets, sans fader ni pan (muet aussi si la piste est muette)
                    let (pre_l, pre_r) = (tl[m] * tr.on_s, if tr.stereo { trr[m] } else { tl[m] } * tr.on_s);
                    let l_in = tl[m] * g;
                    let (l, r) = if tr.stereo {
                        let r_in = trr[m] * g;
                        // Balance (comme Logic, PulsePan d'audio.js) : l'autre côté s'éteint, rien n'est reporté
                        let (gl, gr) = balance_gains(pan);
                        (l_in * gl, r_in * gr)
                    } else {
                        // Mono : puissance constante
                        let a = (pan + 1.0) / 2.0 * FRAC_PI_2;
                        (l_in * a.cos() as f32, l_in * a.sin() as f32)
                    };
                    // vumètre : crêtes après le fader, avant le pan (comme un canal de console) ; efficace après le pan
                    pk_l = pk_l.max(l_in.abs());
                    pk_r = pk_r.max((if tr.stereo { trr[m] * g } else { l_in }).abs());
                    sq += ((l + r) * 0.5) * ((l + r) * 0.5);
                    dl[m] += l * tr.route_s;
                    dr[m] += r * tr.route_s;
                    for (i, level, c, pre) in &tr.sends {
                        let level = c.as_ref().map_or(*level, |c| c.at(t) as f32);
                        let (sl, sr2) = if *pre { (pre_l, pre_r) } else { (l, r) };
                        send_in[*i].0[m] += sl * level;
                        send_in[*i].1[m] += sr2 * level;
                    }
                    for (k, (level, c, _, _, pre)) in tr.aux.iter().enumerate() {
                        let level = c.as_ref().map_or(*level, |c| c.at(t) as f32);
                        let (sl, sr2) = if *pre { (pre_l, pre_r) } else { (l, r) };
                        aux_buf[k].0[m] += sl * level;
                        aux_buf[k].1[m] += sr2 * level;
                    }
                }
                self.levels.push((tr.idx, pk_l, pk_r, (sq / n as f32).sqrt()));
            }
            // Envois vers un groupe : vers son entrée (groupe à effets) ou directement vers le master
            for ((_, _, g, d, _), (al, ar)) in tr.aux.iter().zip(aux_buf) {
                let (dl, dr): (&mut [f32], &mut [f32]) = match d {
                    Some(i) => { let b = &mut bus_in[*i]; (&mut b.0[..], &mut b.1[..]) }
                    None => (&mut *left, &mut *right),
                };
                for m in 0..n { dl[m] += al[m] * g; dr[m] += ar[m] * g; }
            }
        }

        // 4. Groupes avec effets, du plus profond vers le master : effets → volume du groupe → groupe parent ou master
        let mut done = vec![false; self.n_buses];
        let mut discard = (vec![0.0f32; n], vec![0.0f32; n]);
        for b in &mut self.buses {
            let i = b.i;
            let (mut bl, mut br) = std::mem::take(&mut bus_in[i]);
            done[i] = true;
            b.chain.process(&mut bl, &mut br, false);
            if let Some(g) = b.chain.comp_gr() { self.grs.push((true, i, g)); }
            if self.scope_target == Some((true, i)) { Self::scope_push(&mut self.scope, &mut self.scope_i, &bl, &br); }
            let mut aux_buf: Vec<(Vec<f32>, Vec<f32>)> = b.aux.iter().map(|_| (vec![0.0f32; n], vec![0.0f32; n])).collect();
            {
                // un groupe déjà traité ne reçoit plus rien (comme le rendu d'un coup)
                let (dl, dr): (&mut [f32], &mut [f32]) = match b.dest {
                    Some(j) if j != i && !done[j] => { let x = &mut bus_in[j]; (&mut x.0[..], &mut x.1[..]) }
                    Some(j) if j != i => (&mut discard.0[..], &mut discard.1[..]),
                    _ => (&mut *left, &mut *right),
                };
                let route = (b.up * if b.dest.is_some() { 1.0 } else { self.master_volume }) as f32;
                let busmute = if b.muted { 0.0f32 } else { 1.0 };
                let k = smooth_k(sr);
                for m in 0..n {
                    let t = from + (b0 + m) as f64 / sr;
                    b.own_s += (b.own - b.own_s) * k;
                    b.pan_s += (b.pan0 - b.pan_s) * k;
                    b.route_s += (route - b.route_s) * k as f32;
                    let route = b.route_s;
                    let auto = b.curve.as_ref().map_or(1.0, |c| c.at(t)) as f32;
                    let pan = b.pan_curve.as_ref().map_or(b.pan_s, |c| (-1.0 + 2.0 * c.at(t)).clamp(-1.0, 1.0));
                    let (gl, gr) = if b.pan_curve.is_some() || b.pan_s != b.pan0 { balance_gains(pan) } else { b.law0 };
                    let own_g = (b.own_s as f32) * auto;      // volume du groupe (sans la route vers le master)
                    let (xl, xr) = (bl[m] * own_g, br[m] * own_g);
                    let (pre_l, pre_r) = (bl[m] * busmute, br[m] * busmute);
                    let (l, r) = (xl * gl, xr * gr);
                    dl[m] += l * route;
                    dr[m] += r * route;
                    for (k, level, c, pre) in &b.sends {
                        let level = c.as_ref().map_or(*level, |c| c.at(t) as f32);
                        let (sl, sr2) = if *pre { (pre_l, pre_r) } else { (l, r) };
                        send_in[*k].0[m] += sl * level;
                        send_in[*k].1[m] += sr2 * level;
                    }
                    for (k, (level, c, _, _, pre)) in b.aux.iter().enumerate() {
                        let level = c.as_ref().map_or(*level, |c| c.at(t) as f32);
                        let (sl, sr2) = if *pre { (pre_l, pre_r) } else { (l, r) };
                        aux_buf[k].0[m] += sl * level;
                        aux_buf[k].1[m] += sr2 * level;
                    }
                }
            }
            for ((_, _, g, d, _), (al, ar)) in b.aux.iter().zip(aux_buf) {
                let (dl, dr): (&mut [f32], &mut [f32]) = match d {
                    Some(j) if *j != i && !done[*j] => { let x = &mut bus_in[*j]; (&mut x.0[..], &mut x.1[..]) }
                    Some(_) => continue,
                    None => (&mut *left, &mut *right),
                };
                for m in 0..n { dl[m] += al[m] * g; dr[m] += ar[m] * g; }
            }
        }
        // 5. Retours des envois, directement dans le master
        let master = if self.only_track { 1.0 } else { self.master_volume } as f32;
        for (k, fx) in self.sends.iter_mut().enumerate() {
            let Some(fx) = fx else { continue };
            let (sl, sr_buf) = &mut send_in[k];
            fx.process(sl, sr_buf);
            for m in 0..n {
                left[m] += sl[m] * master;
                right[m] += sr_buf[m] * master;
            }
        }
        // 6. Limiteur de sécurité du master (pas sur une piste exportée seule, comme dans le navigateur)
        if let Some(lim) = self.limiter.as_mut() {
            for m in 0..n {
                let mut x = [left[m] as f64, right[m] as f64];
                lim.tick(&mut x);
                left[m] = x[0] as f32;
                right[m] = x[1] as f32;
            }
        }
        // Bords de la boucle : fondu de sortie juste avant la fin, fondu d'entrée juste après la reprise
        if let Some((_, b)) = self.loop_ab {
            for m in 0..n {
                let k = b0 + m;
                let mut g = 1.0f32;
                if k < b && k + LOOP_FADE >= b { g = (b - k) as f32 / LOOP_FADE as f32; }
                if let Some(e) = self.fade_in_end { if k < e && k + LOOP_FADE >= e { g *= (LOOP_FADE - (e - k)) as f32 / LOOP_FADE as f32; } }
                if g < 1.0 { left[m] *= g; right[m] *= g; }
            }
        }
        if self.fade_in_end.is_some_and(|e| b0 + n >= e) { self.fade_in_end = None; }
        let mut sq = 0.0f32;
        for m in 0..n { let x = (left[m] + right[m]) * 0.5; sq += x * x; }
        self.master_rms = (sq / n as f32).sqrt();
        let _ = self.to;
        self.pos += n;
        if self.loop_ab.is_some_and(|(_, b)| self.pos == b) { self.wrap(); }
        n
    }
}

/// Rend tout le projet d'un coup (export, pulse-render). Même résultat que la lecture au fil de l'eau.
pub fn render(project: &Project, media: &Media, opts: &RenderOptions) -> (Vec<f32>, Vec<f32>) {
    render_blocks(project, media, opts, 8192)
}

/// Comme `render`, par blocs de `block` échantillons (le résultat ne dépend pas de la taille des blocs)
pub fn render_blocks(project: &Project, media: &Media, opts: &RenderOptions, block: usize) -> (Vec<f32>, Vec<f32>) {
    let mut r = Renderer::new(project, media, opts);
    let frames = r.frames();
    let mut left = vec![0.0f32; frames];
    let mut right = vec![0.0f32; frames];
    let mut k = 0;
    while k < frames {
        let e = (k + block.max(1)).min(frames);
        r.process(media, &mut left[k..e], &mut right[k..e]);
        k = e;
    }
    (left, right)
}
