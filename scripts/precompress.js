// Pre-compress built assets (Brotli + gzip) so the 23 MB Open CASCADE kernel ships as ~6–7 MB
// without the 2-vCPU app compressing it on every request.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const dir = new URL("../dist/assets/", import.meta.url).pathname;
for (const name of readdirSync(dir)) {
  if (!/\.(js|css|wasm|svg|json)$/.test(name)) continue;
  const file = join(dir, name);
  const raw = readFileSync(file);
  if (raw.length < 1024) continue;
  writeFileSync(file + ".br", brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }));
  writeFileSync(file + ".gz", gzipSync(raw, { level: 9 }));
  const kb = (f) => (statSync(f).size / 1024).toFixed(0);
  console.log(`${name}: ${kb(file)} KB → br ${kb(file + ".br")} KB, gz ${kb(file + ".gz")} KB`);
}
