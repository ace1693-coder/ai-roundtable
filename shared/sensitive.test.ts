import { describe, expect, it } from 'vitest';
import { describeFindings, scanSensitive } from './sensitive';

describe('scanSensitive', () => {
  it('전화번호·주민번호·이메일을 찾는다', () => {
    const kinds = scanSensitive('연락처 010-1234-5678, 주민 900101-1234567, 메일 a.b@example.com').map((f) => f.kind);
    expect(kinds).toContain('phone');
    expect(kinds).toContain('resident_id');
    expect(kinds).toContain('email');
  });

  it('API 키를 찾는다', () => {
    expect(scanSensitive('키는 gsk_abcdefghijklmnop 입니다').map((f) => f.kind)).toContain('api_key');
  });

  it('회사 문서 표지를 찾는다', () => {
    expect(scanSensitive('이 자료는 대외비입니다').map((f) => f.kind)).toContain('company_confidential');
    expect(scanSensitive('첨부는 설계 도면 참고').map((f) => f.kind)).toContain('company_confidential');
  });

  it('사용자가 지정한 차단 키워드를 찾는다', () => {
    expect(scanSensitive('뉴파워프라즈마 3라인 이야기', ['뉴파워프라즈마']).map((f) => f.kind)).toEqual(['custom_keyword']);
  });

  it('깨끗한 회의 주제는 통과시킨다', () => {
    expect(scanSensitive('코팅 공정 불량을 줄이는 방법')).toEqual([]);
    expect(scanSensitive('')).toEqual([]);
  });

  it('찾은 값을 되돌려주지 않는다', () => {
    const findings = scanSensitive('010-9876-5432');
    const text = JSON.stringify(findings) + describeFindings(findings);
    expect(text).not.toContain('9876');
    expect(text).toContain('전화번호');
  });
});
