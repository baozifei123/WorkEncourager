'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tools = path.join(root, 'tools');
const dist = path.join(root, 'dist');
const obj = path.join(dist, 'obj');
const resources = path.join(obj, 'resources');
const launcher = path.join(tools, 'Launcher.cs');
const icon = path.join(tools, 'app.ico');

const embedded = [
  ['上班鼓励器.hta', 'WorkEncourager.hta'],
  ['DesktopPet.cs', 'DesktopPet.cs'],
  ['README.md', 'README.md'],
  ['assets/character-design.md', 'character-design.md'],
  ['assets/whale-character.png', 'whale-character.png'],
  ['assets/whale-blink.png', 'whale-blink.png'],
  ['assets/whale-wave.png', 'whale-wave.png'],
  ['assets/whale-celebrate.png', 'whale-celebrate.png'],
  ['assets/whale-working.png', 'whale-working.png'],
  ['assets/whale-sprint.png', 'whale-sprint.png'],
  ['assets/whale-fight.png', 'whale-fight.png'],
  ['assets/whale-face.png', 'whale-face.png']
];

function findCompiler() {
  const windows = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windows, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  throw new Error('未找到 .NET Framework 4.x 的 csc.exe');
}

fs.rmSync(obj, { recursive: true, force: true });
fs.rmSync(path.join(dist, '上班鼓励器.exe'), { force: true });
fs.rmSync(path.join(dist, '上班鼓励器.exe.sha256'), { force: true });
fs.mkdirSync(resources, { recursive: true });

const digest = crypto.createHash('sha256');
digest.update('workencourager-launcher-v1\0');
digest.update(fs.readFileSync(launcher));
for (const [source, logical] of embedded) {
  const bytes = fs.readFileSync(path.join(root, source));
  fs.writeFileSync(path.join(resources, logical), bytes);
  digest.update(logical + '\0');
  digest.update(bytes);
  console.log('EMBED ' + logical + ' ' + bytes.length);
}
const buildId = digest.digest('hex').slice(0, 16);
console.log('BUILD_ID ' + buildId);

const buildInfo = path.join(obj, 'BuildInfo.cs');
fs.writeFileSync(buildInfo,
  'internal static class BuildInfo { internal const string BuildId = "' + buildId + '"; }\r\n', 'utf8');

const rawExe = path.join(obj, 'WorkEncourager.exe');
const args = [
  '-nologo', '-target:winexe', '-platform:anycpu', '-optimize+', '-codepage:65001',
  '-win32icon:' + icon, '-r:System.Windows.Forms.dll', '-out:' + rawExe
];
for (const [, logical] of embedded) {
  args.push('-resource:' + path.join(resources, logical) + ',' + logical);
}
args.push(launcher, buildInfo);

const compiler = spawnSync(findCompiler(), args, { encoding: 'utf8' });
if (compiler.stdout) process.stdout.write(compiler.stdout);
if (compiler.stderr) process.stderr.write(compiler.stderr);
if (compiler.status !== 0) throw new Error('csc 编译失败，退出码 ' + compiler.status);

const output = path.join(dist, '上班鼓励器.exe');
fs.copyFileSync(rawExe, output);
const bytes = fs.readFileSync(output);
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(output + '.sha256', hash + '  上班鼓励器.exe\r\n', 'utf8');
console.log('EXE ' + output);
console.log('SIZE ' + bytes.length);
console.log('SHA256 ' + hash);
console.log('BUILD PASS');
