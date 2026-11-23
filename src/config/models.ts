/**
 * 실제 호출 대상 모델·제공업체 표기. 모델을 바꿀 때는 이 파일만 고친다.
 * (작업 A 개발회의 결론이 확정되면 여기 값과 worker/wrangler.toml 의 [vars] 를 함께 바꾼다.)
 *
 * 원칙: 화면에 적는 모델명은 실제 호출 대상과 같아야 한다. ChatGPT·Gemini 2.5 같은
 * 다른 제품명을 관성적으로 붙이지 않는다.
 */
export interface ModelSpec {
  /** 화면에 보이는 참가자 이름 */
  label: string;
  /** 실제 API에 넘기는 모델 ID */
  model: string;
  /** 실제 제공업체 이름 */
  provider: string;
  /** 이 응답이 어디서 오는지 */
  transport: string;
}

export const MODEL_SPECS = {
  gptoss: {
    label: 'GPT-OSS',
    model: 'openai/gpt-oss-120b',
    provider: 'GroqCloud',
    transport: 'Worker 경유 실제 API',
  },
  gemini: {
    label: 'Gemini',
    model: 'gemini-3.5-flash-lite',
    provider: 'Google AI Studio',
    transport: 'Worker 경유 실제 API',
  },
  moderator: {
    label: '사회자',
    model: 'gemini-3.5-flash-lite',
    provider: 'Google AI Studio',
    transport: 'Worker 경유 실제 API',
  },
} as const satisfies Record<'gptoss' | 'gemini' | 'moderator', ModelSpec>;

export type AiRoleKey = keyof typeof MODEL_SPECS;

/** 말풍선에 붙는 한 줄: `openai/gpt-oss-120b · GroqCloud` */
export function modelLine(key: AiRoleKey): string {
  const spec = MODEL_SPECS[key];
  return `${spec.model} · ${spec.provider}`;
}
