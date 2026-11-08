'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.join(__dirname, '..');
const launcher = fs.readFileSync(path.join(root, 'tools', 'Launcher.cs'), 'utf8');
const build = fs.readFileSync(path.join(root, 'tools', 'build-exe.js'), 'utf8');
const hta = fs.readFileSync(path.join(root, '上班鼓励器.hta'), 'utf8');
const pet = fs.readFileSync(path.join(root, 'DesktopPet.cs'), 'utf8');
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
const nativeAvailable = process.platform === 'win32' && fs.existsSync(csc);

function launcherMap() {
  const block = launcher.match(/ResourceMap = new string\[,\]\s*\{([\s\S]*?)\};/);
  assert.ok(block, 'Launcher.cs must declare ResourceMap');
  return [...block[1].matchAll(/\{\s*"([^"]+)"\s*,\s*@?"([^"]+)"\s*\}/g)].map(match => ({
    logical: match[1],
    target: match[2].replace(/\\/g, '/')
  }));
}

function buildMap() {
  const block = build.match(/const embedded = \[([\s\S]*?)\];/);
  assert.ok(block, 'build-exe.js must declare the embedded list');
  return [...block[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map(match => ({
    source: match[1],
    logical: match[2]
  }));
}

test('the launcher embeds every runtime asset and both resource lists stay in sync', () => {
  const targets = launcherMap(), sources = buildMap();
  assert.equal(targets.length, sources.length, 'launcher and build maps must have the same size');
  for (const entry of sources) {
    const target = targets.find(item => item.logical === entry.logical);
    assert.ok(target, 'Launcher.cs is missing a target for ' + entry.logical);
    assert.equal(target.target, entry.source, 'resource target must match its source path: ' + entry.logical);
    assert.ok(fs.existsSync(path.join(root, entry.source)), 'missing embedded source ' + entry.source);
  }

  const assets = new Set([
    ...[...pet.matchAll(/"(whale-[a-z-]+\.png)"/g)].map(match => match[1]),
    ...[...hta.matchAll(/assets\/([A-Za-z0-9._-]+)/g)].map(match => match[1])
  ]);
  for (const name of assets) {
    if (name === 'custom-character.png') continue;
    assert.ok(sources.some(item => item.source === 'assets/' + name),
      'runtime asset is not embedded in the EXE: ' + name);
  }

  assert.ok(fs.existsSync(path.join(root, 'tools', 'app.ico')), 'launcher icon is missing');
});

test('Windows launcher restores a work bank hidden in the tray', { skip: !nativeAvailable }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbank-launcher-test-'));
  try {
    const executable = path.join(directory, 'launcher-test.exe');
    const compiled = spawnSync(csc, [
      '/nologo', '/target:exe', '/main:LauncherNativeTests', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
      '/out:' + executable, path.join(root, 'tools', 'Launcher.cs'), path.join(__dirname, 'launcher-native.cs')
    ], { encoding: 'utf8', timeout: 30000 });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    if (result.stdout.includes('SKIP:')) t.skip('an existing work bank window must not be disturbed');
    else assert.match(result.stdout, /Hidden work bank activation passed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
