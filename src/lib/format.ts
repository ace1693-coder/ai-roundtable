const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 카카오톡식 "오전 02:20" */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${pad2(h12)}:${pad2(d.getMinutes())}`;
}

export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

export function formatDateDivider(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  if (isSameDay(ts, now)) return '오늘';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(ts, yesterday.getTime())) return '어제';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}`;
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${formatTime(ts)}`;
}

/** 같은 발신자가 5분 안에 연속으로 보낸 메시지는 한 묶음으로 본다. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;
