import type { AiId, MessageAuthor, MessageSource, ParticipantId } from './types';

export interface ParticipantMeta {
  id: ParticipantId;
  name: string;
  color: string;
  colorTo?: string;
  avatarKind: 'openai' | 'gemini' | 'pickle' | 'user';
  /** 이 앱에서 이 참가자의 응답이 어디서 오는지 (가짜 접속 상태를 만들지 않기 위한 표기) */
  transport: '게스트 웹 수동 연결' | 'API 직접 연결(선택)' | '로컬 규칙 엔진' | '나';
}

export const PARTICIPANTS: Record<ParticipantId, ParticipantMeta> = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    color: '#10A37F',
    avatarKind: 'openai',
    transport: '게스트 웹 수동 연결',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    color: '#4285F4',
    colorTo: '#9B72CB',
    avatarKind: 'gemini',
    transport: '게스트 웹 수동 연결',
  },
  pickle: {
    id: 'pickle',
    name: 'Pickle',
    color: '#FF7A00',
    avatarKind: 'pickle',
    transport: '게스트 웹 수동 연결',
  },
  me: {
    id: 'me',
    name: '나',
    color: '#FEE500',
    avatarKind: 'user',
    transport: '나',
  },
};

export function authorName(author: MessageAuthor, displayName: string): string {
  if (author === 'system') return '로컬 규칙 엔진';
  if (author === 'me') return displayName || '나';
  return PARTICIPANTS[author].name;
}

export function authorColor(author: MessageAuthor): string {
  if (author === 'system') return '#6b7280';
  return PARTICIPANTS[author].color;
}

export const SOURCE_LABEL: Record<MessageSource, string> = {
  user: '사용자',
  manual: '수동 입력',
  api: '실제 API',
  local: '로컬 규칙 엔진',
};

export function isAi(id: string): id is AiId {
  return id === 'chatgpt' || id === 'gemini' || id === 'pickle';
}
