const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '上班鼓励器.hta'), 'utf8');
const scripts = [...source.matchAll(/<script(?: id="bank-core")? type="text\/javascript">([\s\S]*?)<\/script>/g)].map(m => m[1]);
assert.equal(scripts.length, 2);

function runtime(files = Object.create(null)) {
  const elements = Object.create(null);
  const fso = {
    FileExists(name) { return Object.hasOwn(files, name); },
    OpenTextFile(name, mode) {
      if (mode === 1) {
        if (!Object.hasOwn(files, name)) throw new Error('missing file');
        return { AtEndOfStream: files[name].length === 0, ReadAll: () => files[name], Close() {} };
      }
      if (this.failWrites) throw new Error('write denied');
      return { Write(value) { files[name] = value; }, Close() {} };
    },
    CopyFile(from, to) {
      if (this.failWrites || !Object.hasOwn(files, from)) throw new Error('copy denied');
      files[to] = files[from];
    },
    DeleteFile(name) { delete files[name]; },
    GetSpecialFolder() { return { Path: 'C:\\Temp' }; }
  };
  const document = { getElementById(id) {
    if (!elements[id]) elements[id] = { innerText: '', innerHTML: '', className: '', style: {}, value: '', checked: false, title: '' };
    return elements[id];
  } };
  const context = vm.createContext({
    document,
    window: { resizeTo() {}, moveTo() {} },
    screen: { availWidth: 1200, availHeight: 900 },
    location: { pathname: '/C:/Projects/%E5%B7%A5%E6%97%B6/app.hta' },
    ActiveXObject: function (name) {
      if (name === 'Scripting.FileSystemObject') return fso;
      if (name === 'WScript.Shell') return { ExpandEnvironmentStrings: () => 'powershell.exe', Run() {} };
      throw new Error('unexpected ActiveX: ' + name);
    },
    alert() {}, setInterval() {}, setTimeout() { return 1; }, clearTimeout() {}
  });
  scripts.forEach(script => vm.runInContext(script, context));
  return { context, files, fso, elements };
}

const settings = { salary: 8000, monthHours: 174, dayHours: 8, endTime: '18:00', maskByDefault: true, announce: true };
function sampleDay(seconds = 3600) { return { activeSeconds: seconds, hourlyRate: 8000 / 174, dayHours: 8 }; }

test('Unicode application directories decode to the correct local data path', () => {
  const { context: app } = runtime();
  assert.equal(app.appPath('workbank.json'), 'C:\\Projects\\工时\\workbank.json');
});

test('backup recovers a damaged main file without overwriting the good backup', () => {
  const first = runtime(), app = first.context;
  app.bank.settings = settings;
  app.bank.days['2026-11-01'] = sampleDay();
  assert.equal(app.saveBank(), true);
  app.bank.days['2026-11-02'] = sampleDay(7200);
  assert.equal(app.saveBank(), true);
  const main = app.appPath('workbank.json'), backup = app.appPath('workbank.json.bak');
  const goodBackup = first.files[backup];
  first.files[main] = '{broken';
  const restored = runtime(first.files).context;
  restored.loadBank();
  assert.equal(restored.recovered, true);
  assert.equal(restored.bank.days['2026-11-01'].activeSeconds, 3600);
  assert.equal(restored.bank.days['2026-11-02'], undefined);
  assert.equal(restored.saveBank(), true);
  assert.equal(first.files[backup], goodBackup);
  assert.ok(JSON.parse(first.files[main]).days['2026-11-01']);
});

test('corrupt main and backup stop writes rather than silently resetting data', () => {
  const env = runtime(), app = env.context;
  const main = app.appPath('workbank.json'), backup = app.appPath('workbank.json.bak');
  env.files[main] = '{broken';
  env.files[backup] = '{broken backup';
  app.loadBank();
  assert.equal(app.fatalStorage, true);
  assert.equal(app.saveBank(), false);
  assert.equal(env.files[main], '{broken');
  assert.equal(env.files[backup], '{broken backup');
});

test('storage failures are reported rather than presented as saved', () => {
  const env = runtime();
  env.context.bank.settings = settings;
  env.fso.failWrites = true;
  assert.equal(env.context.saveBank(), false);
  assert.match(env.context.storageProblem, /保存失败/);
});

