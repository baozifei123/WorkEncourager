const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const files = ['whale-character.png', 'whale-blink.png', 'whale-tired.png', 'whale-wave.png', 'whale-celebrate.png', 'whale-working.png', 'whale-sprint.png', 'whale-fight.png'];

test('all pet frames are matching transparent PNG images', () => {
  for (const file of files) {
    const image = fs.readFileSync(path.join(root, 'assets', file));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file);
    assert.equal(image.readUInt32BE(16), 600, file + ' width');
    assert.equal(image.readUInt32BE(20), 800, file + ' height');
    assert.equal(image[24], 8, file + ' bit depth');
    assert.equal(image[25], 6, file + ' must have an alpha channel');
  }
});

test('the desktop pet is launched without overriding the execution policy', () => {
  const hta = fs.readFileSync(path.join(root, '上班鼓励器.hta'), 'utf8');
  assert.match(hta, /DesktopPet\.cs/);
  assert.match(hta, /WorkBankPet\]::Run/);
  assert.match(hta, /-Sta -WindowStyle Hidden -Command/);
  assert.doesNotMatch(hta, /ExecutionPolicy\s+Bypass/i);
  for (const name of ['title', 'petAlivePath', 'petStatePath', 'petBeatPath', 'petReadyPath', 'petControlPath', 'petNoticePath', 'petEventsPath']) {
    assert.match(hta, new RegExp('psQuote\\(' + name + '\\)'), name + ' is quoted');
  }
});
