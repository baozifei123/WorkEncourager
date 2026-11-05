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
  const moves = [];
  const context = vm.createContext({
    document,
    window: { resizeTo() {}, moveTo(x, y) { moves.push({ x, y }); } },
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
  return { context, files, fso, elements, alerts, commands, moves };
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

test('goal messages follow the ladder and never promise unreachable targets', () => {
  const { context: app } = runtime();
  app.bank.settings = { ...settings };
  app.tracking = true;
  const dayAt = value => ({ activeSeconds: value * 3600, hourlyRate: 1, dayHours: 400 });
  assert.match(app.goalText(dayAt(7)), /今天的地铁/);
  assert.match(app.goalText(dayAt(8.5)), /早餐豆浆和包子/);
  assert.match(app.goalText(dayAt(13)), /一杯冰美式/);
  assert.match(app.goalText(dayAt(19)), /一份小零食/);
  assert.match(app.goalText(dayAt(80)), /一本小书/);
  assert.match(app.goalText(dayAt(109)), /半天房租/);
  assert.match(app.goalText(dayAt(300)), /已折合/);
  assert.match(app.goalText(dayAt(0)), /^再记录 .*相当于一支好写的签字笔。$/);
  app.tracking = false;
  assert.match(app.goalText(dayAt(0)), /^开始记录后，约 .*相当于一支好写的签字笔。$/);
  app.bank.settings = { salary: 20, monthHours: 174, dayHours: 8, endTime: '18:00' };
  const lowWage = { activeSeconds: 6.5 * 3600, hourlyRate: 20 / 174, dayHours: 8 };
  assert.match(app.goalText(lowWage), /计额快到头了|计额已到上限/);
});

test('custom goals replace the built-in ladder when they are valid', () => {
  const { context: app } = runtime();
  app.bank.settings = { ...settings, customGoals: '咖啡=19\n午饭 = 45\n电影=72\n这一行无效\n负数=-3' };
  app.tracking = true;
  const dayAt = value => ({ activeSeconds: value * 3600, hourlyRate: 1, dayHours: 400 });
  const parsed = app.bankGoalCustom(app.bank.settings.customGoals);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].name, '咖啡');
  assert.equal(parsed[1].name, '午饭');
  assert.equal(parsed[1].value, 45);
  assert.equal(app.bankGoalCustom('只有一行=10\n两行=20'), null, 'fewer than three valid entries fall back to built-ins');
  const merged = app.bankMergeGoals([{ name: 'a', value: 6 }, { name: 'b', value: 7.5 }, { name: 'c', value: 12 }]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].value, 6);
  assert.equal(merged[1].value, 12);
  const kept = app.bankMergeGoals([{ name: 'a', value: 6 }, { name: 'b', value: 8 }]);
  assert.equal(kept.length, 2, 'goals two yuan apart are both kept');
  assert.match(app.goalText(dayAt(10)), /咖啡/);
  assert.match(app.goalText(dayAt(20)), /午饭/);
  assert.match(app.goalText(dayAt(50)), /电影/);
  assert.match(app.goalText(dayAt(80)), /超过了当前设定的目标/);
  app.bank.settings.customGoals = '咖啡=19\n午饭=abc';
  assert.match(app.goalText(dayAt(10)), /早餐豆浆和包子/);
});

test('custom goals are saved, restored and invalid entries warn', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.openSettings();
  env.elements.inSalary.value = '8000';
  env.elements.inMonthHours.value = '174';
  env.elements.inDayHours.value = '8';
  env.elements.inEndTime.value = '18:00';
  env.elements.inMask.checked = true;
  env.elements.inMotion.checked = true;
  env.elements.inMiniMode.value = 'always';
  env.elements.inGoals.value = '冰美式=19\n午饭=45\n电影=72';
  app.saveSettings();
  assert.equal(app.bank.settings.customGoals, '冰美式=19\n午饭=45\n电影=72');
  assert.equal(JSON.parse(env.files[app.appPath('workbank.json')]).settings.customGoals, '冰美式=19\n午饭=45\n电影=72');
  app.openSettings();
  assert.equal(env.elements.inGoals.value, '冰美式=19\n午饭=45\n电影=72');
  env.elements.inSalary.value = '8000';
  env.elements.inMonthHours.value = '174';
  env.elements.inDayHours.value = '8';
  env.elements.inEndTime.value = '18:00';
  env.elements.inMask.checked = true;
  env.elements.inMotion.checked = true;
  env.elements.inMiniMode.value = 'always';
  env.elements.inGoals.value = '只有一行=10';
  app.saveSettings();
  assert.match(env.elements.toast.innerText, /3 个有效项/);
});

