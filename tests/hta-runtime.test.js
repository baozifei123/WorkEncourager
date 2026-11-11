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
  const confirms = [];
  const commands = [];
  const execProcesses = [];
  const timers = Object.create(null);
  let nextTimer = 0, confirmResult = true;
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
    CreateTextFile(name, overwrite) {
      if (!overwrite && Object.hasOwn(files, name)) throw new Error('file already exists');
      return { Write(value) { files[name] = value; }, Close() {} };
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
      if (name === 'WScript.Shell') return {
        ExpandEnvironmentStrings(value) { return value.indexOf('%SystemRoot%') >= 0 ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' : 'powershell.exe'; },
        SpecialFolders(name) { return name === 'Startup' ? 'C:\\Users\\tester\\Startup' : 'C:\\Users\\tester\\Documents'; },
        CreateShortcut(shortcutPath) {
          const saved = Object.hasOwn(files, shortcutPath) ? JSON.parse(files[shortcutPath]) : {};
          return Object.assign(saved, { Save() { files[shortcutPath] = JSON.stringify(saved); } });
        },
        Run(command) { commands.push(command); },
        Exec(command) {
          commands.push(command);
          const process = { Status: 1, terminated: false, Terminate() { this.terminated = true; } };
          execProcesses.push(process);
          return process;
        }
      };
      throw new Error('unexpected ActiveX: ' + name);
    },
    alert(message) { alerts.push(message); }, confirm(message) { confirms.push(message); return confirmResult; }, setInterval() {},
    setTimeout(callback, delay) { const id = ++nextTimer; timers[id] = { callback, delay }; return id; },
    clearTimeout(id) { delete timers[id]; }
  });
  scripts.forEach(script => vm.runInContext(script, context));
  return {
    context, files, fso, elements, alerts, confirms, commands, moves, timers, execProcesses,
    setConfirmResult(value) { confirmResult = value; },
    fireTimer(id) { const timer = timers[id]; if (!timer) return false; delete timers[id]; timer.callback(); return true; }
  };
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

