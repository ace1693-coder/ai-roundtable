import type { AiId, MessageAuthor, MessageSource, ParticipantId } from './types';
import { MODEL_SPECS } from '../config/models';

export interface ParticipantMeta {
  id: ParticipantId;
  name: string;
  color: string;
  colorTo?: string;
  avatarKind: 'openai' | 'gemini' | 'pickle' | 'user';
  /** 실제 호출 대상 모델 ID와 제공업체. UI에 그대로 표시한다. */
  model: string;
  provider: string;
  /** 이 앱에서 이 참가자의 응답이 어디서 오는지 (가짜 접속 상태를 만들지 않기 위한 표기) */
  transport: string;
}

/**
 * GPT-OSS는 ChatGPT가 아니다. GroqCloud가 호스팅하는 OpenAI의 오픈웨이트 모델이며
 * 화면에도 `openai/gpt-oss-120b · GroqCloud`로 정확히 적는다.
 */
export const PARTICIPANTS: Record<ParticipantId, ParticipantMeta> = {
  gptoss: {
    id: 'gptoss',
    name: MODEL_SPECS.gptoss.label,
    color: '#F55036',
    colorTo: '#B4341F',
    avatarKind: 'openai',
    model: MODEL_SPECS.gptoss.model,
    provider: MODEL_SPECS.gptoss.provider,
    transport: MODEL_SPECS.gptoss.transport,
  },
  gemini: {
    id: 'gemini',
    name: MODEL_SPECS.gemini.label,
    color: '#4285F4',
    colorTo: '#9B72CB',
    avatarKind: 'gemini',
    model: MODEL_SPECS.gemini.model,
    provider: MODEL_SPECS.gemini.provider,
    transport: MODEL_SPECS.gemini.transport,
  },
  moderator: {
    id: 'moderator',
    name: MODEL_SPECS.moderator.label,
    color: '#FF7A00',
    colorTo: '#C85A00',
    avatarKind: 'pickle',
    model: MODEL_SPECS.moderator.model,
    provider: MODEL_SPECS.moderator.provider,
    transport: MODEL_SPECS.moderator.transport,
  },
  me: {
    id: 'me',
    name: '나',
    color: '#FEE500',
    avatarKind: 'user',
    model: '',
    provider: '',
    transport: '나',
  },
};

export function authorName(author: MessageAuthor, displayName: string): string {
  if (author === 'system') return '앱';
  if (author === 'me') return displayName || '나';
  return PARTICIPANTS[author]?.name ?? String(author);
}

export function authorColor(author: MessageAuthor): string {
  if (author === 'system') return '#6b7280';
  return PARTICIPANTS[author]?.color ?? '#6b7280';
}

export const SOURCE_LABEL: Record<MessageSource, string> = {
  user: '사용자',
  manual: '수동 입력',
  api: '실제 API',
  local: '앱',
};

export function isAi(id: string): id is AiId {
  return id === 'gptoss' || id === 'gemini' || id === 'moderator';
}
