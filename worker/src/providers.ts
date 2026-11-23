import type { UsageInfo } from '../../shared/protocol';

export interface Env {
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  APP_ACCESS_TOKEN?: string;
  GROQ_MODEL?: string;
  GEMINI_MODEL?: string;
  MODERATOR_MODEL?: string;
  GROQ_DAILY_CAP?: string;
  GEMINI_DAILY_CAP?: string;
  BLOCK_KEYWORDS?: string;
  QUOTA?: KVLike;
}

/** Worker KV와 테스트용 가짜 저장소가 함께 만족하는 최소 인터페이스. */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderResult {
  text: string;
  model: string;
  provider: string;
  usage?: UsageInfo;
}

export class ProviderError extends Error {
  code: 'rate_limited' | 'provider_error' | 'not_configured' | 'network';
  status: number;
  retryAfter?: number;
  detail?: string;

  constructor(
    message: string,
    code: ProviderError['code'],
    status = 0,
    extra?: { retryAfter?: number; detail?: string },
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.retryAfter = extra?.retryAfter;
    this.detail = extra?.detail;
  }
}

function retryAfterFromHeader(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(1, Math.round(n));
  }
  const reset = res.headers.get('x-ratelimit-reset-requests'); // 예: "2m59.56s"
  if (reset) {
    const m = /(?:(\d+)m)?([\d.]+)s/.exec(reset);
    if (m) return Math.max(1, Math.round(Number(m[1] ?? 0) * 60 + Number(m[2])));
  }
  return undefined;
}

async function errorDetail(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '');
  return raw.replace(/\s+/g, ' ').slice(0, 300);
}

/** GroqCloud — OpenAI 호환 Chat Completions. 모델: openai/gpt-oss-120b (무료 플랜) */
export async function callGroq(
  env: Env,
  system: string,
  user: string,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderResult> {
  const key = env.GROQ_API_KEY?.trim();
  if (!key) throw new ProviderError('GROQ_API_KEY secret이 설정되지 않았습니다.', 'not_configured', 503);
  const model = env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';

  let res: Response;
  try {
    res = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.6,
        max_completion_tokens: 900,
        // gpt-oss는 추론 토큰도 TPM에 포함된다. 무료 8K TPM을 지키려면 낮은 추론 강도가 안전하다.
        reasoning_effort: 'low',
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ProviderError('GroqCloud에 연결하지 못했습니다(네트워크·시간 초과).', 'network', 504);
  }

  if (!res.ok) {
    const detail = await errorDetail(res);
    if (res.status === 429) {
      throw new ProviderError('GroqCloud 무료 한도(RPM/TPM/RPD)에 닿았습니다.', 'rate_limited', 429, {
        retryAfter: retryAfterFromHeader(res),
        detail,
      });
    }
    throw new ProviderError(`GroqCloud 호출 실패 (HTTP ${res.status}).`, 'provider_error', 502, { detail });
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new ProviderError('GroqCloud 응답이 비었습니다(빈 content).', 'provider_error', 502);
  return {
    text,
    model,
    provider: 'GroqCloud',
    usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
  };
}

/** Google AI Studio — Gemini generateContent. 기본 모델: gemini-3.5-flash-lite (무료 티어) */
export async function callGemini(
  env: Env,
  modelId: string,
  system: string,
  user: string,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderResult> {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) throw new ProviderError('GEMINI_API_KEY secret이 설정되지 않았습니다.', 'not_configured', 503);
  const model = modelId.trim() || 'gemini-3.5-flash-lite';

  let res: Response;
  try {
    res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch {
    throw new ProviderError('Google AI Studio에 연결하지 못했습니다(네트워크·시간 초과).', 'network', 504);
  }

  if (!res.ok) {
    const detail = await errorDetail(res);
    if (res.status === 429) {
      throw new ProviderError('Gemini 무료 한도(RPM/TPM/RPD)에 닿았습니다.', 'rate_limited', 429, {
        retryAfter: retryAfterFromHeader(res),
        detail,
      });
    }
    throw new ProviderError(`Gemini 호출 실패 (HTTP ${res.status}).`, 'provider_error', 502, { detail });
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    promptFeedback?: { blockReason?: string };
  };
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!text) {
    const reason = candidate?.finishReason ?? data.promptFeedback?.blockReason ?? '알 수 없음';
    throw new ProviderError(`Gemini 응답이 비었습니다(이유: ${reason}).`, 'provider_error', 502);
  }
  return {
    text,
    model,
    provider: 'Google AI Studio',
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
    },
  };
}
