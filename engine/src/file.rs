//! Lecture d'un fichier .pulse (ZIP : project.json + media/<id>.wav) et écriture WAV.
use crate::model::Project;
use crate::render::{Media, Source};
use std::io::{Cursor, Read, Seek};

#[derive(Debug)]
pub enum PulseError {
    Io(std::io::Error),
    Zip(zip::result::ZipError),
    Json(serde_json::Error),
    Wav(hound::Error),
    NoProject,
}
impl std::fmt::Display for PulseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "lecture impossible : {e}"),
            Self::Zip(e) => write!(f, "ce fichier n'est pas un .pulse valide : {e}"),
            Self::Json(e) => write!(f, "project.json illisible : {e}"),
            Self::Wav(e) => write!(f, "fichier audio illisible : {e}"),
            Self::NoProject => write!(f, "project.json absent du fichier .pulse"),
        }
    }
}
impl std::error::Error for PulseError {}
impl From<std::io::Error> for PulseError { fn from(e: std::io::Error) -> Self { Self::Io(e) } }
impl From<zip::result::ZipError> for PulseError { fn from(e: zip::result::ZipError) -> Self { Self::Zip(e) } }
impl From<serde_json::Error> for PulseError { fn from(e: serde_json::Error) -> Self { Self::Json(e) } }
impl From<hound::Error> for PulseError { fn from(e: hound::Error) -> Self { Self::Wav(e) } }

#[derive(serde::Deserialize)]
struct Doc {
    project: Project,
}

fn decode_wav(bytes: Vec<u8>) -> Result<Source, PulseError> {
    let mut reader = hound::WavReader::new(Cursor::new(bytes))?;
    let spec = reader.spec();
    let n = spec.channels as usize;
    // 16 bits (sons Pulse d'avant le 31/10) : gardés tels quels, moitié moins de mémoire qu'en flottant
    if spec.sample_format == hound::SampleFormat::Int && spec.bits_per_sample == 16 {
        let mut channels: Vec<Vec<i16>> = (0..n).map(|_| Vec::with_capacity(reader.len() as usize / n.max(1))).collect();
        for (i, s) in reader.samples::<i16>().enumerate() {
            channels[i % n].push(s?);
        }
        return Ok(Source::from_i16(spec.sample_rate, channels));
    }
    // 24 bits (format des sons Pulse depuis le 31/10, comme Logic / Pro Tools) : rangés serrés, 3 octets par échantillon
    if spec.sample_format == hound::SampleFormat::Int && spec.bits_per_sample == 24 {
        let mut channels: Vec<Vec<u8>> = (0..n).map(|_| Vec::with_capacity(reader.len() as usize / n.max(1) * 3)).collect();
        for (i, s) in reader.samples::<i32>().enumerate() {
            channels[i % n].extend_from_slice(&s?.to_le_bytes()[..3]);
        }
        return Ok(Source::from_i24(spec.sample_rate, channels));
    }
    let mut channels: Vec<Vec<f32>> = (0..n).map(|_| Vec::with_capacity(reader.len() as usize / n.max(1))).collect();
    match spec.sample_format {
        hound::SampleFormat::Float => {
            for (i, s) in reader.samples::<f32>().enumerate() {
                channels[i % n].push(s?);
            }
        }
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1i64 << (spec.bits_per_sample - 1)) as f32;
            for (i, s) in reader.samples::<i32>().enumerate() {
                channels[i % n].push(s? as f32 * scale);
            }
        }
    }
    Ok(Source::new(spec.sample_rate, channels))
}

/// Ouvre un .pulse : le projet + l'audio de chaque clip.
pub fn open<R: Read + Seek>(reader: R) -> Result<(Project, Media), PulseError> {
    open_sized(reader).map(|(p, m, _)| (p, m))
}

/// Comme `open`, avec la taille (octets) du fichier WAV de chaque son : elle sert à reconnaître un son déjà chargé
pub fn open_sized<R: Read + Seek>(reader: R) -> Result<(Project, Media, std::collections::HashMap<String, u64>), PulseError> {
    let mut zip = zip::ZipArchive::new(reader)?;
    let mut project = None;
    let mut media = Media::new();
    let mut sizes = std::collections::HashMap::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let name = entry.name()?.into_owned();
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes)?;
        if name == "project.json" {
            project = Some(serde_json::from_slice::<Doc>(&bytes)?.project);
        } else if let Some(id) = name.strip_prefix("media/").and_then(|n| n.strip_suffix(".wav")) {
            sizes.insert(id.to_owned(), bytes.len() as u64);
            media.insert(id.to_owned(), decode_wav(bytes)?);
        }
    }
    Ok((project.ok_or(PulseError::NoProject)?, media, sizes))
}

/// Écrit un WAV stéréo 24 bits.
pub fn write_wav(path: &std::path::Path, left: &[f32], right: &[f32], sample_rate: u32) -> Result<(), PulseError> {
    let spec = hound::WavSpec { channels: 2, sample_rate, bits_per_sample: 24, sample_format: hound::SampleFormat::Int };
    let mut w = hound::WavWriter::create(path, spec)?;
    let to_i24 = |s: f32| (s.clamp(-1.0, 1.0) * 8_388_607.0) as i32;
    for (l, r) in left.iter().zip(right) {
        w.write_sample(to_i24(*l))?;
        w.write_sample(to_i24(*r))?;
    }
    w.finalize()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    /// WAV 24 bits : relu à l'identique (au pas du 24 bits près) et rangé serré, 3 octets par échantillon
    #[test]
    fn wav_24_bits_relu_et_serre() {
        let path = std::env::temp_dir().join(format!("pulse-24b-{}.wav", std::process::id()));
        let l: Vec<f32> = vec![0.0, 0.5, -0.5, 0.999, -1.0, 1e-6, -1e-6, 0.123_456];
        let r: Vec<f32> = l.iter().map(|v| -v * 0.5).collect();
        super::write_wav(&path, &l, &r, 48_000).unwrap();
        let src = super::decode_wav(std::fs::read(&path).unwrap()).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(src.frames(), l.len());
        assert_eq!(src.n_channels(), 2);
        assert_eq!(src.bytes(), l.len() * 2 * 3, "3 octets par échantillon");
        for i in 0..l.len() {
            for (ch, v) in [(0, l[i]), (1, r[i])] {
                let got = src.sample(ch, i).unwrap();
                assert!((got - v).abs() < 2.0 / 8_388_608.0, "canal {ch} n°{i} : {got} au lieu de {v}");
            }
        }
        assert!(src.sample(0, l.len()).is_none());
    }
}
