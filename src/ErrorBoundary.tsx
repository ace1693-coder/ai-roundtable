import { Component, type ErrorInfo, type ReactNode } from 'react';
import { resetAppCache } from './lib/resetCache';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 렌더 중 예외가 나도 검은 화면을 남기지 않는다.
 * React 18 은 오류를 잡는 경계가 없으면 루트를 통째로 비워 버리기 때문에 반드시 필요하다.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 콘솔에도 남긴다(폰에서 원인을 물어볼 때 근거가 된다).
    try {
      console.error('[AI Roundtable] 렌더 오류', error, info.componentStack);
    } catch {
      /* 무시 */
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>화면을 그리지 못했어</h1>
        <p>앱에서 오류가 났어. 저장된 회의·기억은 그대로 있고, 캐시만 새로 받으면 대부분 해결돼.</p>
        <pre>{error.message || String(error)}</pre>
        <div className="crash-actions">
          <button className="btn primary" type="button" onClick={() => void resetAppCache()}>
            캐시 초기화 후 새로고침
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              this.setState({ error: null });
            }}
          >
            그냥 다시 시도
          </button>
        </div>
      </div>
    );
  }
}
