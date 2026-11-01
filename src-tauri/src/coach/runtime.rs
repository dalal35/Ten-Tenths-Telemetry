//! Directly linked, network-free llama.cpp inference. Never call on the UI thread.
//! Facts remain deterministic; bounded qualitative interpretations are explicitly hypotheses.
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, LlamaModel},
    sampling::LlamaSampler,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::{
    collections::HashSet,
    num::NonZeroU32,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

pub const MODEL_VERSION: &str = "gemma-3-1b-it-Q4_K_M-f9c28bcd";
pub const MODEL_SHA256: &str = "8ccc5cd1f1b3602548715ae25a66ed73fd5dc68a210412eea643eb20eb75a135";
const CONTEXT: u32 = 6144;
const PREFILL_BATCH: u32 = 128;
const MAX_TOKENS: usize = 768;
const MAX_OUTPUT: usize = 8192;
pub const MAX_EVIDENCE_SUMMARY: usize = 4096;
pub const REASONING_VERSION: &str = "evidence-coach-v12-short-corner-identities";
static INFERENCE: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeEvidence {
    pub evidence_id: String,
    pub summary: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeExplanation {
    pub evidence_id: String,
    pub hypothesis: String,
    pub experiment: String,
    pub validation: String,
    pub related_evidence_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interpretation_id: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InferenceMetrics {
    pub integrity_ms: u128,
    pub backend_init_ms: u128,
    pub model_load_ms: u128,
    pub inference_ms: u128,
    pub generated_tokens: usize,
    pub prompt_tokens: usize,
    pub output_bytes: usize,
    pub context_init_ms: u128,
    pub prompt_build_ms: u128,
    pub tokenization_ms: u128,
    pub prefill_ms: u128,
    pub generation_ms: u128,
    pub validation_us: u128,
    pub sampler_init_ms: u128,
    pub prefill_tokens_per_second: f64,
    pub generation_tokens_per_second: f64,
    pub threads: i32,
    pub batch_size: u32,
    pub context_size: u32,
    /// True only for a successful run configured to offload all model layers.
    /// Native diagnostics are the authority for actual tensor placement.
    pub gpu: bool,
    pub gpu_requested: bool,
    pub gpu_fallback_ms: u128,
    pub requested_gpu_layers: u32,
    pub backend_devices: Vec<String>,
}
#[derive(Debug)]
pub enum RuntimeError {
    Busy,
    Cancelled,
    MissingModel,
    Limit,
    InvalidOutput,
    RejectedOutput {
        output: String,
        reason: &'static str,
    },
    Native(String),
}
impl std::fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy => write!(f, "Another model request is running"),
            Self::Cancelled => write!(f, "Cancelled"),
            Self::MissingModel => write!(f, "The bundled coach model is unavailable"),
            Self::Limit => write!(f, "Inference resource limit reached"),
            Self::InvalidOutput => write!(f, "Model output failed evidence validation"),
            Self::RejectedOutput { reason, .. } => write!(f, "Model reasoning rejected: {reason}"),
            Self::Native(e) => write!(f, "Local inference: {e}"),
        }
    }
}
fn native(e: impl std::fmt::Display) -> RuntimeError {
    RuntimeError::Native(e.to_string())
}
fn check(cancel: &AtomicBool, start: Instant) -> Result<(), RuntimeError> {
    if cancel.load(Ordering::Relaxed) {
        Err(RuntimeError::Cancelled)
    } else if start.elapsed() > Duration::from_secs(90) {
        Err(RuntimeError::Limit)
    } else {
        Ok(())
    }
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-:.".contains(&c))
}
fn validate_input(evidence: &[RuntimeEvidence]) -> Result<(), RuntimeError> {
    let mut ids = HashSet::new();
    if evidence.is_empty() || evidence.len() > 16 {
        return Err(RuntimeError::InvalidOutput);
    }
    for e in evidence {
        if !valid_id(&e.evidence_id)
            || !ids.insert(&e.evidence_id)
            || e.summary.len() > MAX_EVIDENCE_SUMMARY
        {
            return Err(RuntimeError::InvalidOutput);
        }
    }
    Ok(())
}
/// Qualitative text cannot introduce numeric quantities or promise a result. This is a
/// mechanical boundary, not a proof of semantic truth: the UI labels causes hypotheses.
fn qualitative(text: &str) -> bool {
    if text.len() < 12
        || text.len() > 320
        || !text
            .bytes()
            .all(|b| b.is_ascii_alphabetic() || b" ,.;:'!?()-/".contains(&b))
    {
        return false;
    }
    let lower = text.to_ascii_lowercase();
    // No such measured channels are supplied to this qualitative interface. A hedge
    // cannot make an invented sensor observation acceptable.
    if [
        "brake pressure",
        "throttle position",
        "steering angle",
        "clutch pressure",
        "tire temperature",
        "tyre temperature",
        "fuel pressure",
        "throttle usage",
        "throttle response",
        "braking inputs",
        "brake inputs",
        "steering inputs",
        "throttle trace",
        "brake trace",
        "steering trace",
        "clutch trace",
    ]
    .iter()
    .any(|channel| lower.contains(channel))
    {
        return false;
    }

    // A speculative second clause cannot turn an asserted unmeasured control into
    // a measured fact. Suggestions and explicitly conditional causes remain allowed.
    if ["brak", "throttle", "steer", "clutch", "shift", "gear"]
        .iter()
        .any(|control| lower.contains(control))
        && [
            "trace shows",
            "data shows",
            "data confirms",
            "you lifted",
            "you braked",
            "you shifted",
            "you are braking",
            "you are steering",
            "you applied",
            "you missed",
            "driver lifted",
            "driver braked",
        ]
        .iter()
        .any(|assertion| lower.contains(assertion))
    {
        return false;
    }

    if [
        "will save",
        "will reduce",
        "will improve",
        "will gain",
        "ensures",
    ]
    .iter()
    .any(|promise| lower.contains(promise))
    {
        return false;
    }
    let banned = [
        "zero",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
        "nineteen",
        "twenty",
        "thirty",
        "forty",
        "fifty",
        "sixty",
        "seventy",
        "eighty",
        "ninety",
        "hundred",
        "thousand",
        "million",
        "half",
        "quarter",
        "tenths",
        "tenth",
        "hundredth",
        "millisecond",
        "milliseconds",
        "second",
        "seconds",
        "minute",
        "minutes",
        "hour",
        "hours",
        "percentages",
        "percentage",
        "dozen",
        "twice",
        "double",
        "triple",
        "quarter",
        "halves",
        "third",
        "thirds",
        "quarters",
        "tenths",
        "hundredths",
        "thousandths",
        "percent",
        "guaranteed",
        "guarantee",
        "proven",
        "definitely",
        "certainly",
        "always",
        "never",
    ];
    let fractions_and_units = [
        "first",
        "second",
        "third",
        "fourth",
        "fifth",
        "sixth",
        "seventh",
        "eighth",
        "ninth",
        "tenth",
        "eleventh",
        "twelfth",
        "thirteenth",
        "fourteenth",
        "fifteenth",
        "sixteenth",
        "seventeenth",
        "eighteenth",
        "nineteenth",
        "twentieth",
        "thirtieth",
        "fortieth",
        "fiftieth",
        "sixtieth",
        "seventieth",
        "eightieth",
        "ninetieth",
        "hundredth",
        "thousandth",
        "millionth",
        "billionth",
        "fifths",
        "sixths",
        "sevenths",
        "eighths",
        "ninths",
        "mph",
        "kph",
        "kmh",
        "km",
        "kmph",
        "mps",
        "kps",
        "kph",
        "meters",
        "meter",
        "metres",
        "metre",
        "kilometers",
        "kilometer",
        "kilometres",
        "kilometre",
        "feet",
        "foot",
        "inches",
        "inch",
        "miles",
        "mile",
        "yards",
        "yard",
        "degrees",
        "degree",
        "radians",
        "radian",
    ];
    if lower.split(|c: char| !c.is_ascii_alphabetic()).any(|word| {
        fractions_and_units.contains(&word)
            || word
                .strip_suffix('s')
                .is_some_and(|singular| fractions_and_units.contains(&singular))
    }) {
        return false;
    }
    !lower
        .split(|c: char| !c.is_ascii_alphabetic())
        .any(|word| banned.contains(&word))
}
/// A production interpretation must select a hypothesis derived from that corner's
/// profiles. An invented causal family cannot become valid merely by adding "may".
fn grounded_selection(row: &RuntimeExplanation, evidence: &[RuntimeEvidence]) -> bool {
    let Some(source) = evidence.iter().find(|e| e.evidence_id == row.evidence_id) else {
        return false;
    };
    let Ok(source) = serde_json::from_str::<serde_json::Value>(&source.summary) else {
        return row.interpretation_id.is_none();
    };
    let Some(options) = source
        .get("coaching")
        .and_then(|c| c.get("hypotheses"))
        .and_then(|v| v.as_array())
    else {
        return row.interpretation_id.is_none();
    };
    let Some(selected) = options
        .iter()
        .find(|h| h.get("id").and_then(|v| v.as_str()) == row.interpretation_id.as_deref())
    else {
        return false;
    };
    // Source prose is created from the profile evidence in Rust. Constrain the
    // explanation as well as the selected ID; hedged free prose is not factual validation.
    selected.get("hypothesis").and_then(|v| v.as_str()) == Some(row.hypothesis.as_str())
        && selected.get("experiment").and_then(|v| v.as_str()) == Some(row.experiment.as_str())
        && selected.get("validation").and_then(|v| v.as_str()) == Some(row.validation.as_str())
}

