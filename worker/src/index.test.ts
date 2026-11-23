import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from './app';
import type { Env, FetchLike } from './providers';
import { createMemoryStore, type QuotaStore } from './store';

const ORIGIN = 'https://ace1693-coder.github.io';

function body(over: Record<string, unknown> = {}) {
  return {
    role: 'gptoss',
    phase: 'open',
    topic: '코팅 공정 불량 개선',
    domain: 'manufacturing',
    turnIndex: 1,
    maxTurns: 5,
    roles: { gptoss: '공정혁신 전문가', gemini: '검증 담당', moderator: '사회자' },
    thinking: [{ title: '반대편에 세우기', instruction: '반론 5개' }],
    memories: [],
    transcript: [{ author: '나', role: '사용자', text: '불량을 줄이고 싶어' }],
    ...over,
  };
}

function request(
  url: string,
  opts: { method?: string; token?: string | null; origin?: string | null; json?: unknown; session?: string | null } = {},
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token !== null) headers['x-app-token'] = opts.token ?? 'test-token';
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.session) headers['x-session-id'] = opts.session;
  return new Request(url, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
  });
}

const groqOk: FetchLike = async () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: '첫 의견입니다.' } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

const geminiOk: FetchLike = async () =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Gemini 검토입니다.' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

describe('worker /api/turn', () => {
  let env: Env;
  let store: QuotaStore;
  let deps: { fetchImpl: FetchLike; store: QuotaStore; now: () => number };

  beforeEach(() => {
    env = {
      GROQ_API_KEY: 'groq-key',
      GEMINI_API_KEY: 'gemini-key',
      APP_ACCESS_TOKEN: 'test-token',
      GROQ_MODEL: 'openai/gpt-oss-120b',
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      MODERATOR_MODEL: 'gemini-3.5-flash-lite',
      GROQ_DAILY_CAP: '10',
      GEMINI_DAILY_CAP: '10',
    } as Env;
    store = createMemoryStore();
    deps = { fetchImpl: groqOk, store, now: () => Date.UTC(2026, 10, 22, 12, 0, 0) };
  });

  it('패스코드가 없으면 401이고 제공업체를 부르지 않는다', async () => {
    const spy = vi.fn<FetchLike>(groqOk);
    const res = await handle(request('https://w.dev/api/turn', { token: 'wrong', json: body() }), env, { ...deps, fetchImpl: spy });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('unauthorized');
    expect(spy).not.toHaveBeenCalled();
  });

  it('APP_ACCESS_TOKEN이 서버에 없으면 503', async () => {
    const res = await handle(request('https://w.dev/api/turn', { json: body() }), { ...env, APP_ACCESS_TOKEN: '' } as Env, deps);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('not_configured');
  });

  it('정상 호출은 실제 모델·제공업체·토큰 사용량을 돌려준다', async () => {
    const res = await handle(request('https://w.dev/api/turn', { json: body() }), env, deps);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, model: 'openai/gpt-oss-120b', provider: 'GroqCloud' });
    expect(json.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('Gemini 역할은 Google AI Studio 엔드포인트로 보낸다', async () => {
    const spy = vi.fn<FetchLike>(geminiOk);
    const res = await handle(request('https://w.dev/api/turn', { json: body({ role: 'gemini', phase: 'critique' }) }), env, {
      ...deps,
      fetchImpl: spy,
    });
    const json = await res.json();
    expect(json.provider).toBe('Google AI Studio');
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('generativelanguage.googleapis.com');
    expect(String(url)).toContain('gemini-3.5-flash-lite');
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('gemini-key');
  });

  it('요약 엔드포인트는 역할을 사회자로 고정한다', async () => {
    const spy = vi.fn<FetchLike>(geminiOk);
    const res = await handle(
      request('https://w.dev/api/summary', { json: body({ role: 'gptoss', phase: 'open' }) }),
      env,
      { ...deps, fetchImpl: spy },
    );
    expect(res.status).toBe(200);
    const payload = JSON.parse(String(spy.mock.calls[0][1]?.body));
    expect(payload.systemInstruction.parts[0].text).toContain('사회자');
    expect(payload.contents[0].parts[0].text).toContain('결론 한 문장');
  });

  it('민감정보가 있으면 422로 막고 값을 되돌려주지 않는다', async () => {
    const spy = vi.fn<FetchLike>(groqOk);
    const res = await handle(
      request('https://w.dev/api/turn', { json: body({ topic: '환자 연락처 010-1234-5678 정리' }) }),
      env,
      { ...deps, fetchImpl: spy },
    );
    const text = await res.text();
    expect(res.status).toBe(422);
    expect(text).toContain('전화번호');
    expect(text).not.toContain('5678');
    expect(spy).not.toHaveBeenCalled();
  });

  it('BLOCK_KEYWORDS에 넣은 단어도 막는다', async () => {
    const res = await handle(
      request('https://w.dev/api/turn', { json: body({ topic: '뉴파워프라즈마 3라인 개선' }) }),
      { ...env, BLOCK_KEYWORDS: '뉴파워프라즈마' } as Env,
      deps,
    );
    expect(res.status).toBe(422);
  });

  it('제공업체 429는 rate_limited와 retryAfter로 전달한다', async () => {
    const limited: FetchLike = async () =>
      new Response(JSON.stringify({ error: { message: 'rate limit' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'retry-after': '7' },
      });
    const res = await handle(request('https://w.dev/api/turn', { json: body() }), env, { ...deps, fetchImpl: limited });
    const json = await res.json();
    expect(res.status).toBe(429);
    expect(json.code).toBe('rate_limited');
    expect(json.retryAfter).toBe(7);
  });

  it('자체 일일 상한에 닿으면 더 부르지 않는다', async () => {
    const small = { ...env, GROQ_DAILY_CAP: '1' } as Env;
    const shared = createMemoryStore();
    const first = await handle(request('https://w.dev/api/turn', { json: body() }), small, { ...deps, store: shared });
    expect(first.status).toBe(200);

    const spy = vi.fn<FetchLike>(groqOk);
    const second = await handle(request('https://w.dev/api/turn', { json: body() }), small, {
      ...deps,
      store: shared,
      fetchImpl: spy,
    });
    expect(second.status).toBe(429);
    expect((await second.json()).code).toBe('quota_exceeded');
    expect(spy).not.toHaveBeenCalled();
  });

  it('같은 세션이 분당 상한을 넘으면 429 rate_limited 로 막는다', async () => {
    const shared = createMemoryStore();
    const session = 'abcd1234efgh';
    for (let i = 0; i < 8; i += 1) {
      const ok = await handle(request('https://w.dev/api/turn', { json: body(), session }), { ...env, GROQ_DAILY_CAP: '50' } as Env, {
        ...deps,
        store: shared,
      });
      expect(ok.status).toBe(200);
    }
    const spy = vi.fn<FetchLike>(groqOk);
    const blocked = await handle(request('https://w.dev/api/turn', { json: body(), session }), { ...env, GROQ_DAILY_CAP: '50' } as Env, {
      ...deps,
      store: shared,
      fetchImpl: spy,
    });
    const json = await blocked.json();
    expect(blocked.status).toBe(429);
    expect(json.code).toBe('rate_limited');
    expect(json.message).toContain('브라우저');
    expect(spy).not.toHaveBeenCalled();
  });

  it('세션 ID 형식이 틀리면 세션 제한 없이 그대로 처리한다', async () => {
    const shared = createMemoryStore();
    for (let i = 0; i < 9; i += 1) {
      const res = await handle(
        request('https://w.dev/api/turn', { json: body(), session: 'bad id!' }),
        { ...env, GROQ_DAILY_CAP: '50' } as Env,
        { ...deps, store: shared },
      );
      expect(res.status).toBe(200);
    }
  });

  it('사회자 결정 턴은 NEXT 표식을 떼고 decision 으로 돌려준다', async () => {
    const decide: FetchLike = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: 'NEXT: gptoss\n쟁점은 점검 주기다. GPT-OSS가 근거를 더 대라.' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const res = await handle(
      request('https://w.dev/api/turn', { json: body({ role: 'moderator', phase: 'decide', participants: ['gptoss', 'gemini', 'moderator'] }) }),
      env,
      { ...deps, fetchImpl: decide },
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.decision).toEqual({ next: 'gptoss' });
    expect(json.text).not.toContain('NEXT');
    expect(json.text).toContain('쟁점은 점검 주기다');
  });

  it('끈 참가자를 지목한 사회자 결정은 버린다(앱이 교대로 대체)', async () => {
    const decide: FetchLike = async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'NEXT: moderator\n정리한다.' }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const res = await handle(
      request('https://w.dev/api/turn', { json: body({ role: 'moderator', phase: 'decide', participants: ['gptoss', 'gemini'] }) }),
      env,
      { ...deps, fetchImpl: decide },
    );
    const json = await res.json();
    expect(json.decision).toBeUndefined();
  });

  it('결정 턴은 역할을 사회자로 고정한다', async () => {
    const spy = vi.fn<FetchLike>(geminiOk);
    await handle(request('https://w.dev/api/turn', { json: body({ role: 'gptoss', phase: 'decide' }) }), env, { ...deps, fetchImpl: spy });
    const [url] = spy.mock.calls[0];
    expect(String(url)).toContain('generativelanguage.googleapis.com');
  });

  it('role 값이 틀리면 400', async () => {
    const res = await handle(request('https://w.dev/api/turn', { json: body({ role: 'chatgpt' }) }), env, deps);
    expect(res.status).toBe(400);
  });

  it('JSON이 아니면 400', async () => {
    const req = new Request('https://w.dev/api/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-token': 'test-token' },
      body: 'not json',
    });
    const res = await handle(req, env, deps);
    expect(res.status).toBe(400);
  });

  it('허용되지 않은 출처에는 CORS 허용 헤더를 주지 않는다', async () => {
    const res = await handle(
      request('https://w.dev/api/turn', { json: body(), origin: 'https://evil.example.com' }),
      env,
      deps,
    );
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('OPTIONS 프리플라이트는 204', async () => {
    const res = await handle(request('https://w.dev/api/turn', { method: 'OPTIONS', token: null, json: undefined }), env, deps);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });
});

describe('worker /api/health', () => {
  it('모델·설정 여부를 숨김값 없이 알려 준다', async () => {
    const env = {
      GROQ_API_KEY: 'k',
      GEMINI_API_KEY: 'g',
      APP_ACCESS_TOKEN: 'test-token',
      GROQ_MODEL: 'openai/gpt-oss-120b',
    } as Env;
    const res = await handle(
      new Request('https://w.dev/api/health', { headers: { origin: ORIGIN, 'x-app-token': 'test-token' } }),
      env,
      { fetchImpl: groqOk, store: createMemoryStore(), now: Date.now },
    );
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.models.gptoss).toBe('openai/gpt-oss-120b');
    expect(json.models.gemini).toBe('gemini-3.5-flash-lite');
    expect(json.configured).toEqual({ groq: true, gemini: true, accessToken: true });
    expect(JSON.stringify(json)).not.toContain('groq-key');
  });
});
