import type { ParticipantId } from '../lib/types';
import { PARTICIPANTS } from '../lib/participants';

interface Props {
  id: ParticipantId;
  size?: number;
  emoji?: string;
  className?: string;
}

const SIZES = { sm: 26, md: 36, lg: 48 };

/** 각 참가자의 정체성이 한눈에 구분되도록 인라인 SVG로 그린다(외부 이미지·로고 파일 의존 없음). */
export function Avatar({ id, size = SIZES.md, emoji, className }: Props) {
  const meta = PARTICIPANTS[id] ?? PARTICIPANTS.me;
  const grad = `grad-${id}`;
  const dim = Math.max(20, size);
  const r = dim / 2;

  return (
    <span
      className={`avatar ${className ?? ''}`}
      style={{ width: dim, height: dim }}
      aria-label={`${meta.name} 프로필`}
      data-testid={`avatar-${id}`}
    >
      <svg viewBox="0 0 48 48" width={dim} height={dim} role="img" aria-hidden="true">
        <defs>
          {meta.colorTo ? (
            <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={meta.color} />
              <stop offset="100%" stopColor={meta.colorTo} />
            </linearGradient>
          ) : null}
        </defs>
        <circle cx="24" cy="24" r="24" fill={meta.colorTo ? `url(#${grad})` : meta.color} />
        {meta.avatarKind === 'openai' ? (
          // OpenAI 느낌의 6겹 매듭 심볼(자체 도형으로 단순화)
          <g stroke="#ffffff" strokeWidth="2.6" fill="none" strokeLinecap="round">
            {[0, 60, 120, 180, 240, 300].map((deg) => (
              <path
                key={deg}
                d="M24 12.5 L24 24"
                transform={`rotate(${deg} 24 24)`}
                strokeWidth="2.6"
              />
            ))}
            <circle cx="24" cy="24" r="5.2" />
            {[0, 60, 120, 180, 240, 300].map((deg) => (
              <path
                key={`p${deg}`}
                d="M24 12.5 A9 9 0 0 1 31.8 16.8"
                transform={`rotate(${deg} 24 24)`}
              />
            ))}
          </g>
        ) : null}
        {meta.avatarKind === 'gemini' ? (
          // 네 갈래 스파클
          <path
            d="M24 8 C25.6 17 31 22.4 40 24 C31 25.6 25.6 31 24 40 C22.4 31 17 25.6 8 24 C17 22.4 22.4 17 24 8 Z"
            fill="#ffffff"
          />
        ) : null}
        {meta.avatarKind === 'pickle' ? (
          // 피클 캐릭터: ㄴ 자음 + 두 눈
          <g>
            <path d="M16 15 L16 31 L30 31" stroke="#ffffff" strokeWidth="4.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="24" cy="19" r="2.2" fill="#ffffff" />
            <circle cx="30" cy="19" r="2.2" fill="#ffffff" />
          </g>
        ) : null}
        {meta.avatarKind === 'user' ? (
          <g>
            {emoji ? (
              <text x="24" y="31" textAnchor="middle" fontSize="22">
                {emoji}
              </text>
            ) : (
              <>
                <circle cx="24" cy="19" r="6.2" fill="#1f2937" />
                <path d="M12 40 C13.5 31 34.5 31 36 40" fill="#1f2937" />
              </>
            )}
          </g>
        ) : null}
        {r < 0 ? null : null}
      </svg>
    </span>
  );
}