test('manual records remain separate from active, amount, overtime and survive reload', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  const today = app.bankDate(Date.now());
  app.bank.days[today] = sampleDay(3600);
  const amount = app.bankDayAmount(app.bank.days[today]);
  app.openManual();
  env.elements.manualMinutes.value = '90';
  env.elements.manualKind.value = '会议';
  assert.equal(app.saveManual(), true);
  assert.equal(app.bank.days[today].activeSeconds, 3600);
  assert.equal(app.bankDayAmount(app.bank.days[today]), amount);
  assert.equal(app.bankOvertime(app.bank.days[today]), 0);
  assert.equal(app.bankManualMinutes(app.bank.days[today]), 90);
  const restored = runtime(env.files).context;
  restored.loadBank();
  assert.equal(restored.bank.days[today].manualEntries[0].kind, '会议');
  assert.equal(restored.bankManualMinutes(restored.bank.days[today]), 90);
  assert.equal(restored.bankDayAmount(restored.bank.days[today]), amount);
  assert.equal(app.deleteManual(today, 0), true);
  assert.equal(app.bankManualMinutes(app.bank.days[today]), 0);
  assert.equal(app.bank.days[today].activeSeconds, 3600);
});

test('manual records validate dates, totals and roll back when saving fails', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.openManual();
  env.elements.manualDate.value = '2024-02-30';
  env.elements.manualMinutes.value = '30';
  assert.equal(app.saveManual(), false);
  env.elements.manualDate.value = app.bankDate(Date.now());
  env.elements.manualMinutes.value = '1.5';
  assert.equal(app.saveManual(), false);
  env.elements.manualMinutes.value = '1441';
  assert.equal(app.saveManual(), false);
  env.elements.manualMinutes.value = '30';
  env.fso.failWrites = true;
  assert.equal(app.saveManual(), false);
  assert.equal(app.bank.days[env.elements.manualDate.value], undefined);
  env.fso.failWrites = false;
  assert.equal(app.saveManual(), true);
  env.fso.failWrites = true;
  assert.equal(app.deleteManual(env.elements.manualDate.value, 0), false);
  assert.equal(app.bankManualMinutes(app.bank.days[env.elements.manualDate.value]), 30);
});

test('manual-only days do not increase active-day counts, and malformed entries cannot be loaded', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.openManual();
  env.elements.manualMinutes.value = '40';
  assert.equal(app.saveManual(), true);
  const today = app.bankDate(Date.now());
  assert.equal(app.bankMonth(app.bank.days, today.slice(0, 7)).days, 0);
  const invalid = JSON.parse(env.files[app.appPath('workbank.json')]);
  invalid.days[today].manualEntries[0].minutes = -1;
  assert.equal(app.parseBank(JSON.stringify(invalid)), null);
});

test('deleting a manual entry preserves pre-existing empty day data', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  const today = app.bankDate(Date.now());
  app.bank.days[today] = { ...sampleDay(0), note: 'preserve existing fields' };
  app.openManual();
  env.elements.manualMinutes.value = '20';
  assert.equal(app.saveManual(), true);
  assert.equal(app.deleteManual(today, 0), true);
  assert.equal(app.bank.days[today].note, 'preserve existing fields');
});

test('history month view includes daily bars and separate manual totals', () => {
  const { context: app, elements } = runtime();
  app.bank.settings = { ...settings };
  app.bank.days['2024-02-10'] = { ...sampleDay(7200), manualEntries: [{ minutes: 30, kind: '会议' }] };
  app.historySelectedMonth = '2024-02';
  app.renderHistory();
  assert.equal((elements.monthChart.innerHTML.match(/class='month-bar'/g) || []).length, 29);
  assert.match(elements.monthChart.innerHTML, /2024-02-10 活跃 02:00:00/);
  assert.match(elements.historyBody.innerHTML, /00:30:00/);
  assert.match(elements.historyBody.innerHTML, /\*\*\*\*/);
  app.moveHistoryMonth(-1);
  assert.equal(app.historySelectedMonth, '2024-01');
  assert.doesNotMatch(elements.historyBody.innerHTML, /2024-02-10/);
});

test('custom goal input reports invalid, duplicate and merged items live', () => {
  const env = runtime(), app = env.context;
  env.elements.inGoals.value = '咖啡=19\n无效\n早餐=19\n午饭=20\n电影=72';
  env.elements.inGoals.oninput();
  assert.match(env.elements.goalValidation.innerText, /已识别 3 项，忽略 2 行/);
  assert.match(env.elements.goalValidation.innerText, /1 项会合并/);
  env.elements.inGoals.value = '一项=9';
  env.elements.inGoals.onkeyup();
  assert.match(env.elements.goalValidation.innerText, /不足 3 项/);
});

