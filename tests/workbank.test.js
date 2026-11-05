const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '上班鼓励器.hta'), 'utf8');
const match = source.match(/<script id="bank-core"[^>]*>([\s\S]*?)<\/script>/);
assert.ok(match, 'HTA must contain the work-bank core');
const core = {};
vm.runInNewContext(match[1], core);

function day(hours, rate, planned) {
  return { activeSeconds: hours * 3600, hourlyRate: rate, dayHours: planned };
}
function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
}

test('daily investment is capped while overtime only records hours', () => {
  const rate = 8000 / 174;
  close(core.bankDayAmount(day(8, rate, 8)), 367.816091954023);
  close(core.bankDayAmount(day(9.2, rate, 8)), 367.816091954023);
  close(core.bankOvertime(day(9.2, rate, 8)) / 3600, 1.2);
  close(core.bankOvertime(day(7, rate, 8)), 0);
});

test('monthly totals use each day’s own rate and cap, never fabricated days', () => {
  const days = {
    '2026-11-01': day(9, 50, 8),
    '2026-11-02': day(5, 40, 6),
    '2026-10-31': day(12, 999, 8),
    '2026-12-01': day(12, 999, 8)
  };
  const result = core.bankMonth(days, '2026-11');
  close(result.amount, 600);
  close(result.activeSeconds, 14 * 3600);
  close(result.overtimeSeconds, 3600);
  assert.equal(result.days, 2);
  assert.equal(core.bankMonth({}, '2026-11').amount, 0);
});

test('idle periods and resumed input do not add inactive time', () => {
  const ranges = core.bankActiveRanges(120000, 125000, 0, 123000, 120000);
  assert.equal(JSON.stringify(ranges), JSON.stringify([{ start: 123000, end: 125000 }]));
  assert.equal(core.bankActiveRanges(120000, 125000, 0, 0, 120000).length, 0);
});

test('overlapping activity windows are merged instead of counted twice', () => {
  const ranges = core.bankActiveRanges(100000, 125000, 0, 110000, 120000);
  assert.equal(JSON.stringify(ranges), JSON.stringify([{ start: 100000, end: 125000 }]));
});

test('cross-midnight activity is split into local calendar days', () => {
  const start = new Date(2026, 10, 3, 23, 59, 59, 500).getTime();
  const end = new Date(2026, 10, 4, 0, 0, 0, 500).getTime();
  const parts = core.bankSplitByDay(start, end);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].date, '2026-11-03');
  assert.equal(parts[0].end - parts[0].start, 500);
  assert.equal(parts[1].date, '2026-11-04');
  assert.equal(parts[1].end - parts[1].start, 500);
});

test('financial formatting and settings validation reject invalid input', () => {
  assert.equal(core.bankValidSettings({ salary: 8000, monthHours: 174, dayHours: 8, endTime: '18:00' }), true);
  assert.equal(core.bankValidSettings({ salary: 8000, monthHours: 0, dayHours: 8, endTime: '18:00' }), false);
  assert.equal(core.bankValidSettings({ salary: 8000, monthHours: 174, dayHours: 25, endTime: '18:00' }), false);
  assert.equal(core.bankValidSettings({ salary: 8000, monthHours: 174, dayHours: 8, endTime: '25:00' }), false);
  assert.equal(core.bankValidSettings({ salary: 8000, monthHours: 174, dayHours: 8, endTime: '18:00',
    autoLaunch: false, lockMode: 'manual', maskTimeoutSeconds: 30, restReminderMinutes: 60 }), true);
  assert.equal(core.bankValidSettings({ salary: 8000, monthHours: 174, dayHours: 8, endTime: '18:00', lockMode: 'unknown' }), false);
  assert.equal(core.bankValidSettings({ salary: 8000, monthHours: 174, dayHours: 8, endTime: '18:00', maskTimeoutSeconds: 15 }), false);
});

test('rest reminders count only valid active time and never emit a burst', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(core.bankReminderProgress(3500, 99, 60))), { seconds: 3599, notify: false });
  assert.deepEqual(JSON.parse(JSON.stringify(core.bankReminderProgress(3599, 2, 60))), { seconds: 1, notify: true });
  assert.deepEqual(JSON.parse(JSON.stringify(core.bankReminderProgress(3580, 7600, 60))), { seconds: 380, notify: true });
  assert.deepEqual(JSON.parse(JSON.stringify(core.bankReminderProgress(200, 500, 0))), { seconds: 0, notify: false });
  assert.deepEqual(JSON.parse(JSON.stringify(core.bankReminderProgress(200, 0, 60))), { seconds: 0, notify: false });
  assert.equal(core.bankReminderSnoozeProgress(900, 0), 900, 'paused and idle seconds do not reduce a snooze');
  assert.equal(core.bankReminderSnoozeProgress(900, 899), 1);
  assert.equal(core.bankReminderSnoozeProgress(900, 901), 0);
});
