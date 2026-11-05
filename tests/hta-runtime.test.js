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
  const alerts = [];
  const commands = [];
  const fso = {
    FileExists(name) { return Object.hasOwn(files, name); },
    FolderExists(name) { return Object.hasOwn(files, name + '\\__folder'); },
    CreateFolder(name) { files[name + '\\__folder'] = ''; },
    DeleteFolder(name) {
      delete files[name + '\\__folder'];
      for (const key of Object.keys(files)) if (key.startsWith(name + '\\')) delete files[key];
    },
    GetFolder(name) {
      const prefix = name + '\\';
      return { Files: Object.keys(files).filter(key => key.startsWith(prefix) && key.endsWith('.evt')).map(Path => ({ Path })) };
    },
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
  const document = { title: '上班鼓励器 · 工时银行', body: { className: '' }, getElementById(id) {
    if (!elements[id]) elements[id] = {
      innerText: '', innerHTML: '', className: '', style: {}, value: '', checked: false, title: '', attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; }
    };
    return elements[id];
  } };
  const context = vm.createContext({
    document,
    window: { resizeTo() {}, moveTo() {} },
    screen: { availWidth: 1200, availHeight: 900 },
    location: { pathname: '/C:/Projects/%E5%B7%A5%E6%97%B6/app.hta' },
    Enumerator: function (items) {
      this.index = 0;
      this.atEnd = () => this.index >= items.length;
      this.moveNext = () => { this.index++; };
      this.item = () => items[this.index];
    },
    ActiveXObject: function (name) {
      if (name === 'Scripting.FileSystemObject') return fso;
      if (name === 'WScript.Shell') return { ExpandEnvironmentStrings: () => 'powershell.exe', Run(command) { commands.push(command); } };
      throw new Error('unexpected ActiveX: ' + name);
    },
    alert(message) { alerts.push(message); }, setInterval() {}, setTimeout() { return 1; }, clearTimeout() {}
  });
  scripts.forEach(script => vm.runInContext(script, context));
  return { context, files, fso, elements, alerts, commands };
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

test('desktop pet receives only status and pauses recording from its menu', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  assert.equal(app.startPet(), true);
  assert.equal(app.petStarting, true);
  assert.match(env.commands[0], /DesktopPet\.cs/);
  assert.doesNotMatch(env.commands[0], /ExecutionPolicy\s+Bypass/i);
  assert.doesNotMatch(env.files[app.petStatePath], /8000|salary/i);
  env.files[app.petReadyPath] = 'ready|12345';
  env.files[app.petBeatPath] = String(Date.now());
  app.petTick();
  assert.equal(app.petRunning, true);
  assert.equal(env.files[app.petControlPath], 'hide');
  env.files[app.petEventsPath + '\\0001.evt'] = 'toggle';
  app.petTick();
  assert.equal(app.tracking, true);
  env.files[app.petEventsPath + '\\0002.evt'] = 'toggle';
  app.petTick();
  assert.equal(app.tracking, false);
});

test('storage corruption keeps the panel visible so the warning is not hidden by the pet', () => {
  const env = runtime(), app = env.context;
  app.fatalStorage = true;
  app.storageProblem = '无法读取本机数据';
  assert.equal(app.startPet(), true);
  assert.match(env.files[app.petStatePath], /^error\|/);
  env.files[app.petReadyPath] = 'ready|12345';
  app.petTick();
  assert.equal(app.petPanelVisible, true);
  assert.equal(env.files[app.petControlPath], 'show');
});

test('hidden-panel reminders go to the pet without leaking salary or amounts', () => {
  const env = runtime(), app = env.context;
  app.petRunning = true;
  app.petPanelVisible = false;
  app.petNoticePath = 'C:\\Temp\\notice';
  app.masked = false;
  app.showToast('时薪参考 ¥ 45.98；仅活跃时间计入。');
  assert.equal(env.files[app.petNoticePath], 'hour');
  app.showToast('本机记录保存失败');
  assert.equal(env.files[app.petNoticePath], 'attention');
});

test('pet startup failure leaves the main application available', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  assert.equal(app.startPet(), true);
  env.files[app.petReadyPath] = 'error';
  app.petTick();
  assert.equal(app.petRunning, false);
  assert.equal(app.petStarting, false);
  assert.equal(app.document.title, '上班鼓励器 · 工时银行');
  assert.match(env.elements.toast.innerText, /桌宠/);
});

test('a lost pet heartbeat does not stop active work tracking', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.tracking = true;
  app.startPet();
  env.files[app.petReadyPath] = 'ready|12345';
  app.petTick();
  app.petStarted = Date.now() - 20000;
  env.files[app.petBeatPath] = String(Date.now() - 20000);
  app.petTick();
  assert.equal(app.petRunning, false);
  assert.equal(app.tracking, true);
  assert.match(env.elements.petStatusText.innerText, /连接中断/);
  assert.ok(env.commands.some(command => /WorkBankRecovery/.test(command) && /ShowWindow/.test(command)), 'restore the minimized panel after the pet dies');
});

test('pet position and topmost preference are validated and persisted', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.handlePetEvent('position|100|200');
  app.handlePetEvent('pin|1');
  assert.equal(app.bank.settings.petX, 100);
  assert.equal(app.bank.settings.petY, 200);
  assert.equal(app.bank.settings.petOnTop, true);
  app.handlePetEvent('position|999999999|bad');
  assert.equal(app.bank.settings.petX, 100);
  assert.equal(JSON.parse(env.files[app.appPath('workbank.json')]).settings.petOnTop, true);
});