test('login startup is opt-in, idempotent, local to the user, and never overwrites foreign shortcuts', () => {
  const env = runtime(), app = env.context;
  const link = 'C:\\Users\\tester\\Startup\\WorkEncourager-WorkBank.lnk';
  assert.equal(app.setWindowsAutostart(false), true);
  assert.equal(env.files[link], undefined);
  assert.equal(app.setWindowsAutostart(true), true);
  const created = JSON.parse(env.files[link]);
  assert.equal(created.Description, app.STARTUP_LINK_MARKER);
  assert.equal(created.TargetPath, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(created.Arguments, '"C:\\Projects\\工时\\上班鼓励器.hta"');
  assert.equal(app.setWindowsAutostart(true), true, 'an owned link is safe to reconcile on later launches');
  assert.equal(app.setWindowsAutostart(false), true);
  assert.equal(env.files[link], undefined, 'disable removes the exact app-owned shortcut');

  env.files[link] = JSON.stringify({ Description: 'A shortcut created by the user', TargetPath: 'C:\\Other\\app.exe', Arguments: '' });
  const foreign = env.files[link];
  assert.equal(app.setWindowsAutostart(true), false);
  assert.equal(app.setWindowsAutostart(false), false);
  assert.equal(env.files[link], foreign, 'foreign shortcuts are neither replaced nor deleted');
});

test('settings keep login launch, tracking auto-start, and lock policy independent', () => {
  const env = runtime(), app = env.context, elements = env.elements;
  app.bank.settings = { ...settings };
  app.openSettings();
  assert.equal(elements.inAutoLaunch.checked, false);
  assert.equal(elements.inAutoStart.checked, false);
  assert.equal(elements.inLockMode.value, 'off');
  assert.equal(elements.inMaskTimeout.value, '0');
  assert.equal(elements.inRestReminder.value, '0');
  elements.inSalary.value = '8000';
  elements.inMonthHours.value = '174';
  elements.inDayHours.value = '8';
  elements.inEndTime.value = '18:00';
  elements.inAutoLaunch.checked = true;
  elements.inAutoStart.checked = false;
  elements.inLockMode.value = 'manual';
  elements.inMaskTimeout.value = '30';
  elements.inRestReminder.value = '60';
  app.saveSettings();
  assert.equal(app.bank.settings.autoLaunch, true);
  assert.equal(app.bank.settings.autoStart, false);
  assert.equal(app.bank.settings.lockMode, 'manual');
  assert.equal(app.bank.settings.maskTimeoutSeconds, 30);
  assert.equal(app.bank.settings.restReminderMinutes, 60);
  const saved = JSON.parse(env.files[app.appPath('workbank.json')]).settings;
  assert.equal(saved.autoLaunch, true);
  assert.equal(saved.autoStart, false);
  assert.equal(saved.lockMode, 'manual');
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

test('hiding and restoring the panel leaves recording and the pet running', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.petRunning = true;
  app.petControlPath = 'C:\\Temp\\control';
  app.tracking = true;
  app.handlePetEvent('hide');
  assert.equal(app.petPanelVisible, false);
  assert.equal(env.files[app.petControlPath], 'hide');
  assert.equal(app.tracking, true);
  assert.equal(app.petRunning, true);
  app.handlePetEvent('show');
  assert.equal(app.petPanelVisible, true);
  assert.equal(env.files[app.petControlPath], 'show');
  assert.equal(app.tracking, true);
  assert.equal(app.petRunning, true);
  app.tracking = false;
  app.handlePetEvent('hide');
  app.handlePetEvent('show');
  assert.equal(app.tracking, false, 'restoring the panel must not start a paused timer');
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
  assert.ok(env.commands.some(command => /WorkBankRecovery/.test(command) && /!IsWindowVisible\(h\)\|\|IsIconic\(h\)/.test(command)), 'restore a hidden or minimized panel after the pet dies');
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

test('earnings labels describe estimates while CSV keeps its existing column name', () => {
  assert.ok(source.includes('<div class="label">今 日 赚 到</div>'), 'daily amount label');
  assert.ok(source.includes('<div class="stat-label">本月赚到</div>'), 'monthly amount label');
  assert.ok(source.includes('<h3>今日赚到记录</h3>'), 'receipt title');
  assert.ok(source.includes('<tr><td>今日赚到</td><td id="receiptAmount">'), 'receipt daily label');
  assert.ok(source.includes('<tr><td>本月赚到</td><td id="receiptMonth">'), 'receipt monthly label');
  assert.ok(source.includes('<th>赚到</th>'), 'history column');
  assert.ok(source.includes('赚到金额按活跃工时估算，仅供参考，不代表实际工资或加班费'), 'estimate disclaimer');
  assert.ok(source.includes('每一次认真投入，都值得被看见'), 'non-monetary wording stays unchanged');

  const { context: app, elements } = runtime();
  app.bank.settings = { ...settings };
  app.bank.days[app.bankDate(Date.now())] = sampleDay();
  app.masked = false;
  app.render(Date.now());
  assert.match(elements.todayAmount.attributes['aria-label'], /^今日赚到 ¥ 45\.9770/);
  assert.match(elements.monthAmount.attributes['aria-label'], /^本月赚到 ¥ 45\.98/);
  assert.match(elements.bankCard.title, /今日赚到 ¥ 45\.9770/);
  assert.match(app.petTip(), /今日赚到 ¥ 45\.9770/);
  assert.match(app.bankCsvText(app.bank), /"当日投入（元）"/);

  app.masked = true;
  app.render(Date.now());
  assert.match(elements.todayAmount.attributes['aria-label'], /^今日赚到 ¥ \*\*\*\*/);
  assert.match(app.petTip(), /今日赚到 ¥ \*\*\*\*/);
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
  assert.equal(elements.energyMeter.className, 'energy overtime paused', 'idle freezes the bar without losing the burn stage');
  app.bank.settings.motion = false;
  app.render(Date.now());
  assert.match(app.document.body.className, /motion-off/);
  assert.ok(source.includes('heatSweep') && source.includes('heatWave') && source.includes('heat-haze') &&
    source.includes('frostShimmer') && source.includes('burn-layer') && source.includes('frost-layer'),
    'heat should flow and rise as waves while cold stays frozen inside the bar');
  assert.ok(source.includes('burn-lightning') && source.includes('burnEdgeTop') && source.includes('burnEdgeBottom') &&
    source.includes('updateBurnEdges') && source.includes('burn-wisp') && source.includes('burn-ember'),
    'the burning bar should draw irregular lightning and soft flame wisps along both edges');
  assert.ok(source.includes('frost-arcs') && source.includes('frostArcPulse') && source.includes('coolSweep') &&
    source.includes('warmSweep') && source.includes('hotSweep') && source.includes('stage-tip') && source.includes('tipPulse'),
    'lower stages should have gentle moving sheens and frozen should have frost arcs');
  assert.match(source, /\.motion-off \.energy \.fill:after[^\{]*\{ animation: none; \}/,
    'turning motion off must override the active heat and frost animations');
  assert.ok(!source.includes('heat-crown') && !source.includes('heatLick') && !source.includes('flame-icon') &&
    !source.includes('emberRise') && !source.includes('frostSway') && !source.includes('burn-flames'),
    'the former cartoon flame, ember and snowflake symbols must not return');
  assert.ok(!source.includes('energyFlow') && !source.includes('repeating-linear-gradient(115deg'),
    'the bar must not fall back to regular diagonal hatching');
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

test('clicking the amount switches privacy everywhere without changing its default setting', () => {
  const env = runtime(), app = env.context, elements = env.elements;
  app.bank.settings = { ...settings, maskByDefault: true };
  app.bank.days[app.bankDate(Date.now())] = sampleDay();
  app.petStatePath = 'C:\\Temp\\state';
  app.petRunning = true;
  app.petPanelVisible = false;
  app.render(Date.now());
  assert.match(elements.todayAmount.innerText, /\*\*\*\*/);
  elements.todayAmount.onclick();
  assert.equal(app.masked, false);
  assert.match(elements.todayAmount.innerText, /45\.9770/);
  assert.match(env.files[app.petStatePath], /45\.9770/);
  assert.equal(elements.todayAmount.attributes['aria-pressed'], 'false');
  app.showHistory();
  app.signOff();
  assert.doesNotMatch(elements.receiptAmount.innerText, /\*\*\*\*/);
  elements.todayAmount.onclick();
  assert.equal(app.masked, true);
  assert.match(elements.todayAmount.innerText, /\*\*\*\*/);
  assert.match(elements.receiptAmount.innerText, /\*\*\*\*/);
  assert.match(elements.historyBody.innerHTML, /\*\*\*\*/);
  assert.match(env.files[app.petStatePath], /\*\*\*\*/);
  assert.equal(elements.todayAmount.attributes['aria-pressed'], 'true');
  assert.equal(app.bank.settings.maskByDefault, true);
  elements.btnPrivacy.onclick();
  assert.equal(app.masked, false, 'the existing privacy button shares the same toggle');
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

test('switching to daily pay revalues only today and keeps monthly and schedule choices', () => {
  const env = runtime(), app = env.context, e = env.elements;
  const today = app.bankDate(Date.now());
  const d = new Date(), previousDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  const yesterday = app.bankDate(previousDate.getTime());
  app.bank.settings = { ...settings };
  app.bank.days[today] = sampleDay(4 * 3600);
  app.bank.days[yesterday] = sampleDay(8 * 3600);
  const history = JSON.stringify(app.bank.days[yesterday]);
  app.openSettings();
  e.inCalculationMode.value = 'days';
  e.inCalculationMode.onchange();
  assert.doesNotMatch(e.dayModeFields.className, /hidden/);
  assert.match(e.monthHoursField.className, /hidden/);
  e.inPaidDays.value = '20';
  e.inNextPaidDays.value = '21.75';
  e.inOverrideDate.value = today;
  e.inOverrideHours.value = '6';
  e.btnSetOverride.onclick();
  assert.equal(app.draftDayOverrides[today], 6);
  assert.match(e.overrideSummary.innerText, /今天：6 小时/, 'newly added exceptions must be visible before saving');
  app.saveSettings();
  assert.match(env.confirms[0], /重新计算今天/);
  assert.equal(app.bank.settings.calculationMode, 'days');
  assert.equal(app.bank.settings.paidDaysByMonth[today.substring(0, 7)], 20);
  assert.equal(app.bank.settings.paidDaysByMonth[app.bankNextMonthKey(today.substring(0, 7))], 21.75);
  assert.equal(app.bank.settings.dayOverrides[today], 6);
  assert.equal(app.bank.days[today].dayHours, 6);
  assert.ok(Math.abs(app.bank.days[today].hourlyRate - 400 / 6) < 1e-10);
  assert.ok(Math.abs(app.bankDayAmount(app.bank.days[today]) - 400 * 4 / 6) < 1e-10);
  assert.equal(JSON.stringify(app.bank.days[yesterday]), history, 'earlier records remain byte-for-byte unchanged');
  const saved = JSON.parse(env.files[app.appPath('workbank.json')]);
  assert.equal(saved.days[today].calculationMode, 'days');
  assert.equal(saved.days[today].paidDays, 20);
  assert.equal(saved.days[today].dailyAmount, 400);
  const reloaded = runtime(env.files).context;
  reloaded.loadBank();
  assert.equal(reloaded.fatalStorage, false);
  assert.equal(reloaded.bank.days[today].dayHours, 6);
  reloaded.openSettings();
  assert.equal(reloaded.$id('inCalculationMode').value, 'days');
  assert.equal(reloaded.$id('inPaidDays').value, '20');
  assert.equal(reloaded.$id('inOverrideHours').value, '6');
  reloaded.$id('inCalculationMode').value = 'hours';
  reloaded.saveSettings();
  assert.equal(reloaded.bank.settings.calculationMode, 'hours');
  assert.equal(reloaded.bank.days[today].dayHours, 8);
  assert.ok(Math.abs(reloaded.bank.days[today].hourlyRate - 8000 / 174) < 1e-10);
  assert.equal(reloaded.bank.settings.dayOverrides[today], 6, 'day-mode choices are retained for a future switch back');
  assert.equal(JSON.stringify(reloaded.bank.days[yesterday]), history);
});

test('cancelled mode changes and failed saves leave settings and today snapshot intact', () => {
  const env = runtime(), app = env.context, e = env.elements;
  const today = app.bankDate(Date.now());
  app.bank.settings = { ...settings };
  app.bank.days[today] = sampleDay(3600);
  const originalSettings = JSON.stringify(app.bank.settings), originalDay = JSON.stringify(app.bank.days[today]);
  app.openSettings();
  e.inCalculationMode.value = 'days';
  e.inPaidDays.value = '20';
  env.setConfirmResult(false);
  app.saveSettings();
  assert.equal(JSON.stringify(app.bank.settings), originalSettings);
  assert.equal(JSON.stringify(app.bank.days[today]), originalDay);
  assert.equal(e.settingsModal.className, 'modal', 'a declined confirmation leaves the draft open');
  env.setConfirmResult(true);
  env.fso.failWrites = true;
  app.saveSettings();
  assert.equal(JSON.stringify(app.bank.settings), originalSettings);
  assert.equal(JSON.stringify(app.bank.days[today]), originalDay, 'all calculation metadata rolls back after a failed save');
});

test('rest days show zero investment and count active time as overtime without NaN', () => {
  const env = runtime(), app = env.context, e = env.elements;
  const today = app.bankDate(Date.now()), month = today.substring(0, 7);
  app.bank.settings = { ...settings, calculationMode: 'days', paidDaysByMonth: { [month]: 20 },
    weekHours: [0, 8, 8, 8, 8, 8, 0], dayOverrides: { [today]: 0 } };
  app.tracking = true;
  app.monitorReady = true;
  app.monitorIdle = false;
  app.petRunning = true;
  app.petStatePath = 'C:\\Temp\\rest-state';
  app.render(Date.now());
  assert.match(e.progressText.innerText, /休息日/);
  assert.doesNotMatch(e.progressText.innerText, /NaN|Infinity/);
  assert.equal(app.bankDayAmount(app.currentDay(Date.now())), 0);
  app.writePetState();
  assert.equal(env.files[app.petStatePath].split('|')[0], 'rest');
  assert.doesNotMatch(env.files[app.petStatePath], /NaN|Infinity/);
  const date = new Date();
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTime();
  app.addActivity(noon, noon + 3600000);
  const day = app.bank.days[today];
  assert.equal(day.dayHours, 0);
  assert.equal(day.hourlyRate, 0);
  assert.equal(app.bankDayAmount(day), 0);
  assert.equal(app.bankOvertime(day), 3600);
  assert.ok(app.parseBank(JSON.stringify(app.bank)), 'rest-day snapshots are accepted by the loader');
  app.render(Date.now());
  assert.equal(env.elements.progressFill.style.width, '100%', 'all rest-day activity is overtime, so the bar is full');
  assert.match(env.elements.energyMeter.className, /energy overtime/, 'rest-day overtime must burn like a full work day');
  app.petLastState = '';
  app.writePetState();
  const restFields = env.files[app.petStatePath].split('|');
  assert.equal(restFields[0], 'overtime');
  assert.equal(restFields[6], '100');
});

test('missing paid days pause recording without fabricating hours or discarding earlier days', () => {
  const env = runtime(), app = env.context;
  const today = app.bankDate(Date.now()), earlier = '2020-01-01';
  app.bank.settings = { ...settings, calculationMode: 'days', paidDaysByMonth: {},
    weekHours: [0, 8, 8, 8, 8, 8, 0], dayOverrides: {} };
  app.bank.days[earlier] = sampleDay();
  const before = JSON.stringify(app.bank.days[earlier]);
  app.tracking = true;
  app.monitorReady = true;
  app.stopMonitor = () => { app.monitorReady = false; };
  app.tick(true);
  assert.equal(app.tracking, false);
  assert.equal(app.bank.days[today], undefined);
  assert.equal(JSON.stringify(app.bank.days[earlier]), before);
  assert.match(env.elements.monitorText.innerText, /本月计薪天数未设置/);
  app.tracking = true;
  app.monitorReady = true;
  assert.equal(app.petState(), 'unconfigured');
  app.tracking = false;
  app.petRunning = true;
  app.petPanelVisible = false;
  app.petControlPath = 'C:\\Temp\\control';
  app.startTracking();
  assert.equal(app.tracking, false);
  assert.equal(app.petPanelVisible, true, 'settings must restore a collapsed panel before showing');
  assert.equal(env.files[app.petControlPath], 'show');
  assert.equal(env.elements.settingsModal.className, 'modal');
});

test('a month rollover into an unconfigured month keeps only the pre-midnight activity', () => {
  const env = runtime(), app = env.context;
  const boundary = new Date(2026, 11, 1, 0, 0, 0, 0).getTime();
  const now = boundary + 1000, lastTick = boundary - 1500;
  app.bank.settings = { ...settings, calculationMode: 'days', paidDaysByMonth: { '2026-11': 20 },
    weekHours: [0, 8, 8, 8, 8, 8, 0], dayOverrides: {} };
  app.tracking = true;
  app.monitorReady = true;
  app.sessionLocked = false;
  app.lastTick = lastTick;
  app.previousInput = lastTick - 1000;
  app.samplePath = 'C:\\Temp\\rollover.sample';
  env.files[app.samplePath] = now + '|0';
  app.stopMonitor = () => { app.monitorReady = false; };
  assert.equal(app.pauseForMissingPaidMonth(now), true);
  assert.equal(app.tracking, false);
  assert.equal(app.bank.days['2026-12-01'], undefined, 'no rate is invented for the new month');
  const kept = app.bank.days['2026-11-30'];
  assert.ok(kept, 'activity before midnight is kept under the old month');
  assert.equal(kept.activeSeconds, 1.5);
  assert.equal(kept.calculationMode, 'days');
  assert.equal(kept.dayHours, 8);
  const saved = JSON.parse(env.files[app.appPath('workbank.json')]);
  assert.equal(saved.days['2026-11-30'].activeSeconds, 1.5);
  assert.match(env.elements.toast.innerText, /本月计薪天数尚未设置/);
  assert.equal(app.currentDay(now).unconfigured, true);
});

test('date overrides reject the past and remain draft-only until settings are saved', () => {
  const env = runtime(), app = env.context, e = env.elements;
  const now = new Date(), today = app.bankDate(now.getTime());
  const yesterday = app.bankDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime());
  app.bank.settings = { ...settings };
  app.openSettings();
  e.inCalculationMode.value = 'days';
  e.inOverrideDate.value = yesterday;
  e.inOverrideHours.value = '6';
  e.btnSetOverride.onclick();
  assert.equal(app.draftDayOverrides[yesterday], undefined);
  assert.match(env.alerts[0], /今天或之后/);
  e.inOverrideDate.value = today;
  e.inOverrideHours.value = '';
  e.btnSetOverride.onclick();
  assert.equal(app.draftDayOverrides[today], undefined, 'blank is not silently interpreted as a rest day');
  e.inOverrideHours.value = '0';
  e.btnSetOverride.onclick();
  assert.equal(app.draftDayOverrides[today], 0);
  assert.equal(app.bank.settings.dayOverrides, undefined);
  e.btnClearOverride.onclick();
  assert.equal(app.draftDayOverrides[today], undefined);
});

test('a manual-only day is safely revalued when the day-based plan becomes available', () => {
  const env = runtime(), app = env.context, e = env.elements;
  const today = app.bankDate(Date.now()), month = today.substring(0, 7);
  app.bank.settings = { ...settings, calculationMode: 'days', paidDaysByMonth: {},
    weekHours: [8, 8, 8, 8, 8, 8, 8], dayOverrides: {} };
  app.openManual();
  e.manualMinutes.value = '30';
  e.manualKind.value = '会议';
  assert.equal(app.saveManual(), true);
  assert.equal(app.bank.days[today].manualOnly, true);
  assert.equal(app.bank.days[today].hourlyRate, 0);
  assert.ok(app.parseBank(JSON.stringify(app.bank)));
  app.bank.settings.paidDaysByMonth[month] = 20;
  const now = Date.now();
  app.addActivity(now - 1000, now);
  assert.equal(app.bank.days[today].manualOnly, undefined);
  assert.equal(app.bank.days[today].dayHours, 8);
  assert.equal(app.bank.days[today].hourlyRate, 50);
  assert.equal(app.bank.days[today].manualEntries[0].minutes, 30);
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
  assert.equal(app.chromeColor('#18303b'), 0x3b3018);
  assert.equal(app.THEME_DEFAULT_ALPHA.glass, 82);
  assert.equal(app.alphaByte(app.THEME_DEFAULT_ALPHA.glass), 209);
  assert.equal(app.alphaByte(100), 255);
  assert.equal(app.alphaByte(60), 153);
  assert.equal(app.normalizeTheme('glass'), 'glass');
  assert.equal(app.normalizeTheme('unknown'), 'deep');
});

test('theme switches between deep sea and apron paper and persists', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  app.setTheme('cream', true);
  assert.equal(app.bank.settings.theme, 'cream');
  assert.match(app.document.body.className, /theme-cream/);
  assert.equal(JSON.parse(env.files[app.appPath('workbank.json')]).settings.theme, 'cream');
  app.openSettings();
  assert.equal(app.pendingTheme, 'cream');
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

test('theme menu selects glass directly, persists, restores after reload, and cancels preview', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings, theme: 'cream' };
  app.setTheme('cream', false);
  env.elements.btnTheme.onclick({ cancelBubble: false });
  assert.equal(env.elements.themeMenu.className, 'theme-menu');
  env.elements.themePickGlass.onclick();
  assert.equal(app.theme, 'glass');
  assert.match(app.document.body.className, /theme-glass/);
  assert.equal(env.elements.themeMenu.className, 'theme-menu hidden');
  assert.equal(JSON.parse(env.files[app.appPath('workbank.json')]).settings.theme, 'glass');
  const restored = runtime(env.files), next = restored.context;
  next.loadBank();
  assert.equal(next.theme, 'glass');
  next.openSettings();
  assert.equal(next.pendingTheme, 'glass');
  restored.elements.btnCancelSettings.onclick();
  assert.equal(next.theme, 'glass');
  restored.elements.btnTheme.onclick({ cancelBubble: false });
  restored.elements.themePickDeep.onclick();
  assert.equal(next.theme, 'deep');
  assert.equal(JSON.parse(env.files[app.appPath('workbank.json')]).settings.theme, 'deep');
});

test('theme menu marks the current theme, toggles, and closes on outside click or Escape', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings, theme: 'cream' };
  app.setTheme('cream', false);
  env.elements.btnTheme.onclick({ cancelBubble: false });
  assert.equal(env.elements.themeMenu.className, 'theme-menu');
  assert.match(env.elements.themePickCream.className, /on/);
  assert.doesNotMatch(env.elements.themePickDeep.className, /on/);
  env.elements.btnTheme.onclick({ cancelBubble: false });
  assert.equal(env.elements.themeMenu.className, 'theme-menu hidden', 'second click closes the menu');
  env.elements.btnTheme.onclick({ cancelBubble: false });
  app.document.onclick({ target: env.elements.bankCard });
  assert.equal(env.elements.themeMenu.className, 'theme-menu hidden', 'outside click closes the menu');
  env.elements.btnTheme.onclick({ cancelBubble: false });
  app.handleShortcut({ keyCode: 27, preventDefault() {}, returnValue: true });
  assert.equal(env.elements.themeMenu.className, 'theme-menu hidden', 'Escape closes the menu');
});

test('each theme remembers the opacity edited in settings', () => {
  const first = runtime(), seeded = first.context;
  seeded.bank.settings = { ...settings, theme: 'glass', themeAlpha: { deep: 100, cream: 90, glass: 70 } };
  assert.equal(seeded.saveBank(), true);

  const env = runtime(first.files), app = env.context, elements = env.elements;
  app.loadBank();
  assert.equal(app.theme, 'glass');
  assert.equal(app.activeAlpha, 70);
  assert.equal(app.savedThemeAlpha.cream, 90);
  app.openSettings();
  assert.equal(elements.inOpacity.value, '70');
  assert.equal(elements.opacityValue.innerText, '70%');
  elements.inOpacity.value = '63';
  elements.inOpacity.oninput();
  assert.equal(app.activeAlpha, 63);
  assert.equal(app.draftThemeAlpha.glass, 63);
  elements.btnCancelSettings.onclick();
  assert.equal(app.theme, 'glass');
  assert.equal(app.activeAlpha, 70);
  assert.equal(app.draftThemeAlpha.glass, 70);

  app.setTheme('cream', true);
  assert.equal(app.activeAlpha, 90, 'another theme uses its own saved opacity');
  app.openSettings();
  assert.equal(elements.inOpacity.value, '90');
  elements.inOpacity.value = '64';
  elements.inOpacity.oninput();
  elements.inSalary.value = '8000';
  elements.inMonthHours.value = '174';
  elements.inDayHours.value = '8';
  elements.inEndTime.value = '18:00';
  elements.inMask.checked = true;
  app.saveSettings();
  assert.equal(app.bank.settings.theme, 'cream');
  assert.equal(app.bank.settings.themeAlpha.cream, 64);
  assert.equal(app.activeAlpha, 64);
  const stored = JSON.parse(env.files[app.appPath('workbank.json')]).settings;
  assert.equal(stored.themeAlpha.cream, 64);
  assert.equal(stored.themeAlpha.glass, 70);

  const reloaded = runtime(env.files).context;
  reloaded.loadBank();
  assert.equal(reloaded.theme, 'cream');
  assert.equal(reloaded.activeAlpha, 64);
});

test('opacity defaults and out-of-range values are sanitised', () => {
  const { context: app } = runtime();
  const defaults = app.bankThemeAlpha(null);
  assert.equal(defaults.deep, 100);
  assert.equal(defaults.cream, 100);
  assert.equal(defaults.glass, 82);
  assert.equal(app.clampAlpha(59, 100), 60);
  assert.equal(app.clampAlpha(101, 88), 100);
  assert.equal(app.clampAlpha('bad', 88), 88);
  assert.equal(app.clampAlpha(null, 87), 87);
  const stored = app.bankThemeAlpha({ themeAlpha: { deep: 61, cream: 'bad', glass: 120 } });
  assert.equal(stored.deep, 61);
  assert.equal(stored.cream, 100);
  assert.equal(stored.glass, 100);
});

test('keyboard shortcuts close dialogs, mask amounts, toggle tracking, and hide via the pet', () => {
  const env = runtime(), app = env.context, elements = env.elements;
  app.bank.settings = { ...settings, theme: 'glass', themeAlpha: { deep: 100, cream: 100, glass: 75 } };
  app.savedThemeAlpha = app.bankThemeAlpha(app.bank.settings);
  app.setTheme('glass', false);
  app.openSettings();
  elements.inOpacity.value = '100';
  elements.inOpacity.oninput();
  assert.equal(app.activeAlpha, 100);
  const esc = { keyCode: 27, altKey: false, target: { tagName: 'INPUT' }, preventDefault() { this.prevented = true; } };
  assert.equal(app.handleShortcut(esc), false);
  assert.equal(elements.settingsModal.className, 'modal hidden');
  assert.equal(app.theme, 'glass');
  assert.equal(app.activeAlpha, 75);
  assert.equal(esc.prevented, true);

  app.bank.days[app.bankDate(Date.now())] = sampleDay();
  app.render(Date.now());
  assert.equal(app.masked, true);
  const maskKey = { keyCode: 77, altKey: true, target: { tagName: 'BODY' }, preventDefault() {} };
  assert.equal(app.handleShortcut(maskKey), false);
  assert.equal(app.masked, false);

  app.startMonitor = () => {};
  const trackKey = { keyCode: 84, altKey: true, target: { tagName: 'BODY' }, preventDefault() {} };
  app.handleShortcut(trackKey);
  assert.equal(app.tracking, true);
  app.handleShortcut(trackKey);
  assert.equal(app.tracking, false);

  app.petControlPath = 'C:\\Temp\\control';
  app.petRunning = true;
  const hideKey = { keyCode: 72, altKey: true, target: { tagName: 'BODY' }, preventDefault() {} };
  app.handleShortcut(hideKey);
  assert.equal(env.files[app.petControlPath], 'hide');
  assert.equal(app.petPanelVisible, false);

  const typed = { keyCode: 77, altKey: true, target: { tagName: 'TEXTAREA' }, preventDefault() {} };
  const before = app.masked;
  app.handleShortcut(typed);
  assert.equal(app.masked, before, 'shortcuts typed into form fields are ignored');
});

test('mini card buttons and pet menu keep the persisted always, hover, and off modes in sync', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings, miniMode: 'always', miniInfo: true };
  app.petRunning = true;
  app.petEventsPath = 'C:\\Temp\\events';
  env.files[app.petEventsPath + '\\__folder'] = '';
  app.petStatePath = 'C:\\Temp\\state';
  app.petPanelVisible = true;
  app.handlePetEvent('mini-mode|hover');
  assert.equal(app.bank.settings.miniMode, 'hover');
  assert.equal(env.elements.inMiniMode.value, 'hover');
  app.writePetState();
  let fields = env.files[app.petStatePath].split('|');
  assert.equal(fields[4], '0', 'the collapsed card is hidden while the full panel is open');
  assert.equal(fields[9], 'hover', 'the preferred mode stays available to the mini-card controls and pet menu');
  assert.equal(fields[10], 'off', 'lock monitoring stays opt-in');
  app.petPanelVisible = false;
  app.petLastState = '';
  app.$id('settingsModal').className = 'modal';
  app.writePetState();
  assert.equal(env.files[app.petStatePath].split('|')[4], '0', 'an open dialog takes over from the mini card');
  app.$id('settingsModal').className = 'modal hidden';
  app.petLastState = '';
  app.writePetState();
  fields = env.files[app.petStatePath].split('|');
  assert.equal(fields[4], '2', 'hover mode is shown in the pet state');
  app.handlePetEvent('mini-mode|off');
  assert.equal(app.bank.settings.miniInfo, false);
  assert.equal(app.bank.settings.miniMode, 'off');
  app.handlePetEvent('mini-mode|always');
  assert.equal(app.bank.settings.miniInfo, true, 'the right-click menu can restore a hidden card');
  assert.equal(app.bank.settings.miniMode, 'always');
});

test('lock events pause only an active tracked session and follow the configured unlock policy', () => {
  const makeApp = mode => {
    const env = runtime(), app = env.context;
    app.bank.settings = { ...settings, lockMode: mode };
    app.bank.days[app.bankDate(Date.now())] = sampleDay(3600);
    app.tracking = true;
    app.monitorReady = true;
    app.sessionMonitorReady = true;
    app.startMonitor = () => { app.monitorReady = true; app.monitorIdle = false; };
    app.stopMonitor = () => { app.monitorReady = false; app.monitorIdle = false; };
    return { env, app };
  };
  const manual = makeApp('manual'), manualDay = manual.app.bank.days[manual.app.bankDate(Date.now())];
  const before = JSON.stringify(manual.app.bank.days);
  manual.app.handlePetEvent('session|locked');
  assert.equal(manual.app.sessionLocked, true);
  assert.equal(manual.app.tracking, false);
  assert.equal(manual.app.lockPausedTracking, true);
  manual.app.handlePetEvent('session|locked');
  assert.equal(JSON.stringify(manual.app.bank.days), before, 'lock does not fabricate activity or overtime');
  manual.app.handlePetEvent('session|unlocked');
  assert.equal(manual.app.sessionLocked, false);
  assert.equal(manual.app.tracking, false, 'manual-resume mode stays paused after unlock');
  assert.equal(manual.app.lockPausedTracking, false);
  assert.ok(manualDay.activeSeconds >= 3600);

  const automatic = makeApp('auto'), autoApp = automatic.app;
  autoApp.handlePetEvent('session|locked');
  assert.equal(autoApp.tracking, false);
  autoApp.handlePetEvent('session|unlocked');
  assert.equal(autoApp.sessionLocked, false);
  assert.equal(autoApp.tracking, true, 'auto-resume mode starts a fresh sample window on unlock');
  assert.equal(autoApp.monitorReady, true);
});

test('lock monitoring failure fails closed instead of letting tracking continue unprotected', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings, lockMode: 'auto' };
  app.tracking = true;
  app.monitorReady = true;
  app.stopMonitor = () => { app.monitorReady = false; };
  app.handlePetEvent('session-ready|0');
  assert.equal(app.tracking, false);
  assert.equal(app.sessionMonitorFailed, true);
  app.startPet = () => true;
  app.startTracking();
  assert.equal(app.tracking, false, 'tracking must wait until lock monitoring is restored or disabled');
  assert.ok(env.alerts.length === 0);
});

test('automatic masking hides all amount views without changing the saved default', () => {
  const env = runtime(), app = env.context, elements = env.elements;
  const boot = runtime();
  boot.context.bank.settings = { ...settings, maskByDefault: false, maskTimeoutSeconds: 30 };
  assert.equal(boot.context.saveBank(), true);
  const reopened = runtime(boot.files), reopenedApp = reopened.context;
  reopenedApp.startPet = () => true;
  reopenedApp.window.onload();
  assert.equal(reopenedApp.masked, false, 'the configured launch preference still applies');
  assert.ok(Object.keys(reopened.timers).some(id => reopened.timers[id].delay === 30000), 'an unmasked launch arms its timer');

  app.bank.settings = { ...settings, maskByDefault: true, maskTimeoutSeconds: 30 };
  app.bank.days[app.bankDate(Date.now())] = sampleDay();
  app.petStatePath = 'C:\\Temp\\privacy-state';
  app.petRunning = true;
  app.render(Date.now());
  app.togglePrivacy();
  assert.equal(app.masked, false);
  assert.match(elements.todayAmount.innerText, /45\.9770/);
  const timeout = Object.keys(env.timers).map(Number).find(id => env.timers[id].delay === 30000);
  assert.ok(timeout, 'showing the amount arms the selected timeout');
  assert.equal(env.fireTimer(timeout), true);
  assert.equal(app.masked, true);
  assert.match(elements.todayAmount.innerText, /\*\*\*\*/);
  assert.match(elements.monthAmount.innerText, /\*\*\*\*/);
  assert.equal(app.bank.settings.maskByDefault, true, 'the one-time timeout does not rewrite the default');
  assert.match(env.files[app.petStatePath], /\*\*\*\*/);
  assert.equal(Object.keys(env.timers).some(id => env.timers[id].delay === 30000), false);
});

test('rest reminders use sampled active time, repeat at one interval, and reset when disabled', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings, restReminderMinutes: 45 };
  app.tracking = true;
  app.monitorReady = true;
  app.monitorIdle = false;
  app.lastTick = Date.now() - 2000;
  app.previousInput = app.lastTick;
  app.readSample = now => ({ idle: 0, input: now });
  app.restReminderActiveSeconds = 44 * 60 + 59.5;
  app.tick(true);
  assert.match(env.elements.toast.innerText, /累计记录约 45 分钟/);
  assert.ok(app.restReminderActiveSeconds < 2, 'only the interval remainder carries forward');
  const progress = app.restReminderActiveSeconds;
  app.readSample = () => null;
  app.monitorIdle = true;
  app.tick(true);
  assert.equal(app.restReminderActiveSeconds, progress, 'idle sampling does not advance the reminder');
  app.restReminderPending = true;
  assert.equal(app.snoozeRestReminder(), true);
  assert.equal(app.restReminderSnoozeSeconds, 900, 'snooze duration is measured in active seconds');
  assert.match(env.elements.toast.innerText, /再记录 15 分钟活跃时间/);
  assert.equal(app.restReminderPending, true, 'the reminder stays pending until active time uses the snooze');
  app.petRunning = true;
  app.petPanelVisible = false;
  app.petNoticePath = 'C:\\Temp\\rest-notice';
  app.showToast("Alt+R 或小鲸右键菜单可稍后提醒");
  assert.equal(env.files[app.petNoticePath], 'rest', 'a hidden panel forwards the reminder to the pet');
  app.handlePetEvent('rest-snooze');
  assert.equal(app.restReminderSnoozeSeconds, 900, 'the pet menu uses the same snooze action');
  app.bank.settings.restReminderMinutes = 0;
  assert.deepEqual(JSON.parse(JSON.stringify(app.bankReminderProgress(progress, 1, 0))), { seconds: 0, notify: false });
});

