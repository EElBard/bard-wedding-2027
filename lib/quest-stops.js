export const QUEST_STOPS = [
  { index: 0, day: 'Fri', date: 'Fri Feb 19', time: '2 PM', short: 'Crowns', name: 'Arrival & Crowns', icon: '👑', cost: 0 },
  { index: 1, day: 'Fri', date: 'Fri Feb 19', time: '4 PM', short: 'Happy Hr', name: 'Happy Hour', icon: '🥂', cost: 0 },
  { index: 2, day: 'Fri', date: 'Fri Feb 19', time: '6 PM', short: 'Tournament', name: 'Tournament of Kings', icon: '⚔️', cost: 85 },
  { index: 3, day: 'Sat', date: 'Sat Feb 20', time: 'Day', short: 'D&D', name: 'D&D One-Shot', icon: '🎲', cost: 0 },
  { index: 4, day: 'Sat', date: 'Sat Feb 20', time: 'Eve', short: 'Dinner', name: 'Group Dinner', icon: '🍽️', cost: 0 },
  { index: 5, day: 'Sat', date: 'Sat Feb 20', time: 'Night', short: 'Club Crawl', name: 'Club Crawl', icon: '🎉', cost: 40 },
  { index: 6, day: 'Sun', date: 'Sun Feb 21', time: 'AM', short: 'Café', name: 'Café & Farewells', icon: '☕', cost: 0 }
];

export const LAST_STOP = QUEST_STOPS.length - 1;
export const ALL_STOP_INDICES = QUEST_STOPS.map((stop) => stop.index);

export function formatStop(stop) {
  return `${stop.day} ${stop.time} · ${stop.name}`;
}

export function resolveSelectedStops(record) {
  if (!record || record.attending !== 'yes') {
    return [];
  }

  if (Array.isArray(record.selected_stops)) {
    const valid = [];
    for (const raw of record.selected_stops) {
      if (raw === null || raw === undefined || typeof raw === 'boolean' || (typeof raw === 'string' && raw.trim() === '')) {
        continue;
      }
      const num = Number(raw);
      if (Number.isInteger(num) && num >= 0 && num <= LAST_STOP) {
        valid.push(num);
      }
    }
    return [...new Set(valid)].sort((a, b) => a - b);
  }

  const rawArrive = Number.isInteger(record.arrive_idx) ? record.arrive_idx : 0;
  const rawDepart = Number.isInteger(record.depart_idx) ? record.depart_idx : LAST_STOP;
  const start = Math.max(0, Math.min(LAST_STOP, rawArrive));
  const end = Math.max(0, Math.min(LAST_STOP, rawDepart));

  const stops = [];
  for (let i = start; i <= end; i += 1) {
    stops.push(i);
  }
  return stops;
}

export function buildBachScheduleFromStops(selectedStops) {
  const stops = [...new Set(selectedStops)].sort((a, b) => a - b);
  if (stops.length === 0) {
    return {
      selectedStops: [],
      arriveIdx: null,
      departIdx: null,
      arriveAt: '',
      departAfter: '',
      schedule: ''
    };
  }

  const arriveIdx = stops[0];
  const departIdx = stops[stops.length - 1];
  const arriveAt = formatStop(QUEST_STOPS[arriveIdx]);
  const departAfter = formatStop(QUEST_STOPS[departIdx]);
  const schedule = stops.length === QUEST_STOPS.length
    ? 'Full Weekend'
    : stops.map((idx) => QUEST_STOPS[idx].name).join(', ');

  return {
    selectedStops: stops,
    arriveIdx,
    departIdx,
    arriveAt,
    departAfter,
    schedule
  };
}

export function buildBachSchedule(arriveIdx, departIdx) {
  const arriveStop = QUEST_STOPS[arriveIdx];
  const departStop = QUEST_STOPS[departIdx];
  const arriveAt = formatStop(arriveStop);
  const departAfter = formatStop(departStop);
  const schedule = arriveIdx === 0 && departIdx === LAST_STOP
    ? 'Full Weekend'
    : `${arriveAt} to ${departAfter}`;

  return {
    arriveIdx,
    departIdx,
    arriveAt,
    departAfter,
    schedule
  };
}
