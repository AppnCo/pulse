//! Mixage hors-ligne : mêmes règles que `buildGraph()` du prototype web.
//! (EQ, saturation, de-esser, compresseur, reverb et courbe de volume portés ; effets de groupe et limiteur : pas encore.)
use crate::model::{Clip, Curve, Project};
use std::collections::HashMap;
use std::f64::consts::FRAC_PI_2;

/// Audio source d'un clip : canaux séparés, à sa fréquence d'origine.
#[derive(Debug, Clone)]
pub struct Source {
    pub sample_rate: u32,
    pub channels: Vec<Vec<f32>>,
}

impl Source {
    pub fn frames(&self) -> usize {
        self.channels.first().map_or(0, Vec::len)
    }
    pub fn duration(&self) -> f64 {
        self.frames() as f64 / self.sample_rate as f64
    }
    /// Échantillon à l'instant `t` (secondes), interpolé.
    fn at(&self, ch: usize, t: f64) -> f32 {
        let data = &self.channels[ch.min(self.channels.len() - 1)];
        let pos = t * self.sample_rate as f64;
        if pos < 0.0 {
            return 0.0;
        }
        let i = pos.floor() as usize;
        if i + 1 >= data.len() {
            return data.get(i).copied().unwrap_or(0.0);
        }
        let frac = (pos - i as f64) as f32;
        data[i] * (1.0 - frac) + data[i + 1] * frac
    }
}

pub type Media = HashMap<String, Source>;

