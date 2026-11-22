/** AI 참가자 3명. 모델·제공업체는 실제 호출 대상과 정확히 일치시킨다. */
export type AiId = 'gptoss' | 'gemini' | 'moderator';
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
  /** 실제 응답을 만든 모델 ID와 제공업체. 로컬·수동 메시지에는 없다. */
  model?: string;
  provider?: string;
  latencyMs?: number;
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
  /**
   * 이미 AI에게 최우선 지시로 전달한 사용자 발언의 id.
   * 같은 말을 매 턴 다시 밀어 넣지 않으면서, 전달되지 못한 말은 잃지 않게 남긴다.
   */
  directiveSentId?: string;
  lastSpeaker?: MessageAuthor;
  usedMemoryIds: string[];
  repeatWarnings: number;
  summary?: string;
  /** 표시용: AI 발언 수(고정 상한 아님). 예전 값과의 호환을 위해 남긴다. */
  maxTurns: number;
  /** 자동 회의 루프 켜짐 여부. 사용자가 일시정지하면 false가 된다. */
  auto: boolean;
  /** AI별 켜짐/꺼짐. 꺼진 AI는 실제 API를 부르지 않는다. */
  enabledAi: Record<AiId, boolean>;
  /** 사회자가 정한 다음 발언자. 'done'이면 회의를 마무리한다. */
  nextSpeaker?: AiId | 'done';
  /** 사회자의 결정을 기다리는 중인지 */
  awaitingDecision?: boolean;
  /** 마지막 결정 요약(화면 표시용) */
  lastDecision?: { next: AiId | 'done'; reason?: string };
  /** 이 회의에서 실제 Worker 호출 횟수(예산 계산) */
  callCount: number;
  /** 회의를 멈춘 이유 */
  endedReason?: EndedReason;
}

export type EndedReason = 'user' | 'moderator_done' | 'budget' | 'repeat' | 'all_disabled' | 'error' | 'sensitive';

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
  /** Cloudflare Worker 배포 주소. 예: https://ai-roundtable.xxxx.workers.dev */
  workerUrl: string;
  /** 개인용 접근 패스코드(Worker의 APP_ACCESS_TOKEN과 같은 값). API 키는 여기에 넣지 않는다. */
  accessCode: string;
  /** 회의당 AI 발언 수(2라운드=6). 무료 한도를 아끼려면 4. */
  maxTurns: number;
}

export interface AppData {
  meetings: Meeting[];
  memories: MemoryItem[];
  settings: Settings;
  activeMeetingId: string | null;
}

export const AI_IDS: AiId[] = ['gptoss', 'gemini', 'moderator'];

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
