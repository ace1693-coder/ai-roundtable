import { handle } from './app';
import type { Env } from './providers';

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * Cloudflare 진입점. workerd는 named export를 모두 바인딩으로 읽으므로
 * 이 파일에는 default export만 둔다. 라우팅은 app.ts의 handle이 맡는다.
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContextLike): Promise<Response> {
    return handle(request, env, { fetchImpl: fetch, now: Date.now });
  },
};
