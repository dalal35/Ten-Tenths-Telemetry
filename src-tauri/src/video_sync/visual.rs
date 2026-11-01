//! Repeated views are landmark hypotheses, not certified start/finish crossings.
use super::laps::VideoCrossing;
use crate::video_analysis::{
    motion::{appearance_descriptor, appearance_features},
    CancellationToken, ErrorKind, SampledVideoFrame, VideoAnalysisError,
};

pub(super) const MAX_SCAN_FRAMES: usize = 40000;
const MAX_WINDOW_FRAMES: usize = 1600;
const MAX_HYPOTHESES: usize = 12;
const MAX_FINE_SAMPLES: usize = 128;
#[derive(Clone)]
pub(super) struct Feature {
    pub(super) time: f64,
    pub(super) descriptor: [f32; 192],
    pub(super) checker: f64,
    pub(super) clip: usize,
    pub(super) tracking_support: Option<f64>,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutBracket {
    pub start_seconds: f64,
    pub end_seconds: f64,
}
#[derive(Default)]
pub struct VisualAnalyzer {
    pub(super) features: Vec<Feature>,
    pub(super) cuts: Vec<CutBracket>,
    pub(super) possible_cuts: Vec<CutBracket>,
    fine_previous: Option<Feature>,
    pending_fine_cut: Option<(CutBracket, [f32; 192])>,
    pub(super) incomplete: bool,
}
#[derive(Clone)]
pub struct FineFeature {
    pub time: f64,
    descriptor: [f32; 192],
    checker: f64,
}
impl FineFeature {
    pub fn checker_score(&self) -> f64 {
        self.checker
    }
    pub fn from_frame(frame: &SampledVideoFrame) -> Result<Self, VideoAnalysisError> {
        let (descriptor, checker) = appearance_features(frame)?;
        Ok(Self {
            time: frame.timestamp_seconds,
            descriptor,
            checker,
        })
    }
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LandmarkObservation {
    pub time: f64,
    pub clip: usize,
    pub similarity: f64,
    pub checker_score: f64,
}
pub struct VisualAnalysis {
    pub cuts: Vec<CutBracket>,
    pub hypotheses: Vec<Vec<VideoCrossing>>,
    pub incomplete: bool,
    pub landmark_scores: Vec<f64>,
    pub marker_hypotheses: Vec<bool>,
    templates: Vec<[f32; 192]>,
    coarse_times: Vec<Vec<f64>>,
    fine: Vec<Vec<Vec<(f64, f64)>>>,
    fine_checker: Vec<Vec<f64>>,
    fine_bounds: Vec<Vec<(f64, f64)>>,
}

// The best small translation tolerates vibration; normalized luminance tolerates exposure changes.
fn similarity(a: &[f32; 192], b: &[f32; 192]) -> f64 {
    let mut best = -1.0_f64;
    for dy in -1_i32..=1 {
        for dx in -1_i32..=1 {
            let (mut aa, mut bb, mut ab) = (0.0_f64, 0.0_f64, 0.0_f64);
            for y in 1..11 {
                for x in 1..15 {
                    let u = a[y * 16 + x] as f64;
                    let v = b[((y as i32 + dy) * 16 + x as i32 + dx) as usize] as f64;
                    aa += u * u;
                    bb += v * v;
                    ab += u * v;
                }
            }
            if aa > 1e-8 && bb > 1e-8 {
                best = best.max(ab / (aa * bb).sqrt());
            }
        }
    }
    best
}

fn marking_score(features: &[Feature], hits: &[usize]) -> f64 {
    let mut scores: Vec<_> = hits.iter().map(|&i| features[i].checker).collect();
    scores.sort_by(|a, b| b.total_cmp(a));
    (scores.iter().sum::<f64>() / scores.len() as f64).min(scores.get(3).copied().unwrap_or(0.0))
}

fn recording_runs(recordings: &[crate::telemetry::Session]) -> Vec<Vec<f64>> {
    let mut runs = Vec::new();
    for recording in recordings {
        let mut laps: Vec<_> = recording.laps.iter().collect();
        laps.sort_by(|a, b| a.start.total_cmp(&b.start));
        let mut run: Vec<f64> = Vec::new();
        for lap in laps {
            if !lap.complete
                || !lap.start.is_finite()
                || !lap.end.is_finite()
                || lap.end <= lap.start
                || run
                    .last()
                    .is_some_and(|&end| (end - lap.start).abs() > 0.01)
            {
                if run.len() >= 4 {
                    runs.push(std::mem::take(&mut run));
                } else {
                    run.clear();
                }
            }
            if lap.complete && lap.start.is_finite() && lap.end.is_finite() && lap.end > lap.start {
                if run.is_empty() {
                    run.push(lap.start);
                }
                run.push(lap.end);
            }
        }
        if run.len() >= 4 {
            runs.push(run);
        }
    }
    runs
}

impl VisualAnalyzer {
    pub fn new() -> Self {
        Self::default()
    }
    /// Compare observed landmark views without changing media timestamps or lap identity.
    pub fn landmark_observations(
        &self,
        templates: &[FineFeature],
        cancel: &CancellationToken,
    ) -> Result<Vec<LandmarkObservation>, String> {
        if templates.len() > 32 {
            return Err("Too many landmark templates".into());
        }
        let mut observations = Vec::with_capacity(self.features.len());
        for feature in &self.features {
            if cancel.is_cancelled() {
                return Err("Video analysis cancelled".into());
            }
            let best = templates
                .iter()
                .map(|t| similarity(&t.descriptor, &feature.descriptor))
                .max_by(f64::total_cmp)
                .unwrap_or(-1.0);
            observations.push(LandmarkObservation {
                time: feature.time,
                clip: feature.clip,
                similarity: best,
                checker_score: feature.checker,
            });
        }
        Ok(observations)
    }
    pub fn frame_count(&self) -> usize {
        self.features.len()
    }
    pub fn cuts(&self) -> &[CutBracket] {
        &self.cuts
    }
    pub fn time_bounds(&self) -> Option<(f64, f64)> {
        Some((self.features.first()?.time, self.features.last()?.time))
    }
    /// Keep the whole cut index so a late window retains global clip identities.
    pub fn window(&self, start: f64, end: f64) -> Result<Self, String> {
        if !start.is_finite() || !end.is_finite() || start < 0.0 || end <= start {
            return Err("Invalid visual window".into());
        }
        let first = self.features.partition_point(|f| f.time < start);
        let last = self.features.partition_point(|f| f.time < end);
        if last - first > MAX_WINDOW_FRAMES {
            return Err("Visual window exceeds feature limit".into());
        }
        Ok(Self {
            features: self.features[first..last].to_vec(),
            cuts: self.cuts.clone(),
            possible_cuts: self
                .possible_cuts
                .iter()
                .filter(|c| c.end_seconds >= start && c.start_seconds < end)
                .cloned()
                .collect(),
            incomplete: self.incomplete,
            ..Self::default()
        })
    }
    pub fn push(
        &mut self,
        frame: &SampledVideoFrame,
        tracking_support: Option<f64>,
    ) -> Result<(), VideoAnalysisError> {
        if self
            .features
            .last()
            .is_some_and(|f| frame.timestamp_seconds <= f.time)
        {
            return Err(VideoAnalysisError::new(
                ErrorKind::InvalidInput,
                "Scene timestamps must increase",
            ));
        }
        let (descriptor, checker) = appearance_features(frame)?;
        if self.features.len() >= MAX_SCAN_FRAMES {
            return Err(VideoAnalysisError::new(
                ErrorKind::InvalidOptions,
                "Video feature limit exceeded",
            ));
        }
        if let Some(previous) = self.features.last() {
            let gap = frame.timestamp_seconds - previous.time;
            // A geometry failure alone includes normal turns, occlusion and pit entry.
            // These are possible edit brackets: never assert frame-exact cut ground truth.
            if gap > 0.6
                || (tracking_support.is_some_and(|q| q < 0.10)
                    && similarity(&previous.descriptor, &descriptor) < 0.20)
            {
                self.possible_cuts.push(CutBracket {
                    start_seconds: previous.time,
                    end_seconds: frame.timestamp_seconds,
                });
            }
        }
        self.features.push(Feature {
            time: frame.timestamp_seconds,
            descriptor,
            checker,
            tracking_support,
            clip: self
                .cuts
                .iter()
                .filter(|c| c.end_seconds <= frame.timestamp_seconds)
                .count(),
        });
        Ok(())
    }
    /// A 0.4-second camera turn can look like an edit. Confirm proposals at 20 fps.
    pub fn suspected_cut_windows(&self) -> Vec<(f64, f64)> {
        self.possible_cuts
            .iter()
            .map(|c| ((c.start_seconds - 0.1).max(0.0), c.end_seconds + 0.1))
            .collect()
    }
    pub fn confirm_cut(
        &mut self,
        frame: &SampledVideoFrame,
        tracking_support: Option<f64>,
    ) -> Result<(), VideoAnalysisError> {
        let descriptor = appearance_descriptor(frame)?;
        if let Some((cut, after)) = self.pending_fine_cut.take() {
            if frame.timestamp_seconds > cut.end_seconds
                && frame.timestamp_seconds - cut.end_seconds <= 0.11
                && tracking_support.is_some_and(|q| q >= 0.3)
                && similarity(&after, &descriptor) >= 0.5
            {
                self.cuts.push(cut);
                self.cuts
                    .sort_by(|a, b| a.start_seconds.total_cmp(&b.start_seconds));
                for feature in &mut self.features {
                    feature.clip = self
                        .cuts
                        .iter()
                        .filter(|c| c.end_seconds <= feature.time)
                        .count();
                }
            }
        }
        if let Some(previous) = &self.fine_previous {
            let gap = frame.timestamp_seconds - previous.time;
            if gap > 0.0
                && gap <= 0.11
                && tracking_support.is_some_and(|q| q < 0.10)
                && similarity(&previous.descriptor, &descriptor) < 0.20
                && self.possible_cuts.iter().any(|c| {
                    previous.time >= c.start_seconds - 0.11
                        && frame.timestamp_seconds <= c.end_seconds + 0.11
                })
                && !self
                    .cuts
                    .iter()
                    .any(|c| (c.end_seconds - frame.timestamp_seconds).abs() < 0.2)
            {
                self.pending_fine_cut = Some((
                    CutBracket {
                        start_seconds: previous.time,
                        end_seconds: frame.timestamp_seconds,
                    },
                    descriptor,
                ));
            }
        }
        self.fine_previous = Some(Feature {
            time: frame.timestamp_seconds,
            descriptor,
            checker: 0.0,
            tracking_support,
            clip: 0,
        });
        Ok(())
    }
    pub fn finish_transferred(
        &self,
        templates: &[FineFeature],
        ranges: &[(f64, f64)],
        recordings: &[crate::telemetry::Session],
        cancel: &CancellationToken,
    ) -> Result<VisualAnalysis, String> {
        if self.features.len() > MAX_WINDOW_FRAMES
            || ranges.len() > 32
            || ranges
                .iter()
                .any(|&(a, b)| !a.is_finite() || !b.is_finite() || a <= 1.0 || b < a)
        {
            return Err("Invalid transferred landmark window".into());
        }
        let observations = self.landmark_observations(templates, cancel)?;
        let mut episodes: Vec<Vec<usize>> = Vec::new();
        for (i, observation) in observations.iter().enumerate() {
            if observation.similarity < 0.84 {
                continue;
            }
            if let Some(last) = episodes.last_mut().filter(|last| {
                observations[*last.last().unwrap()].clip == observation.clip
                    && observation.time - observations[*last.last().unwrap()].time <= 0.61
            }) {
                last.push(i);
            } else {
                episodes.push(vec![i]);
            }
        }
        let mut peaks = Vec::new();
        let mut bounds = std::collections::BTreeMap::new();
        for episode in episodes {
            let first = episode[0];
            let last = *episode.last().unwrap();
            // Persistent static or pit views are not independent crossing episodes.
            if observations[last].time - observations[first].time > 2.4 {
                continue;
            }
            let peak = *episode
                .iter()
                .max_by(|&&a, &&b| {
                    observations[a]
                        .similarity
                        .total_cmp(&observations[b].similarity)
                })
                .unwrap();
            peaks.push(peak);
            bounds.insert(
                peak,
                (
                    (observations[first].time - 0.4).max(0.0),
                    observations[last].time + 0.4,
                ),
            );
        }
        let result = VisualAnalysis {
            cuts: self.cuts.clone(),
            hypotheses: Vec::new(),
            incomplete: self.incomplete,
            landmark_scores: Vec::new(),
            marker_hypotheses: Vec::new(),
            templates: Vec::new(),
            coarse_times: Vec::new(),
            fine: Vec::new(),
            fine_checker: Vec::new(),
            fine_bounds: Vec::new(),
        };
        self.append_marker_sequences(
            result,
            &peaks,
            &recording_runs(recordings),
            Some(&bounds),
            cancel,
        )
    }
    pub fn finish_recordings(
        &self,
        ranges: &[(f64, f64)],
        recordings: &[crate::telemetry::Session],
        cancel: &CancellationToken,
    ) -> Result<VisualAnalysis, String> {
        let runs = recording_runs(recordings);
        self.finish_with_sequences(ranges, &runs, cancel)
    }
    /// XRK boundary patterns select among soft checker peaks before fine localization.
    pub fn finish_with_sequences(
        &self,
        ranges: &[(f64, f64)],
        boundary_runs: &[Vec<f64>],
        cancel: &CancellationToken,
    ) -> Result<VisualAnalysis, String> {
        let result = self.finish_ranges(ranges, cancel)?;
        if boundary_runs.iter().map(Vec::len).sum::<usize>() > 8192
            || boundary_runs.iter().any(|run| {
                run.iter().any(|t| !t.is_finite()) || run.windows(2).any(|w| w[1] <= w[0])
            })
        {
            return Err("Invalid visual boundary sequences".into());
        }
        let peaks: Vec<_> = self
            .features
            .iter()
            .enumerate()
            .filter_map(|(i, f)| {
                let mut background: Vec<_> = self
                    .features
                    .iter()
                    .filter(|n| n.clip == f.clip && (n.time - f.time).abs() <= 2.0)
                    .map(|n| n.checker)
                    .collect();
                background.sort_by(f64::total_cmp);
                let baseline = background[background.len() / 2];
                (f.checker > 0.07
                    && f.checker > baseline * 1.15
                    && !self.features.iter().any(|n| {
                        n.clip == f.clip && (n.time - f.time).abs() <= 0.6 && n.checker > f.checker
                    }))
                .then_some(i)
            })
            .collect();
        self.append_marker_sequences(result, &peaks, boundary_runs, None, cancel)
    }
    fn append_marker_sequences(
        &self,
        mut result: VisualAnalysis,
        peaks: &[usize],
        boundary_runs: &[Vec<f64>],
        bounds: Option<&std::collections::BTreeMap<usize, (f64, f64)>>,
        cancel: &CancellationToken,
    ) -> Result<VisualAnalysis, String> {
        if boundary_runs.iter().map(Vec::len).sum::<usize>() > 8192 {
            return Err("Invalid visual boundary sequences".into());
        }
        let mut chains = Vec::new();
        let mut operations = 0;
        'search: for &first in peaks {
            for run in boundary_runs {
                for start in 0..run.len().saturating_sub(3) {
                    if cancel.is_cancelled() {
                        return Err("Video analysis cancelled".into());
                    }
                    let seed = &self.features[first];
                    let offset = run[start] - seed.time;
                    let mut hits = vec![first];
                    let mut residual = 0.0;
                    for &boundary in &run[start + 1..] {
                        operations += peaks.len();
                        if operations > 2_000_000 {
                            result.incomplete = true;
                            break 'search;
                        }
                        let target = boundary - offset;
                        if let Some(&next) = peaks
                            .iter()
                            .filter(|&&i| {
                                self.features[i].clip == seed.clip
                                    && i > *hits.last().unwrap()
                                    && (self.features[i].time - target).abs()
                                        <= if bounds.is_some() { 1.2 } else { 0.8 }
                                    && similarity(&seed.descriptor, &self.features[i].descriptor)
                                        >= 0.5
                            })
                            .max_by(|&&a, &&b| {
                                let rank = |i: usize| {
                                    self.features[i].checker
                                        - (self.features[i].time - target).abs() * 0.03
                                };
                                rank(a).total_cmp(&rank(b))
                            })
                        {
                            residual += (self.features[next].time - target).abs();
                            hits.push(next);
                        }
                    }
                    if hits.len() >= 4 {
                        chains.push((hits.len(), residual / hits.len() as f64, hits));
                    }
                }
            }
        }
        chains.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.total_cmp(&b.1)));
        let mut selected: Vec<Vec<usize>> = Vec::new();
        for (_, _, hits) in chains {
            if selected
                .iter()
                .any(|old| hits.iter().filter(|i| old.contains(i)).count() >= 3)
            {
                continue;
            }
            selected.push(hits);
        }
        if selected.len() > 12 {
            result.incomplete = true;
        }
        let mut by_clip =
            std::collections::BTreeMap::<usize, std::collections::VecDeque<Vec<usize>>>::new();
        for hits in selected {
            by_clip
                .entry(self.features[hits[0]].clip)
                .or_default()
                .push_back(hits);
        }
        let mut selected = Vec::new();
        while selected.len() < 12 && by_clip.values().any(|q| !q.is_empty()) {
            for queue in by_clip.values_mut() {
                if let Some(hits) = queue.pop_front() {
                    selected.push(hits);
                }
                if selected.len() == 12 {
                    break;
                }
            }
        }
        for hits in selected.into_iter().rev() {
            let crossing: Vec<_> = hits
                .iter()
                .map(|&i| VideoCrossing {
                    time: self.features[i].time,
                    uncertainty_seconds: bounds
                        .and_then(|b| b.get(&i))
                        .map_or(0.4, |b| ((b.1 - b.0) / 2.0).max(0.4)),
                    clip: self.features[i].clip,
                })
                .collect();
            result
                .coarse_times
                .insert(0, crossing.iter().map(|c| c.time).collect());
            result.fine.insert(0, vec![Vec::new(); crossing.len()]);
            result.fine_checker.insert(0, vec![0.0; crossing.len()]);
            result.fine_bounds.insert(
                0,
                hits.iter()
                    .map(|&i| {
                        bounds.and_then(|b| b.get(&i).copied()).unwrap_or((
                            (self.features[i].time - 0.6).max(0.0),
                            self.features[i].time + 0.6,
                        ))
                    })
                    .collect(),
            );
            result
                .templates
                .insert(0, self.features[hits[0]].descriptor);
            result
                .landmark_scores
                .insert(0, marking_score(&self.features, &hits));
            result.marker_hypotheses.insert(0, true);
            result.hypotheses.insert(0, crossing);
        }
        Ok(result)
    }
    pub fn finish_ranges(
        &self,
        ranges: &[(f64, f64)],
        cancel: &CancellationToken,
    ) -> Result<VisualAnalysis, String> {
        if cancel.is_cancelled() {
            return Err("Video analysis cancelled".into());
        }
        let mut combined = VisualAnalysis {
            cuts: self.cuts.clone(),
            hypotheses: Vec::new(),
            incomplete: self.incomplete,
            landmark_scores: Vec::new(),
            marker_hypotheses: Vec::new(),
            fine_checker: Vec::new(),
            fine_bounds: Vec::new(),
            templates: Vec::new(),
            coarse_times: Vec::new(),
            fine: Vec::new(),
        };
        if ranges.len() > 32 {
            return Err("Too many visual lap ranges".into());
        }
        let mut queues = Vec::new();
        for &(minimum, maximum) in ranges {
            let result = self.finish(minimum, maximum, cancel)?;
            combined.incomplete |= result.incomplete;
            queues.push(
                result
                    .hypotheses
                    .into_iter()
                    .zip(result.templates)
                    .zip(result.coarse_times)
                    .zip(result.fine)
                    .zip(result.landmark_scores)
                    .zip(result.marker_hypotheses)
                    .zip(result.fine_checker)
                    .zip(result.fine_bounds)
                    .collect::<std::collections::VecDeque<_>>(),
            );
        }
        while combined.hypotheses.len() < MAX_HYPOTHESES && queues.iter().any(|q| !q.is_empty()) {
            for queue in &mut queues {
                let Some((
                    (
                        (((((hypothesis, template), coarse), fine), landmark_score), marker),
                        fine_checker,
                    ),
                    fine_bounds,
                )) = queue.pop_front()
                else {
                    continue;
                };
                if combined.hypotheses.iter().any(|old| {
                    hypothesis
                        .iter()
                        .filter(|c| {
                            old.iter()
                                .any(|o| o.clip == c.clip && (o.time - c.time).abs() < 1.0)
                        })
                        .count()
                        >= 3
                }) {
                    continue;
                }
                combined.hypotheses.push(hypothesis);
                combined.templates.push(template);
                combined.coarse_times.push(coarse);
                combined.fine.push(fine);
                combined.landmark_scores.push(landmark_score);
                combined.marker_hypotheses.push(marker);
                combined.fine_checker.push(fine_checker);
                combined.fine_bounds.push(fine_bounds);
                if combined.hypotheses.len() == MAX_HYPOTHESES {
                    break;
                }
            }
        }
        combined.incomplete |= queues.iter().any(|q| !q.is_empty());
        Ok(combined)
    }
    pub fn finish(
        &self,
        min_lap_seconds: f64,
        max_lap_seconds: f64,
        cancel: &CancellationToken,
    ) -> Result<VisualAnalysis, String> {
        if !min_lap_seconds.is_finite()
            || !max_lap_seconds.is_finite()
            || min_lap_seconds <= 1.0
            || max_lap_seconds < min_lap_seconds
        {
            return Err("Invalid visual lap duration range".into());
        }
        if self.features.len() > MAX_WINDOW_FRAMES {
            return Err("Select a bounded visual window before matching".into());
        }
        let mut proposals: Vec<(f64, Vec<usize>)> = Vec::new();
        let mut last_seed = -f64::INFINITY;
        for (seed, f) in self.features.iter().enumerate() {
            if cancel.is_cancelled() {
                return Err("Video analysis cancelled".into());
            }
            if f.time - last_seed < 1.2 && f.checker < 0.15 {
                continue;
            }
            last_seed = f.time;
            let mut hits = vec![seed];
            let mut strength = 0.0;
            let mut last = seed;
            loop {
                let mut best: Option<(usize, f64)> = None;
                for i in last + 1..self.features.len() {
                    let next = &self.features[i];
                    if next.clip != f.clip {
                        break;
                    }
                    let dt = next.time - self.features[last].time;
                    if dt < min_lap_seconds {
                        continue;
                    }
                    // Permit one missing visual observation, without synthesizing its timestamp.
                    if dt > max_lap_seconds * 2.0 {
                        break;
                    }
                    if dt > max_lap_seconds && dt < min_lap_seconds * 2.0 {
                        continue;
                    }
                    let appearance = similarity(&f.descriptor, &next.descriptor);
                    let marking_supported = f.checker >= 0.15 && next.checker >= 0.15;
                    if appearance < if marking_supported { 0.80 } else { 0.86 } {
                        continue;
                    }
                    let score = appearance
                        + if marking_supported {
                            next.checker * 0.15
                        } else {
                            0.0
                        }
                        - if dt > max_lap_seconds { 0.02 } else { 0.0 };
                    if best.is_none_or(|(_, s)| score > s) {
                        best = Some((i, score));
                    }
                }
                let Some((index, score)) = best else {
                    break;
                };
                // A stationary/pit view is not evidence for completing a lap.
                let middle = (last + index) / 2;
                if similarity(&f.descriptor, &self.features[middle].descriptor) > 0.85 {
                    break;
                }
                hits.push(index);
                strength += score;
                last = index;
            }
            if hits.len() >= 4 {
                let strength = strength / (hits.len() - 1) as f64;
                let marking = marking_score(&self.features, &hits);
                proposals.push((
                    strength * (hits.len() - 1) as f64 * (1.0 + marking * 4.0),
                    hits,
                ));
            }
        }
        proposals.sort_by(|a, b| b.0.total_cmp(&a.0));
        let mut chosen: Vec<Vec<usize>> = Vec::new();
        for (_, hits) in proposals {
            if chosen.iter().any(|old| {
                hits.iter()
                    .filter(|&&i| {
                        old.iter()
                            .any(|&j| (self.features[i].time - self.features[j].time).abs() < 1.0)
                    })
                    .count()
                    >= 3
            }) {
                continue;
            }
            chosen.push(hits);
        }
        let truncated = chosen.len() > MAX_HYPOTHESES;
        let mut by_clip =
            std::collections::BTreeMap::<usize, std::collections::VecDeque<Vec<usize>>>::new();
        for hits in chosen {
            by_clip
                .entry(self.features[hits[0]].clip)
                .or_default()
                .push_back(hits);
        }
        let mut chosen = Vec::new();
        while chosen.len() < MAX_HYPOTHESES && by_clip.values().any(|q| !q.is_empty()) {
            for queue in by_clip.values_mut() {
                if let Some(hits) = queue.pop_front() {
                    chosen.push(hits);
                }
                if chosen.len() == MAX_HYPOTHESES {
                    break;
                }
            }
        }
        let hypotheses: Vec<Vec<VideoCrossing>> = chosen
            .iter()
            .map(|hits| {
                hits.iter()
                    .map(|&i| VideoCrossing {
                        time: self.features[i].time,
                        uncertainty_seconds: 0.4,
                        clip: self.features[i].clip,
                    })
                    .collect()
            })
            .collect();
        let landmark_scores = chosen
            .iter()
            .map(|hits| marking_score(&self.features, hits))
            .collect();
        let templates = chosen
            .iter()
            .map(|hits| self.features[hits[0]].descriptor)
            .collect();
        let coarse_times = hypotheses
            .iter()
            .map(|h| h.iter().map(|c| c.time).collect())
            .collect();
        let fine = hypotheses
            .iter()
            .map(|h| vec![Vec::new(); h.len()])
            .collect();
        Ok(VisualAnalysis {
            cuts: self.cuts.clone(),
            marker_hypotheses: vec![false; hypotheses.len()],
            fine_checker: hypotheses.iter().map(|h| vec![0.0; h.len()]).collect(),
            fine_bounds: hypotheses
                .iter()
                .map(|h| {
                    h.iter()
                        .map(|c| ((c.time - 0.6).max(0.0), c.time + 0.6))
                        .collect()
                })
                .collect(),
            hypotheses,
            incomplete: self.incomplete || truncated,
            templates,
            landmark_scores,
            coarse_times,
            fine,
        })
    }
}
impl VisualAnalysis {
    /// Keep descriptor/template identity when lap evidence changes refinement priority.
    pub fn prioritize(&mut self, indices: &[usize]) -> Result<(), String> {
        if indices.len() > 3
            || indices.iter().any(|&i| i >= self.hypotheses.len())
            || indices
                .iter()
                .enumerate()
                .any(|(i, v)| indices[..i].contains(v))
        {
            return Err("Invalid visual refinement priorities".into());
        }
        let order: Vec<_> = indices
            .iter()
            .copied()
            .chain((0..self.hypotheses.len()).filter(|i| !indices.contains(i)))
            .collect();
        self.hypotheses = order.iter().map(|&i| self.hypotheses[i].clone()).collect();
        self.templates = order.iter().map(|&i| self.templates[i]).collect();
        self.landmark_scores = order.iter().map(|&i| self.landmark_scores[i]).collect();
        self.marker_hypotheses = order.iter().map(|&i| self.marker_hypotheses[i]).collect();
        self.fine_checker = order
            .iter()
            .map(|&i| self.fine_checker[i].clone())
            .collect();
        self.fine_bounds = order.iter().map(|&i| self.fine_bounds[i].clone()).collect();
        self.coarse_times = order
            .iter()
            .map(|&i| self.coarse_times[i].clone())
            .collect();
        self.fine = order.iter().map(|&i| self.fine[i].clone()).collect();
        Ok(())
    }
    fn event_window(&self, h: usize, i: usize) -> (f64, f64) {
        let clip = self.hypotheses[h][i].clip;
        let start = clip
            .checked_sub(1)
            .and_then(|c| self.cuts.get(c))
            .map_or(0.0, |c| c.end_seconds);
        let end = self
            .cuts
            .get(clip)
            .map_or(f64::INFINITY, |c| c.start_seconds);
        let bounds = self.fine_bounds[h][i];
        (bounds.0.max(start), bounds.1.min(end))
    }
    /// Fine decoding is bounded to the first three hypotheses, at most 48 merged windows.
    pub fn refinement_windows(&self) -> Vec<(f64, f64)> {
        let mut windows = Vec::new();
        for h in 0..self.hypotheses.len().min(3) {
            for i in 0..self.hypotheses[h].len() {
                windows.push(self.event_window(h, i));
            }
        }
        windows.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut merged: Vec<(f64, f64)> = Vec::new();
        for window in windows {
            if let Some(last) = merged.last_mut().filter(|last| last.1 >= window.0) {
                last.1 = last.1.max(window.1);
            } else {
                merged.push(window);
            }
        }
        merged.truncate(48);
        merged
    }
    pub fn refine(&mut self, frame: &SampledVideoFrame) -> Result<(), VideoAnalysisError> {
        self.refine_feature(&FineFeature::from_frame(frame)?)
    }
    pub fn refine_feature(&mut self, feature: &FineFeature) -> Result<(), VideoAnalysisError> {
        if !feature.time.is_finite() || feature.time < 0.0 {
            return Err(VideoAnalysisError::new(
                ErrorKind::InvalidInput,
                "Invalid fine feature timestamp",
            ));
        }
        let descriptor = feature.descriptor;
        let checker = feature.checker;
        for h in 0..self.hypotheses.len().min(3) {
            let score = if self.marker_hypotheses[h] {
                checker
            } else {
                similarity(&self.templates[h], &descriptor)
            };
            for i in 0..self.hypotheses[h].len() {
                let window = self.event_window(h, i);
                if feature.time < window.0 || feature.time > window.1 {
                    continue;
                }
                let samples = &mut self.fine[h][i];
                if samples.iter().any(|s| (s.0 - feature.time).abs() < 1e-8) {
                    continue;
                }
                self.fine_checker[h][i] = self.fine_checker[h][i].max(checker);
                if samples.len() >= MAX_FINE_SAMPLES {
                    self.incomplete = true;
                    let weakest = samples
                        .iter()
                        .enumerate()
                        .min_by(|(_, a), (_, b)| a.1.total_cmp(&b.1))
                        .unwrap();
                    if score <= weakest.1 .1 {
                        continue;
                    }
                    let index = weakest.0;
                    samples.swap_remove(index);
                }
                samples.push((feature.time, score));
                let best = *samples.iter().max_by(|a, b| a.1.total_cmp(&b.1)).unwrap();
                let mut near: Vec<_> = samples
                    .iter()
                    .filter(|s| s.1 >= best.1 - 0.02)
                    .map(|s| s.0)
                    .collect();
                near.sort_by(f64::total_cmp);
                self.hypotheses[h][i].time = best.0;
                // Similarity plateaus and window edges must not imply frame-precise localization.
                self.hypotheses[h][i].uncertainty_seconds =
                    if best.0 <= window.0 + 0.1 || best.0 >= window.1 - 0.1 {
                        ((window.1 - window.0) / 2.0).max(0.6)
                    } else {
                        0.1_f64.max((near.last().unwrap() - near[0]) / 2.0)
                    };
            }
            if self.marker_hypotheses[h] {
                let mut strengths = self.fine_checker[h].clone();
                strengths.sort_by(|a, b| b.total_cmp(a));
                self.landmark_scores[h] = (strengths.iter().sum::<f64>() / strengths.len() as f64)
                    .min(strengths.get(3).copied().unwrap_or(0.0));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn signature(seed: u32) -> [f32; 192] {
        let mut s = seed;
        std::array::from_fn(|_| {
            s = s.wrapping_mul(1664525).wrapping_add(1013904223);
            (s >> 16) as f32 / 32768.0 - 1.0
        })
    }
    fn periodic() -> VisualAnalyzer {
        let mut analyzer = VisualAnalyzer::new();
        for i in 0..410 {
            analyzer.features.push(Feature {
                time: i as f64 * 0.4 + 0.03,
                descriptor: signature((i % 100) as u32 + 1),
                checker: 0.0,
                tracking_support: Some(1.0),
                clip: 0,
            });
        }
        analyzer
    }
    #[test]
    fn recurrence_preserves_actual_pts_and_does_not_cross_clips() {
        let mut analyzer = periodic();
        let result = analyzer
            .finish(35.0, 45.0, &CancellationToken::default())
            .unwrap();
        assert!(!result.hypotheses.is_empty());
        assert!(result
            .hypotheses
            .iter()
            .all(|h| h
                .windows(2)
                .all(|w| (w[1].time - w[0].time - 40.0).abs() < 1e-8)));
        assert!(result.hypotheses[0][0].time % 0.4 > 0.029);
        for feature in analyzer.features.iter_mut().skip(210) {
            feature.clip = 1;
        }
        assert!(analyzer
            .finish(35.0, 45.0, &CancellationToken::default())
            .unwrap()
            .hypotheses
            .is_empty());
    }
    #[test]
    fn rejects_stationary_negative_invalid_range_and_cancellation() {
        let mut analyzer = periodic();
        for feature in &mut analyzer.features {
            feature.descriptor = signature(2);
        }
        assert!(analyzer
            .finish(35.0, 45.0, &CancellationToken::default())
            .unwrap()
            .hypotheses
            .is_empty());
        assert!(analyzer
            .finish(f64::NAN, 45.0, &CancellationToken::default())
            .is_err());
        let token = CancellationToken::default();
        token.cancel();
        assert!(analyzer.finish(35.0, 45.0, &token).is_err());
    }
    #[test]
    fn separate_duration_ranges_do_not_turn_an_outlier_into_a_lap_search_envelope() {
        let mut analyzer = periodic();
        for (i, feature) in analyzer.features.iter_mut().enumerate() {
            feature.descriptor = signature((i % 68) as u32 + 1);
        }
        let result = analyzer
            .finish_ranges(
                &[(24.0, 32.0), (180.0, 220.0)],
                &CancellationToken::default(),
            )
            .unwrap();
        assert!(result.hypotheses.iter().any(|h| h.len() >= 5
            && h.windows(2)
                .all(|w| (w[1].time - w[0].time - 27.2).abs() < 1e-8)));
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    #[test]
    fn cut_confirmation_ignores_fixed_cockpit_and_rejects_coarse_camera_motion() {
        use crate::video_analysis::{motion::MotionTracker, PixelFormat};
        let frame = |time: f64, seed: u32| {
            let descriptor = signature(seed);
            SampledVideoFrame {
                timestamp_seconds: time,
                timestamp_value: (time * 1000.0) as i64,
                timestamp_timescale: 1000,
                width: 320,
                height: 180,
                pixel_format: PixelFormat::Gray8,
                pixels: (0..320 * 180)
                    .map(|i| {
                        let (x, y) = (i % 320, i / 320);
                        if y >= 144 || (y >= 117 && x >= 90 && x < 272) {
                            if (x / 4 + y / 4) % 2 == 0 {
                                220
                            } else {
                                30
                            }
                        } else {
                            ((descriptor[(y / 12 * 16 + x / 20) % 192] + 1.0) * 100.0 + 20.0) as u8
                        }
                    })
                    .collect(),
            }
        };
        let mut analyzer = VisualAnalyzer::new();
        analyzer.push(&frame(0.0, 3), None).unwrap();
        analyzer.push(&frame(0.4, 9), Some(0.0)).unwrap();
        assert_eq!(analyzer.suspected_cut_windows().len(), 1);
        assert!(analyzer.cuts.is_empty());
        let mut tracker = MotionTracker::new(320, 180).unwrap();
        for f in [frame(0.35, 3), frame(0.40, 9), frame(0.45, 9)] {
            tracker.push(&f).unwrap();
            analyzer
                .confirm_cut(&f, tracker.tracking_support())
                .unwrap();
        }
        assert_eq!(
            analyzer.cuts.len(),
            1,
            "fixed cockpit must not certify road continuity"
        );
        let mut motion = VisualAnalyzer::new();
        motion.push(&frame(0.0, 3), None).unwrap();
        motion.push(&frame(0.4, 9), Some(0.0)).unwrap();
        for f in [frame(0.35, 3), frame(0.40, 9), frame(0.45, 9)] {
            motion.confirm_cut(&f, Some(0.8)).unwrap();
        }
        assert!(
            motion.cuts.is_empty(),
            "a coarse appearance jump with fine geometry continuity is not an edit"
        );
    }
    #[test]
    fn refinement_priority_keeps_template_and_timestamp_identity() {
        let analyzer = periodic();
        let mut result = analyzer
            .finish(35.0, 45.0, &CancellationToken::default())
            .unwrap();
        assert!(result.hypotheses.len() > 1);
        result.landmark_scores[1] = 0.7;
        let time = result.hypotheses[1][0].time;
        let bounds = ((time - 1.0).max(0.0), time + 1.0);
        result.fine_bounds[1][0] = bounds;
        let template = result.templates[1];
        result.prioritize(&[1, 0]).unwrap();
        assert_eq!(result.hypotheses[0][0].time, time);
        assert_eq!(result.coarse_times[0][0], time);
        assert_eq!(result.templates[0], template);
        assert_eq!(result.landmark_scores[0], 0.7);
        assert_eq!(result.event_window(0, 0), bounds);
        assert!(result.prioritize(&[0, 0]).is_err());
        assert!(result.prioritize(&[usize::MAX]).is_err());
    }
    #[test]
    fn checker_episodes_follow_duration_sequences_without_synthesizing_timestamps() {
        let mut analyzer = periodic();
        for feature in &mut analyzer.features {
            feature.checker = 0.05;
        }
        for i in [5, 105, 205, 305, 405] {
            analyzer.features[i].checker = 0.11;
        }
        let result = analyzer
            .finish_with_sequences(
                &[(35.0, 45.0)],
                &[vec![0.0, 40.0, 80.0, 120.0, 160.0]],
                &CancellationToken::default(),
            )
            .unwrap();
        let marker = result.marker_hypotheses.iter().position(|&m| m).unwrap();
        assert_eq!(result.hypotheses[marker].len(), 5);
        assert!(result.hypotheses[marker].iter().all(|c| analyzer
            .features
            .iter()
            .any(|f| f.time == c.time && f.checker == 0.11)));
        let unrelated = analyzer
            .finish_with_sequences(
                &[(35.0, 45.0)],
                &[vec![0.0, 40.0, 90.0, 130.0, 180.0]],
                &CancellationToken::default(),
            )
            .unwrap();
        assert!(!unrelated.marker_hypotheses.iter().any(|&m| m));
        for feature in &mut analyzer.features {
            feature.checker = 0.05;
        }
        for i in [5, 71, 199, 239, 405] {
            analyzer.features[i].checker = 0.11;
            analyzer.features[i].descriptor = signature(3);
        }
        let irregular = analyzer
            .finish_with_sequences(
                &[(35.0, 45.0)],
                &[vec![0.0, 40.0, 80.0, 120.0, 160.0]],
                &CancellationToken::default(),
            )
            .unwrap();
        assert!(!irregular.marker_hypotheses.iter().any(|&m| m));
        for feature in &mut analyzer.features {
            feature.checker = 0.8;
        }
        let stationary = analyzer
            .finish_with_sequences(
                &[(35.0, 45.0)],
                &[vec![0.0, 40.0, 80.0, 120.0, 160.0]],
                &CancellationToken::default(),
            )
            .unwrap();
        assert!(!stationary.marker_hypotheses.iter().any(|&m| m));
    }
    #[test]
    fn late_windows_preserve_global_clip_indexes_pts_and_the_whole_cut_index() {
        let mut analyzer = VisualAnalyzer::new();
        analyzer.cuts = vec![
            CutBracket {
                start_seconds: 99.1,
                end_seconds: 99.2,
            },
            CutBracket {
                start_seconds: 1199.1,
                end_seconds: 1199.2,
            },
            CutBracket {
                start_seconds: 2199.1,
                end_seconds: 2199.2,
            },
        ];
        for i in 0..6600 {
            let time = i as f64 * 0.4 + 0.03;
            analyzer.features.push(Feature {
                time,
                descriptor: signature((i % 100) as u32),
                checker: 0.05,
                tracking_support: Some(0.9),
                clip: analyzer
                    .cuts
                    .iter()
                    .filter(|c| c.end_seconds <= time)
                    .count(),
            });
        }
        assert!(analyzer
            .finish(35.0, 45.0, &CancellationToken::default())
            .is_err());
        let late = analyzer.window(2000.0, 2599.0).unwrap();
        assert_eq!(late.cuts().len(), 3);
        assert_eq!(late.features.first().unwrap().clip, 2);
        assert_eq!(late.features.last().unwrap().clip, 3);
        assert_eq!(
            late.features.last().unwrap().time,
            analyzer.features[6497].time
        );
        assert!(late.frame_count() > 1400 && late.frame_count() <= 1600);
        assert!(analyzer.window(0.0, 1000.0).is_err());
        assert!(analyzer.window(f64::NAN, 20.0).is_err());
    }
    #[test]
    fn nonrepeating_pit_activity_does_not_force_a_cut_or_clip_renumbering() {
        let mut analyzer = periodic();
        for feature in analyzer.features.iter_mut().skip(120).take(100) {
            feature.checker = 0.0;
            feature.descriptor = signature(7);
        }
        let before = analyzer.window(0.0, 80.0).unwrap();
        let after = analyzer.window(80.0, 165.0).unwrap();
        assert!(before.cuts().is_empty() && after.cuts().is_empty());
        assert!(after.features.iter().all(|f| f.clip == 0));
    }
    #[test]
    fn cached_fine_features_keep_visual_only_localization() {
        let analyzer = periodic();
        let mut result = analyzer
            .finish(35.0, 45.0, &CancellationToken::default())
            .unwrap();
        result.marker_hypotheses[0] = true;
        let time = result.hypotheses[0][0].time;
        result
            .refine_feature(&FineFeature {
                time: time + 0.1,
                descriptor: [0.0; 192],
                checker: 0.2,
            })
            .unwrap();
        result
            .refine_feature(&FineFeature {
                time: time + 0.2,
                descriptor: [0.0; 192],
                checker: 0.4,
            })
            .unwrap();
        assert_eq!(result.hypotheses[0][0].time, time + 0.2);
    }
    fn transfer_session() -> crate::telemetry::Session {
        crate::telemetry::Session {
            merge: None,
            id: "transfer".into(),
            source: String::new(),
            name: String::new(),
            driver: String::new(),
            track: String::new(),
            recorded_at: String::new(),
            channels: vec![],
            warnings: vec![],
            laps: (0..4)
                .map(|i| crate::telemetry::Lap {
                    id: i.to_string(),
                    number: i + 1,
                    start: i as f64 * 40.0,
                    end: (i + 1) as f64 * 40.0,
                    duration: 40.0,
                    complete: true,
                })
                .collect(),
        }
    }
    #[test]
    fn learned_landmark_transfers_across_lighting_occlusion_and_disjoint_clips() {
        let mut analyzer = VisualAnalyzer::new();
        let view = signature(3);
        analyzer.cuts.push(CutBracket {
            start_seconds: 199.9,
            end_seconds: 200.0,
        });
        for i in 0..1000 {
            analyzer.features.push(Feature {
                time: i as f64 * 0.4 + 0.03,
                descriptor: signature((i % 100) as u32 + 1000),
                checker: 0.04,
                clip: usize::from(i >= 500),
                tracking_support: Some(0.9),
            });
        }
        for event in [5, 105, 205, 305, 405, 505, 605, 705, 805, 905] {
            for i in event - 1..=event + 1 {
                analyzer.features[i].descriptor =
                    std::array::from_fn(|j| if j < 32 { 0.0 } else { view[j] * 0.7 });
            }
        }
        let template = FineFeature {
            time: 9000.0,
            descriptor: view,
            checker: 0.3,
        };
        let result = analyzer
            .finish_transferred(
                &[template],
                &[(35.0, 45.0)],
                &[transfer_session()],
                &CancellationToken::default(),
            )
            .unwrap();
        assert!(result
            .hypotheses
            .iter()
            .any(|h| h.len() == 5 && h[0].clip == 0));
        assert!(result
            .hypotheses
            .iter()
            .any(|h| h.len() == 5 && h[0].clip == 1));
        assert!(result.marker_hypotheses.iter().all(|&m| m));
        assert!(result.hypotheses.iter().all(|h| h
            .iter()
            .all(|c| c.clip == h[0].clip && analyzer.features.iter().any(|f| f.time == c.time))));
        assert!(result.refinement_windows().iter().any(|(a, b)| b - a > 1.2));
    }
    #[test]
    fn transferred_views_reject_static_unrelated_and_irregular_activity() {
        let view = signature(3);
        let template = FineFeature {
            time: 9000.0,
            descriptor: view,
            checker: 0.3,
        };
        let mut analyzer = periodic();
        for f in &mut analyzer.features {
            f.descriptor = signature(900);
        }
        assert!(analyzer
            .finish_transferred(
                &[template.clone()],
                &[(35.0, 45.0)],
                &[transfer_session()],
                &CancellationToken::default()
            )
            .unwrap()
            .hypotheses
            .is_empty());
        for i in [5, 71, 199, 239, 405] {
            analyzer.features[i].descriptor = view;
        }
        assert!(analyzer
            .finish_transferred(
                &[template.clone()],
                &[(35.0, 45.0)],
                &[transfer_session()],
                &CancellationToken::default()
            )
            .unwrap()
            .hypotheses
            .is_empty());
        for f in &mut analyzer.features {
            f.descriptor = view;
        }
        assert!(analyzer
            .finish_transferred(
                &[template],
                &[(35.0, 45.0)],
                &[transfer_session()],
                &CancellationToken::default()
            )
            .unwrap()
            .hypotheses
            .is_empty());
    }
    #[test]
    fn late_stronger_fine_marker_survives_budget_exhaustion_and_replay_order() {
        let analyzer = periodic();
        let mut result = analyzer
            .finish(35.0, 45.0, &CancellationToken::default())
            .unwrap();
        result.marker_hypotheses[0] = true;
        result.fine_bounds[0][0] = (0.0, 3.2);
        for i in 0..MAX_FINE_SAMPLES {
            result
                .refine_feature(&FineFeature {
                    time: 0.01 + i as f64 * 0.001,
                    descriptor: [0.0; 192],
                    checker: 0.05,
                })
                .unwrap();
        }
        result
            .refine_feature(&FineFeature {
                time: 2.8,
                descriptor: [0.0; 192],
                checker: 0.7,
            })
            .unwrap();
        assert_eq!(result.hypotheses[0][0].time, 2.8);
        assert_eq!(result.fine_checker[0][0], 0.7);
        assert_eq!(result.fine[0][0].len(), MAX_FINE_SAMPLES);
        assert!(result.incomplete);
    }
    #[test]
    fn marking_evidence_needs_repeated_observations() {
        let mut analyzer = periodic();
        analyzer.features[0].checker = 0.9;
        assert_eq!(marking_score(&analyzer.features, &[0, 100, 200, 300]), 0.0);
        for i in [100, 200, 300] {
            analyzer.features[i].checker = 0.3;
        }
        assert!(marking_score(&analyzer.features, &[0, 100, 200, 300]) >= 0.3);
    }
    #[test]
    fn descriptor_tolerates_exposure_and_translation() {
        let a = signature(3);
        let mut b = [0.0; 192];
        for y in 0..12 {
            for x in 1..16 {
                b[y * 16 + x] = a[y * 16 + x - 1] * 1.2;
            }
        }
        assert!(similarity(&a, &b) > 0.999);
        assert!(similarity(&a, &signature(9)) < 0.3);
    }
}
