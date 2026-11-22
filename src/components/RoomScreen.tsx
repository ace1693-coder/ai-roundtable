import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AiId, Attachment, ChatMessage, Meeting, MemoryItem, Settings } from '../lib/types';
import { AI_IDS, MEMORY_STATUSES, MEMORY_TYPES } from '../lib/types';
import { PARTICIPANTS, SOURCE_LABEL, authorName } from '../lib/participants';
import { formatDateDivider, formatTime, GROUP_WINDOW_MS, isSameDay } from '../lib/format';
import { activeMentionQuery, filterMentionOptions } from '../lib/mentions';
import { averageLatency, describeProgress, planNextTurn } from '../lib/meetingEngine';
import { PHASE_LABEL } from '../../shared/protocol';
import { callBudget } from '../config/meeting';
import type { TurnStatus } from '../App';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { MemorySheet, SettingsSheet } from './DataSheets';

export interface RoomActions {
  send: (text: string, attachment?: Attachment) => void;
  pause: () => void;
  resume: () => void;
  end: () => void;
  reopen: () => void;
  pin: (id: string) => void;
  edit: (id: string, text: string) => void;
  remove: (id: string) => void;
  saveMemory: (msg: ChatMessage, draft: { status: MemoryItem['status']; type: MemoryItem['type']; tags: string[] }) => void;
  saveSettings: (s: Settings) => void;
  addMemory: (draft: { title: string; body: string; status: MemoryItem['status']; type: MemoryItem['type']; tags: string[] }) => void;
  deleteMemory: (id: string) => void;
  importMemories: (text: string) => void;
  exportAll: () => void;
  importAll: (text: string) => void;
  copy: (text: string, label: string) => void;
  beginAuto: () => void;
  /** AI 한 명 켜기/끄기. 꺼진 AI는 실제 API를 부르지 않는다. */
  toggleAi: (id: AiId) => void;
}

interface Props {
  meeting: Meeting;
  memories: MemoryItem[];
  settings: Settings;
  running: boolean;
  turnStatus: Record<AiId, TurnStatus>;
  workerReady: boolean;
  actions: RoomActions;
  onBack: () => void;
  onOpenSettings: () => void;
  toast: string;
  externalSheet?: React.ReactNode;
}

type SheetName = 'participants' | 'search' | 'memory' | 'settings' | 'summary' | 'saveMemory' | 'menu' | null;

const STATUS_TEXT: Record<TurnStatus, string> = {
  idle: '대기',
  thinking: '생각 중',
  done: '완료',
  error: '오류',
};

