import { describe, expect, it } from 'vitest';
import { activeMentionQuery, filterMentionOptions, parseMentions, stripMentions } from './mentions';

describe('parseMentions', () => {
  it('개별 멘션을 대상으로 뽑는다', () => {
    expect(parseMentions('@Gemini 위험성 검토해').targets).toEqual(['gemini']);
    expect(parseMentions('@GPT-OSS 너는 어떻게 생각해?').targets).toEqual(['gptoss']);
    expect(parseMentions('@사회자 지금까지 정리해').targets).toEqual(['moderator']);
  });

  it('문장 중간의 멘션도 인식한다', () => {
    expect(parseMentions('이 부분은 @Gemini가 봐줘').targets).toEqual(['gemini']);
  });

  it('@전체는 세 AI 전부, 중복 없이', () => {
    expect(parseMentions('@전체 다시 생각해봐').targets).toEqual(['gptoss', 'gemini', 'moderator']);
    expect(parseMentions('@전체 그리고 @Gemini도').targets).toEqual(['gptoss', 'gemini', 'moderator']);
  });

  it('한글 별칭도 인식한다', () => {
    expect(parseMentions('@제미나이 의견').targets).toEqual(['gemini']);
    expect(parseMentions('@피클 정리').targets).toEqual(['moderator']);
  });

  it('멘션이 없으면 빈 배열', () => {
    expect(parseMentions('그냥 질문').targets).toEqual([]);
    expect(parseMentions('@없는사람').targets).toEqual([]);
  });
});

describe('activeMentionQuery', () => {
  it('커서 앞 @ 뒤에 공백이 없으면 자동완성 대상', () => {
    const text = '@Ge';
    const q = activeMentionQuery(text, text.length);
    expect(q).toEqual({ query: 'Ge', start: 0 });
  });

  it('공백이 끼면 자동완성 종료', () => {
    expect(activeMentionQuery('@Gem ', 5)).toBeNull();
  });

  it('@가 없으면 null', () => {
    expect(activeMentionQuery('안녕', 2)).toBeNull();
  });
});

describe('filterMentionOptions', () => {
  it('질의에 맞는 후보만 남는다', () => {
    expect(filterMentionOptions('ge').map((o) => o.id)).toEqual(['gemini']);
    expect(filterMentionOptions('').length).toBe(4);
  });
});

describe('stripMentions', () => {
  it('멘션 토큰을 지운다', () => {
    expect(stripMentions('@Gemini 위험성 검토해')).toBe('위험성 검토해');
  });
});
