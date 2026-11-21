import { useState } from 'react';
import type { MemoryItem, Settings } from '../lib/types';
import { MEMORY_STATUSES, MEMORY_TYPES } from '../lib/types';
import { matchMemories } from '../lib/memory';
import { formatDateTime } from '../lib/format';

interface Props {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onExportAll: () => void;
  onImportAll: (text: string) => void;
}

export function SettingsSheet({ settings, onSave, onExportAll, onImportAll }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [importText, setImportText] = useState('');
  const [msg, setMsg] = useState('');

  return (
    <div className="stack">
      <label className="field">
        <span>내 이름(말풍선에 표시)</span>
        <input
          data-testid="settings-name"
          value={draft.displayName}
          onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
          placeholder="나"
        />
      </label>
      <label className="field">
        <span>내 아바타(이모지 1개, 비우면 기본 사람 아이콘)</span>
        <input
          data-testid="settings-emoji"
          value={draft.avatarEmoji}
          onChange={(e) => setDraft({ ...draft, avatarEmoji: e.target.value.slice(0, 2) })}
          placeholder="예: 🙂"
        />
      </label>

      <div className="section-title">선택: 직접 API 연결</div>
      <p className="hint">
        기본은 <b>수동 연결</b>입니다(0원). 아래에 본인 키를 넣고 자동 응답을 켜면 그 AI만 실제로 호출합니다. 키는 이
        기기 브라우저(localStorage)에만 저장되고 서버로 보내지 않습니다. Pickle은 API 자동 호출 대상이 아닙니다.
      </p>
      <label className="field">
        <span>OpenAI API 키</span>
        <input
          data-testid="settings-openai-key"
          type="password"
          autoComplete="off"
          value={draft.apiKeys.openai}
          onChange={(e) => setDraft({ ...draft, apiKeys: { ...draft.apiKeys, openai: e.target.value } })}
          placeholder="sk-... (없으면 비워두세요)"
        />
      </label>
      <label className="field">
        <span>OpenAI 모델</span>
        <input
          value={draft.models.openai}
          onChange={(e) => setDraft({ ...draft, models: { ...draft.models, openai: e.target.value } })}
        />
      </label>
      <label className="field">
        <span>Gemini API 키</span>
        <input
          data-testid="settings-gemini-key"
          type="password"
          autoComplete="off"
          value={draft.apiKeys.gemini}
          onChange={(e) => setDraft({ ...draft, apiKeys: { ...draft.apiKeys, gemini: e.target.value } })}
          placeholder="AIza... (없으면 비워두세요)"
        />
      </label>
      <label className="field">
        <span>Gemini 모델</span>
        <input
          value={draft.models.gemini}
          onChange={(e) => setDraft({ ...draft, models: { ...draft.models, gemini: e.target.value } })}
        />
      </label>
      <label className="switch">
        <input
          type="checkbox"
          data-testid="settings-auto-api"
          checked={draft.autoApi}
          onChange={(e) => setDraft({ ...draft, autoApi: e.target.checked })}
        />
        <span>API 키가 있는 AI는 자동으로 응답 받기 (기본 꺼짐)</span>
      </label>
      <p className="hint">
        자동 응답이 꺼져 있거나 키가 없으면 앱은 프롬프트만 만들어 복사해 줍니다. 실제 호출 없이 응답이 생기는 일은
        없습니다.
      </p>

      <div className="section-title">데이터</div>
      <div className="row wrap">
        <button className="btn" onClick={onExportAll} data-testid="export-all">
          전체 JSON 내보내기
        </button>
      </div>
      <textarea
        className="textarea small"
        placeholder="전체 JSON을 붙여넣고 가져오기"
        value={importText}
        onChange={(e) => setImportText(e.target.value)}
        data-testid="import-all-text"
      />
      <button
        className="btn"
        data-testid="import-all"
        onClick={() => {
          try {
            onImportAll(importText);
            setImportText('');
            setMsg('가져왔습니다.');
          } catch (e) {
            setMsg(e instanceof Error ? `가져오기 실패: ${e.message}` : '가져오기 실패');
          }
        }}
      >
        전체 JSON 가져오기
      </button>

      <div className="row">
        <button
          className="btn primary"
          data-testid="settings-save"
          onClick={() => {
            onSave(draft);
            setMsg('저장했습니다.');
          }}
        >
          설정 저장
        </button>
      </div>
      {msg ? <p className="hint ok" data-testid="settings-message">{msg}</p> : null}
    </div>
  );
}

