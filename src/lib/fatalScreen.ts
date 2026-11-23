/**
 * React 가 화면을 그리지 못했을 때 보여줄 안내 화면.
 *
 * 검은 화면 사고(2026-11-23) 대응: 어떤 이유로든(#root 가 비어 있음, 번들 평가 실패,
 * 렌더 오류) 콘텐츠가 없으면 배경색만 남기지 않고 원인 요약과 [캐시 초기화 후 새로고침]
 * 버튼을 띄운다. 인라인 스타일만 쓴다 — CSS 파일이 404 나 오래된 캐시여도 보여야 한다.
 */
import { resetAppCache } from './resetCache';

const WRAP_STYLE = [
  'position:fixed',
  'inset:0',
  'z-index:2147483000',
  'display:flex',
  'flex-direction:column',
  'align-items:center',
  'justify-content:center',
  'gap:12px',
  'padding:24px',
  'background:#0b0d10',
  'color:#e9ecf1',
  'font:14px/1.55 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",system-ui,sans-serif',
  'text-align:center',
].join(';');

const BUTTON_STYLE = [
  'border:1px solid #3a4352',
  'background:#fee500',
  'color:#191919',
  'border-radius:10px',
  'padding:10px 14px',
  'font-size:13.5px',
  'font-weight:700',
].join(';');

const GHOST_STYLE = [
  'border:1px solid #262c35',
  'background:transparent',
  'color:#c8d0da',
  'border-radius:10px',
  'padding:9px 12px',
  'font-size:12.5px',
].join(';');

export interface FatalScreenInput {
  title?: string;
  message?: string;
  detail?: string;
}

/** 화면 전체를 덮는 안내. 여러 번 불려도 하나만 남는다. */
export function showFatalScreen(input: FatalScreenInput = {}): void {
  try {
    const doc = document;
    doc.getElementById('airt-fatal')?.remove();

    const wrap = doc.createElement('div');
    wrap.id = 'airt-fatal';
    wrap.setAttribute('role', 'alert');
    wrap.style.cssText = WRAP_STYLE;

    const title = doc.createElement('div');
    title.textContent = input.title ?? '화면을 열지 못했어';
    title.style.cssText = 'font-size:17px;font-weight:800;color:#e9ecf1';
    wrap.appendChild(title);

    const message = doc.createElement('div');
    message.textContent =
      input.message ?? '앱 파일을 받아오는 중에 문제가 생겼어. 아래 버튼을 누르면 저장된 캐시를 지우고 다시 열어.';
    message.style.cssText = 'max-width:340px;color:#c3ccd6';
    wrap.appendChild(message);

    if (input.detail) {
      const detail = doc.createElement('div');
      detail.textContent = input.detail.slice(0, 300);
      detail.style.cssText =
        'max-width:340px;color:#8d97a4;font-size:11.5px;background:#14171c;border:1px solid #262c35;border-radius:10px;padding:8px 10px;overflow-wrap:anywhere';
      wrap.appendChild(detail);
    }

    const actions = doc.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:4px';

    const reset = doc.createElement('button');
    reset.type = 'button';
    reset.textContent = '캐시 초기화 후 새로고침';
    reset.style.cssText = BUTTON_STYLE;
    reset.addEventListener('click', () => {
      reset.textContent = '초기화 중…';
      void resetAppCache();
    });
    actions.appendChild(reset);

    const reload = doc.createElement('button');
    reload.type = 'button';
    reload.textContent = '그냥 다시 시도';
    reload.style.cssText = GHOST_STYLE;
    reload.addEventListener('click', () => {
      try {
        location.reload();
      } catch {
        /* 무시 */
      }
    });
    actions.appendChild(reload);

    wrap.appendChild(actions);

    const note = doc.createElement('div');
    note.textContent = '저장된 회의·기억은 지워지지 않아. 캐시만 새로 받아.';
    note.style.cssText = 'color:#6f7987;font-size:11.5px;margin-top:2px';
    wrap.appendChild(note);

    (doc.body ?? doc.documentElement).appendChild(wrap);
  } catch {
    /* 안내조차 만들 수 없는 환경이면 아무것도 하지 않는다 */
  }
}

/** #root 에 실제 콘텐츠가 그려졌는지(인라인 로딩 문구만 남아 있으면 false). */
export function appRendered(): boolean {
  try {
    if (document.documentElement.dataset.airt === 'ready') return true;
    const root = document.getElementById('root');
    if (!root || root.childElementCount === 0) return false;
    return !root.querySelector('#airt-boot');
  } catch {
    return false;
  }
}

/**
 * 전역 오류를 잡아, 화면이 비어 있을 때만 안내 화면을 띄운다.
 * React 가 정상 동작 중인데 생긴 잡음(클립보드 거부 등)으로 화면을 덮지 않는다.
 */
export function installGlobalErrorScreen(): void {
  const onError = (event: ErrorEvent | PromiseRejectionEvent) => {
    const reason =
      'reason' in event
        ? event.reason instanceof Error
          ? event.reason.message
          : String(event.reason ?? '')
        : (event as ErrorEvent).message;
    // 에러 처리 자체가 다시 오류를 내지 않도록 다음 틱에서 확인한다.
    window.setTimeout(() => {
      if (appRendered()) return;
      showFatalScreen({ title: '앱을 시작하지 못했어', detail: reason });
    }, 0);
  };
  try {
    window.addEventListener('error', onError as EventListener);
    window.addEventListener('unhandledrejection', onError as EventListener);
  } catch {
    /* 리스너를 붙일 수 없는 환경이면 무시 */
  }
}
