import type { ApiErrorCode } from '../../shared/protocol';

/**
 * CORS는 사용자의 GitHub Pages 주소와 로컬 개발 주소만 허용한다.
 * 그 외 출처(다른 사람이 만든 페이지)는 개인용 패스코드를 알더라도 브라우저에서 부를 수 없다.
 */
const ALLOWED_ORIGINS: RegExp[] = [
  /^https:\/\/ace1693-coder\.github\.io$/,
  /^http:\/\/localhost(:\d{1,5})?$/,
  /^http:\/\/127\.0\.0\.1(:\d{1,5})?$/,
];

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some((re) => re.test(origin));
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-app-token, x-session-id',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin as string;
  return headers;
}

/** 길이가 달라도 끝까지 비교해 응답 시간으로 토큰을 추측하지 못하게 한다. */
export function tokenEquals(provided: string, expected: string): boolean {
  const a = provided ?? '';
  const b = expected ?? '';
  if (!b) return false;
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    if (i > 4096) break;
  }
  return diff === 0 && a.length === b.length;
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export function jsonResponse(
  body: unknown,
  init: { status?: number; origin: string | null; extraHeaders?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(init.origin),
      ...(init.extraHeaders ?? {}),
    },
  });
}

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  status: number,
  origin: string | null,
  extra?: { retryAfter?: number; findings?: string[] },
): Response {
  return jsonResponse(
    { ok: false, code, message, ...(extra?.retryAfter ? { retryAfter: extra.retryAfter } : {}), ...(extra?.findings ? { findings: extra.findings } : {}) },
    { status, origin },
  );
}