test('a failed first save can be retried without leaving half-applied settings', () => {
  const env = runtime(), app = env.context;
  app.openSettings();
  env.elements.inSalary.value = '8000';
  env.elements.inMonthHours.value = '174';
  env.elements.inDayHours.value = '8';
  env.elements.inEndTime.value = '18:00';
  env.elements.inMask.checked = true;
  env.elements.inAnnounce.checked = true;
  env.fso.failWrites = true;
  app.saveSettings();
  assert.equal(app.bank.settings, null);
  assert.equal(app.tracking, false);
  env.fso.failWrites = false;
  app.saveSettings();
  assert.equal(app.bank.settings.salary, 8000);
  assert.equal(app.tracking, true);
});

test('a long pause is never filled in as active time', () => {
  const { context: app } = runtime();
  app.bank.settings = settings;
  app.tracking = true;
  app.monitorStarted = Date.now();
  app.lastSave = Date.now();
  app.previousInput = Date.now() - 30000;
  app.lastTick = Date.now() - 10000;
  app.readSample = now => ({ input: now - 30000, idle: 30000 });
  app.tick();
  assert.equal(app.currentDay(Date.now()).activeSeconds, 0);
  app.lastTick = Date.now() - 1000;
  app.tick();
  const recorded = app.currentDay(Date.now()).activeSeconds;
  assert.ok(recorded >= 0.99 && recorded <= 1.1, 'only the recent interval should be recorded');
});

test('stale or missing samples stop accounting until fresh observations resume', () => {
  const { context: app } = runtime();
  app.bank.settings = settings;
  app.tracking = true;
  app.monitorStarted = Date.now();
  app.lastSave = Date.now();
  app.previousInput = Date.now() - 30000;
  app.lastTick = Date.now() - 1000;
  app.readSample = () => null;
  app.tick();
  assert.equal(app.monitorReady, false);
  assert.equal(app.currentDay(Date.now()).activeSeconds, 0);
  app.readSample = now => ({ input: now - 30000, idle: 30000 });
  app.lastTick = Date.now() - 1000;
  app.tick();
  assert.equal(app.currentDay(Date.now()).activeSeconds, 0);
  app.lastTick = Date.now() - 1000;
  app.tick();
  assert.ok(app.currentDay(Date.now()).activeSeconds >= 0.99);
});

test('goal messages never promise an already reached or unreachable target', () => {
  const { context: app } = runtime();
  app.bank.settings = settings;
  assert.match(app.goalText(sampleDay(8 * 3600)), /已折合/);
  app.bank.settings = { salary: 20, monthHours: 174, dayHours: 8, endTime: '18:00' };
  const lowWage = { activeSeconds: 6.5 * 3600, hourlyRate: 20 / 174, dayHours: 8 };
  assert.match(app.goalText(lowWage), /计额有上限/);
});

test('masking applies to the card, tooltip, history and receipt', () => {
  const { context: app, elements } = runtime();
  app.bank.settings = settings;
  app.bank.days[app.bankDate(Date.now())] = sampleDay();
  app.render(Date.now());
  assert.match(elements.todayAmount.innerText, /\*\*\*\*/);
  assert.match(elements.bankCard.title, /\*\*\*\*/);
  app.showHistory();
  assert.match(elements.historyBody.innerHTML, /\*\*\*\*/);
  app.signOff();
  assert.match(elements.receiptAmount.innerText, /\*\*\*\*/);
  app.masked = false;
  app.render(Date.now());
  assert.doesNotMatch(elements.todayAmount.innerText, /\*\*\*\*/);
  app.showToast('sensitive');
  elements.btnPrivacy.onclick();
  assert.match(elements.toast.className, /hidden/);
  assert.match(elements.todayAmount.innerText, /\*\*\*\*/);
});

test('settings updates revalue today but leave earlier days unchanged', () => {
  const { context: app, elements } = runtime();
  app.bank.settings = settings;
  const today = app.bankDate(Date.now());
  app.bank.days[today] = sampleDay();
  app.bank.days['2020-01-01'] = sampleDay();
  app.openSettings();
  elements.inSalary.value = '10000';
  elements.inMonthHours.value = '200';
  elements.inDayHours.value = '6';
  elements.inEndTime.value = '17:00';
  elements.inMask.checked = true;
  elements.inAnnounce.checked = true;
  app.saveSettings();
  assert.equal(app.bank.days[today].hourlyRate, 50);
  assert.equal(app.bank.days[today].dayHours, 6);
  assert.equal(app.bank.days['2020-01-01'].hourlyRate, 8000 / 174);
  assert.equal(app.bank.days['2020-01-01'].dayHours, 8);
});
