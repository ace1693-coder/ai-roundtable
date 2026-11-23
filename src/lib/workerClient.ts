import type { Settings } from './types';
import { clientSessionId } from './storage';
import type { ApiErrorCode, HealthInfo, TurnRequest, TurnResponse, TurnSuccess } from '../../shared/protocol';

export class WorkerError extends Error {
  code: ApiErrorCode;
  status: number;
  retryAfter?: number;
  findings?: string[];

  constructor(message: string, code: ApiErrorCode, status = 0, extra?: { retryAfter?: number; findings?: string[] }) {
    super(message);
    this.name = 'WorkerError';
    this.code = code;
    this.status = status;
    this.retryAfter = extra?.retryAfter;
    this.findings = extra?.findings;
  }
}

export function normalizeWorkerUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

export function isWorkerConfigured(settings: Settings): boolean {
  return Boolean(normalizeWorkerUrl(settings.workerUrl) && settings.accessCode.trim());
}

function configOf(settings: Settings): { url: string; token: string } {
  const url = normalizeWorkerUrl(settings.workerUrl);
  const token = settings.accessCode.trim();
  if (!url) throw new WorkerError('Worker 주소가 설정되지 않았습니다. 설정에서 배포한 Worker URL을 넣어 주세요.', 'not_configured');
  if (!token) throw new WorkerError('개인용 접근 패스코드가 없습니다. 설정에서 APP_ACCESS_TOKEN 값을 넣어 주세요.', 'not_configured');
  return { url, token };
}

async function post(path: string, body: unknown, settings: Settings, timeoutMs = 120_000): Promise<TurnSuccess> {
  const { url, token } = configOf(settings);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-token': token, 'x-session-id': clientSessionId() },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError' ? '응답 시간 초과(120초)' : '네트워크 연결 실패';
    throw new WorkerError(`${reason} — Worker 주소와 배포 상태를 확인해 주세요.`, 'network');
  } finally {
    clearTimeout(timer);
  }

  let payload: TurnResponse | null = null;
  try {
    payload = (await res.json()) as TurnResponse;
  } catch {
    payload = null;
  }

  if (!res.ok || !payload || payload.ok === false) {
    const fail = payload && payload.ok === false ? payload : null;
    throw new WorkerError(
      fail?.message ?? `Worker가 HTTP ${res.status}로 응답했습니다.`,
      fail?.code ?? 'provider_error',
      res.status,
      { retryAfter: fail?.retryAfter, findings: fail?.findings },
    );
  }
  return payload;
}

export function requestTurn(settings: Settings, body: TurnRequest): Promise<TurnSuccess> {
  return post('/api/turn', body, settings);
}

export function requestSummary(settings: Settings, body: TurnRequest): Promise<TurnSuccess> {
  return post('/api/summary', body, settings);
}

export async function checkHealth(settings: Settings): Promise<HealthInfo> {
  const url = normalizeWorkerUrl(settings.workerUrl);
  if (!url) throw new WorkerError('Worker 주소가 비어 있습니다.', 'not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${url}/api/health`, {
      headers: {
        ...(settings.accessCode.trim() ? { 'x-app-token': settings.accessCode.trim() } : {}),
        'x-session-id': clientSessionId(),
      },
      signal: controller.signal,
    });
    const data = (await res.json()) as HealthInfo | { ok: false; message?: string };
    if (!res.ok || !('models' in data)) {
      const message = 'message' in data && data.message ? data.message : `HTTP ${res.status}`;
      throw new WorkerError(`Worker 점검 실패: ${message}`, 'provider_error', res.status);
    }
    return data;
  } catch (e) {
    if (e instanceof WorkerError) throw e;
    throw new WorkerError('Worker에 닿지 않습니다. 주소·배포 상태를 확인해 주세요.', 'network');
  } finally {
    clearTimeout(timer);
  }
}