test('automatic start is opt-in and does not count time before launch', () => {
  const first = runtime();
  first.context.bank.settings = { ...settings, autoStart: true };
  assert.equal(first.context.saveBank(), true);
  const restored = runtime(first.files), app = restored.context;
  let monitorStarts = 0;
  app.startMonitor = () => { monitorStarts++; };
  app.startPet = () => true;
  const before = Date.now();
  app.window.onload();
  assert.equal(app.tracking, true);
  assert.equal(monitorStarts, 1);
  assert.ok(app.lastTick >= before);
  assert.equal(app.bank.days[app.bankDate(Date.now())], undefined);
  app.openSettings();
  assert.equal(restored.elements.inAutoStart.checked, true);
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

test('panel anchors beside the pet and stays within the work area', () => {
  const { context: app } = runtime();
  const pet = { x: 1800, y: 900, width: 180, height: 240, workLeft: 0, workTop: 0, workRight: 1920, workBottom: 1080 };
  const primary = app.bankPanelBounds(pet, 530, 720, 12);
  assert.equal(primary.x, 1258);
  assert.equal(primary.y, 360);
  assert.equal(app.bankPanelBounds({ ...pet, x: 100 }, 530, 720, 12).x, 292);
  assert.equal(app.bankPanelBounds({ ...pet, y: 700, workBottom: 900 }, 530, 720, 12).y, 180);
  assert.equal(app.bankPanelBounds({ ...pet, x: 10, workRight: 400 }, 530, 720, 12).x, 0);
});

test('opening the panel places it beside the pet and follows the pet', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.petRunning = true;
  app.petControlPath = 'C:\\Temp\\control';
  app.petPosPath = 'C:\\Temp\\pos';
  env.files[app.petPosPath] = '1600|800|180|240|0|0|1920|1080';
  app.handlePetEvent('show');
  assert.equal(app.petPanelVisible, true);
  assert.equal(env.files[app.petControlPath], 'show|1058|320');
  env.files[app.petPosPath] = '1200|700|180|240|0|0|1920|1080';
  const movesSoFar = env.moves.length;
  app.followPet();
  assert.equal(env.moves.length, movesSoFar + 1, 'moves once for the new pet position');
  assert.equal(env.moves[env.moves.length - 1].x, 658);
  assert.equal(env.moves[env.moves.length - 1].y, 220);
  const afterMove = env.moves.length;
  app.followPet();
  assert.equal(env.moves.length, afterMove, 'no redundant moves while the pet stays put');
  app.handlePetEvent('hide');
  assert.equal(app.petPanelVisible, false);
  assert.equal(env.files[app.petControlPath], 'hide', 'a late expand command cannot leave the window open');
});

test('window chrome colours follow the theme palette', () => {
  const { context: app } = runtime();
  assert.equal(app.chromeColor('#0a1424'), 0x24140a);
  assert.equal(app.chromeColor('#f2ebdd'), 0xddebf2);
  assert.equal(app.chromeColor('#2b4a6e'), 0x6e4a2b);
});

test('theme switches between deep sea and apron paper and persists', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.setTheme('cream', true);
  assert.equal(app.bank.settings.theme, 'cream');
  assert.match(app.document.body.className, /theme-cream/);
  assert.equal(JSON.parse(env.files[app.appPath('workbank.json')]).settings.theme, 'cream');
  app.openSettings();
  assert.match(env.elements.segCream.className, /on/);
  env.elements.inSalary.value = '8000';
  env.elements.inMonthHours.value = '174';
  env.elements.inDayHours.value = '8';
  env.elements.inEndTime.value = '18:00';
  env.elements.inMask.checked = true;
  app.saveSettings();
  assert.equal(app.bank.settings.theme, 'cream');
  app.setTheme('deep', true);
  assert.match(app.document.body.className, /theme-deep/);
});