export function RoomScreen({
  meeting,
  memories,
  settings,
  running,
  turnStatus,
  workerReady,
  actions,
  onBack,
  onOpenSettings,
  toast,
  externalSheet,
}: Props) {
  const [sheet, setSheet] = useState<SheetName>(null);
  const [text, setText] = useState('');
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [attachment, setAttachment] = useState<Attachment | undefined>();
  const [search, setSearch] = useState('');
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [memoryTarget, setMemoryTarget] = useState<ChatMessage | null>(null);
  const [memoryDraft, setMemoryDraft] = useState<{ status: MemoryItem['status']; type: MemoryItem['type']; tags: string }>({
    status: '가설',
    type: '사실',
    tags: '',
  });
  const [highlight, setHighlight] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const nearBottom = useRef(true);

  const visible = useMemo(() => meeting.messages.filter((m) => !m.deleted), [meeting.messages]);
  const pinned = useMemo(() => [...visible].reverse().find((m) => m.pinned), [visible]);
  const displayName = settings.displayName || '나';
  const plan = useMemo(() => planNextTurn(meeting), [meeting]);
  const avgLatency = averageLatency(meeting);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [meeting.messages.length, sheet, running]);

  useEffect(() => {
    if (!highlight) return;
    const t = window.setTimeout(() => setHighlight(null), 2500);
    return () => window.clearTimeout(t);
  }, [highlight]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  function insertMention(insert: string) {
    const el = inputRef.current;
    if (!mention || !el) return;
    const caret = el.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}${insert}${text.slice(caret)}`;
    pendingCaret.current = mention.start + insert.length;
    setText(next);
    setMention(null);
  }

  useLayoutEffect(() => {
    if (pendingCaret.current == null) return;
    const el = inputRef.current;
    if (!el) return;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    el.focus();
    el.setSelectionRange(pos, pos);
  }, [text]);

  function submit() {
    const body = text.trim();
    if (!body && !attachment) return;
    if (meeting.status === 'ended') return;
    actions.send(body, attachment);
    setText('');
    setAttachment(undefined);
    setMention(null);
    nearBottom.current = true;
  }

  function jumpTo(id: string) {
    setSheet(null);
    setHighlight(id);
    requestAnimationFrame(() => {
      document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  const searchResults = visible.filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return false;
    return m.text.toLowerCase().includes(q) || authorName(m.authorId, displayName).toLowerCase().includes(q);
  });

  const roleOf = (m: ChatMessage) => {
    if (m.authorId === 'system') return '';
    if (m.authorId === 'me') return '';
    return m.roleAtTime || meeting.roles[m.authorId];
  };

  return (
    <div className="room">
      <header className="room-head">
        <button className="icon-btn" onClick={onBack} aria-label="뒤로" data-testid="back-button">
          <Icon name="back" size={22} />
        </button>
        <div className="room-title-wrap">
          <h1 data-testid="room-title">{meeting.title}</h1>
          <p>
            <span data-testid="participant-count">참가자 4명</span> ·{' '}
            <span data-testid="progress-text">{describeProgress(meeting)}</span> ·{' '}
            {meeting.status === 'active' ? (running ? '진행 중' : '대기') : meeting.status === 'paused' ? '일시정지' : '종료'}
          </p>
        </div>
        <button className="icon-btn" onClick={() => setSheet('search')} aria-label="대화 검색" data-testid="search-btn">
          <Icon name="search" size={19} />
        </button>
        <button className="icon-btn" onClick={() => setSheet('participants')} aria-label="참가자" data-testid="participants-btn">
          <Icon name="users" size={19} />
        </button>
        <button className="icon-btn" onClick={() => setSheet('menu')} aria-label="메뉴" data-testid="menu-btn">
          <Icon name="menu" size={19} />
        </button>
      </header>

      <div className="status-chips" data-testid="status-chips">
        {AI_IDS.map((id) => (
          <span key={id} className={`chip-status st-${turnStatus[id]} dot-${id}`} data-testid={`status-${id}`}>
            <i className="dot" /> {PARTICIPANTS[id].name} · {STATUS_TEXT[turnStatus[id]]}
          </span>
        ))}
      </div>

      {pinned ? (
        <div className="pin-banner" data-testid="pin-banner">
          <span className="pin-icon" aria-hidden="true">
            <Icon name="pin" size={15} />
          </span>
          <span className="pin-text" data-testid="pin-banner-text">
            {pinned.text}
          </span>
          <button className="link" onClick={() => actions.pin(pinned.id)} data-testid="pin-remove">
            해제
          </button>
        </div>
      ) : null}

      <div className="msg-list" ref={listRef} onScroll={onScroll} data-testid="msg-list">
        {visible.length === 0 ? (
          <div className="empty-room">
            <p>회의방이 열렸습니다.</p>
            <p className="hint">
              질문을 입력하면 <b>GPT-OSS</b> → <b>Gemini</b> → <b>사회자</b> 순서로 실제 API가 답합니다. 중간에 끼어들면 그
              말이 다음 발언에 최우선으로 반영됩니다.
            </p>
            {!workerReady ? (
              <button className="btn primary" onClick={onOpenSettings} data-testid="empty-open-settings">
                Worker 연결 설정
              </button>
            ) : null}
          </div>
        ) : null}
        {visible.map((m, i) => {
          const prev = visible[i - 1];
          const newDate = !prev || !isSameDay(prev.createdAt, m.createdAt);
          const grouped = !newDate && prev && prev.authorId === m.authorId && m.createdAt - prev.createdAt < GROUP_WINDOW_MS;
          const isSystem = m.authorId === 'system';
          const mine = m.authorId === 'me';
          const aiAuthor = m.authorId !== 'me' && m.authorId !== 'system' ? m.authorId : null;
          return (
            <div key={m.id}>
              {newDate ? (
                <div className="date-divider">
                  <span>{formatDateDivider(m.createdAt)}</span>
                </div>
              ) : null}
              <div
                id={`msg-${m.id}`}
                className={`msg-row ${isSystem ? 'system' : mine ? 'me' : 'ai'} ${grouped ? 'grouped' : ''} ${
                  highlight === m.id ? 'highlight' : ''
                }`}
                data-testid="message"
                data-author={m.authorId}
                data-source={m.source}
              >
                {aiAuthor ? <div className="avatar-col">{grouped ? null : <Avatar id={aiAuthor} size={36} />}</div> : null}
                <div className="msg-body">
                  {!grouped && !isSystem ? (
                    <div className="msg-meta">
                      <span className={`msg-name name-${m.authorId}`}>{aiAuthor ? PARTICIPANTS[aiAuthor].name : displayName}</span>
                      {roleOf(m) ? (
                        <span className="msg-role" data-testid="msg-role">
                          · {roleOf(m)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {isSystem ? (
                    <div className="system-bubble" data-testid="system-notice">
                      <span className="system-src">앱 알림</span>
                      <p>{m.text}</p>
                    </div>
                  ) : (
                    <button
                      className={`bubble ${mine ? 'bubble-me' : 'bubble-ai'}`}
                      onClick={() => setActionMsg(actionMsg === m.id ? null : m.id)}
                      data-testid="msg-bubble"
                      aria-label="메시지 동작"
                    >
                      <span className="msg-text" data-testid="msg-text">
                        {m.text}
                      </span>
                      {m.attachment ? (
                        <span className="attachment">
                          {m.attachment.type.startsWith('image/') && m.attachment.dataUrl ? (
                            <img src={m.attachment.dataUrl} alt={m.attachment.name} />
                          ) : (
                            <span className="file-chip">📎 {m.attachment.name}</span>
                          )}
                        </span>
                      ) : null}
                      {m.source === 'api' && m.model ? (
                        <span className="model-line" data-testid="msg-model">
                          {m.model} · {m.provider}
                          {m.latencyMs ? ` · ${(m.latencyMs / 1000).toFixed(1)}s` : ''}
                        </span>
                      ) : null}
                      <span className={`source-badge src-${m.source}`} data-testid="msg-source">
                        출처: {SOURCE_LABEL[m.source]}
                      </span>
                      <span className="msg-time" data-testid="msg-time">
                        {formatTime(m.createdAt)}
                      </span>
                    </button>
                  )}
                  {m.editedAt ? <span className="edited">수정됨</span> : null}
                  {actionMsg === m.id && !isSystem ? (
                    <div className="msg-actions" data-testid="msg-actions">
                      <button
                        data-testid="msg-copy"
                        onClick={() => {
                          actions.copy(m.text, '메시지를 복사했습니다.');
                          setActionMsg(null);
                        }}
                      >
                        복사
                      </button>
                      <button
                        data-testid="msg-pin"
                        onClick={() => {
                          actions.pin(m.id);
                          setActionMsg(null);
                        }}
                      >
                        {m.pinned ? '고정 해제' : '고정'}
                      </button>
                      <button
                        data-testid="msg-save-memory"
                        onClick={() => {
                          setMemoryTarget(m);
                          setMemoryDraft({ status: '가설', type: '사실', tags: '' });
                          setSheet('saveMemory');
                          setActionMsg(null);
                        }}
                      >
                        기억 저장
                      </button>
                      {mine ? (
                        <>
                          <button
                            data-testid="msg-edit"
                            onClick={() => {
                              setEditing({ id: m.id, text: m.text });
                              setActionMsg(null);
                            }}
                          >
                            수정
                          </button>
                          <button
                            data-testid="msg-delete"
                            onClick={() => {
                              actions.remove(m.id);
                              setActionMsg(null);
                            }}
                          >
                            삭제
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {m.memoryId ? <span className="saved-note">기억 저장소에 저장됨</span> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!workerReady ? (
        <div className="turn-bar paused" data-testid="worker-missing-bar">
          <div className="turn-main">
            <b>Worker 연결 필요</b>
            <span className="turn-note">배포한 Worker URL과 개인용 패스코드를 넣으면 자동 회의가 시작됩니다.</span>
          </div>
          <div className="turn-actions">
            <button className="btn primary" onClick={onOpenSettings} data-testid="open-settings-missing">
              설정 열기
            </button>
          </div>
        </div>
      ) : meeting.status === 'active' && meeting.auto ? (
        <div className="turn-bar running" data-testid="auto-bar">
          <div className="turn-main">
            <span className="thinking-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <div className="turn-target-wrap">
              <b data-testid="turn-target">{plan ? PARTICIPANTS[plan.speaker].name : '정리 중'}</b>
              <span className="turn-role"> · {plan ? PHASE_LABEL[plan.phase] : '마무리'}</span>
              <div className="turn-note">
                실제 API 호출 {(meeting.callCount ?? 0) + 1}/{callBudget()}
                {plan?.mode === 'decide' ? ' · 사회자가 다음 발언자를 고르는 중' : ''}
                {avgLatency !== null ? ` · 평균 응답 ${(avgLatency / 1000).toFixed(1)}초` : ''}
              </div>
            </div>
          </div>
          <div className="turn-actions">
            <button className="btn" onClick={actions.pause} data-testid="pause-btn">
              일시정지
            </button>
          </div>
        </div>
      ) : meeting.status === 'paused' ? (
        <div className="turn-bar paused" data-testid="pause-bar">
          <div className="turn-main">
            <b>일시정지</b>
            <span className="turn-note">자동 발언을 멈췄습니다. 대화는 그대로 남아 있습니다.</span>
          </div>
          <div className="turn-actions">
            <button className="btn primary" onClick={actions.resume} data-testid="resume-btn">
              재개
            </button>
            <button className="btn" onClick={() => setSheet('summary')} data-testid="summary-from-pause">
              요약
            </button>
          </div>
        </div>
      ) : meeting.status === 'ended' ? (
        <div className="turn-bar ended" data-testid="ended-bar">
          <div className="turn-main">
            <b>회의 종료</b>
            <span className="turn-note">{meeting.summary ? '사회자의 최종 정리가 저장되어 있습니다.' : '저장된 발언은 그대로 남습니다.'}</span>
          </div>
          <div className="turn-actions">
            <button className="btn" onClick={actions.reopen} data-testid="reopen-btn">
              이어가기
            </button>
            <button className="btn" onClick={() => setSheet('summary')} data-testid="summary-open-2">
              요약 보기
            </button>
          </div>
        </div>
      ) : (
        <div className="turn-bar paused" data-testid="ready-bar">
          <div className="turn-main">
            <b>다음 발언 대기</b>
            <span className="turn-note">
              {plan ? `${PARTICIPANTS[plan.speaker].name} · ${PHASE_LABEL[plan.phase]}` : '남은 발언이 없습니다.'}
            </span>
          </div>
          <div className="turn-actions">
            <button className="btn primary" onClick={actions.beginAuto} data-testid="start-auto">
              자동 회의 시작
            </button>
          </div>
        </div>
      )}

      <div className="composer">
        {mention ? (
          <div className="mention-popup" data-testid="mention-popup">
            {filterMentionOptions(mention.query).map((o) => (
              <button key={o.id} data-testid={`mention-option-${o.id}`} onClick={() => insertMention(o.insert)}>
                <span className={`mention-dot dot-${o.id}`} />
                {o.label}
              </button>
            ))}
            {filterMentionOptions(mention.query).length === 0 ? <span className="hint">일치하는 참가자가 없습니다.</span> : null}
          </div>
        ) : null}
        {attachment ? (
          <div className="attach-preview" data-testid="attach-preview">
            {attachment.type.startsWith('image/') && attachment.dataUrl ? (
              <img src={attachment.dataUrl} alt={attachment.name} />
            ) : (
              <span>📎 {attachment.name}</span>
            )}
            <button className="link" onClick={() => setAttachment(undefined)}>
              제거
            </button>
          </div>
        ) : null}
        <div className="quick-mentions">
          {AI_IDS.map((id) => (
            <button
              key={id}
              className={`chip dot-${id}`}
              onClick={() => setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${PARTICIPANTS[id].name} `)}
            >
              @{PARTICIPANTS[id].name}
            </button>
          ))}
          <button className="chip" onClick={() => setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@전체 `)}>
            @전체
          </button>
        </div>
        <div className="composer-row">
          <label className="icon-btn attach" aria-label="파일·사진 첨부">
            ＋
            <input
              type="file"
              accept="image/*,.pdf,.txt"
              data-testid="attach-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 1.5 * 1024 * 1024) {
                  alert('첨부는 1.5MB 이하만 가능합니다(기기 저장 공간 보호).');
                  e.target.value = '';
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  setAttachment({ name: f.name, type: f.type, size: f.size, dataUrl: String(reader.result) });
                };
                if (f.type.startsWith('image/')) reader.readAsDataURL(f);
                else setAttachment({ name: f.name, type: f.type, size: f.size });
                e.target.value = '';
              }}
            />
          </label>
          <textarea
            ref={inputRef}
            className="composer-input"
            data-testid="composer-input"
            placeholder={meeting.status === 'ended' ? '종료됨 · 이어가기를 누르세요' : '끼어들 말 입력 (@로 AI 지정)'}
            value={text}
            disabled={meeting.status === 'ended'}
            rows={1}
            onChange={(e) => {
              setText(e.target.value);
              const caret = e.target.selectionStart ?? e.target.value.length;
              setMention(activeMentionQuery(e.target.value, caret));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') setMention(null);
            }}
          />
          <button className="send-btn" onClick={submit} disabled={meeting.status === 'ended'} data-testid="send-button" aria-label="전송">
            <Icon name="send" size={20} />
          </button>
        </div>
      </div>

      {toast ? (
        <div className="toast" data-testid="toast">
          {toast}
        </div>
      ) : null}

      <Sheet title="참가자" open={sheet === 'participants'} onClose={() => setSheet(null)} testId="participants-sheet">
        <ul className="participant-list">
          {AI_IDS.map((id) => {
            const on = meeting.enabledAi[id] !== false;
            return (
              <li key={id} className={`participant${on ? '' : ' off'}`} data-testid="participant-item" data-ai={id} data-on={on ? '1' : '0'}>
                <Avatar id={id} size={40} />
                <div>
                  <b>
                    {PARTICIPANTS[id].name} <span className="role">· {meeting.roles[id]}</span>
                  </b>
                  <p className="hint">
                    {PARTICIPANTS[id].model} · {PARTICIPANTS[id].provider} · {on ? STATUS_TEXT[turnStatus[id]] : '꺼짐(호출 안 함)'}
                  </p>
                </div>
                <button
                  className={`btn small${on ? '' : ' primary'}`}
                  onClick={() => actions.toggleAi(id)}
                  data-testid={`toggle-${id}`}
                  aria-pressed={on}
                >
                  {on ? '끄기' : '켜기'}
                </button>
              </li>
            );
          })}
          <li className="participant" data-testid="participant-item">
            <Avatar id="me" size={40} emoji={settings.avatarEmoji} />
            <div>
              <b>{displayName}</b>
              <p className="hint">사용자 · 끼어든 말은 다음 발언에 최우선으로 반영</p>
            </div>
          </li>
        </ul>
      </Sheet>

      <Sheet title="대화 검색" open={sheet === 'search'} onClose={() => setSheet(null)} testId="search-sheet">
        <input
          data-testid="search-input"
          placeholder="단어를 입력하면 메시지를 찾습니다"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="search-results" data-testid="search-results">
          {search.trim() && searchResults.length === 0 ? <p className="hint">일치하는 메시지가 없습니다.</p> : null}
          {searchResults.map((m) => (
            <button className="search-result" key={m.id} data-testid="search-result" onClick={() => jumpTo(m.id)}>
              <span className="sr-author">{authorName(m.authorId, displayName)}</span>
              <span className="sr-text">{m.text}</span>
              <span className="sr-time">{formatTime(m.createdAt)}</span>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet title="메뉴" open={sheet === 'menu'} onClose={() => setSheet(null)} testId="menu-sheet">
        <div className="stack">
          <button className="btn wide" onClick={() => setSheet('summary')} data-testid="summary-open">
            회의 요약
          </button>
          <button
            className="btn wide"
            onClick={() => {
              if (meeting.status === 'active' && meeting.auto) actions.pause();
              else actions.resume();
              setSheet(null);
            }}
            data-testid="pause-menu-btn"
          >
            {meeting.status === 'active' && meeting.auto ? '자동 회의 일시정지' : '자동 회의 재개'}
          </button>
          <button
            className="btn wide danger"
            onClick={() => {
              actions.end();
              setSheet('summary');
            }}
            data-testid="end-btn"
          >
            회의 종료
          </button>
          <button className="btn wide" onClick={() => setSheet('memory')} data-testid="open-memory">
            기억 저장소 ({memories.length})
          </button>
          <button className="btn wide" onClick={onOpenSettings} data-testid="open-settings">
            Worker·패스코드 설정
          </button>
        </div>
      </Sheet>

      <Sheet title="회의 요약" open={sheet === 'summary'} onClose={() => setSheet(null)} testId="summary-sheet">
        <pre className="summary-text" data-testid="summary-text">
          {meeting.summary ?? '(아직 요약이 없습니다. 회의가 끝나면 사회자가 최종 정리를 씁니다.)'}
        </pre>
        <div className="row wrap">
          <button className="btn" onClick={() => actions.copy(meeting.summary ?? '', '요약을 복사했습니다.')} data-testid="copy-summary">
            요약 복사
          </button>
          {meeting.status !== 'ended' ? (
            <button className="btn" onClick={actions.end} data-testid="end-from-summary">
              회의 종료
            </button>
          ) : null}
        </div>
        <p className="hint">
          요약은 회의 마지막에 사회자(Gemini, 별도 호출)가 저장된 대화만 보고 쓴 글입니다. Worker에 닿지 못한 경우에는
          앱이 기록만 발췌한 대체 요약이 들어가며, 그때는 머리에 그렇게 표시됩니다.
        </p>
      </Sheet>

      <Sheet
        title="기억 저장소에 저장"
        open={sheet === 'saveMemory'}
        onClose={() => setSheet(null)}
        testId="save-memory-sheet"
      >
        <p className="hint">저장할 메시지: {memoryTarget ? memoryTarget.text.slice(0, 80) : ''}</p>
        <select
          value={memoryDraft.status}
          onChange={(e) => setMemoryDraft({ ...memoryDraft, status: e.target.value as MemoryItem['status'] })}
          data-testid="save-memory-status"
        >
          {MEMORY_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          value={memoryDraft.type}
          onChange={(e) => setMemoryDraft({ ...memoryDraft, type: e.target.value as MemoryItem['type'] })}
          data-testid="save-memory-type"
        >
          {MEMORY_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input
          placeholder="태그(쉼표)"
          value={memoryDraft.tags}
          onChange={(e) => setMemoryDraft({ ...memoryDraft, tags: e.target.value })}
          data-testid="save-memory-tags"
        />
        <button
          className="btn primary wide"
          data-testid="save-memory-submit"
          onClick={() => {
            if (!memoryTarget) return;
            actions.saveMemory(memoryTarget, {
              status: memoryDraft.status,
              type: memoryDraft.type,
              tags: memoryDraft.tags.split(',').map((t) => t.trim()).filter(Boolean),
            });
            setSheet(null);
            setMemoryTarget(null);
          }}
        >
          저장
        </button>
      </Sheet>

      <Sheet title="기억 저장소" open={sheet === 'memory'} onClose={() => setSheet(null)} testId="memory-sheet">
        <MemorySheet memories={memories} topic={meeting.topic} onAdd={actions.addMemory} onDelete={actions.deleteMemory} onImport={actions.importMemories} />
      </Sheet>

      <Sheet title="설정" open={sheet === 'settings'} onClose={() => setSheet(null)} testId="settings-sheet">
        <SettingsSheet
          settings={settings}
          onSave={actions.saveSettings}
          onExportAll={actions.exportAll}
          onImportAll={actions.importAll}
        />
      </Sheet>

      <Sheet title="메시지 수정" open={editing !== null} onClose={() => setEditing(null)} testId="edit-sheet">
        <textarea
          className="textarea"
          value={editing?.text ?? ''}
          onChange={(e) => setEditing(editing ? { ...editing, text: e.target.value } : null)}
          data-testid="edit-textarea"
          rows={4}
        />
        <button
          className="btn primary wide"
          data-testid="edit-submit"
          onClick={() => {
            if (!editing) return;
            actions.edit(editing.id, editing.text);
            setEditing(null);
          }}
        >
          저장
        </button>
      </Sheet>

      {externalSheet}
    </div>
  );
}