interface MemoryProps {
  memories: MemoryItem[];
  topic: string;
  onAdd: (draft: { title: string; body: string; status: MemoryItem['status']; type: MemoryItem['type']; tags: string[] }) => void;
  onDelete: (id: string) => void;
  onImport: (text: string) => void;
}

export function MemorySheet({ memories, topic, onAdd, onDelete, onImport }: MemoryProps) {
  const [filter, setFilter] = useState<string>('전체');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<MemoryItem['status']>('가설');
  const [type, setType] = useState<MemoryItem['type']>('사실');
  const [tags, setTags] = useState('');
  const [importText, setImportText] = useState('');
  const [error, setError] = useState('');
  const related = matchMemories(topic, memories, 50).map((r) => r.item.id);
  const shown = memories
    .filter((m) => (filter === '전체' ? true : m.status === filter))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="stack">
      <p className="hint">
        이 주제와 맞는 기억 <b>{related.length}건</b>을 대화 프롬프트에 자동으로 넣습니다. 상태 4종·유형 7종으로 나눠
        저장하세요.
      </p>
      <div className="chips">
        {['전체', ...MEMORY_STATUSES].map((s) => (
          <button key={s} className={`chip ${filter === s ? 'on' : ''}`} onClick={() => setFilter(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="stack compact">
        {shown.length === 0 ? <p className="hint">저장된 기억이 없습니다.</p> : null}
        {shown.map((m) => (
          <div className="memory-item" key={m.id} data-testid="memory-item">
            <div className="memory-head">
              <b>{m.title}</b>
              <span className={`badge status-${MEMORY_STATUSES.indexOf(m.status)}`}>{m.status}</span>
            </div>
            <p>{m.body}</p>
            <div className="memory-meta">
              <span>{m.type}</span>
              {m.tags.length ? <span>#{m.tags.join(' #')}</span> : null}
              <span>{formatDateTime(m.updatedAt)}</span>
              {related.includes(m.id) ? <span className="ok">이 주제 관련</span> : null}
              <button className="link" onClick={() => onDelete(m.id)} data-testid="memory-delete">
                삭제
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="section-title">새 기억 추가</div>
      <input placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="memory-title" />
      <textarea
        className="textarea small"
        placeholder="내용(근거·한계 포함)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        data-testid="memory-body"
      />
      <div className="row">
        <select value={status} onChange={(e) => setStatus(e.target.value as MemoryItem['status'])} data-testid="memory-status">
          {MEMORY_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as MemoryItem['type'])} data-testid="memory-type">
          {MEMORY_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <input placeholder="태그(쉼표)" value={tags} onChange={(e) => setTags(e.target.value)} data-testid="memory-tags" />
      <button
        className="btn primary"
        data-testid="memory-add"
        onClick={() => {
          if (!title.trim()) {
            setError('제목을 입력하세요.');
            return;
          }
          onAdd({
            title,
            body,
            status,
            type,
            tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          });
          setTitle('');
          setBody('');
          setTags('');
          setError('');
        }}
      >
        기억 추가
      </button>
      {error ? <p className="hint warn">{error}</p> : null}

      <div className="section-title">JSON 가져오기</div>
      <textarea
        className="textarea small"
        placeholder='{"memories":[...]}'
        value={importText}
        onChange={(e) => setImportText(e.target.value)}
        data-testid="memory-import-text"
      />
      <button
        className="btn"
        data-testid="memory-import"
        onClick={() => {
          try {
            onImport(importText);
            setImportText('');
            setError('가져왔습니다.');
          } catch (e) {
            setError(e instanceof Error ? e.message : '가져오기 실패');
          }
        }}
      >
        기억 가져오기
      </button>
    </div>
  );
}
