import { describe, expect, it } from 'vitest';
import { createMemory, matchMemories, parseMemoryImport } from './memory';
import type { MemoryItem } from './types';

function mem(partial: Partial<MemoryItem>): MemoryItem {
  const base = createMemory({ title: 't', body: 'b', status: '가설', type: '사실' });
  return { ...base, ...partial };
}

describe('matchMemories', () => {
  it('태그가 주제에 맞으면 상위로 온다', () => {
    const list = [
      mem({ title: '코팅 공정 온도', body: '온도 상승 시 두께 편차', tags: ['코팅', '공정'] }),
      mem({ title: '가격 실험', body: '소액 광고로 전환율 측정', tags: ['가격'] }),
    ];
    const r = matchMemories('코팅 공정 불량', list);
    expect(r[0].item.title).toBe('코팅 공정 온도');
    expect(r).toHaveLength(1);
  });

  it('본문 키워드 겹침으로도 잡는다', () => {
    const list = [mem({ title: '측정 우선', body: '불량 유형과 발생 지점을 2주간 기록한다', tags: [] })];
    const r = matchMemories('불량 발생 지점 기록', list);
    expect(r).toHaveLength(1);
    expect(r[0].score).toBeGreaterThan(0);
  });

  it('폐기된 정보는 점수를 깎는다', () => {
    const a = mem({ title: '전해액 온도', body: '온도를 올리면 좋다', tags: ['온도'], status: '폐기된 정보' });
    const b = mem({ title: '온도 기록', body: '온도 로그를 남긴다', tags: ['온도'], status: '검증된 사실' });
    const r = matchMemories('온도', [a, b]);
    expect(r[0].item.title).toBe('온도 기록');
  });

  it('관련 없으면 빈 배열', () => {
    expect(matchMemories('전혀 다른 이야기', [mem({ title: '코팅', body: '공정' })])).toEqual([]);
  });
});

describe('parseMemoryImport', () => {
  it('정상 JSON을 읽는다', () => {
    const raw = JSON.stringify({
      memories: [
        { id: 'm1', title: '제목', body: '내용', status: '검증된 사실', type: '사실', tags: ['a'], createdAt: 1, updatedAt: 2 },
      ],
    });
    const out = parseMemoryImport(raw);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('검증된 사실');
  });

  it('status 값이 틀리면 전체를 거부한다', () => {
    const raw = JSON.stringify([{ title: '제목', body: '내용', status: '아무거나', type: '사실' }]);
    expect(() => parseMemoryImport(raw)).toThrow(/status/);
  });

  it('JSON이 아니면 거부', () => {
    expect(() => parseMemoryImport('not json')).toThrow(/JSON/);
  });

  it('배열이 없으면 거부', () => {
    expect(() => parseMemoryImport('{"a":1}')).toThrow(/memories/);
  });
});
