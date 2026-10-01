import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const manifestPath = 'ai-capability-surface.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const knownExtensions = new Set(['.html','.js','.jsx','.ts','.tsx','.mjs','.cjs','.css','.vue','.svelte']);
const ignoredSegments = new Set(['.git','.github','node_modules','dist','build','coverage','test','tests','__tests__','docs','doc','documentation']);
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean)
  .filter(path => knownExtensions.has(path.slice(path.lastIndexOf('.')).toLowerCase()))
  .filter(path => !path.split('/').some(segment => ignoredSegments.has(segment.toLowerCase())))
  .filter(path => path !== 'scripts/ai-capability-surface.mjs')
  .sort();
const current = {};
for (const path of tracked) {
  current[path] = execFileSync('git', ['hash-object', '--no-filters', '--', path], { encoding: 'utf8' }).trim();
}
const expected = Object.keys(manifest.source_files || {}).sort();
const missing = tracked.filter(path => !Object.hasOwn(manifest.source_files || {}, path));
const removed = expected.filter(path => !Object.hasOwn(current, path));
const changed = tracked.filter(path => manifest.source_files?.[path] && manifest.source_files[path] !== current[path]);
if (process.argv.includes('--write')) {
  manifest.source_files = current;
  manifest.snapshot_commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Updated ${manifestPath}: ${tracked.length} capability-related source files.`);
} else {
  const failures = [];
  if (missing.length) failures.push(`New source files missing from surface ledger: ${missing.join(', ')}`);
  if (removed.length) failures.push(`Removed source files still listed in surface ledger: ${removed.join(', ')}`);
  if (changed.length) failures.push(`Changed source files have stale fingerprints: ${changed.join(', ')}`);
  if (process.argv.includes('--require-review')) {
    const match = (process.env.PR_BODY || '').match(/^\s*AI_CAPABILITY_REVIEW:\s*(UPDATED|COVERED|GAP)\s*[-—:]\s*(.+)$/im);
    if (!match) failures.push('PR body must include AI_CAPABILITY_REVIEW: UPDATED|COVERED|GAP — <short explanation>.');
    else if (match[1].toUpperCase() === 'GAP' && match[2].trim().length < 12) failures.push('A GAP review must state the uncovered capability and its disposition.');
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    console.error('Refresh source fingerprints with: node scripts/ai-capability-surface.mjs --write');
    process.exitCode = 1;
  } else {
    console.log(`Capability surface current: ${tracked.length} source files fingerprinted for ${manifest.app}.`);
  }
}
