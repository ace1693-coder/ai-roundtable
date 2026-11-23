import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  footer?: ReactNode;
}

/** 모바일 하단 시트. 배경 탭·닫기 버튼·ESC 로 닫는다. */
export function Sheet({ title, open, onClose, children, testId, footer }: Props) {
  // ESC 로 닫기. 저장 버튼을 누른 뒤 시트가 그대로 남아 아래 화면을 막는 일을 없앤다.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button className="sheet-backdrop" aria-label="닫기" onClick={onClose} />
      <div className="sheet" data-testid={testId}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기" data-testid="sheet-close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
