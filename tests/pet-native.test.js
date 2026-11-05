const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.join(__dirname, '..');
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
const available = process.platform === 'win32' && fs.existsSync(csc);

test('Windows pet loads custom artwork without distortion and falls back on invalid files', { skip: !available }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workbank-pet-test-'));
  try {
    const executable = path.join(directory, 'pet-test.exe');
    const compiled = spawnSync(csc, [
      '/nologo', '/target:exe', '/main:PetNativeTests', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
      '/out:' + executable, path.join(root, 'DesktopPet.cs'), path.join(__dirname, 'pet-native.cs')
    ], { encoding: 'utf8', timeout: 30000 });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const result = spawnSync(executable, [directory, path.join(root, 'assets', 'whale-character.png'), path.join(root, 'assets', 'whale-fight.png')], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /selection, aspect ratio, transparency.*mini card controls, session events and click routing passed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
