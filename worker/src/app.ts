import type { NextSpeaker, RoleId, TurnDecision, TurnPhase, TurnRequest, TurnSuccess } from '../../shared/protocol';
import { parseDecisionLine } from '../../shared/protocol';
import { describeFindings, scanSensitive } from '../../shared/sensitive';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import { callGemini, callGroq, ProviderError, type Env, type FetchLike } from './providers';
import { createKvStore, createMemoryStore, utcDayKey, utcMinuteKey, type QuotaStore } from './store';
import { clientIp, corsHeaders, errorResponse, isAllowedOrigin, jsonResponse, tokenEquals } from './guard';

export const VERSION = '4.0.0';

const ROLES: RoleId[] = ['gptoss', 'gemini', 'moderator'];
const PHASES: TurnPhase[] = ['open', 'critique', 'moderate', 'rebut', 'summary', 'decide'];

/** 무료 한도 안전장치 — 자체 IP 제한 */
const IP_PER_MINUTE = 20;
const IP_PER_DAY = 200;
/** 같은 브라우저(세션) 하나가 혼자 무료 한도를 태우지 못하게 하는 제한 */
const SESSION_PER_MINUTE = 8;
const SESSION_PER_DAY = 120;
/** 앱이 만드는 세션 ID 형식만 받는다(임의 문자열로 카운터를 흩뜨리지 못하게). */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export interface Deps {
  fetchImpl: FetchLike;
  store?: QuotaStore;
  now: () => number;
}

function createStore(env: Env, deps: Deps): QuotaStore {
  if (deps.store) return deps.store;
  return env.QUOTA ? createKvStore(env.QUOTA) : createMemoryStore(deps.now);
}

function capOf(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** 외부에서 온 JSON을 그대로 믿지 않고 필요한 모양만 뽑아 쓴다. */
export function parseTurnRequest(raw: unknown, forced?: { role: RoleId; phase: TurnPhase }): TurnRequest | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: '요청 본문이 JSON 객체가 아닙니다.' };
  const b = raw as Record<string, unknown>;
  const role = forced?.role ?? (ROLES.includes(b.role as RoleId) ? (b.role as RoleId) : null);
  const phase = forced?.phase ?? (PHASES.includes(b.phase as TurnPhase) ? (b.phase as TurnPhase) : null);
  if (!role) return { error: 'role 값이 올바르지 않습니다(gptoss|gemini|moderator).' };
  if (!phase) return { error: 'phase 값이 올바르지 않습니다.' };

  const topic = str(b.topic, 2000).trim();
  if (!topic) return { error: 'topic이 비었습니다.' };

  const rolesRaw = (b.roles ?? {}) as Record<string, unknown>;
  const roles = {
    gptoss: str(rolesRaw.gptoss, 60) || '전략 분석가',
    gemini: str(rolesRaw.gemini, 60) || '검증 담당',
    moderator: str(rolesRaw.moderator, 60) || '사회자',
  };

  const thinking = Array.isArray(b.thinking)
    ? b.thinking.slice(0, 3).map((t) => {
        const row = (t ?? {}) as Record<string, unknown>;
        return { title: str(row.title, 60), instruction: str(row.instruction, 300) };
      })
    : [];

  const memories = Array.isArray(b.memories)
    ? b.memories.slice(0, 5).map((m) => {
        const row = (m ?? {}) as Record<string, unknown>;
        return { title: str(row.title, 120), body: str(row.body, 400), status: str(row.status, 20) };
      })
    : [];

  const transcript = Array.isArray(b.transcript)
    ? b.transcript.slice(-12).map((t) => {
        const row = (t ?? {}) as Record<string, unknown>;
        return { author: str(row.author, 40), role: str(row.role, 40), text: str(row.text, 800) };
      })
    : [];

  const participants = Array.isArray(b.participants)
    ? (b.participants.filter((p) => ROLES.includes(p as RoleId)) as RoleId[]).slice(0, 3)
    : [];
  const callIndex = Number(b.callIndex);
  const callBudget = Number(b.callBudget);

  const turnIndex = Number(b.turnIndex);
  const maxTurns = Number(b.maxTurns);

  return {
    role,
    phase,
    topic,
    domain: str(b.domain, 30) || 'general',
    turnIndex: Number.isFinite(turnIndex) && turnIndex > 0 ? Math.floor(turnIndex) : 1,
    maxTurns: Number.isFinite(maxTurns) && maxTurns > 0 ? Math.floor(maxTurns) : 6,
    roles,
    thinking,
    memories,
    transcript,
    userDirective: str(b.userDirective, 1000) || undefined,
    participants: participants.length ? participants : undefined,
    callIndex: Number.isFinite(callIndex) && callIndex > 0 ? Math.floor(callIndex) : undefined,
    callBudget: Number.isFinite(callBudget) && callBudget > 0 ? Math.floor(callBudget) : undefined,
  };
}

