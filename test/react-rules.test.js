// Static checks for React patterns that have broken the app in the field.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) ? [join(dir, e.name)] : []));

test("effects never return the value of an expression (must use a block body)", () => {
  // useEffect(() => something(...)) returns whatever something() returns. If that is not a
  // function, React later calls it as a cleanup: "x is not a function". Chrome 152 made
  // Element.scrollTo() return a Promise, which crashed the SI assistant this way.
  const offenders = [];
  for (const f of files("src")) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/use(Layout|Insertion)?Effect\(\s*(async\s*)?\(\s*\)\s*=>\s*[^{\s]/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
});
