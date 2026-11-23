/**
 * 외부 LLM(Groq·Google)으로 내보내면 안 되는 문자열을 찾는 가드.
 * 프런트엔드(전송 전)와 Worker(수신 후) 양쪽에서 같은 규칙으로 검사한다.
 *
 * 원칙: 찾은 값 자체는 절대 되돌려주지 않는다. 어떤 종류가 걸렸는지만 알려 준다
 * (오류 메시지에 주민번호를 다시 실어 보내면 그 자체가 유출이다).
 */

export type SensitiveKind =
  | 'resident_id'
  | 'phone'
  | 'email'
  | 'account'
  | 'card'
  | 'api_key'
  | 'company_confidential'
  | 'custom_keyword';

export interface SensitivityFinding {
  kind: SensitiveKind;
  /** 사용자에게 보여 줄 짧은 이름. 값은 담지 않는다. */
  label: string;
}

const RULES: { kind: SensitiveKind; label: string; re: RegExp }[] = [
  { kind: 'resident_id', label: '주민등록번호 형태', re: /\b\d{6}[- ]?[1-8]\d{6}\b/ },
  { kind: 'phone', label: '전화번호 형태', re: /\b0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}\b/ },
  { kind: 'email', label: '이메일 주소', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { kind: 'card', label: '카드번호 형태', re: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/ },
  { kind: 'account', label: '계좌번호 형태', re: /\b\d{2,6}[- ]\d{2,6}[- ]\d{4,8}\b/ },
  { kind: 'api_key', label: 'API 키 형태', re: /\b(sk-[A-Za-z0-9_-]{12,}|gsk_[A-Za-z0-9]{12,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,})\b/ },
  {
    kind: 'company_confidential',
    label: '회사 비공개 표지',
    re: /(대외비|사내한|극비|기밀\s*문서|내부\s*자료|비공개\s*자료|설계\s*도면|Confidential)/i,
  },
];

/**
 * 기본 차단 키워드는 비워 둔다. 회사 이름만으로 막으면 정작 회의가 필요한 업무 주제가 전부 막힌다.
 * 대신 회사 문서 표지(대외비·도면 등)를 막고, 더 막고 싶은 단어는 Worker의 BLOCK_KEYWORDS에 넣는다.
 */
export const DEFAULT_COMPANY_KEYWORDS: string[] = [];

export function scanSensitive(text: string, extraKeywords: string[] = []): SensitivityFinding[] {
  if (!text) return [];
  const found = new Map<SensitiveKind, SensitivityFinding>();
  for (const rule of RULES) {
    if (rule.re.test(text)) found.set(rule.kind, { kind: rule.kind, label: rule.label });
  }
  for (const kw of [...DEFAULT_COMPANY_KEYWORDS, ...extraKeywords]) {
    const k = kw.trim();
    if (k.length >= 2 && text.toLowerCase().includes(k.toLowerCase())) {
      found.set('custom_keyword', { kind: 'custom_keyword', label: `차단 키워드(${k})` });
    }
  }
  return [...found.values()];
}

/** 화면·오류 응답에 쓰는 한 줄 요약. 민감한 값은 나오지 않는다. */
export function describeFindings(findings: SensitivityFinding[]): string {
  return findings.map((f) => f.label).join(', ');
}
