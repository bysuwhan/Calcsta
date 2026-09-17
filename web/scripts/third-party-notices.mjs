/**
 * Generate the third-party notices that ship with the browser bundle.
 *
 * ── Why this exists ────────────────────────────────────────────────
 *
 * Calcsta is AGPL-3.0 and its production artifacts embed JavaScript packages, Rust crates,
 * and a small MIT-licensed dataset. Their licences attach conditions to DISTRIBUTION, and a
 * browser app distributes to every visitor:
 *
 *   - **MIT** — "The above copyright notice and this permission notice shall be included in
 *     all copies or substantial portions of the Software."
 *   - **Apache-2.0 §4** — retain the copyright, patent, trademark and attribution notices, and
 *     give recipients a copy of the licence.
 *   - **MPL-2.0 §3.2** — recipients must be told how to obtain the source of the covered files.
 *
 * The bundle satisfies none of that on its own: `vite build` minifies, and a check of
 * `dist/assets/*.js` finds zero `Copyright (c)` strings. The notices therefore have to
 * accompany the distribution as a separate document, which is what this writes.
 *
 * ── What it reads, and what it deliberately does not ───────────────
 *
 * The RUNTIME closures only — `npm ls --omit=dev` plus non-dev dependencies reachable from
 * the Cargo workspace members. Build and test tools are absent because they are not shipped.
 *
 * Licence TEXT is copied verbatim from each package's own file rather than from a table of
 * canonical texts, because the copyright line is part of the notice and it is per-package.
 *
 * ── Keeping it honest ──────────────────────────────────────────────
 *
 * `third-party-notices.test.ts` runs this and fails if the committed file differs. Adding a
 * runtime dependency without regenerating is therefore a test failure rather than a
 * compliance gap discovered by somebody else.
 *
 *   node scripts/third-party-notices.mjs          # check, exit 1 on drift
 *   node scripts/third-party-notices.mjs --write  # regenerate
 */

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(WEB, '..');
const OUT_REPO = path.join(REPO, 'THIRD_PARTY_NOTICES.md');
/** Also shipped, so the deployed site carries its own notices at a stable URL. */
const OUT_PUBLIC = path.join(WEB, 'public', 'third-party-notices.txt');
const OUT_AGPL = path.join(WEB, 'public', 'LICENSE.txt');

const EUROCODEPY = {
  name: 'eurocodepy profile data',
  version: 'source snapshot credited in web/src/lib/data/steel-profiles.ts',
  licence: 'MIT',
  source: 'https://github.com/pcachim/eurocodepy',
  text: `MIT License

Copyright (c) 2026 Paulo Cachim

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`
};

