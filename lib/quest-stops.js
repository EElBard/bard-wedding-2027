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

export function formatStop(stop) {
  return `${stop.day} ${stop.time} · ${stop.name}`;
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
