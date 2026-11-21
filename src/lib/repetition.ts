/** 반복 발언 감지 — 외부 라이브러리 없이 단어 토큰 + 문자 2-gram Jaccard. */

const STOPWORDS = new Set([
  '그리고', '그러니까', '그런데', '하지만', '그래서', '이거', '그거', '저거', '것', '수', '때',
  '있는', '없는', '한다', '했다', '입니다', '합니다', '좋다', '같다', '대한', '위한', '정도',
  '우리', '너희', '제가', '내가', '네가', '좀', '더', '그냥', '일단', '그럼', '그러면',
]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordTokens(text: string): string[] {
  const words = normalize(text).split(' ').filter(Boolean);
  return words.filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

export function charBigrams(text: string): string[] {
  const compact = normalize(text).replace(/\s/g, '');
  const out: string[] = [];
  for (let i = 0; i < compact.length - 1; i += 1) out.push(compact.slice(i, i + 2));
  return out;
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  sa.forEach((x) => {
    if (sb.has(x)) inter += 1;
  });
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 한국어는 조사·어미 때문에 단어 토큰만으로는 같은 말을 반복해도 유사도가 낮다.
 * 단어 Jaccard와 문자 2-gram Jaccard 중 큰 값을 쓴다 (K-AI-015, 유력한 가설).
 */
export function similarity(a: string, b: string): number {
  const wa = wordTokens(a);
  const wb = wordTokens(b);
  const word = jaccard(wa, wb);
  const bigram = jaccard(charBigrams(a), charBigrams(b));
  // 짧은 문장(인사·동의)은 단어 겹침만으로 1.0이 되기 쉬워 가중치를 낮춘다.
  const weight = wa.length >= 4 && wb.length >= 4 ? 1 : 0.85;
  return Math.max(word, bigram) * weight;
}

export const REPEAT_THRESHOLD = 0.75;
/** 경고가 이만큼 연속되면 회의를 일시정지하고 정리를 제안한다(자동 종료는 하지 않는다). */
export const REPEAT_LIMIT = 3;

export interface RepeatCheck {
  similarity: number;
  repeated: boolean;
  matchedIndex: number;
}

export function checkRepeat(newText: string, previous: string[], threshold = REPEAT_THRESHOLD): RepeatCheck {
  let best = 0;
  let matchedIndex = -1;
  previous.forEach((p, i) => {
    const s = similarity(newText, p);
    if (s > best) {
      best = s;
      matchedIndex = i;
    }
  });
  return { similarity: Number(best.toFixed(3)), repeated: best >= threshold, matchedIndex };
}