test('the mini card privacy event and the monthly amount share the mask toggle', () => {
  const env = runtime(), app = env.context, elements = env.elements;
  app.bank.settings = { ...settings, maskByDefault: true };
  app.bank.days[app.bankDate(Date.now())] = sampleDay();
  app.petControlPath = 'C:\\Temp\\control';
  app.petRunning = true;
  app.render(Date.now());
  assert.match(elements.monthAmount.innerText, /\*\*\*\*/);
  app.handlePetEvent('privacy');
  assert.equal(app.masked, false);
  assert.match(elements.monthAmount.innerText, /45\.98/);
  assert.equal(elements.monthAmount.attributes['aria-pressed'], 'false');
  elements.monthAmount.onclick();
  assert.equal(app.masked, true);
  assert.match(elements.monthAmount.innerText, /\*\*\*\*/);
  assert.equal(elements.monthAmount.attributes['aria-pressed'], 'true');
});

test('manual JSON backup and CSV export are local, explicit, and never overwrite existing files', () => {
  const env = runtime(), app = env.context;
  const today = app.bankDate(Date.now());
  app.bank.settings = { ...settings, autoLaunch: false };
  app.bank.days[today] = { ...sampleDay(9 * 3600), manualEntries: [{ kind: '会议', minutes: 30 }] };
  const csv = app.bankCsvText(app.bank);
  assert.match(csv, /"日期","活跃秒数"/);
  assert.match(csv, /会议:30分钟/);
  assert.match(csv, /45\.977011/);
  assert.doesNotMatch(csv, /salary|8000/);

  const existing = 'C:\\Users\\tester\\Documents\\already-there.json';
  env.files[existing] = 'keep-me';
  assert.equal(app.writeDataExport(existing, 'json'), false);
  assert.equal(env.files[existing], 'keep-me');
  assert.equal(app.writeDataExport(app.appPath('workbank.json'), 'json'), false, 'the live ledger can never be an export target');

  const backup = 'C:\\Users\\tester\\Documents\\workbank-backup.json';
  assert.equal(app.writeDataExport(backup, 'json'), true);
  assert.equal(JSON.parse(env.files[backup]).settings.salary, 8000);
  const csvPath = 'C:\\Users\\tester\\Documents\\workbank-records.csv';
  assert.equal(app.writeDataExport(csvPath, 'csv'), true);
  assert.match(env.files[csvPath], /"当日投入（元）"/);
  assert.match(env.files[csvPath], /会议:30分钟/);
});

