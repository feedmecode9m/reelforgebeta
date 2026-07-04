mod policy;
mod scan;

use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

use policy::{LayerEdge, Policy};
use scan::{dedupe_violations, layer_edges, Violation};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(msg) => {
            eprintln!("{msg}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let policy_path = resolve_policy_path()?;
    let policy = Policy::load(&policy_path)?;
    let imports = scan::scan_crate(&policy)?;

    let layer_pairs = layer_edges(&policy, &imports);
    let mut violations = Vec::new();

    for (imp, to_layer) in layer_pairs {
        let edge = LayerEdge {
            from: imp.from_layer.clone(),
            to: to_layer.clone(),
        };

        if policy.allowed.contains(&edge) {
            continue;
        }

        if !policy.forbidden.contains(&edge) {
            continue;
        }

        if policy
            .is_exception(&edge.from, &edge.to, &imp.from_rel)
            .is_some()
        {
            continue;
        }

        let rule = policy.rule_description(&edge);
        let fix = policy.fix_hint(&edge);
        violations.push(Violation {
            from_layer: edge.from,
            to_layer: edge.to,
            file_rel: imp.from_rel.clone(),
            file_abs: imp.from_file.clone(),
            line: imp.line,
            rule,
            fix,
            exception_reason: None,
        });
    }

    let violations = dedupe_violations(violations);

    print_summary(&policy, &imports, &violations);

    if violations.is_empty() {
        println!("\n✅ DEPGRAPH CHECK PASSED");
        println!("Policy: {}", policy_path.display());
        println!("Policy version: {}", policy.version);
        return Ok(());
    }

    println!("\n❌ ARCHITECTURE VIOLATION DETECTED\n");
    for (i, v) in violations.iter().enumerate() {
        if i > 0 {
            println!();
        }
        print_violation(v);
    }
    println!(
        "\n{} violation(s). See docs/DEPENDENCY_GRAPH_ENFORCEMENT_MODEL.md",
        violations.len()
    );
    Err(format!("depgraph-check failed with {} violation(s)", violations.len()))
}

fn resolve_policy_path() -> Result<PathBuf, String> {
    if let Ok(p) = env::var("DEPGRAPH_POLICY_PATH") {
        return Ok(PathBuf::from(p));
    }

    let mut dir = env::current_dir().map_err(|e| e.to_string())?;
    for _ in 0..8 {
        let candidate = dir.join("architecture/dependency_policy.toml");
        if candidate.is_file() {
            return Ok(candidate);
        }
        if !dir.pop() {
            break;
        }
    }

    Err(
        "dependency_policy.toml not found; set DEPGRAPH_POLICY_PATH or run from repo root"
            .into(),
    )
}

fn print_summary(policy: &Policy, imports: &[scan::ImportEdge], _violations: &[Violation]) {
    let mut layer_counts: std::collections::BTreeMap<String, usize> =
        std::collections::BTreeMap::new();
    for imp in imports {
        if !imp.in_test_context {
            *layer_counts.entry(imp.from_layer.clone()).or_default() += 1;
        }
    }

    println!("ReelForge Dependency Graph Enforcement (DGEL)");
    println!("Crate root: {}", policy.crate_root.display());
    println!("Production import sites scanned: {}", imports.iter().filter(|i| !i.in_test_context).count());
    println!("Layers with activity: {}", layer_counts.len());
}

fn print_violation(v: &Violation) {
    println!("Violation: {} → {}", v.from_layer, v.to_layer);
    println!("File: backend/src/{}:{}", v.file_rel, v.line);
    println!();
    println!("Rule: {}", v.rule);
    println!();
    println!("Fix:");
    for line in v.fix.split('\n') {
        println!("- {line}");
    }
}
