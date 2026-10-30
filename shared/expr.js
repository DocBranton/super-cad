// Tiny arithmetic evaluator for parameter expressions. Recursive descent over
// numbers, parameter names, + - * / and parentheses. No eval, no functions, no properties.

const TOKEN = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(.))/gy;

function tokenize(src) {
  const out = [];
  TOKEN.lastIndex = 0;
  let m;
  while (TOKEN.lastIndex < src.length && (m = TOKEN.exec(src))) {
    if (m[1] !== undefined) out.push({ t: "num", v: parseFloat(m[1]) });
    else if (m[2] !== undefined) out.push({ t: "id", v: m[2] });
    else if (m[3] !== undefined) {
      if (!"+-*/()".includes(m[3])) throw new Error(`unexpected "${m[3]}"`);
      out.push({ t: m[3] });
    }
  }
  return out;
}

/** Evaluate `src` with `lookup(name) -> number`. */
export function evaluate(src, lookup) {
  if (typeof src === "number") return src;
  const toks = tokenize(String(src));
  let i = 0;
  const peek = () => toks[i]?.t;
  function primary() {
    const tok = toks[i++];
    if (!tok) throw new Error("expression ends early");
    if (tok.t === "num") return tok.v;
    if (tok.t === "id") return lookup(tok.v);
    if (tok.t === "-") return -primary();
    if (tok.t === "+") return primary();
    if (tok.t === "(") {
      const v = sum();
      if (toks[i++]?.t !== ")") throw new Error("missing )");
      return v;
    }
    throw new Error(`unexpected "${tok.t}"`);
  }
  function product() {
    let v = primary();
    while (peek() === "*" || peek() === "/") {
      const op = toks[i++].t;
      const r = primary();
      if (op === "/" && r === 0) throw new Error("division by zero");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function sum() {
    let v = product();
    while (peek() === "+" || peek() === "-") {
      const op = toks[i++].t;
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const v = sum();
  if (i !== toks.length) throw new Error(`unexpected "${toks[i].t === "id" || toks[i].t === "num" ? toks[i].v : toks[i].t}"`);
  if (!Number.isFinite(v)) throw new Error("result is not a finite number");
  return v;
}

/** Names referenced by an expression (for dependency display). */
export function references(src) {
  if (typeof src === "number") return [];
  try {
    return tokenize(String(src)).filter((t) => t.t === "id").map((t) => t.v);
  } catch {
    return [];
  }
}

/**
 * Resolve every parameter to a number. Returns { values, errors } where errors maps a
 * parameter name to a message (unknown name, cycle, bad syntax).
 */
export function resolveParameters(parameters) {
  const byName = new Map(parameters.map((p) => [p.name, p]));
  const values = {};
  const errors = {};
  const visiting = new Set();
  function get(name) {
    if (name in values) return values[name];
    const p = byName.get(name);
    if (!p) throw new Error(`unknown parameter "${name}"`);
    if (p.unit === "text") throw new Error(`parameter "${name}" is text, not a number`);
    if (visiting.has(name)) throw new Error(`circular reference through "${name}"`);
    visiting.add(name);
    try {
      return (values[name] = evaluate(p.expr, get));
    } finally {
      visiting.delete(name);
    }
  }
  for (const p of parameters) {
    if (p.unit === "text") continue;
    try {
      get(p.name);
    } catch (e) {
      errors[p.name] = e.message;
    }
  }
  return { values, errors };
}