test('history export buttons require privacy confirmation and launch a save dialog', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings };
  env.elements.btnBackup.onclick();
  assert.match(env.confirms[0], /包含月薪设置/);
  assert.match(env.commands[0], /SaveFileDialog/);
  assert.match(env.commands[0], /OverwritePrompt=\$false/);
  assert.match(env.commands[0], /-Sta/);
  const selected = 'C:\\Users\\tester\\Documents\\picked-backup.json';
  env.files[app.exportDialogPath] = selected;
  app.checkExportChoice(app.exportDialogPath, 'json', app.exportDialogStarted);
  assert.ok(Object.hasOwn(env.files, selected));
  assert.equal(app.exportDialogPath, '');

  app.chooseDataExport('csv');
  const choiceFile = app.exportDialogPath;
  const dialogProcess = env.execProcesses[1];
  dialogProcess.Status = 0;
  app.window.onunload();
  assert.equal(dialogProcess.terminated, true, 'closing the HTA cancels its owned file-picker process');
  assert.equal(env.files[choiceFile], undefined, 'the selection handoff file is cleaned up');
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

test('pet uses the first two hours of cumulative active overtime for its fighting pose', () => {
  const env = runtime(), app = env.context;
  app.bank.settings = { ...settings, endTime: '00:00' };
  app.tracking = true;
  app.monitorReady = true;
  app.monitorIdle = false;
  app.petRunning = true;
  app.petStatePath = 'C:\\Temp\\state';
  const today = app.bankDate(Date.now());
  const current = sampleDay(8 * 3600);
  app.bank.days[today] = current;
  for (const seconds of [0, 1, 3599, 7199, 7199.99]) {
    current.activeSeconds = 8 * 3600 + seconds;
    assert.equal(app.petState(), 'overtime', `fighting stage at ${seconds} overtime seconds`);
  }
  current.activeSeconds = 8 * 3600 + 7200;
  const bankBefore = JSON.stringify(app.bank);
  app.writePetState();
  assert.equal(JSON.stringify(app.bank), bankBefore, 'choosing a pose must not modify the bank records');
  assert.equal(app.petState(), 'overtime-steady');
  assert.equal(env.files[app.petStatePath].split('|')[0], 'overtime-steady');
  current.activeSeconds += 3 * 3600;
  assert.equal(app.petState(), 'overtime-steady');

  app.monitorIdle = true;
  assert.equal(app.petState(), 'idle', 'inactive tracking keeps its existing state');
  app.monitorIdle = false;
  app.tracking = false;
  assert.equal(app.petState(), 'paused', 'pausing remains higher priority than overtime');
  app.tracking = true;
  assert.equal(app.petState(), 'overtime-steady', 'resuming preserves cumulative overtime');
  const date = new Date();
  const yesterday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
  app.bank.days[app.bankDate(yesterday.getTime())] = current;
  app.bank.days[today] = sampleDay(3600);
  assert.equal(app.petState(), 'overtime', 'yesterday’s overtime does not affect the new day');
  assert.equal(app.bankOvertime(app.bank.days[today]), 0, 'passing the planned end time does not create active overtime');
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
