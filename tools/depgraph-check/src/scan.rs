use std::collections::HashMap;
use std::path::PathBuf;

use syn::visit::Visit;
use syn::{Attribute, ExprPath, Item, ItemMod, Path as SynPath, UseTree};

use crate::policy::Policy;

#[derive(Debug, Clone)]
pub struct ImportEdge {
    pub from_file: PathBuf,
    pub from_rel: String,
    pub from_layer: String,
    pub to_crate_segments: Vec<String>,
    pub line: usize,
    pub in_test_context: bool,
}

pub fn scan_crate(policy: &Policy) -> Result<Vec<ImportEdge>, String> {
    let src_root = policy.crate_root.join("src");
    // policy.crate_root is the backend package dir (e.g. backend/)
    if !src_root.is_dir() {
        return Err(format!(
            "crate src root not found: {}",
            src_root.display()
        ));
    }

    let mut edges = Vec::new();
    for entry in walkdir::WalkDir::new(&src_root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "rs"))
    {
        let path = entry.path();
        let rel = path
            .strip_prefix(&src_root)
            .map_err(|_| "strip_prefix")?
            .to_string_lossy()
            .replace('\\', "/");

        let from_layer = match policy.layer_for_file(&rel) {
            Some(l) => l,
            None => continue,
        };

        let source = std::fs::read_to_string(path)
            .map_err(|e| format!("read {}: {e}", path.display()))?;
        let syntax = syn::parse_file(&source)
            .map_err(|e| format!("parse {}: {e}", path.display()))?;

        let file_test_only = policy.is_test_only_file(&rel);
        let mut visitor = ImportVisitor {
            from_file: path.to_path_buf(),
            from_rel: rel,
            from_layer,
            file_test_only,
            test_depth: 0,
            edges: Vec::new(),
        };
        visitor.visit_file(&syntax);
        edges.append(&mut visitor.edges);
    }

    Ok(edges)
}

struct ImportVisitor {
    from_file: PathBuf,
    from_rel: String,
    from_layer: String,
    file_test_only: bool,
    test_depth: u32,
    edges: Vec<ImportEdge>,
}

impl ImportVisitor {
    fn in_test(&self) -> bool {
        self.file_test_only || self.test_depth > 0
    }

    fn is_cfg_test(attrs: &[Attribute]) -> bool {
        attrs.iter().any(|attr| {
            attr.meta.path().is_ident("cfg")
                && attr
                    .meta
                    .require_list()
                    .ok()
                    .and_then(|list| list.tokens.to_string().contains("test").then_some(()))
                    .is_some()
        })
    }

    fn push_edge(&mut self, segments: Vec<String>, line: usize) {
        if segments.is_empty() || segments[0] != "crate" {
            return;
        }
        let crate_segments: Vec<String> = segments.into_iter().skip(1).collect();
        if crate_segments.is_empty() {
            return;
        }
        self.edges.push(ImportEdge {
            from_file: self.from_file.clone(),
            from_rel: self.from_rel.clone(),
            from_layer: self.from_layer.clone(),
            to_crate_segments: crate_segments,
            line,
            in_test_context: self.in_test(),
        });
    }

    fn visit_use_tree(&mut self, tree: &UseTree, line: usize) {
        let mut segments = Vec::new();
        collect_use_segments(tree, &mut segments);
        if segments.first().is_some_and(|s| s == "crate") {
            self.push_edge(segments, line);
        }
    }
}

fn collect_use_segments(tree: &UseTree, segments: &mut Vec<String>) {
    match tree {
        UseTree::Path(path) => {
            segments.push(path.ident.to_string());
            collect_use_segments(&path.tree, segments);
        }
        UseTree::Name(name) => segments.push(name.ident.to_string()),
        UseTree::Rename(rename) => segments.push(rename.ident.to_string()),
        UseTree::Glob(_) => {}
        UseTree::Group(group) => {
            for item in &group.items {
                collect_use_segments(item, segments);
            }
        }
    }
}

impl Visit<'_> for ImportVisitor {
    fn visit_item_mod(&mut self, node: &ItemMod) {
        let is_test_mod = node.ident == "tests" || Self::is_cfg_test(&node.attrs);
        if is_test_mod {
            self.test_depth += 1;
            syn::visit::visit_item_mod(self, node);
            self.test_depth -= 1;
        } else {
            syn::visit::visit_item_mod(self, node);
        }
    }

    fn visit_item(&mut self, node: &Item) {
        if let Item::Use(item_use) = node {
            let line = item_use.use_token.span.start().line;
            self.visit_use_tree(&item_use.tree, line);
        }
        syn::visit::visit_item(self, node);
    }

    fn visit_expr_path(&mut self, node: &ExprPath) {
        if node.path.segments.first().is_some_and(|s| s.ident == "crate") {
            let segments: Vec<String> = path_to_strings(&node.path);
            self.push_edge(
                segments,
                node.path
                    .segments
                    .first()
                    .map(|s| s.ident.span().start().line)
                    .unwrap_or(1),
            );
        }
        syn::visit::visit_expr_path(self, node);
    }
}

fn path_to_strings(path: &SynPath) -> Vec<String> {
    path.segments
        .iter()
        .map(|s| s.ident.to_string())
        .collect()
}

pub fn layer_edges(
    policy: &Policy,
    imports: &[ImportEdge],
) -> Vec<(ImportEdge, String)> {
    let mut out = Vec::new();
    for imp in imports {
        if imp.in_test_context {
            continue;
        }
        let segs: Vec<&str> = imp.to_crate_segments.iter().map(String::as_str).collect();
        if let Some(to_layer) = policy.layer_for_crate_path(&segs) {
            if to_layer != imp.from_layer {
                out.push((imp.clone(), to_layer));
            }
        }
    }
    out
}

pub fn dedupe_violations(
    violations: Vec<Violation>,
) -> Vec<Violation> {
    let mut seen = HashMap::new();
    for v in violations {
        let key = (
            v.from_layer.clone(),
            v.to_layer.clone(),
            v.file_rel.clone(),
            v.line,
        );
        seen.entry(key).or_insert(v);
    }
    seen.into_values().collect()
}

#[derive(Debug, Clone)]
pub struct Violation {
    pub from_layer: String,
    pub to_layer: String,
    pub file_rel: String,
    pub file_abs: PathBuf,
    pub line: usize,
    pub rule: String,
    pub fix: String,
    pub exception_reason: Option<String>, // reserved for warn-only mode
}