test('pet preferences chosen before first setup survive saving the initial settings', () => {
  const { context: app, elements } = runtime();
  app.handlePetEvent('position|120|240');
  app.handlePetEvent('pin|0');
  app.openSettings();
  elements.inSalary.value = '8000';
  elements.inMonthHours.value = '174';
  elements.inDayHours.value = '8';
  elements.inEndTime.value = '18:00';
  elements.inMask.checked = true;
  app.saveSettings();
  assert.equal(app.bank.settings.petX, 120);
  assert.equal(app.bank.settings.petY, 240);
  assert.equal(app.bank.settings.petOnTop, false);
});

test('editing settings preserves the pet position and pin preference', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings, petX: 120, petY: 240, petOnTop: false };
  assert.equal(app.saveBank(), true);
  const restored = runtime(env.files), next = restored.context;
  next.loadBank();
  next.openSettings();
  restored.elements.inMotion.checked = false;
  next.saveSettings();
  assert.equal(next.bank.settings.petX, 120);
  assert.equal(next.bank.settings.petY, 240);
  assert.equal(next.bank.settings.petOnTop, false);
  assert.equal(next.bank.settings.motion, false);
});

test('today uses four decimal places while monthly and receipt totals use two', () => {
  const { context: app, elements } = runtime();
  app.bank.settings = { ...settings };
  app.bank.days[app.bankDate(Date.now())] = sampleDay();
  app.masked = false;
  app.render(Date.now());
  assert.equal(elements.todayAmount.innerText, '¥ 45.9770');
  assert.equal(elements.monthAmount.innerText, '¥ 45.98');
  assert.match(elements.bankCard.title, /¥ 45\.9770/);
  app.signOff();
  assert.equal(elements.receiptAmount.innerText, '¥ 45.98');
});

test('energy indicator warms with progress and pauses when tracking is idle', () => {
  const { context: app, elements } = runtime();
  app.bank.settings = { ...settings, motion: true };
  app.tracking = true;
  app.monitorReady = true;
  const today = app.bankDate(Date.now());
  app.bank.days[today] = sampleDay(3600);
  app.render(Date.now());
  assert.match(elements.energyMeter.className, /cool/);
  app.bank.days[today].activeSeconds = 5 * 3600;
  app.render(Date.now());
  assert.match(elements.energyMeter.className, /warm/);
  app.bank.days[today].activeSeconds = 7.5 * 3600;
  app.render(Date.now());
  assert.match(elements.energyMeter.className, /hot/);
  app.bank.days[today].activeSeconds = 9 * 3600;
  app.render(Date.now());
  assert.equal(elements.progressFill.style.width, '100%');
  assert.match(elements.energyMeter.className, /overtime/);
  app.monitorIdle = true;
  app.render(Date.now());
  assert.match(elements.energyMeter.className, /paused/);
  app.bank.settings.motion = false;
  app.render(Date.now());
  assert.match(app.document.body.className, /motion-off/);
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

test('window pinning is confirmed before its state is saved and can be undone', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.render(Date.now());
  assert.match(env.elements.todayAmount.innerText, /\*\*\*\*/);
  app.requestPin(true, true);
  assert.equal(app.pinPending, true);
  assert.equal(app.pinned, false);
  assert.notEqual(app.document.title, '上班鼓励器 · 工时银行');
  assert.match(env.commands[0], /SetWindowPos/);
  env.files[app.pinResultPath] = '1';
  app.checkPin();
  assert.equal(app.pinned, true);
  assert.equal(app.bank.settings.alwaysOnTop, true);
  assert.equal(app.masked, true);
  app.render(Date.now());
  assert.match(env.elements.todayAmount.innerText, /\*\*\*\*/);
  assert.equal(app.document.title, '上班鼓励器 · 工时银行');
  assert.equal(JSON.parse(env.files[app.appPath('workbank.json')]).settings.alwaysOnTop, true);
  app.requestPin(false, true);
  env.files[app.pinResultPath] = '1';
  app.checkPin();
  assert.equal(app.pinned, false);
  assert.equal(app.bank.settings.alwaysOnTop, false);
});

test('window pin failures and timeouts do not falsely change or save the state', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.requestPin(true, true);
  env.files[app.pinResultPath] = '-1';
  app.checkPin();
  assert.equal(app.pinned, false);
  assert.equal(app.pinPending, false);
  assert.equal(app.document.title, '上班鼓励器 · 工时银行');
  assert.equal(app.bank.settings.alwaysOnTop, undefined);
  assert.equal(env.alerts.length, 1);
  app.requestPin(true, true);
  app.pinStarted = Date.now() - 20000;
  app.checkPin();
  assert.equal(app.pinned, false);
  assert.equal(app.pinPending, false);
  assert.equal(env.alerts.length, 2);
});

test('pinning remains truthful if the preference cannot be saved', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.requestPin(true, true);
  app.requestPin(false, true);
  assert.equal(env.commands.length, 1, 'ignore a second request while the first is pending');
  env.fso.failWrites = true;
  env.files[app.pinResultPath] = '1';
  app.checkPin();
  assert.equal(app.pinned, true);
  assert.equal(app.bank.settings.alwaysOnTop, true);
  assert.equal(app.dirty, true);
  assert.match(app.storageProblem, /保存失败/);
  assert.match(env.elements.toast.innerText, /偏好保存失败/);
});

test('a saved pin preference is reapplied on launch and retained when editing settings', () => {
  const first = runtime();
  first.context.bank.settings = { ...settings, alwaysOnTop: true };
  assert.equal(first.context.saveBank(), true);
  const restored = runtime(first.files), app = restored.context;
  app.window.onload();
  assert.equal(app.pinPending, true);
  assert.equal(app.pinned, false);
  restored.files[app.pinResultPath] = '1';
  app.checkPin();
  assert.equal(app.pinned, true);
  app.openSettings();
  app.saveSettings();
  assert.equal(app.bank.settings.alwaysOnTop, true);
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