const TOKIO_MIT = `MIT License

Copyright (c) Tokio Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** crates.io package omissions whose canonical repository notice is known. */
const RUST_LICENCE_FALLBACKS = new Map([
  ['valuable', [{ file: 'LICENSE (repository)', text: TOKIO_MIT }]],
]);

/** Every package reachable from `dependencies`, flattened, name → version. */
function runtimeClosure() {
  const raw = process.platform === 'win32'
    ? execSync('npm.cmd ls --omit=dev --all --json', { cwd: WEB, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    : execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: WEB, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const tree = JSON.parse(raw);
  const found = new Map();
  (function walk(node) {
    for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
      if (!found.has(name)) found.set(name, dep.version ?? '?');
      walk(dep);
    }
  })(tree);
  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Non-dev crates reachable from the engine and backend workspace packages. */
function rustRuntimeClosure() {
  const raw = execFileSync('cargo', ['metadata', '--format-version', '1', '--locked'], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const metadata = JSON.parse(raw);
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map((metadata.resolve?.nodes ?? []).map((node) => [node.id, node]));
  const found = new Map();
  const visited = new Set();

  function walk(id) {
    if (visited.has(id)) return;
    visited.add(id);
    const pkg = packages.get(id);
    if (!pkg) return;
    if (pkg.source) found.set(id, pkg);
    const node = nodes.get(id);
    for (const dep of node?.deps ?? []) {
      const runtime = (dep.dep_kinds ?? []).some((kind) => kind.kind === null);
      if (runtime) walk(dep.pkg);
    }
  }

  for (const id of metadata.workspace_members ?? []) walk(id);
  return [...found.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function readPkg(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(WEB, 'node_modules', name, 'package.json'), 'utf8'));
  } catch { return {}; }
}

/** The package's own licence file, whatever it chose to call it. */
function readLicenceText(name) {
  const dir = path.join(WEB, 'node_modules', name);
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return null; }
  const file = entries.find((f) => /^(LICEN[CS]E|COPYING)([.-]|$)/i.test(f));
  if (!file) return null;
  return { file, text: fs.readFileSync(path.join(dir, file), 'utf8').trimEnd() };
}

/** All licence/copyright files shipped by a Cargo package (needed for AND licences). */
function readRustLicenceTexts(pkg) {
  const dir = path.dirname(pkg.manifest_path);
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const licences = entries
    .filter((file) => /^(LICEN[CS]E|COPYING|NOTICE|UNLICENSE)([.-]|$)/i.test(file))
    .sort()
    .map((file) => ({ file, text: fs.readFileSync(path.join(dir, file), 'utf8').trimEnd() }));
  return licences.length ? licences : (RUST_LICENCE_FALLBACKS.get(pkg.name) ?? []);
}

function licenceId(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) return pkg.licenses[0].type;
  return 'UNKNOWN';
}

function build() {
  const closure = runtimeClosure();
  const rustClosure = rustRuntimeClosure();
  const lines = [];

  lines.push('# Third-party notices');
  lines.push('');
  lines.push('Calcsta is an unofficial modified and simplified version of Stabileo, focused on');
  lines.push('commonly used mechanical design features. Calcsta is licensed under the **GNU');
  lines.push('Affero General Public License v3.0**; see the repository `LICENSE` or the');
  lines.push('deployed `/LICENSE.txt`. Copyright in the original');
  lines.push('Stabileo code remains with LambdaClass and the respective Stabileo contributors.');
  lines.push('Its production artifacts also contain the third-party components listed below.');
  lines.push('');
  lines.push('This file is GENERATED by `web/scripts/third-party-notices.mjs` and checked by');
  lines.push('`third-party-notices.test.ts`. Edit the generator, not this file.');
  lines.push('');
  lines.push('Only components that reach a **distributed runtime artifact** are listed. Build');
  lines.push('and test tooling — Vite, Vitest, Playwright, TypeScript, Criterion — is omitted.');
  lines.push('');

  const byLicence = new Map();
  for (const [name, version] of closure) {
    const id = licenceId(readPkg(name));
    if (!byLicence.has(id)) byLicence.set(id, []);
    byLicence.get(id).push({ name, version });
  }

  lines.push('## Summary');
  lines.push('');
  lines.push('| Ecosystem | Package | Version | Licence |');
  lines.push('|---|---|---|---|');
  for (const [name, version] of closure) {
    lines.push(`| npm | \`${name}\` | ${version} | ${licenceId(readPkg(name))} |`);
  }
  for (const pkg of rustClosure) {
    lines.push(`| Cargo | \`${pkg.name}\` | ${pkg.version} | ${pkg.license ?? 'UNKNOWN'} |`);
  }
  lines.push(`| data | \`${EUROCODEPY.name}\` | ${EUROCODEPY.version} | ${EUROCODEPY.licence} |`);
  lines.push('');

  for (const [name, version] of closure) {
    const pkg = readPkg(name);
    const id = licenceId(pkg);
    const lic = readLicenceText(name);
    lines.push('---');
    lines.push('');
    lines.push(`## ${name} ${version}`);
    lines.push('');
    lines.push(`- **Licence:** ${id}`);
    if (pkg.homepage) lines.push(`- **Homepage:** ${pkg.homepage}`);
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    if (repo) lines.push(`- **Source:** ${repo.replace(/^git\+/, '').replace(/\.git$/, '')}`);
    if (id === 'MPL-2.0') {
      // MPL §3.2: recipients must be told where the source of the covered files is.
      lines.push('- **MPL-2.0 note:** the source of the covered files is available at the'
        + ' repository above. Calcsta does not modify them.');
    }
    lines.push('');
    if (lic) {
      lines.push(`<details><summary>${lic.file}</summary>`);
      lines.push('');
      lines.push('```');
      lines.push(lic.text);
      lines.push('```');
      lines.push('');
      lines.push('</details>');
    } else {
      // Loud rather than silent: a package with no licence file is a question, not a default.
      lines.push(`> **No licence file found in \`node_modules/${name}\`.** Declared \`${id}\`.`);
      lines.push('> Resolve before the next release.');
    }
    lines.push('');
  }

  for (const pkg of rustClosure) {
    const licences = readRustLicenceTexts(pkg);
    lines.push('---');
    lines.push('');
    lines.push(`## ${pkg.name} ${pkg.version} (Cargo)`);
    lines.push('');
    lines.push(`- **Licence:** ${pkg.license ?? 'UNKNOWN'}`);
    if (pkg.homepage) lines.push(`- **Homepage:** ${pkg.homepage}`);
    if (pkg.repository) lines.push(`- **Source:** ${pkg.repository}`);
    lines.push('');
    if (licences.length) {
      for (const lic of licences) {
        lines.push(`<details><summary>${lic.file}</summary>`);
        lines.push('');
        lines.push('```');
        lines.push(lic.text);
        lines.push('```');
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }
    } else {
      lines.push(`> **No licence file found for Cargo package \`${pkg.name}\`.** Declared \`${pkg.license ?? 'UNKNOWN'}\`.`);
      lines.push('> Resolve before the next release.');
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(`## ${EUROCODEPY.name}`);
  lines.push('');
  lines.push(`- **Licence:** ${EUROCODEPY.licence}`);
  lines.push(`- **Source:** ${EUROCODEPY.source}`);
  lines.push('- **Use:** selected European steel-profile data, converted to Calcsta units.');
  lines.push('');
  lines.push('<details><summary>LICENSE.md</summary>');
  lines.push('');
  lines.push('```');
  lines.push(EUROCODEPY.text);
  lines.push('```');
  lines.push('');
  lines.push('</details>');
  lines.push('');

  return lines.join('\n');
}

const content = build();
const write = process.argv.includes('--write');

if (write) {
  fs.writeFileSync(OUT_REPO, content);
  fs.mkdirSync(path.dirname(OUT_PUBLIC), { recursive: true });
  fs.writeFileSync(OUT_PUBLIC, content);
  fs.copyFileSync(path.join(REPO, 'LICENSE'), OUT_AGPL);
  console.log(`third-party notices: wrote notices and ${OUT_AGPL}`);
} else {
  const current = fs.existsSync(OUT_REPO) ? fs.readFileSync(OUT_REPO, 'utf8') : '';
  if (current !== content) {
    console.error('third-party notices are out of date — run '
      + '`node scripts/third-party-notices.mjs --write`');
    process.exit(1);
  }
  const agpl = fs.readFileSync(path.join(REPO, 'LICENSE'), 'utf8');
  const publicAgpl = fs.existsSync(OUT_AGPL) ? fs.readFileSync(OUT_AGPL, 'utf8') : '';
  if (publicAgpl !== agpl) {
    console.error('public AGPL copy is missing or stale — run '
      + '`node scripts/third-party-notices.mjs --write`');
    process.exit(1);
  }
  console.log('third-party notices: up to date');
}

export { build };
