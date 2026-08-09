import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ignored = new Set(['.git', '.tmp', '.visual-test', 'bin', 'dist', 'node_modules', 'release']);

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (ignored.has(name)) return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(root);
const projectFiles = files.map((path) => relative(root, path).replaceAll('\\', '/'));
const config = JSON.parse(readFileSync(join(root, 'neutralino.config.json'), 'utf8'));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

assert.equal(config.logging.enabled, false, 'runtime logging must stay disabled');
assert.equal(config.logging.writeToLogFile, false, 'runtime log files must stay disabled');
assert.equal(config.enableNativeAPI, true);
assert.ok(config.nativeAllowList.includes('os.execCommand'));
assert.equal(config.nativeAllowList.includes('net.*'), false);
assert.equal(packageJson.private, true);
assert.equal(packageJson.license, 'MIT');
assert.equal(existsSync(join(root, 'scripts', 'relay', 'AIOfficeHookRelay.exe')), true, 'compiled relay missing');

const forbiddenMedia = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);
assert.deepEqual(projectFiles.filter((path) => forbiddenMedia.has(extname(path).toLowerCase())), []);

for (const path of files.filter((item) => /\.(?:js|mjs)$/i.test(item) && !item.endsWith('neutralino.js'))) {
  const checked = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(checked.status, 0, `${relative(root, path)}: ${checked.stderr}`);
}

for (const path of files.filter((item) => item.includes(`${join(root, 'resources', 'js')}\\`) && item.endsWith('.js') && !item.endsWith('neutralino.js'))) {
  const source = readFileSync(path, 'utf8');
  assert.equal(/\b(?:AudioContext|webkitAudioContext|new\s+Audio)\b/.test(source), false, `${relative(root, path)} adds audio runtime`);
}

for (const path of files.filter((item) => item.endsWith('.ps1'))) {
  const source = readFileSync(path, 'utf8');
  assert.equal([...source].some((character) => character.codePointAt(0) > 127), false, `${relative(root, path)} must stay Windows PowerShell 5.1-safe ASCII`);
}

console.log(JSON.stringify({
  ok: true,
  checkedFiles: files.length,
  javascriptFiles: files.filter((item) => /\.(?:js|mjs)$/i.test(item) && !item.endsWith('neutralino.js')).length,
  audioAssets: 0,
  runtimeLogging: false
}));
