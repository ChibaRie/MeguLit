/* run by home-month-calendar.test.cjs in a child process with TZ set: prints how the month calendar for 15 Nov 2026 is laid out */
import {monthHTML} from '../web/home-tv.js';
import {activityCells} from '../web/learning-activity.js';

const [h, mi] = process.argv.slice(2).map(Number);
const today = new Date(2026, 10, 15, h, mi);
const pad = n => String(n).padStart(2, '0');
const record = d => ({day: '2026-11-' + pad(d), seconds: d * 120, characters: d * 10, sentences: 1, lookups: d % 3});
const all = activityCells([record(2), record(14), record(15)], today);
const result = monthHTML(all, 'zh', x => x, {chars: '字', days: '天', streak: '最长连续'}, v => String(v), today);
const days = result.html.match(/<i [^>]*><\/i>/g) || [];
const cell = d => {
  const m = days[d - 1].match(/grid-column:(\d+);grid-row:(\d+)/);
  return {col: +m[1] - 1, row: +m[2] - 1};
};
const level = d => (days[d - 1].match(/class="(?:today )?(l\d|later)?/) || [])[1] || '';
const todayIndex = days.findIndex(c => c.includes('today'));
console.log(JSON.stringify({
  days: days.length, firstCol: cell(1).col, firstRow: cell(1).row, secondCol: cell(2).col, secondRow: cell(2).row,
  todayDay: todayIndex + 1, todayRow: cell(15).row, todayCol: cell(15).col,
  l2: level(2), l3: level(3), l14: level(14), l15: level(15), l16: level(16)
}));
