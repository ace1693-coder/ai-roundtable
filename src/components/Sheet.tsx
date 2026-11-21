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

/** 모바일 하단 시트. 배경 탭·닫기 버튼으로 닫는다. */
export function Sheet({ title, open, onClose, children, testId, footer }: Props) {
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