test('mini info modes migrate old settings and persist', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.openSettings();
  assert.equal(env.elements.inMiniMode.value, 'always', 'existing settings keep the new card by default');
  env.elements.inSalary.value = '8000';
  env.elements.inMonthHours.value = '174';
  env.elements.inDayHours.value = '8';
  env.elements.inEndTime.value = '18:00';
  env.elements.inMask.checked = true;
  env.elements.inMotion.checked = true;
  env.elements.inMiniMode.value = 'off';
  app.saveSettings();
  assert.equal(app.bank.settings.miniMode, 'off');
  assert.equal(JSON.parse(env.files[app.appPath('workbank.json')]).settings.miniMode, 'off');
  app.openSettings();
  assert.equal(env.elements.inMiniMode.value, 'off');
  app.bank.settings = { ...settings, miniInfo: false };
  app.openSettings();
  assert.equal(env.elements.inMiniMode.value, 'off', 'legacy disabled setting migrates to off');
  env.elements.inMiniMode.value = 'hover';
  app.saveSettings();
  assert.equal(app.bank.settings.miniMode, 'hover');
});

test('pet state carries panel visibility, mini progress and a masked tooltip', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.tracking = true;
  app.monitorReady = true;
  app.monitorIdle = false;
  app.masked = true;
  app.petStatePath = 'C:\\Temp\\state';
  app.petRunning = true;
  app.petPanelVisible = true;
  app.bank.days[app.bankDate(Date.now())] = sampleDay(3600);
  app.petLastState = '';
  app.writePetState();
  const parts = env.files[app.petStatePath].split('|');
  assert.ok(['active', 'overtime', 'urgent'].includes(parts[0]));
  assert.equal(parts[2], '1');
  assert.equal(parts[3], '1');
  assert.equal(parts[4], '0', 'the mini card stays hidden while the full panel is open');
  assert.equal(parts[5], 'deep');
  assert.equal(parts[6], '12');
  assert.equal(parts[7], '¥ ****');
  assert.equal(parts[8], '1.00 / 8.00 小时');
  assert.match(parts.slice(9).join('|'), /¥ \*\*\*\*/);
  app.petPanelVisible = false;
  app.petLastState = '';
  app.writePetState();
  assert.equal(env.files[app.petStatePath].split('|')[4], '1', 'the mini card follows a hidden panel');
  app.bank.settings.miniInfo = false;
  app.petLastState = '';
  app.writePetState();
  assert.equal(env.files[app.petStatePath].split('|')[4], '0', 'the mini card can be switched off');
  app.bank.settings.miniInfo = true;
  app.bank.settings.miniMode = 'hover';
  app.petLastState = '';
  app.writePetState();
  assert.equal(env.files[app.petStatePath].split('|')[4], '2', 'hover mode is sent to the pet');
  app.bank.settings.miniMode = 'always';
  app.theme = 'cream';
  app.petLastState = '';
  app.writePetState();
  assert.equal(env.files[app.petStatePath].split('|')[5], 'cream');
  app.masked = false;
  app.petLastState = '';
  app.writePetState();
  assert.match(env.files[app.petStatePath], /¥ 45\.9770/);
});

test('milestones announce once at half, near-full and full', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.tracking = true;
  app.monitorReady = true;
  const today = app.bankDate(Date.now());
  app.bank.days[today] = sampleDay(3.9 * 3600);
  app.render(Date.now());
  assert.notEqual(app.$id('toast').className, 'toast');
  app.bank.days[today].activeSeconds = 4.1 * 3600;
  app.render(Date.now());
  assert.match(app.$id('toast').innerText, /一半/);
  app.bank.days[today].activeSeconds = 7.3 * 3600;
  app.render(Date.now());
  assert.match(app.$id('toast').innerText, /接近计划工时/);
  app.bank.days[today].activeSeconds = 8.1 * 3600;
  app.render(Date.now());
  assert.match(app.$id('toast').innerText, /计划工时已满/);
});

test('signing off celebrates on the pet before settling to paused', () => {
  const { context: app } = runtime();
  app.bank.settings = { ...settings };
  app.bank.days[app.bankDate(Date.now())] = sampleDay();
  app.signOff();
  assert.equal(app.petState(), 'celebrate');
  app.celebrateUntil = Date.now() - 1;
  assert.equal(app.petState(), 'paused');
});

test('first run keeps the settings panel visible after the pet starts', () => {
  const env = runtime(), app = env.context;
  app.petStarting = true;
  app.petStarted = Date.now();
  app.petLastHeartbeat = Date.now();
  app.petAlivePath = 'C:\\Temp\\alive';
  app.petReadyPath = 'C:\\Temp\\ready';
  app.petControlPath = 'C:\\Temp\\control';
  env.files[app.petAlivePath] = 'alive';
  env.files[app.petReadyPath] = 'ready|123';
  app.petTick();
  assert.equal(app.petPanelVisible, true);
  assert.equal(app.petRunning, true);
  assert.equal(env.files[app.petControlPath], 'show');
});