function requestText(req: TurnRequest): string {
  return [
    req.topic,
    req.userDirective ?? '',
    ...Object.values(req.roles),
    ...req.thinking.map((t) => `${t.title} ${t.instruction}`),
    ...req.memories.map((m) => `${m.title} ${m.body}`),
    ...req.transcript.map((t) => `${t.author} ${t.text}`),
  ].join('\n');
}

async function handleTurn(request: Request, env: Env, deps: Deps, forced?: { role: RoleId; phase: TurnPhase }): Promise<Response> {
  const origin = request.headers.get('origin');
  const store = createStore(env, deps);

  // 1) 개인용 인증 — 여기서 막히면 어떤 무료 한도도 쓰지 않는다.
  const expected = env.APP_ACCESS_TOKEN?.trim();
  if (!expected) {
    return errorResponse('not_configured', '서버에 APP_ACCESS_TOKEN이 설정되지 않았습니다.', 503, origin);
  }
  const provided = request.headers.get('x-app-token') ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!tokenEquals(provided, expected)) {
    return errorResponse('unauthorized', '개인용 접근 패스코드가 올바르지 않습니다.', 401, origin);
  }

  // 2) 요청 크기·모양
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > 200_000) return errorResponse('bad_request', '요청 본문이 너무 큽니다.', 413, origin);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse('bad_request', 'JSON 본문을 읽지 못했습니다.', 400, origin);
  }
  const parsed = parseTurnRequest(raw, forced);
  if ('error' in parsed) return errorResponse('bad_request', parsed.error, 400, origin);

  // 2-1) 사회자 결정 턴은 역할을 고정한다(다른 역할로 호출하지 못하게).
  if (parsed.phase === 'decide') parsed.role = 'moderator';

  // 3) 민감정보·회사자료 가드 — 값은 되돌려주지 않고 종류만 알린다.
  const extraKeywords = (env.BLOCK_KEYWORDS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const findings = scanSensitive(requestText(parsed), extraKeywords);
  if (findings.length) {
    return errorResponse(
      'sensitive_blocked',
      `외부 API로 보내지 않았습니다. 민감정보로 보이는 항목: ${describeFindings(findings)}. 해당 부분을 지우고 다시 보내 주세요.`,
      422,
      origin,
      { findings: findings.map((f) => f.label) },
    );
  }

  // 4) 내 쪽 레이트리밋
  const ip = clientIp(request);
  const day = utcDayKey(new Date(deps.now()));
  const minute = utcMinuteKey(new Date(deps.now()));
  const perMinute = await store.incr(`rl:${ip}:${minute}`, 120);
  if (perMinute > IP_PER_MINUTE) {
    return errorResponse('quota_exceeded', `요청이 너무 잦습니다(분당 ${IP_PER_MINUTE}회 제한). 잠시 뒤 다시 시도해 주세요.`, 429, origin, {
      retryAfter: 60,
    });
  }
  const perDay = await store.incr(`rld:${ip}:${day}`, 90000);
  if (perDay > IP_PER_DAY) {
    return errorResponse('quota_exceeded', `오늘 요청 한도(${IP_PER_DAY}회)를 다 썼습니다. 자정(UTC) 이후에 풀립니다.`, 429, origin);
  }

  // 4-1) 세션 단위 제한 — 같은 브라우저가 자동 회의를 반복해 돌려도 하루 상한을 앞당겨 태우지 않는다.
  const sessionId = request.headers.get('x-session-id') ?? '';
  if (SESSION_ID_RE.test(sessionId)) {
    const sPerMinute = await store.incr(`sl:${sessionId}:${minute}`, 120);
    if (sPerMinute > SESSION_PER_MINUTE) {
      return errorResponse(
        'rate_limited',
        `이 브라우저의 요청이 너무 잦습니다(분당 ${SESSION_PER_MINUTE}회 제한). 자동 회의 호출 간격을 확인해 주세요.`,
        429,
        origin,
        { retryAfter: 60 },
      );
    }
    const sPerDay = await store.incr(`sld:${sessionId}:${day}`, 90000);
    if (sPerDay > SESSION_PER_DAY) {
      return errorResponse(
        'quota_exceeded',
        `이 브라우저의 오늘 요청 한도(${SESSION_PER_DAY}회)를 다 썼습니다. 자정(UTC) 이후에 풀립니다.`,
        429,
        origin,
      );
    }
  }

  // 5) 제공업체별 일일 상한 — 무료 한도에 닿기 전에 앱이 멈춘다(과금 전환 없음).
  const provider = parsed.role === 'gptoss' ? 'groq' : 'gemini';
  const cap = provider === 'groq' ? capOf(env.GROQ_DAILY_CAP, 300) : capOf(env.GEMINI_DAILY_CAP, 300);
  const used = await store.get(`q:${provider}:${day}`);
  if (used >= cap) {
    return errorResponse(
      'quota_exceeded',
      `${provider === 'groq' ? 'GroqCloud' : 'Google AI Studio'} 오늘 사용 상한(${cap}회)에 닿아 자동 회의를 멈췄습니다. 내일(UTC 자정) 다시 시작됩니다.`,
      429,
      origin,
    );
  }

  // 6) 실제 호출
  const system = buildSystemPrompt(parsed);
  const user = buildUserPrompt(parsed);
  const startedAt = deps.now();
  try {
    const result =
      parsed.role === 'gptoss'
        ? await callGroq(env, system, user, deps.fetchImpl)
        : await callGemini(env, parsed.role === 'moderator' ? env.MODERATOR_MODEL || env.GEMINI_MODEL || 'gemini-3.5-flash-lite' : env.GEMINI_MODEL || 'gemini-3.5-flash-lite', system, user, deps.fetchImpl);

    // 사회자 결정 턴: NEXT 표식을 떼고, 실제로 고를 수 있는 후보만 인정한다.
    let text = result.text;
    let decision: TurnDecision | undefined;
    if (parsed.phase === 'decide') {
      const allowed: NextSpeaker[] = [...(parsed.participants?.length ? parsed.participants : (['gptoss', 'gemini', 'moderator'] as RoleId[])), 'done'];
      const parsedOut = parseDecisionLine(text, allowed);
      text = parsedOut.text || text;
      decision = parsedOut.decision;
    }

    const after = await store.incr(`q:${provider}:${day}`, 90000);
    const success: TurnSuccess = {
      ok: true,
      text,
      model: result.model,
      provider: result.provider,
      latencyMs: Math.max(0, deps.now() - startedAt),
      usage: result.usage,
      quota: { remaining: Math.max(0, cap - after), cap },
      ...(decision ? { decision } : {}),
    };
    return jsonResponse(success, { origin });
  } catch (e) {
    if (e instanceof ProviderError) {
      const status = e.code === 'rate_limited' ? 429 : e.code === 'not_configured' ? 503 : e.code === 'network' ? 504 : 502;
      const detail = e.detail ? ` (${e.detail})` : '';
      return errorResponse(e.code, `${e.message}${detail}`.slice(0, 600), status, origin, { retryAfter: e.retryAfter });
    }
    return errorResponse('provider_error', `예상하지 못한 오류: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400), 500, origin);
  }
}

async function handleHealth(request: Request, env: Env, deps: Deps): Promise<Response> {
  const origin = request.headers.get('origin');
  const store = createStore(env, deps);
  const day = utcDayKey(new Date(deps.now()));
  const tokenOk =
    Boolean(env.APP_ACCESS_TOKEN?.trim()) &&
    tokenEquals(request.headers.get('x-app-token') ?? '', env.APP_ACCESS_TOKEN ?? '');

  return jsonResponse(
    {
      ok: true,
      app: 'ai-roundtable',
      version: VERSION,
      models: {
        gptoss: env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b',
        gemini: env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
        moderator: env.MODERATOR_MODEL?.trim() || env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
      },
      configured: {
        groq: Boolean(env.GROQ_API_KEY?.trim()),
        gemini: Boolean(env.GEMINI_API_KEY?.trim()),
        accessToken: Boolean(env.APP_ACCESS_TOKEN?.trim()),
      },
      ...(tokenOk
        ? {
            quota: {
              groq: { used: await store.get(`q:groq:${day}`), cap: capOf(env.GROQ_DAILY_CAP, 300) },
              gemini: { used: await store.get(`q:gemini:${day}`), cap: capOf(env.GEMINI_DAILY_CAP, 300) },
            },
          }
        : {}),
      allowedOrigin: isAllowedOrigin(origin),
    },
    { origin },
  );
}

/** 테스트에서도 같은 경로를 타도록 라우팅을 함수로 분리했다. */
export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  const origin = request.headers.get('origin');
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return handleHealth(request, env, deps);
  }
  if (url.pathname === '/api/turn' && request.method === 'POST') {
    return handleTurn(request, env, deps);
  }
  if (url.pathname === '/api/summary' && request.method === 'POST') {
    return handleTurn(request, env, deps, { role: 'moderator', phase: 'summary' });
  }
  return errorResponse('bad_request', '없는 경로입니다. (/api/health, /api/turn, /api/summary)', 404, origin);
}
