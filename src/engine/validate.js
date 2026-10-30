// Deterministic engineering checks. The UI shows "Validated" only when every check here passes.
// These are geometry checks, not engineering approval: see docs/DEVELOPMENT_CONTRACT.md.

import { isValidSolid } from "./regenerate.js";

const REL_TOL = 1e-6;
const ABS_TOL = 1e-3; // mm, mm³

export async function planHash(plan) {
  const text = JSON.stringify(plan);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function close(a, b) {
  return Math.abs(a - b) <= Math.max(ABS_TOL, REL_TOL * Math.max(Math.abs(a), Math.abs(b)));
}

/**
 * @returns {Promise<{status: "validated"|"failed", checks: Array<{id,label,status:"pass"|"fail"|"warn",detail}>, planHash, at, kernel}>}
 */
export async function validateBodies(r, oc, plan, bodies, regenFeatures = {}) {
  const checks = [];
  const push = (id, label, ok, detail, warnOnly = false) => checks.push({ id, label, status: ok ? "pass" : warnOnly ? "warn" : "fail", detail });

  const featureErrors = Object.entries(regenFeatures).filter(([, s]) => s.state === "error");
  push("features", "All features regenerate", featureErrors.length === 0, featureErrors.length ? featureErrors.map(([id, s]) => `${id}: ${s.message}`).join("; ") : `${Object.keys(regenFeatures).length || "all"} features evaluated`);

  const live = bodies.filter((b) => plan.bodies.find((x) => x.id === b.id)?.visible !== false);
  for (const b of live) {
    if (!b.shape) {
      push(`solid-${b.id}`, `${b.name}: has a solid`, false, "no geometry was produced");
      continue;
    }
    const valid = isValidSolid(oc, b.shape);
    push(`brep-${b.id}`, `${b.name}: valid B-Rep`, valid, valid ? "topology and geometry checks pass" : "BRepCheck reports an invalid shape");
    const solids = b.shape.solids.length;
    push(`single-${b.id}`, `${b.name}: one closed solid`, solids === 1, `${solids} solid${solids === 1 ? "" : "s"}`, true);
    const vol = r.measureVolume(b.shape);
    push(`volume-${b.id}`, `${b.name}: positive volume`, vol > ABS_TOL, `${vol.toFixed(1)} mm³`);

    // STEP round trip: export, re-import, compare volume and bounding box.
    try {
      const blob = b.shape.blobSTEP();
      const back = await r.importSTEP(new Blob([await blob.arrayBuffer()]));
      const v2 = r.measureVolume(back);
      const [a0, a1] = b.shape.boundingBox.bounds;
      const [b0, b1] = back.boundingBox.bounds;
      const bbOk = [...a0, ...a1].every((x, i) => Math.abs(x - [...b0, ...b1][i]) <= 1e-3);
      push(`step-roundtrip-${b.id}`, `${b.name}: STEP round trip`, close(vol, v2) && bbOk, `volume ${vol.toFixed(3)} → ${v2.toFixed(3)} mm³, bounding box ${bbOk ? "matches" : "differs"} (${(blob.size / 1024).toFixed(0)} KB)`);
      back.delete?.();
    } catch (e) {
      push(`step-roundtrip-${b.id}`, `${b.name}: STEP round trip`, false, `export or re-import failed: ${e?.message || "kernel error"}`);
    }
  }

  // Interference between every pair of bodies.
  const clashes = [];
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i].shape;
      const c = live[j].shape;
      if (!a || !c) continue;
      try {
        const common = a.intersect(c);
        const v = r.measureVolume(common);
        common.delete?.();
        if (v > ABS_TOL) clashes.push(`${live[i].name} ∩ ${live[j].name}: ${v.toFixed(2)} mm³`);
      } catch {
        clashes.push(`${live[i].name} ∩ ${live[j].name}: could not be computed`);
      }
    }
  if (live.length > 1) push("interference", "No interference between bodies", clashes.length === 0, clashes.length ? clashes.join("; ") : `${(live.length * (live.length - 1)) / 2} pair(s) checked`);

  return {
    status: checks.some((c) => c.status === "fail") ? "failed" : "validated",
    checks,
    planHash: await planHash(plan),
    at: new Date().toISOString(),
    kernel: "Open CASCADE 7.x via replicad (same kernel that built the model)",
  };
}
