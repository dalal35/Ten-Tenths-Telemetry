// The verifier substitutes these two paths when preparing its isolated crate.
#[path = "__TELEMETRY_PATH__"] mod telemetry;
#[path = "__MERGING_PATH__"] mod merging;
use std::io::{self, Read};

fn main() -> Result<(), String> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).map_err(|e| e.to_string())?;
    let q: serde_json::Value = serde_json::from_str(&input).map_err(|e| e.to_string())?;
    let mut session = telemetry::parse_session(std::path::Path::new(q["path"].as_str().ok_or("missing path")?))?;
    let formulas: Vec<telemetry::expressions::Formula> = serde_json::from_value(q["formulas"].as_array().cloned().unwrap_or_default().into()).map_err(|e| e.to_string())?;
    let derived = telemetry::expressions::evaluate(&session, &formulas)?;
    let value = match q["mode"].as_str().unwrap_or("") {
        "session" => serde_json::to_value(session),
        "validate" => serde_json::to_value(derived.iter().map(|c| serde_json::json!({"id":c.id,"name":c.name,"unit":c.unit})).collect::<Vec<_>>()),
        "analysis" | "advanced" => {
            session.channels.extend(derived);
            let primary=q["primary"].as_str().ok_or("missing primary")?;
            let comparison=q["comparison"].as_str();
            let axis=q["axis"].as_str().ok_or("missing axis")?;
            if q["mode"]=="analysis" {
                let channels: Vec<String>=serde_json::from_value(q["channels"].clone()).map_err(|e| e.to_string())?;
                serde_json::to_value(telemetry::analyze(&session,primary,comparison,axis,&channels)?)
            } else {
                let mut request:telemetry::advanced::AdvancedRequest=serde_json::from_value(q["request"].clone()).map_err(|e|e.to_string())?;
                request.axis=axis.into();
                let analysis=telemetry::analyze(&session,primary,comparison,axis,&[])?;
                serde_json::to_value(telemetry::advanced::analyze(&session,&analysis,&request)?)
            }
        },
        _ => return Err("unknown mode".into()),
    }.map_err(|e| e.to_string())?;
    println!("{}", value);
    Ok(())
}