/// Reject unknown fields, quantities, invented/duplicate references and unbounded prose.
/// The model selects and orders a subset; source measurements and confidence remain unchanged.
pub fn validate_output(
    output: &str,
    evidence: &[RuntimeEvidence],
) -> Result<Vec<RuntimeExplanation>, RuntimeError> {
    if output.len() > MAX_OUTPUT {
        return Err(RuntimeError::Limit);
    }
    let rows: Vec<RuntimeExplanation> =
        serde_json::from_str(output).map_err(|_| RuntimeError::InvalidOutput)?;
    let ids: HashSet<_> = evidence.iter().map(|e| e.evidence_id.as_str()).collect();
    let mut seen = HashSet::new();
    if rows.len() > 3 {
        return Err(RuntimeError::InvalidOutput);
    }
    for row in &rows {
        let mut related = HashSet::new();
        if !ids.contains(row.evidence_id.as_str())
            || !seen.insert(&row.evidence_id)
            || !grounded_selection(row, evidence)
            || !row
                .hypothesis
                .to_ascii_lowercase()
                .split(|c: char| !c.is_ascii_alphabetic())
                .any(|word| ["may", "might", "could"].contains(&word))
            || !qualitative(&row.hypothesis)
            || !qualitative(&row.experiment)
            || !qualitative(&row.validation)
            || row.related_evidence_ids.len() > 3
            || row.related_evidence_ids.iter().any(|id| {
                id == &row.evidence_id || !ids.contains(id.as_str()) || !related.insert(id)
            })
        {
            return Err(RuntimeError::InvalidOutput);
        }
    }
    Ok(rows)
}
/// A malformed/unsupported row must not discard an independent, strictly validated
/// interpretation. Only complete JSON arrays are considered; schema and numeric guards
/// apply to every surviving row, including duplicate-reference checks.
fn usable_output(
    output: &str,
    evidence: &[RuntimeEvidence],
) -> Result<Vec<RuntimeExplanation>, RuntimeError> {
    if output.len() > MAX_OUTPUT {
        return Err(RuntimeError::Limit);
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Selection {
        evidence_id: String,
        interpretation_id: String,
    }
    if let Ok(selections) = serde_json::from_str::<Vec<Selection>>(output) {
        if !selections.is_empty() {
            let mut rows = Vec::new();
            for selection in selections {
                let source = evidence
                    .iter()
                    .find(|e| e.evidence_id == selection.evidence_id)
                    .ok_or(RuntimeError::InvalidOutput)?;
                let source: serde_json::Value = serde_json::from_str(&source.summary)
                    .map_err(|_| RuntimeError::InvalidOutput)?;
                let option = source["coaching"]["hypotheses"]
                    .as_array()
                    .and_then(|options| {
                        options.iter().find(|o| {
                            o["id"].as_str() == Some(selection.interpretation_id.as_str())
                        })
                    })
                    .ok_or(RuntimeError::InvalidOutput)?;
                let field = |key: &str| {
                    option[key]
                        .as_str()
                        .map(str::to_owned)
                        .ok_or(RuntimeError::InvalidOutput)
                };
                rows.push(RuntimeExplanation {
                    evidence_id: selection.evidence_id,
                    interpretation_id: Some(selection.interpretation_id),
                    hypothesis: field("hypothesis")?,
                    experiment: field("experiment")?,
                    validation: field("validation")?,
                    related_evidence_ids: vec![],
                });
            }
            return validate_output(&serde_json::to_string(&rows).map_err(native)?, evidence);
        }
    }
    if let Ok(rows) = validate_output(output, evidence) {
        return Ok(rows);
    }
    if output.len() > MAX_OUTPUT {
        return Err(RuntimeError::Limit);
    }
    let rows: Vec<serde_json::Value> =
        serde_json::from_str(output).map_err(|_| RuntimeError::InvalidOutput)?;
    if rows.len() > 3 {
        return Err(RuntimeError::InvalidOutput);
    }
    let mut accepted = Vec::new();
    for row in rows {
        let single = serde_json::to_string(&vec![row]).map_err(native)?;
        if let Ok(mut valid) = validate_output(&single, evidence) {
            let row = valid.remove(0);
            if !accepted
                .iter()
                .any(|previous: &RuntimeExplanation| previous.evidence_id == row.evidence_id)
            {
                accepted.push(row);
            }
        }
    }
    if accepted.is_empty() {
        Err(RuntimeError::InvalidOutput)
    } else {
        Ok(accepted)
    }
}

fn grammar(evidence: &[RuntimeEvidence]) -> String {
    let quoted =
        |value: &str| serde_json::to_string(&serde_json::to_string(value).unwrap()).unwrap();
    let ids = evidence
        .iter()
        .map(|e| quoted(&e.evidence_id))
        .collect::<Vec<_>>()
        .join(" | ");
    let row_rules = evidence.iter().enumerate().map(|(index, e)| {
        let choices = serde_json::from_str::<serde_json::Value>(&e.summary).ok()
            .and_then(|v| v.get("coaching").and_then(|c| c.get("hypotheses")).and_then(|v| v.as_array()).cloned());
        let rows = if let Some(choices) = choices {
            choices.iter().map(|choice| {
                let literal = |field| quoted(choice.get(field).and_then(|v| v.as_str()).unwrap_or(""));
                format!(r#""{{" ws "\"evidenceId\":" ws {} ws "," ws "\"interpretationId\":" ws {} ws "}}""#,
                    quoted(&e.evidence_id),literal("id"))
            }).collect::<Vec<_>>().join(" | ")
        } else {
            format!(r#""{{" ws "\"evidenceId\":" ws {} ws "," ws "\"hypothesis\":" ws prose ws "," ws "\"experiment\":" ws prose ws "," ws "\"validation\":" ws prose ws "," ws "\"relatedEvidenceIds\":" ws related ws "}}""#, quoted(&e.evidence_id))
        };
        format!("row{index} ::= {rows}")
    }).collect::<Vec<_>>().join("\n");
    let row_options = (0..evidence.len())
        .map(|i| format!("row{i}"))
        .collect::<Vec<_>>()
        .join(" | ");
    let bounded = evidence.iter().all(|e| {
        serde_json::from_str::<serde_json::Value>(&e.summary)
            .ok()
            .is_some_and(|v| {
                v.get("coaching")
                    .and_then(|c| c.get("hypotheses"))
                    .is_some_and(|h| h.is_array())
            })
    });
    let sequences = if bounded {
        (0..evidence.len())
            .map(|i| format!("row{i}"))
            .collect::<Vec<_>>()
            .join(" ws \",\" ws ")
    } else {
        (1..=3)
            .map(|n| vec!["row"; n].join(" ws \",\" ws "))
            .collect::<Vec<_>>()
            .join(" | ")
    };
    let optional = if bounded { "" } else { "?" };
    format!(
        r#"root ::= "[" ws rows{optional} ws "]"
rows ::= {sequences}
row ::= {row_options}
{row_rules}
id ::= {ids}
prose ::= "\"" [a-zA-Z ,.;:'!?()/-]+ "\""
related ::= "[" ws "]" | "[" ws id ws "]" | "[" ws id ws "," ws id ws "]" | "[" ws id ws "," ws id ws "," ws id ws "]"
ws ::= [ \t\n\r]*"#
    )
}
fn coached(evidence: &[RuntimeEvidence]) -> bool {
    evidence.iter().all(|source| {
        serde_json::from_str::<serde_json::Value>(&source.summary)
            .ok()
            .is_some_and(|v| v["coaching"]["hypotheses"].is_array())
    })
}

/// Model-facing identities carry no measurement facts. Preserve the object decision
/// schema and all observations, shortening only identities that would otherwise be
/// generated token by token (merged source-qualified hashes are particularly long).
fn wire_evidence(evidence: &[RuntimeEvidence]) -> Vec<RuntimeEvidence> {
    let shorten = coached(evidence);
    evidence
        .iter()
        .enumerate()
        .map(|(index, source)| RuntimeEvidence {
            evidence_id: if shorten {
                format!("c{index}")
            } else {
                source.evidence_id.clone()
            },
            summary: source.summary.clone(),
        })
        .collect()
}

fn restore_source_ids(
    mut rows: Vec<RuntimeExplanation>,
    wire: &[RuntimeEvidence],
    source: &[RuntimeEvidence],
) -> Result<Vec<RuntimeExplanation>, RuntimeError> {
    if wire.len() != source.len() || (coached(source) && rows.len() != source.len()) {
        return Err(RuntimeError::InvalidOutput);
    }
    let restore = |id: &str| {
        wire.iter()
            .position(|item| item.evidence_id == id)
            .map(|index| source[index].evidence_id.clone())
            .ok_or(RuntimeError::InvalidOutput)
    };
    for row in &mut rows {
        row.evidence_id = restore(&row.evidence_id)?;
        row.related_evidence_ids = row
            .related_evidence_ids
            .iter()
            .map(|id| restore(id))
            .collect::<Result<Vec<_>, _>>()?;
    }
    validate_output(&serde_json::to_string(&rows).map_err(native)?, source)
}

/// Model/context/samplers are dropped on every return, releasing idle model memory.
/// `force_cpu` is provided for the reproducible benchmark and CPU fallback verification.
pub fn generate(
    model_path: &Path,
    evidence: &[RuntimeEvidence],
    cancel: &AtomicBool,
    force_cpu: bool,
) -> Result<(Vec<RuntimeExplanation>, InferenceMetrics), RuntimeError> {
    generate_with_context(model_path, evidence, "", cancel, force_cpu)
}

pub fn generate_with_context(
    model_path: &Path,
    evidence: &[RuntimeEvidence],
    section_context: &str,
    cancel: &AtomicBool,
    force_cpu: bool,
) -> Result<(Vec<RuntimeExplanation>, InferenceMetrics), RuntimeError> {
    let _exclusive = INFERENCE.try_lock().map_err(|_| RuntimeError::Busy)?;
    let started = Instant::now();
    check(cancel, started)?;
    validate_input(evidence)?;
    if section_context.len() > 12000 {
        return Err(RuntimeError::Limit);
    }
    if !model_path.is_file() {
        return Err(RuntimeError::MissingModel);
    }
    let integrity_start = Instant::now();
    // Production always uses the pinned bundle. The benchmark explicitly accepts other candidates.
    if model_path.file_name().is_some_and(|n| n == "model.gguf") {
        verify_model(model_path, cancel, started)?;
    }
    let integrity_ms = integrity_start.elapsed().as_millis();
    let backend_start = Instant::now();
    let mut backend = LlamaBackend::init().map_err(native)?;
    if !cfg!(debug_assertions) && std::env::var_os("COACH_NATIVE_LOGS").is_none() {
        backend.void_logs();
    }
    let accelerated = !force_cpu && backend.supports_gpu_offload();
    let backend_devices = llama_cpp_2::list_llama_ggml_backend_devices()
        .into_iter()
        .map(|device| format!("{}:{}:{}", device.backend, device.name, device.description))
        .collect::<Vec<_>>();
    let backend_init_ms = backend_start.elapsed().as_millis();
    let wire = wire_evidence(evidence);
    let attempt_start = Instant::now();
    let mut gpu_fallback_ms = 0;
    let result = match run(
        &backend,
        model_path,
        &wire,
        section_context,
        cancel,
        started,
        accelerated,
    ) {
        Err(RuntimeError::Native(_)) if accelerated => {
            gpu_fallback_ms = attempt_start.elapsed().as_millis();
            check(cancel, started)?;
            run(
                &backend,
                model_path,
                &wire,
                section_context,
                cancel,
                started,
                false,
            )
        }
        result => result,
    };
    result.and_then(|(rows, mut metrics)| {
        let validation_start = Instant::now();
        let rows = restore_source_ids(rows, &wire, evidence)?;
        metrics.validation_us += validation_start.elapsed().as_micros();
        metrics.integrity_ms = integrity_ms;
        metrics.backend_init_ms = backend_init_ms;
        metrics.gpu_requested = accelerated;
        metrics.gpu_fallback_ms = gpu_fallback_ms;
        metrics.backend_devices = backend_devices;
        Ok((rows, metrics))
    })
}
/// Stream rather than mapping a second model-sized allocation. Cancellation is checked
/// between reads. Integrity is verified on each cold load, including offline installs.
fn verify_model(path: &Path, cancel: &AtomicBool, started: Instant) -> Result<(), RuntimeError> {
    let mut file = std::fs::File::open(path).map_err(native)?;
    if file.metadata().map_err(native)?.len() != 806_058_240 {
        return Err(RuntimeError::InvalidOutput);
    }
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut hash = Sha256::new();
    loop {
        check(cancel, started)?;
        let size = file.read(&mut buffer).map_err(native)?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
    }
    if format!("{:x}", hash.finalize()) != MODEL_SHA256 {
        return Err(RuntimeError::Native(
            "Bundled model checksum mismatch".into(),
        ));
    }
    Ok(())
}
fn run(
    backend: &LlamaBackend,
    path: &Path,
    evidence: &[RuntimeEvidence],
    section_context: &str,
    cancel: &AtomicBool,
    started: Instant,
    gpu: bool,
) -> Result<(Vec<RuntimeExplanation>, InferenceMetrics), RuntimeError> {
    let batch_size = PREFILL_BATCH;
    let load = Instant::now();
    let params = LlamaModelParams::default().with_n_gpu_layers(if gpu { 99 } else { 0 });
    // Zero model layers alone still permits KQV/operation offload in llama.cpp.
    // An explicit empty device list plus CPU context flags makes fallback truly CPU-only.
    let params = if gpu {
        params
    } else {
        params.with_devices(&[]).map_err(native)?
    };
    let model = LlamaModel::load_from_file(backend, path, &params).map_err(native)?;
    check(cancel, started)?;
    let threads = std::thread::available_parallelism()
        .map_or(2, |n| n.get().saturating_sub(2).clamp(1, 4)) as i32;
    let model_load_ms = load.elapsed().as_millis();
    let context_start = Instant::now();
    let mut context = model
        .new_context(
            backend,
            LlamaContextParams::default()
                .with_n_ctx(NonZeroU32::new(CONTEXT))
                .with_n_batch(batch_size)
                .with_n_ubatch(batch_size)
                .with_offload_kqv(gpu)
                .with_op_offload(gpu)
                .with_n_threads(threads)
                .with_n_threads_batch(threads),
        )
        .map_err(native)?;
    let context_init_ms = context_start.elapsed().as_millis();
    let prompt_start = Instant::now();
    // Summaries are serialized compact measurements in production. Parse them back
    // into objects so a small model sees structured facts, not escaped JSON strings.
    let candidates = evidence
        .iter()
        .map(|item| {
            let mut observations = serde_json::from_str::<serde_json::Value>(&item.summary)
                .unwrap_or_else(|_| serde_json::Value::String(item.summary.clone()));
            if let Some(fields) = observations.as_object_mut() {
                // Legacy caches may retain offered choices. They are never a prose menu.
                fields.remove("interpretations");
            }
            serde_json::json!({"evidenceId": item.evidence_id, "observations": observations})
        })
        .collect::<Vec<_>>();
    let prompt = format!(
        "<start_of_turn>user\nYou are an offline kart driving coach. Choose the most useful supported driving experiment for each supplied corner.\nContext: {}\nCorner evidence: {}\nWhen coaching.hypotheses is supplied, compare those competing explanations against the actual versus modeled profile facts. Select the most plausible hypothesis ID. Rust will attach its supported explanation, experiment and validation. These are supported experimental possibilities, never measured driver controls or promised gains. Favor specific interventions over investigation when evidence supports them. Different corners can need different interventions. Return all supplied corners, best experiment first, as a JSON array. For coached corners return ONLY evidenceId and interpretationId. No invented facts, numerical claims or other prose. If no coaching hypotheses are supplied, return evidenceId,hypothesis,experiment,validation,relatedEvidenceIds instead, and write short qualitative hypotheses containing may, might or could, experiments and validation without numbers or unmeasured controls.\n<end_of_turn>\n<start_of_turn>model\n",
        section_context, serde_json::to_string(&candidates).map_err(native)?
    );
    let prompt_build_ms = prompt_start.elapsed().as_millis();
    let tokenize_start = Instant::now();
    let vocab = model.vocab();
    let tokens = vocab.tokenize(prompt.as_bytes(), true, true);
    let tokenization_ms = tokenize_start.elapsed().as_millis();
    if tokens.len() + MAX_TOKENS >= CONTEXT as usize {
        return Err(RuntimeError::Limit);
    }
    let infer = Instant::now();
    let mut batch = LlamaBatch::new(batch_size as usize, 1);
    for (chunk_index, chunk) in tokens.chunks(batch_size as usize).enumerate() {
        check(cancel, started)?;
        batch.clear();
        for (i, token) in chunk.iter().enumerate() {
            let position = chunk_index * batch_size as usize + i;
            batch
                .add(*token, position as i32, &[0], position + 1 == tokens.len())
                .map_err(native)?;
        }
        context.decode(&mut batch).map_err(native)?;
    }
    context.synchronize();
    let prefill_duration = infer.elapsed();
    let sampler_start = Instant::now();
    let mut sampler = LlamaSampler::chain_simple([
        LlamaSampler::grammar(&model, &grammar(evidence), "root").map_err(native)?,
        LlamaSampler::greedy(),
    ]);
    let sampler_init_ms = sampler_start.elapsed().as_millis();
    let generation_start = Instant::now();
    let mut validation_us = 0;
    let mut output = Vec::new();
    for generated in 0..MAX_TOKENS {
        check(cancel, started).map_err(|error| match error {
            RuntimeError::Limit => RuntimeError::RejectedOutput {
                output: String::from_utf8_lossy(&output).into_owned(),
                reason: "deadline",
            },
            other => other,
        })?;
        // sample already accepts the token in this pinned API; do not accept twice.
        let token = sampler.sample(&context, -1);
        if vocab.is_eog(token) {
            return Err(RuntimeError::RejectedOutput {
                output: String::from_utf8_lossy(&output).into_owned(),
                reason: "schema or qualitative boundary",
            });
        }
        output.extend(vocab.token_to_piece(token, false, None));
        if output.len() > MAX_OUTPUT {
            return Err(RuntimeError::Limit);
        }
        if let Ok(text) = std::str::from_utf8(&output) {
            let validation_start = Instant::now();
            let validated = usable_output(text, evidence);
            validation_us += validation_start.elapsed().as_micros();
            if let Ok(rows) = validated {
                return Ok((
                    rows,
                    InferenceMetrics {
                        integrity_ms: 0,
                        backend_init_ms: 0,
                        model_load_ms,
                        inference_ms: infer.elapsed().as_millis(),
                        generated_tokens: generated + 1,
                        prompt_tokens: tokens.len(),
                        output_bytes: output.len(),
                        context_init_ms,
                        prompt_build_ms,
                        tokenization_ms,
                        prefill_ms: prefill_duration.as_millis(),
                        generation_ms: generation_start.elapsed().as_millis(),
                        validation_us,
                        sampler_init_ms,
                        prefill_tokens_per_second: tokens.len() as f64
                            / prefill_duration.as_secs_f64(),
                        generation_tokens_per_second: (generated + 1) as f64
                            / generation_start.elapsed().as_secs_f64(),
                        threads,
                        batch_size,
                        context_size: CONTEXT,
                        gpu,
                        gpu_requested: gpu,
                        gpu_fallback_ms: 0,
                        requested_gpu_layers: if gpu { 99 } else { 0 },
                        backend_devices: vec![],
                    },
                ));
            }
        }
        batch.clear();
        batch
            .add(token, (tokens.len() + generated) as i32, &[0], true)
            .map_err(native)?;
        context.decode(&mut batch).map_err(native)?;
    }
    Err(RuntimeError::RejectedOutput {
        output: String::from_utf8_lossy(&output).into_owned(),
        reason: "token budget",
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn evidence() -> Vec<RuntimeEvidence> {
        vec![RuntimeEvidence {
            evidence_id: "lap_a:exit".into(),
            summary: "Exit speed lower than reference".into(),
        }]
    }
    #[test]
    fn production_requires_selected_evidence_and_exact_supported_claims() {
        let mut inputs = evidence();
        let choice = serde_json::json!({"id":"exit-recovery", "hypothesis":"The exit arc may delay recovery.","experiment":"Try opening the exit arc earlier.","validation":"Compare corner and following time."});
        inputs[0].summary = serde_json::json!({"coaching":{"hypotheses":[choice]}}).to_string();
        let mut row = serde_json::json!({"evidenceId":"lap_a:exit","interpretationId":"exit-recovery","hypothesis":choice["hypothesis"],"experiment":choice["experiment"],"validation":choice["validation"],"relatedEvidenceIds":[]});
        assert!(validate_output(&serde_json::to_string(&vec![&row]).unwrap(), &inputs).is_ok());
        for (field, unsupported) in [
            ("experiment", "Try delaying recovery further."),
            ("hypothesis", "You braked too early and may lose speed."),
            ("interpretationId", "invented"),
        ] {
            let mut invalid = row.clone();
            invalid[field] = unsupported.into();
            assert!(
                validate_output(&serde_json::to_string(&vec![invalid]).unwrap(), &inputs).is_err()
            );
        }
        row.as_object_mut().unwrap().remove("interpretationId");
        assert!(validate_output(&serde_json::to_string(&vec![row]).unwrap(), &inputs).is_err());
        let grammar = grammar(&inputs);
        assert!(grammar.contains("interpretationId"));
        assert!(grammar.contains("exit-recovery"));
        let selected = usable_output(
            r#"[{"evidenceId":"lap_a:exit","interpretationId":"exit-recovery"}]"#,
            &inputs,
        )
        .unwrap();
        assert_eq!(selected[0].experiment, "Try opening the exit arc earlier.");
        assert!(usable_output(
            r#"[{"evidenceId":"lap_a:exit","interpretationId":"invented"}]"#,
            &inputs
        )
        .is_err());
        for malformed in [
            r#"[{"evidenceId":"unknown","interpretationId":"exit-recovery"}]"#,
            r#"[{"evidenceId":"lap_a:exit","interpretationId":"exit-recovery","fabricatedFact":"engine fault"}]"#,
            r#"[{"evidenceId":"lap_a:exit","interpretationId":"exit-recovery"},{"evidenceId":"lap_a:exit","interpretationId":"exit-recovery"}]"#,
        ] {
            assert!(
                usable_output(malformed, &inputs).is_err(),
                "accepted {malformed}"
            );
        }
    }

    #[test]
    fn short_wire_ids_restore_exact_source_grounding() {
        let option = serde_json::json!({"id":"exit","hypothesis":"The exit arc may delay recovery.","experiment":"Try opening the exit arc earlier.","validation":"Compare corner and following time."});
        let source = (0..3).map(|index| RuntimeEvidence {
            evidence_id: format!("source-qualified-corner-{index}"),
            summary: serde_json::json!({"coaching":{"hypotheses":[option.clone()]},"actualSpeed":23.5}).to_string(),
        }).collect::<Vec<_>>();
        let wire = wire_evidence(&source);
        for (index, item) in wire.iter().enumerate() {
            assert_eq!(item.evidence_id, format!("c{index}"));
            assert_eq!(item.summary, source[index].summary);
        }
        let output = r#"[{"evidenceId":"c0","interpretationId":"exit"},{"evidenceId":"c1","interpretationId":"exit"},{"evidenceId":"c2","interpretationId":"exit"}]"#;
        let rows = usable_output(output, &wire).unwrap();
        let restored = restore_source_ids(rows.clone(), &wire, &source).unwrap();
        assert_eq!(
            restored
                .iter()
                .map(|row| &row.evidence_id)
                .collect::<Vec<_>>(),
            source
                .iter()
                .map(|item| &item.evidence_id)
                .collect::<Vec<_>>()
        );
        assert!(restore_source_ids(rows[..2].to_vec(), &wire, &source).is_err());
        let mut bad = rows.clone();
        bad[0].evidence_id = "unknown".into();
        assert!(restore_source_ids(bad, &wire, &source).is_err());
        let mut bad = rows.clone();
        bad[1].evidence_id = bad[0].evidence_id.clone();
        assert!(restore_source_ids(bad, &wire, &source).is_err());
        let mut bad = rows;
        bad[0].hypothesis = "You braked too early and may lose speed.".into();
        assert!(restore_source_ids(bad, &wire, &source).is_err());
        let legacy = evidence();
        assert_eq!(wire_evidence(&legacy)[0].evidence_id, legacy[0].evidence_id);
        assert_eq!(wire_evidence(&legacy)[0].summary, legacy[0].summary);
        assert!(usable_output("[]", &legacy).unwrap().is_empty());
    }

    #[test]
    fn production_reasoning_authors_prose_even_with_legacy_choices() {
        let mut inputs = evidence();
        inputs[0].summary = serde_json::json!({"interpretations":[
            {"choiceId":"line","hypothesis":"The line may vary.","experiment":"Try a repeatable line.","validation":"Compare full section time."}
        ]}).to_string();
        let output = r#"[{"evidenceId":"lap_a:exit","hypothesis":"Approach speed may compromise downstream recovery, though conditions could contribute.","experiment":"Try a calmer entry while preserving the exit arc.","validation":"Compare combined corner and downstream time with repeatable entry speed.","relatedEvidenceIds":[]}]"#;
        assert_eq!(
            usable_output(output, &inputs).unwrap()[0].interpretation_id,
            None
        );
        assert!(usable_output(
            r#"[{"evidenceId":"lap_a:exit","choiceId":"line"}]"#,
            &inputs
        )
        .is_err());
        assert!(grammar(&inputs).contains("hypothesis"));
        assert!(!grammar(&inputs).contains("choiceId"));
    }

    #[test]
    fn accepts_grounded_qualitative_reasoning_and_rejects_numeric_claims() {
        let e = evidence();
        let good = r#"[{"evidenceId":"lap_a:exit","hypothesis":"A tight exit line may interrupt momentum.","experiment":"Try opening the exit while keeping entry repeatable.","validation":"Compare section time and exit speed on repeated laps.","relatedEvidenceIds":[]}]"#;
        assert!(validate_output(good, &e).is_ok());
        for bad in [
            "Gain 0.2 seconds.",
            "Gain two tenths.",
            "Gain half a second.",
            "Save twenty milliseconds.",
            "Gain a fifth on exit.",
            "Gain a sixth on exit.",
            "Gain a seventh on exit.",
            "Gain extra mph on exit.",
            "Gain extra kph on exit.",
            "Guaranteed faster.",
            "This will save time through the corner.",
            "This ensures a faster lap.",
            "Brake pressure may be excessive at entry.",
            "Throttle position may interrupt exit momentum.",
            "Compare throttle usage across the supporting laps.",
            "Monitor RPM and throttle response during the entry phase.",
            "Compare braking inputs across repeated laps.",
        ] {
            assert!(!qualitative(bad), "numeric boundary accepted {bad}");
            let bad = good.replace("Try opening the exit while keeping entry repeatable.", bad);
            assert!(validate_output(&bad, &e).is_err(), "accepted {bad}");
        }
        for bad in [
            good.replace("lap_a:exit", "invented"),
            good.replace("[]", "[\"invented\"]"),
            good.replace("hypothesis", "fact"),
        ] {
            assert!(validate_output(&bad, &e).is_err());
        }
    }

    #[test]
    fn rejects_inferred_controls_presented_as_observed_behavior() {
        let e = evidence();
        for assertion in [
            "The trace shows late braking and may explain the exit.",
            "You lifted the throttle and may lose exit momentum.",
            "You are braking too early and may compromise the exit.",
            "The data confirms a missed shift that may hurt recovery.",
        ] {
            let output = serde_json::json!([{
                "evidenceId":"lap_a:exit", "hypothesis":assertion,
                "experiment":"Try opening the exit while preserving entry consistency.",
                "validation":"Compare corner and downstream section time.", "relatedEvidenceIds":[]
            }])
            .to_string();
            assert!(
                validate_output(&output, &e).is_err(),
                "accepted {assertion}"
            );
        }
        assert!(qualitative(
            "Try releasing the brake more progressively while keeping the entry repeatable."
        ));
        assert!(qualitative(
            "Braking timing may differ, or the exit line may restrict recovery."
        ));
    }

    #[test]
    fn qualitative_guard_preserves_nonquantified_engineering_words() {
        assert!(qualitative(
            "Compare line widths and the lengths of recovery paths."
        ));
        for text in [
            "Gain a fifth on exit.",
            "Gain a sixth on exit.",
            "Gain a seventh on exit.",
            "Gain extra mph on exit.",
            "Gain extra kph on exit.",
            "Gain extra twentieths on exit.",
        ] {
            assert!(!qualitative(text), "accepted {text}");
        }
    }
    #[test]
    fn rejects_unqualified_causal_prose() {
        let output = r#"[{"evidenceId":"lap_a:exit","hypothesis":"Lower RPM recovery improves lap time.","experiment":"Try preserving momentum through the exit.","validation":"Compare section time and exit speed.","relatedEvidenceIds":[]}]"#;
        assert!(validate_output(output, &evidence()).is_err());
    }
    #[test]
    fn independent_valid_rows_survive_a_rejected_sibling() {
        let good = serde_json::json!({"evidenceId":"lap_a:exit","hypothesis":"The exit arc may interrupt momentum.","experiment":"Try opening the exit while preserving entry consistency.","validation":"Compare corner and downstream section time.","relatedEvidenceIds":[]});
        let mut bad = good.clone();
        bad["hypothesis"] = "Brake pressure may cost two seconds.".into();
        let output = serde_json::to_string(&vec![bad, good]).unwrap();
        assert!(validate_output(&output, &evidence()).is_err());
        assert_eq!(usable_output(&output, &evidence()).unwrap().len(), 1);
        assert!(usable_output("[{", &evidence()).is_err());
    }

    #[test]
    fn model_can_abstain_instead_of_inventing_findings() {
        assert!(validate_output("[]", &evidence()).unwrap().is_empty());
        assert!(usable_output("[]", &evidence()).unwrap().is_empty());
    }

    #[test]
    fn cancellation_precedes_loading() {
        assert!(matches!(
            generate(
                Path::new("missing"),
                &evidence(),
                &AtomicBool::new(true),
                true
            ),
            Err(RuntimeError::Cancelled)
        ));
    }
    #[test]
    fn rejects_prompt_injection_ids_and_unbounded_input() {
        let mut e = evidence();
        e[0].evidence_id = "\"evil".into();
        assert!(validate_input(&e).is_err());
        e = evidence();
        e[0].summary = "a".repeat(MAX_EVIDENCE_SUMMARY + 1);
        assert!(validate_input(&e).is_err());
    }
    #[test]
    fn accepts_real_event_timestamp_ids() {
        let mut e = evidence();
        e[0].evidence_id = "lap-7:bog-12.450".into();
        assert!(validate_input(&e).is_ok());
    }
    #[test]
    fn rejects_duplicate_rows_and_relations() {
        let row = r#"{"evidenceId":"lap_a:exit","hypothesis":"The exit line may restrict momentum.","experiment":"Try opening the line earlier.","validation":"Compare exit speed and section time.","relatedEvidenceIds":[]}"#;
        assert!(validate_output(&format!("[{row},{row}]"), &evidence()).is_err());
        assert!(validate_output(
            &format!("[{row}]").replace("[]", "[\"lap_a:exit\"]"),
            &evidence()
        )
        .is_err());
    }
}
