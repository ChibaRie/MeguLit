const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

/* 2026-11-15 regression (user: the month calendar did not match the real date). 1 Nov 2026 is a Sunday, so a Monday-first
   calendar has ONE cell in its first row (it sits in the last column) and the 15th, a Sunday, is the last cell of the third row.
   Checked in UTC+8, UTC+9, UTC and UTC-8, early morning (where UTC is still the day before) and later in the day. */
const probe = path.join(__dirname, 'home-month-calendar.probe.mjs');
const zones = ['Asia/Shanghai', 'Asia/Tokyo', 'UTC', 'America/Los_Angeles'];
const times = [[0, 30], [6, 24], [7, 59], [8, 0], [15, 0], [23, 59]];

for (const tz of zones) for (const [h, m] of times) test(`month calendar is right in ${tz} at ${h}:${m}`, () => {
  const run = spawnSync(process.execPath, [probe, String(h), String(m)], {env: {...process.env, TZ: tz}, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  const o = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.deepEqual([o.firstRow, o.firstCol], [0, 6], '1 Nov is a Sunday: first row, last column');
  assert.deepEqual([o.secondRow, o.secondCol], [1, 0], '2 Nov starts the second row on Monday');
  assert.equal(o.days, 30);
  assert.equal(o.todayDay, 15);
  assert.equal(o.todayRow, 2, 'third row');
  assert.equal(o.todayCol, 6, 'Sunday, last column');
  assert.equal(o.l16, 'later');
  for (const lit of [o.l2, o.l14, o.l15]) assert.match(lit, /^l\d$/, 'days with data are lit');
  assert.equal(o.l3, '', 'a day without data stays plain');
});

test('every day carries its own grid cell (automatic placement let days 2 and 3 spill into extra columns)', () => {
  const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'web', 'home-tv.js'), 'utf8');
  assert.ok(src.includes('grid-column:${at%7+1};grid-row:${Math.floor(at/7)+1}'));
});

test('the calendar cells never use the bare class "today" (grimoire.css has a global .today{grid-area:today;display:flex;padding-left:28px} that stretched that cell)', () => {
  const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'web', 'home-tv.js'), 'utf8');
  const month = src.slice(src.indexOf('export function monthHTML'), src.indexOf('export function stopHomeTV'));
  assert.ok(!/class="\$\{d===td\?'today /.test(month));
  assert.ok(month.includes("'is-today '"));
});
