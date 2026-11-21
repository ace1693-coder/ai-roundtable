export type AiId = 'chatgpt' | 'gemini' | 'pickle';
export type ParticipantId = AiId | 'me';
export type MessageAuthor = ParticipantId | 'system';

/** 말풍선마다 남는 출처. 실제로 연결된 것처럼 보이는 값을 만들지 않기 위해 4종만 쓴다. */
export type MessageSource = 'user' | 'manual' | 'api' | 'local';

export type MemoryStatus = '검증된 사실' | '가설' | '확인 필요' | '폐기된 정보';

export type MemoryType =
  | '사실'
  | '아이디어'
  | '실행 결과'
  | '실패 원인'
  | '정정 정보'
  | '배경지식'
  | '사용자 선호';

export type Domain = 'manufacturing' | 'business' | 'appdev' | 'health' | 'general';

export interface Attachment {
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
}

export interface ChatMessage {
  id: string;
  authorId: MessageAuthor;
  text: string;
  createdAt: number;
  source: MessageSource;
  /** 발언 당시의 역할. 역할이 바뀐 뒤에도 과거 표기가 맞도록 메시지에 남긴다. */
  roleAtTime: string;
  attachment?: Attachment;
  editedAt?: number;
  deleted?: boolean;
  pinned?: boolean;
  memoryId?: string;
}

export type MeetingStatus = 'active' | 'paused' | 'ended';

export interface Meeting {
  id: string;
  title: string;
  topic: string;
  domain: Domain;
  createdAt: number;
  updatedAt: number;
  roles: Record<AiId, string>;
  status: MeetingStatus;
  messages: ChatMessage[];
  /** 사용자가 멘션으로 지정했거나 우선 처리해야 하는 응답 대기열. */
  queue: AiId[];
  lastSpeaker?: MessageAuthor;
  usedMemoryIds: string[];
  repeatWarnings: number;
  summary?: string;
}

export interface MemoryItem {
  id: string;
  title: string;
  body: string;
  status: MemoryStatus;
  type: MemoryType;
  tags: string[];
  sourceMeetingId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  displayName: string;
  avatarEmoji: string;
  /** 사용자가 직접 넣은 키. 앱은 이 값을 서버로 보내지 않는다(정적 앱, localStorage에만 저장). */
  apiKeys: { openai: string; gemini: string };
  /** 켜져 있고 해당 키가 있을 때만 실제 fetch 호출을 한다. 기본은 꺼짐(수동 모드). */
  autoApi: boolean;
  models: { openai: string; gemini: string };
}

export interface AppData {
  meetings: Meeting[];
  memories: MemoryItem[];
  settings: Settings;
  activeMeetingId: string | null;
}

export const AI_IDS: AiId[] = ['chatgpt', 'gemini', 'pickle'];

export const MEMORY_STATUSES: MemoryStatus[] = ['검증된 사실', '가설', '확인 필요', '폐기된 정보'];

export const MEMORY_TYPES: MemoryType[] = [
  '사실',
  '아이디어',
  '실행 결과',
  '실패 원인',
  '정정 정보',
  '배경지식',
  '사용자 선호',
];