pub struct RenderOptions {
    pub sample_rate: u32,
    pub master_volume: f64,
    /// Plage à rendre (secondes) ; `None` = tout le projet.
    pub range: Option<(f64, f64)>,
    /// Ne rendre qu'une piste (stem) : ignore mute/solo et les groupes.
    pub only_track: Option<usize>,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self { sample_rate: 48_000, master_volume: 0.8, range: None, only_track: None }
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

pub fn render(project: &Project, media: &Media, opts: &RenderOptions) -> (Vec<f32>, Vec<f32>) {
    let sr = opts.sample_rate as f64;
    let (from, to) = opts.range.unwrap_or((0.0, project.end()));
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
    let mut left = vec![0.0f32; frames];
    let mut right = vec![0.0f32; frames];
    // Entrée des groupes qui ont des effets (les autres ne sont qu'un volume, appliqué directement)
    let mut bus_in: Vec<Option<(Vec<f32>, Vec<f32>)>> = project.buses.iter().map(|_| None).collect();
    let mut send_in: Vec<Option<(Vec<f32>, Vec<f32>)>> = project.sends.iter().map(|_| None).collect();

    for (idx, track) in project.tracks.iter().enumerate() {
        let stem = opts.only_track.is_some();
        if let Some(only) = opts.only_track {
            if only != idx {
                continue;
            }
        } else if !project.is_audible(track) {
            continue;
        }
        let (bus, dest) = if stem { (1.0, None) } else { project.route(track.output.as_deref()) };
        let master = if stem || dest.is_some() { 1.0 } else { opts.master_volume };
        let vol = track.volume.unwrap_or(100.0) / 100.0;
        let route_gain = (bus * master) as f32; // de la sortie de la piste jusqu'à sa destination
        // Envois de cette piste : (indice de l'envoi, dose)
        // (indice de l'envoi, dose, courbe d'automation éventuelle : elle remplace la dose, comme dans le navigateur)
        let pre_of = |pre: &HashMap<String, bool>, key: String| pre.get(&key).copied().unwrap_or(false);
        let track_sends: Vec<(usize, f32, Option<Curve>, bool)> = project.sends.iter().enumerate()
            .filter(|(_, sd)| !sd.muted)
            .filter_map(|(i, sd)| {
                let lvl = track.sends.get(&sd.id).copied().unwrap_or(0.0);
                let c = track.automation.curve(&format!("send:{}", sd.id));
                (lvl > 0.0 || c.is_some()).then(|| (i, (lvl / 100.0) as f32, c, pre_of(&track.pre_sends, format!("send:{}", sd.id))))
            })
            .collect();
        let track_aux = if stem { Vec::new() } else { aux_sends(project, &track.bus_sends, &track.automation, &track.pre_sends, track.output.as_deref(), opts.master_volume) };
        let any_pre = track_sends.iter().any(|s| s.3) || track_aux.iter().any(|a| a.4);
        if (vol == 0.0 && !any_pre) || (route_gain == 0.0 && track_sends.is_empty() && track_aux.is_empty()) {
            continue;
        }

        // 1. Les clips de la piste, sommés (mono tant qu'aucune source n'est stéréo, comme Web Audio)
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
        // Effets d'une région (avant ceux de la piste) : une chaîne par région qui en a
        let mut clip_fx: Vec<Option<crate::fx::Chain>> = clips.iter().map(|(c, _)| c.fx.as_ref().filter(|f| !f.effects.is_empty())
            .map(|f| crate::fx::Chain::new(&f.effects, &f.effect_params, sr, project.bpm, project.ceiling()).with_order(&f.fx_order))).collect();
        let stereo = !force_mono && (clips.iter().any(|(_, s)| s.channels.len() > 1) || clip_fx.iter().flatten().any(|c| c.outputs_stereo()));
        let mut tl = vec![0.0f32; frames];
        let mut tr = if stereo { vec![0.0f32; frames] } else { Vec::new() };
        let all: Vec<&Clip> = clips.iter().map(|(c, _)| *c).collect();
        for (ci, (clip, src)) in clips.iter().enumerate() {
            let (xin, xout) = crossfade_extents(&all, clip);
            let offset = clip.offset.unwrap_or(0.0).max(0.0);
            let seg_start = clip.start.max(from);
            let seg_end = clip.end().min(to);
            if seg_end <= seg_start {
                continue;
            }
            let first = ((seg_start - from) * sr).round() as usize;
            let last = (((seg_end - from) * sr).round() as usize).min(frames);
            let src_stereo = !force_mono && src.channels.len() > 1;
            let has_fx = clip_fx[ci].is_some();
            let (mut cl, mut cr) = if has_fx { (vec![0.0f32; frames], vec![0.0f32; frames]) } else { (Vec::new(), Vec::new()) };
            for n in first..last {
                let x = from + n as f64 / sr - clip.start; // position dans le clip
                // Répétition : on reboucle sur la portion [offset, offset + duration)
                let in_src = offset + (x % clip.duration);
                if in_src >= src.duration() {
                    continue;
                }
                let g = clip_level(clip, x, xin, xout) as f32;
                // Piste forcée en mono : les deux côtés sont mélangés à parts égales (comme Web Audio, 2 → 1 canal)
                let l = if force_mono && src.channels.len() > 1 { 0.5 * (src.at(0, in_src) + src.at(1, in_src)) * g } else { src.at(0, in_src) * g };
                let r = if src.channels.len() > 1 && !force_mono { src.at(1, in_src) * g } else { l };
                if has_fx {
                    cl[n] = l;
                    cr[n] = r;
                    continue;
                }
                tl[n] += l;
                if stereo {
                    tr[n] += r;
                }
            }
            // La région passe dans ses effets ; l'écho / la reverb continuent après sa fin (queue)
            if let Some(chain) = clip_fx[ci].as_mut() {
                let out_stereo = src_stereo || chain.outputs_stereo();
                chain.process(&mut cl, &mut cr, !src_stereo);
                for n in 0..frames {
                    tl[n] += cl[n];
                    if stereo {
                        tr[n] += if out_stereo { cr[n] } else { cl[n] };
                    }
                }
            }
        }

        // 2. Effets de la piste
        let mut chain = crate::fx::Chain::for_track(track, sr, project.bpm).with_auto(&track.automation, from);
        let mono_in = !stereo;
        let stereo = stereo || chain.makes_stereo();
        if stereo && tr.is_empty() {
            tr = vec![0.0f32; frames];
        }
        if !chain.is_empty() {
            chain.process(&mut tl, &mut tr, mono_in);
        }

        // 3. Volume (fader, groupes, master, courbe) puis pan, et somme dans le mix
        let curve = track.automation.curve("volume");
        let pan_curve = track.automation.curve("pan");
        let pan0 = (track.pan.unwrap_or(0.0) / 100.0).clamp(-1.0, 1.0);
        let mut aux_buf: Vec<(Vec<f32>, Vec<f32>)> = track_aux.iter().map(|_| (vec![0.0f32; frames], vec![0.0f32; frames])).collect();
        {
        let (left, right) = match dest {
            Some(i) => {
                let b = bus_in[i].get_or_insert_with(|| (vec![0.0f32; frames], vec![0.0f32; frames]));
                (&mut b.0, &mut b.1)
            }
            None => (&mut left, &mut right),
        };
        for n in 0..frames {
            let t = from + n as f64 / sr;
            let auto = curve.as_ref().map_or(1.0, |c| c.at(t));
            let pan = pan_curve.as_ref().map_or(pan0, |c| (-1.0 + 2.0 * c.at(t)).clamp(-1.0, 1.0));
            let g = (vol * auto) as f32;
            // Signal avant le fader (Pre) : après les effets, sans fader ni pan
            let (pre_l, pre_r) = (tl[n], if stereo { tr[n] } else { tl[n] });
            let l_in = tl[n] * g;
            let (l, r) = if stereo {
                let r_in = tr[n] * g;
                // Même loi que le StereoPanner Web Audio pour une entrée stéréo
                if pan <= 0.0 {
                    let a = (pan + 1.0) * FRAC_PI_2;
                    (l_in + r_in * a.cos() as f32, r_in * a.sin() as f32)
                } else {
                    let a = pan * FRAC_PI_2;
                    (l_in * a.cos() as f32, r_in + l_in * a.sin() as f32)
                }
            } else {
                // Mono : puissance constante
                let a = (pan + 1.0) / 2.0 * FRAC_PI_2;
                (l_in * a.cos() as f32, l_in * a.sin() as f32)
            };
            left[n] += l * route_gain;
            right[n] += r * route_gain;
            for (i, level, c, pre) in &track_sends {
                let level = c.as_ref().map_or(*level, |c| c.at(t) as f32);
                let (sl, sr2) = if *pre { (pre_l, pre_r) } else { (l, r) };
                let b = send_in[*i].get_or_insert_with(|| (vec![0.0f32; frames], vec![0.0f32; frames]));
                b.0[n] += sl * level;
                b.1[n] += sr2 * level;
            }
            for (k, (level, c, _, _, pre)) in track_aux.iter().enumerate() {
                let level = c.as_ref().map_or(*level, |c| c.at(t) as f32);
                let (sl, sr2) = if *pre { (pre_l, pre_r) } else { (l, r) };
                aux_buf[k].0[n] += sl * level;
                aux_buf[k].1[n] += sr2 * level;
            }
        }
        }
        // Envois vers un groupe : vers son entrée (groupe à effets) ou directement vers le master
        for ((_, _, g, d, _), (al, ar)) in track_aux.iter().zip(aux_buf) {
            let (dl, dr) = match d {
                Some(i) => { let b = bus_in[*i].get_or_insert_with(|| (vec![0.0f32; frames], vec![0.0f32; frames])); (&mut b.0, &mut b.1) }
                None => (&mut left, &mut right),
            };
            for n in 0..frames { dl[n] += al[n] * g; dr[n] += ar[n] * g; }
        }
    }

    // 4. Groupes avec effets, du plus profond vers le master : effets → volume du groupe → groupe parent ou master
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
    for i in order {
        let Some((mut bl, mut br)) = bus_in[i].take() else { continue };
        let bus = &project.buses[i];
        crate::fx::Chain::new(&bus.effects, &bus.effect_params, sr, project.bpm, project.ceiling()).with_order(&bus.fx_order).with_auto(&bus.automation, from).process(&mut bl, &mut br, false);
        let own = if bus.muted { 0.0 } else { bus.volume.unwrap_or(100.0) / 100.0 };
        let (up, dest) = project.route(bus.output.as_deref());
        let g = (own * up * if dest.is_some() { 1.0 } else { opts.master_volume }) as f32;
        let (dl, dr) = match dest {
            Some(j) if j != i => {
                let b = bus_in[j].get_or_insert_with(|| (vec![0.0f32; frames], vec![0.0f32; frames]));
                (&mut b.0, &mut b.1)
            }
            _ => (&mut left, &mut right),
        };
        let curve = bus.automation.curve("volume");
        let pan_curve = bus.automation.curve("pan");
        // Gauche / droite du groupe : même loi que le StereoPanner pour une entrée stéréo
        let pan0 = (bus.pan.unwrap_or(0.0) / 100.0).clamp(-1.0, 1.0);
        let pan_law = |pan: f64| if pan <= 0.0 {
            let a = ((pan + 1.0) * FRAC_PI_2) as f32;
            (1.0f32, a.cos(), 0.0f32, a.sin())   // l' = l + r·cos ; r' = r·sin
        } else {
            let a = (pan * FRAC_PI_2) as f32;
            (a.cos(), 0.0f32, a.sin(), 1.0f32)   // l' = l·cos ; r' = r + l·sin
        };
        let law0 = pan_law(pan0);
        // Envois de ce groupe vers un autre groupe (posés après le traitement ; un groupe déjà traité ne les reçoit plus)
        let bus_aux = aux_sends(project, &bus.bus_sends, &bus.automation, &bus.pre_sends, bus.output.as_deref(), opts.master_volume);
        let mut aux_buf: Vec<(Vec<f32>, Vec<f32>)> = bus_aux.iter().map(|_| (vec![0.0f32; frames], vec![0.0f32; frames])).collect();
        let bus_sends: Vec<(usize, f32, Option<Curve>, bool)> = project.sends.iter().enumerate()
            .filter(|(_, sd)| !sd.muted)
            .filter_map(|(k, sd)| {
                let lvl = bus.sends.get(&sd.id).copied().unwrap_or(0.0);
                let c = bus.automation.curve(&format!("send:{}", sd.id));
                (lvl > 0.0 || c.is_some()).then(|| (k, (lvl / 100.0) as f32, c, bus.pre_sends.get(&format!("send:{}", sd.id)).copied().unwrap_or(false)))
            })
            .collect();
        for n in 0..frames {
            let t = from + n as f64 / sr;
            let auto = curve.as_ref().map_or(1.0, |c| c.at(t)) as f32;
            let pan = pan_curve.as_ref().map_or(pan0, |c| (-1.0 + 2.0 * c.at(t)).clamp(-1.0, 1.0));
            let (pl_l, pl_r, pr_l, pr_r) = if pan_curve.is_some() { pan_law(pan) } else { law0 };
            let own_g = (own as f32) * auto;      // volume du groupe (sans la route vers le master)
            let (xl, xr) = (bl[n] * own_g, br[n] * own_g);
            let busmute = if bus.muted { 0.0f32 } else { 1.0 };
            let (pre_l, pre_r) = (bl[n] * busmute, br[n] * busmute);
            let (l, r) = if pan <= 0.0 { (xl * pl_l + xr * pl_r, xr * pr_r) } else { (xl * pl_l, xr * pr_r + xl * pr_l) };
            let route = (up * if dest.is_some() { 1.0 } else { opts.master_volume }) as f32;
            dl[n] += l * route;
            dr[n] += r * route;
            for (k, level, c, pre) in &bus_sends {
                let level = c.as_ref().map_or(*level, |c| c.at(t) as f32);
                let (sl, sr2) = if *pre { (pre_l, pre_r) } else { (l, r) };
                let b = send_in[*k].get_or_insert_with(|| (vec![0.0f32; frames], vec![0.0f32; frames]));
                b.0[n] += sl * level;
                b.1[n] += sr2 * level;
            }
            for (k, (level, c, _, _, pre)) in bus_aux.iter().enumerate() {
                let level = c.as_ref().map_or(*level, |c| c.at(t) as f32);
                let (sl, sr2) = if *pre { (pre_l, pre_r) } else { (l, r) };
                aux_buf[k].0[n] += sl * level;
                aux_buf[k].1[n] += sr2 * level;
            }
        }
        let _ = g;
        for ((_, _, g, d, _), (al, ar)) in bus_aux.iter().zip(aux_buf) {
            let (dl, dr) = match d {
                Some(j) if *j != i => { let b = bus_in[*j].get_or_insert_with(|| (vec![0.0f32; frames], vec![0.0f32; frames])); (&mut b.0, &mut b.1) }
                Some(_) => continue,
                None => (&mut left, &mut right),
            };
            for n in 0..frames { dl[n] += al[n] * g; dr[n] += ar[n] * g; }
        }
    }
    // 5. Retours des envois, directement dans le master
    let master = if opts.only_track.is_some() { 1.0 } else { opts.master_volume } as f32;
    for (i, buf) in send_in.into_iter().enumerate() {
        let Some((mut sl, mut sr_buf)) = buf else { continue };
        crate::fx::process_send(&project.sends[i], &mut sl, &mut sr_buf, sr, project.bpm);
        for n in 0..frames {
            left[n] += sl[n] * master;
            right[n] += sr_buf[n] * master;
        }
    }

    // 6. Limiteur de sécurité du master (pas sur une piste exportée seule, comme dans le navigateur)
    if opts.only_track.is_none() {
        crate::fx::limit(&mut left, &mut right, sr, project.ceiling());
    }
    (left, right)
}
