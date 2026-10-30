// Explain which features may need regeneration after a parameter change.
// Conservative static dependency analysis: it never claims engineering validation.
const words = (s) => String(s).match(/[A-Za-z_][A-Za-z_0-9]*/g) ?? [];
const readParams = (obj, names, out = new Set()) => {
  if (typeof obj === "string") for (const w of words(obj)) if (names.has(w)) out.add(w);
  else if (Array.isArray(obj)) for (const item of obj) readParams(item, names, out);
  else if (obj && typeof obj === "object") for (const [key, val] of Object.entries(obj))
    if (!["id", "name", "material", "color", "text", "font"].includes(key)) readParams(val, names, out);
  return out;
};
export function changeImpact(before, after) {
  if (!before || !after) throw new Error("Two plans required");
  const old = new Map(before.parameters.map(p => [p.name, p]));
  const now = new Map(after.parameters.map(p => [p.name, p]));
  const changed = [...new Set([...old.keys(), ...now.keys()])].filter(n => JSON.stringify(old.get(n)) !== JSON.stringify(now.get(n)));
  const names = new Set(changed);
  // Follow parameter expressions (e.g., length changes and half_length = length/2).
  let added = true;
  while (added) {
    added = false;
    for (const p of after.parameters) {
      if (!names.has(p.name) && readParams(p.expr, names).size) { names.add(p.name); added = true; }
    }
  }
  const affected = [];
  const oldBodies = new Map(before.bodies.map(b => [b.id, b]));
  for (const body of after.bodies) {
    const original = oldBodies.get(body.id);
    const hasStructuralChange = !original || JSON.stringify(original.placement) !== JSON.stringify(body.placement);
    let upstream = hasStructuralChange;
    for (let i = 0; i < body.features.length; i++) {
      const feature = body.features[i];
      const prior = original?.features.find(f => f.id === feature.id);
      const direct = !prior || JSON.stringify(prior) !== JSON.stringify(feature) || readParams(feature, names).size > 0;
      if (direct) upstream = true;
      if (upstream) affected.push({body: body.name, bodyId: body.id, feature: feature.name || feature.op, featureId: feature.id, direct});
    }
  }
  const removedBodies = before.bodies.filter(b => !after.bodies.some(n => n.id === b.id)).map(b => b.name);
  return {changedParameters: changed, derivedParameters: [...names].filter(n => !changed.includes(n)), affected, removedBodies, requiresValidation: changed.length > 0 || affected.length > 0 || removedBodies.length > 0};
}
