'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const launcher = fs.readFileSync(path.join(root, 'tools', 'Launcher.cs'), 'utf8');
const build = fs.readFileSync(path.join(root, 'tools', 'build-exe.js'), 'utf8');
const hta = fs.readFileSync(path.join(root, '上班鼓励器.hta'), 'utf8');
const pet = fs.readFileSync(path.join(root, 'DesktopPet.cs'), 'utf8');

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
