import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AiId, Attachment, ChatMessage, Meeting, MemoryItem, Settings } from '../lib/types';
import { AI_IDS, MEMORY_STATUSES, MEMORY_TYPES } from '../lib/types';
import { PARTICIPANTS, SOURCE_LABEL, authorName } from '../lib/participants';
import { formatDateDivider, formatTime, GROUP_WINDOW_MS, isSameDay } from '../lib/format';
import { activeMentionQuery, filterMentionOptions } from '../lib/mentions';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { Icon } from './Icon';
import { MemorySheet, SettingsSheet } from './DataSheets';

export interface RoomActions {
  send: (text: string, attachment?: Attachment) => void;
  register: (text: string, source: 'manual' | 'api') => void;
  skip: () => void;
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
  runApi: () => Promise<void>;
  copy: (text: string, label: string) => void;
}

interface Props {
  meeting: Meeting;
  memories: MemoryItem[];
  settings: Settings;
  target: AiId | null;
  prompt: string;
  summaryPrompt: string;
  actions: RoomActions;
  onBack: () => void;
  toast: string;
}

type SheetName = 'participants' | 'search' | 'memory' | 'settings' | 'summary' | 'paste' | 'saveMemory' | 'menu' | null;

export function RoomScreen({ meeting, memories, settings, target, prompt, summaryPrompt, actions, onBack, toast }: Props) {
  const [sheet, setSheet] = useState<SheetName>(null);
  const [text, setText] = useState('');
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [attachment, setAttachment] = useState<Attachment | undefined>();
  const [search, setSearch] = useState('');
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [pasteText, setPasteText] = useState('');
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

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [meeting.messages.length, sheet]);

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

  // 멘션을 끼워 넣은 직후 커서를 삽입 지점 뒤로 옮긴다(다음 타이핑이 문장 끝으로 튀지 않게).
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
    if (m.authorId === 'system') return '로컬 규칙 엔진';
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
            <span data-testid="participant-count">참가자 4명</span> · {meeting.status === 'active' ? '진행 중' : meeting.status === 'paused' ? '일시정지' : '종료'}
          </p>
        </div>
        <button className="icon-btn" onClick={() => setSheet('search')} aria-label="대화 검색" data-testid="search-btn">
          <Icon name="search" size={19} />
        </button>
        <button
          className="icon-btn"
          onClick={() => setSheet('participants')}
          aria-label="참가자"
          data-testid="participants-btn"
        >
          <Icon name="users" size={19} />
        </button>
        <button className="icon-btn" onClick={() => setSheet('menu')} aria-label="메뉴" data-testid="menu-btn">
          <Icon name="menu" size={19} />
        </button>
      </header>

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
              아래 [프롬프트 복사]로 첫 발언 프롬프트를 가져가 ChatGPT·Gemini 웹에 붙여넣고, 받은 답변을 [답변 붙여넣기]로
              등록하세요. 나도 언제든 말할 수 있습니다.
            </p>
          </div>
        ) : null}
        {visible.map((m, i) => {
          const prev = visible[i - 1];
          const newDate = !prev || !isSameDay(prev.createdAt, m.createdAt);
          const grouped =
            !newDate && prev && prev.authorId === m.authorId && m.createdAt - prev.createdAt < GROUP_WINDOW_MS;
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
                {aiAuthor ? (
                  <div className="avatar-col">{grouped ? null : <Avatar id={aiAuthor} size={36} />}</div>
                ) : null}
                <div className="msg-body">
                  {!grouped && !isSystem ? (
                    <div className="msg-meta">
                      <span className={`msg-name name-${m.authorId}`}>
                        {aiAuthor ? PARTICIPANTS[aiAuthor].name : displayName}
                      </span>
                      {roleOf(m) ? (
                        <span className="msg-role" data-testid="msg-role">
                          · {roleOf(m)}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {isSystem ? (
                    <div className="system-bubble" data-testid="system-notice">
                      <span className="system-src">로컬 규칙 엔진</span>
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
                        지식 저장
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
                  {m.memoryId ? <span className="saved-note">지식 저장소에 저장됨</span> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {meeting.status === 'paused' ? (
        <div className="turn-bar paused" data-testid="pause-bar">
          <div className="turn-main">
            <b>회의 일시정지</b>
            <span className="turn-note">다음 발언 제안을 멈췄습니다. 재개하면 이어갑니다.</span>
          </div>
          <div className="turn-actions">
            <button className="btn" onClick={actions.resume} data-testid="resume-btn">
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
            <span className="turn-note">저장된 발언은 그대로 남습니다.</span>
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
      ) : target ? (
        <div className="turn-bar" data-testid="turn-bar">
          <div className="turn-main">
            <Avatar id={target} size={26} />
            <div className="turn-target-wrap">
              <b data-testid="turn-target">{PARTICIPANTS[target].name}</b>
              <span className="turn-role"> · {meeting.roles[target]}</span>
              <div className="turn-note">
                {meeting.queue.length > 0 ? `대기 ${meeting.queue.length} · 멘션·사용자 지시 우선` : '규칙 엔진이 고른 다음 발언'}{' '}
                · 수동 연결
              </div>
              {target !== 'pickle' ? (
                <a
                  className="turn-link"
                  href={target === 'chatgpt' ? 'https://chatgpt.com/' : 'https://gemini.google.com/app'}
                  target="_blank"
                  rel="noreferrer noopener"
                  data-testid="open-ai-web"
                >
                  {PARTICIPANTS[target].name} 웹 열기 ↗
                </a>
              ) : null}
            </div>
          </div>
          <div className="turn-actions">
            <button className="btn primary" onClick={() => actions.copy(prompt, '프롬프트를 복사했습니다. 게스트 웹에 붙여넣으세요.')} data-testid="copy-prompt">
              프롬프트 복사
            </button>
            <button className="btn" onClick={() => setSheet('paste')} data-testid="open-paste">
              답변 붙여넣기
            </button>
            {settings.autoApi &&
            settings.apiKeys[target === 'chatgpt' ? 'openai' : target === 'gemini' ? 'gemini' : 'openai'].trim() &&
            target !== 'pickle' ? (
              <button className="btn" onClick={() => void actions.runApi()} data-testid="run-api">
                API로 응답
              </button>
            ) : null}
            <button className="btn ghost" onClick={actions.skip} data-testid="skip-turn">
              건너뛰기
            </button>
          </div>
        </div>
      ) : null}

      <div className="composer">
        {mention ? (
          <div className="mention-popup" data-testid="mention-popup">
            {filterMentionOptions(mention.query).map((o) => (
              <button
                key={o.id}
                data-testid={`mention-option-${o.id}`}
                onClick={() => insertMention(o.insert)}
              >
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
          {(['chatgpt', 'gemini', 'pickle'] as const).map((id) => (
            <button key={id} className={`chip dot-${id}`} onClick={() => setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${PARTICIPANTS[id].name} `)}>
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
            placeholder={meeting.status === 'ended' ? '종료됨 · 이어가기를 누르세요' : '메시지 입력 (@로 AI 지정)'}
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
            const key = id === 'chatgpt' ? 'openai' : id === 'gemini' ? 'gemini' : null;
            const hasKey = key ? Boolean(settings.apiKeys[key].trim()) : false;
            return (
              <li key={id} className="participant" data-testid="participant-item">
                <Avatar id={id} size={40} />
                <div>
                  <b>
                    {PARTICIPANTS[id].name} <span className="role">· {meeting.roles[id]}</span>
                  </b>
                  <p className="hint">
                    {id === 'pickle'
                      ? '수동 입력 / 로컬 규칙 엔진 (API 자동 호출 없음)'
                      : hasKey
                        ? `API 키 입력됨 · 자동 응답 ${settings.autoApi ? '켜짐' : '꺼짐'} (아니면 수동 연결)`
                        : 'API 미연결 · 게스트 웹 수동 연결'}
                  </p>
                </div>
              </li>
            );
          })}
          <li className="participant" data-testid="participant-item">
            <Avatar id="me" size={40} emoji={settings.avatarEmoji} />
            <div>
              <b>{displayName}</b>
              <p className="hint">사용자 · 언제든 끼어들 수 있고 그 말이 최우선</p>
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
              if (meeting.status === 'paused') actions.resume();
              else actions.pause();
              setSheet(null);
            }}
            data-testid="pause-btn"
          >
            {meeting.status === 'paused' ? '회의 재개' : '회의 일시정지'}
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
          <button className="btn wide" onClick={() => setSheet('settings')} data-testid="open-settings">
            설정
          </button>
        </div>
      </Sheet>

      <Sheet title="회의 요약 (로컬 규칙 엔진)" open={sheet === 'summary'} onClose={() => setSheet(null)} testId="summary-sheet">
        <pre className="summary-text" data-testid="summary-text">
          {meeting.summary ?? '(요약이 아직 없습니다. 회의를 종료하면 로컬 규칙 엔진 요약이 만들어집니다.)'}
        </pre>
        <div className="row wrap">
          <button
            className="btn"
            onClick={() => actions.copy(meeting.summary ?? '', '요약을 복사했습니다.')}
            data-testid="copy-summary"
          >
            요약 복사
          </button>
          <button
            className="btn"
            onClick={() => actions.copy(summaryPrompt, 'AI 요약 프롬프트를 복사했습니다. 게스트 웹에 붙여넣으세요.')}
            data-testid="copy-summary-prompt"
          >
            AI 요약 프롬프트 복사
          </button>
          {meeting.status !== 'ended' ? (
            <button
              className="btn"
              onClick={() => {
                actions.end();
              }}
              data-testid="end-from-summary"
            >
              회의 종료
            </button>
          ) : null}
        </div>
        <p className="hint">
          위 요약은 앱의 규칙 엔진이 만든 초안입니다(AI가 쓴 것 아님). AI 요약을 원하면 프롬프트를 복사해 게스트 웹에
          붙여넣고, 답변을 [답변 붙여넣기]로 등록하세요.
        </p>
      </Sheet>

      <Sheet title={`${target ? PARTICIPANTS[target].name : ''} 답변 붙여넣기`} open={sheet === 'paste'} onClose={() => setSheet(null)} testId="paste-sheet">
        <p className="hint">
          게스트 웹에서 받은 답변을 그대로 붙여넣으세요. 대상은 <b>{target ? PARTICIPANTS[target].name : '-'}</b>로 고정되고,
          출처는 <b>수동 입력</b>으로 남습니다.
        </p>
        <textarea
          className="textarea"
          data-testid="paste-textarea"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="ChatGPT/Gemini 답변을 여기에 붙여넣기"
          rows={8}
        />
        <button
          className="btn primary wide"
          data-testid="paste-submit"
          onClick={() => {
            if (!pasteText.trim()) return;
            actions.register(pasteText, 'manual');
            setPasteText('');
            setSheet(null);
          }}
        >
          답변 등록
        </button>
      </Sheet>

      <Sheet
        title="지식 저장소에 저장"
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
        <MemorySheet
          memories={memories}
          topic={meeting.topic}
          onAdd={actions.addMemory}
          onDelete={actions.deleteMemory}
          onImport={actions.importMemories}
        />
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
    </div>
  );
}
