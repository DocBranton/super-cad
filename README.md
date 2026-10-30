# Super CAD

**Browser-native parametric CAD with SI-assisted modeling — built for a restricted Databricks App environment.**

> **Status:** working foundation derived from [DocBranton/si-cad-workbench](https://github.com/DocBranton/si-cad-workbench), plus the first Super CAD-specific feature. This is an engineering prototype, **not** an authorized or flight-certified tool. A successful deployment, approved endpoint connection, and independent neutral-CAD interoperability test have **not** been verified.

## Why this starting point

Rather than ship a mocked 3D viewer, Super CAD begins with an actual browser-local Open CASCADE B-Rep modeling kernel, a deterministic parameter/feature plan, and a Databricks-backed application server. The source CAD Workbench implementation is reused with attribution; it is not presented as a clean-room rewrite. Source licenses remain applicable.

**New in Super CAD:** change-impact tracing in the SI assistant. After an edit, expand **CHANGE IMPACT** to see which named parameters changed, which derived parameters reference them, and which features may require regeneration downstream. The report is conservative, advisory, and never constitutes engineering verification. Unit tests: `test/change-impact.test.js`.

## Current capabilities

- Parametric solids: extrude, hole, fillet, chamfer, shell, circular patterns, twisted extrusions.
- Named expressions, feature timeline, undo/redo, mesh visualization.
- SI plan proposals through an approved Databricks Model Serving endpoint or a restricted offline template planner; user must approve generated changes.
- Browser-side STEP and STL **export** and native JSON feature-plan save/reopen.
- Geometry validity and same-kernel STEP export→reimport checks.
- Project revision API backed by an authorized Unity Catalog Volume or local development storage.
- Desktop CAD workspace; service theme variants.

### Not yet delivered
- General-purpose STEP/IGES **import** into the editor (separate priority milestone).
- Constraint-based sketch editor, robust persistent topology naming, direct edits to imported solids, or independent server-side geometry validation.
- Full verified WDP AppKit integration, two-identity security tests, production-ready cyber authorization, or completed DoW pilot.

## Run

```bash
npm ci
npm test
npm run build
npm start
```

Open http://localhost:8000. With no Databricks endpoint, the server uses the offline template planner. No external CDN is contacted at runtime; dependency acquisition during build must use an approved mirror in restricted environments.

## Databricks Apps

Review `databricks.yml` and replace the example serving endpoint and `main.engineering.super_cad` Unity Catalog Volume with **real, approved resources**. The bundle uses the separate app name `super-cad`, never `cad-workbench`.

```bash
databricks bundle deploy -t dev
databricks bundle run super_cad -t dev
```

The bundle currently **expects** resource bindings for model serving and a UC Volume. Configure those permissions before deployment; do not assume that offline mode skips missing resource bindings. Validate AppKit compatibility and approved dependency access separately.

## Quality gates

`npm test` exercises the baseline kernel and planner plus change-impact tests. `npm run build` type-checks the UI and bundles the WASM client. Successful local checks do not prove Databricks deployment or engineering accuracy.

## Competitive development priorities

1. Open STEP solids and preserve their imported B-Rep as an editable base feature.
2. Build a constraint-based 2D sketcher and stable downstream feature references.
3. Introduce SI preview/apply/rollback for scoped, reversible edits.
4. Independent STEP interoperability verification and server-authoritative validation.
5. Identity hardening, audit evidence, WDP GitLab pipeline, AppKit adapters, and accessibility.

**Security:** No arbitrary SI-written source code executes. Validate every plan at the trust boundary, scan uploads, enforce identity/authorization, and keep classified or controlled data out of public commercial environments.
