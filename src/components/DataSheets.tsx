import { useEffect, useState } from 'react';
import type { MemoryItem, Settings } from '../lib/types';
import { MEMORY_STATUSES, MEMORY_TYPES } from '../lib/types';
import { matchMemories } from '../lib/memory';
import { formatDateTime } from '../lib/format';
import { checkHealth, normalizeWorkerUrl } from '../lib/workerClient';
import { MEETING_TUNING } from '../config/meeting';

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
  const [checking, setChecking] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  async function testConnection() {
    setChecking(true);
    setMsg('');
    try {
      const info = await checkHealth({ ...draft, workerUrl: normalizeWorkerUrl(draft.workerUrl) });
      const ready = info.configured.groq && info.configured.gemini && info.configured.accessToken;
      setMsg(
        ready
          ? `연결됨 · GPT-OSS ${info.models.gptoss} / Gemini ${info.models.gemini} / 사회자 ${info.models.moderator}`
          : `Worker는 응답하지만 비밀키가 빠졌습니다 (Groq ${info.configured.groq ? 'O' : 'X'}, Gemini ${
              info.configured.gemini ? 'O' : 'X'
            }, 패스코드 설정 ${info.configured.accessToken ? 'O' : 'X'})`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? `연결 실패: ${e.message}` : '연결 실패');
    } finally {
      setChecking(false);
    }
  }

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

      <div className="section-title">자동 회의 연결 (Cloudflare Worker)</div>
      <p className="hint">
        API 키는 여기에 넣지 않습니다. 키는 Worker의 비밀값에만 있고, 이 앱은 <b>Worker 주소</b>와 <b>개인용 패스코드</b>만
        저장합니다(이 브라우저 localStorage).
      </p>
      <label className="field">
        <span>Worker 주소</span>
        <input
          data-testid="settings-worker-url"
          value={draft.workerUrl}
          onChange={(e) => setDraft({ ...draft, workerUrl: e.target.value })}
          placeholder="https://ai-roundtable.xxxx.workers.dev"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>개인용 접근 패스코드 (APP_ACCESS_TOKEN과 같은 값)</span>
        <input
          data-testid="settings-access-code"
          type="password"
          value={draft.accessCode}
          onChange={(e) => setDraft({ ...draft, accessCode: e.target.value })}
          placeholder="Worker secret으로 넣은 값"
          autoComplete="off"
        />
      </label>
      <p className="hint" data-testid="settings-budget">
        회의는 <b>고정 라운드 제한 없이</b> 사회자가 끝을 판단할 때까지 이어진다. 멈추는 조건은 사용자 정지,
        사회자의 마무리 판단, 같은 발언 반복 감지, 그리고 회의당 호출 예산 {MEETING_TUNING.maxCallsPerMeeting}회다
        (무료 한도 보호용 안전장치).
      </p>
      <div className="row wrap">
        <button className="btn" onClick={() => void testConnection()} disabled={checking} data-testid="settings-test">
          {checking ? '확인 중…' : '연결 확인'}
        </button>
        <button
          className="btn primary"
          data-testid="settings-save"
          onClick={() => {
            onSave({ ...draft, workerUrl: normalizeWorkerUrl(draft.workerUrl), accessCode: draft.accessCode.trim() });
            setMsg('저장했습니다.');
          }}
        >
          저장
        </button>
      </div>
      {msg ? (
        <p className="hint" data-testid="settings-status">
          {msg}
        </p>
      ) : null}
      <p className="hint">
        무료 한도(Groq 30 RPM·1,000 RPD·8K TPM / Gemini 3.5 Flash-Lite 15 RPM·500 RPD 실측)에 닿으면 앱이 스스로 멈춥니다.
        유료 전환은 하지 않습니다.
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
        가져오기
      </button>
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
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<MemoryItem['status']>('가설');
  const [type, setType] = useState<MemoryItem['type']>('사실');
  const [tags, setTags] = useState('');
  const [importText, setImportText] = useState('');
  const [msg, setMsg] = useState('');

  const related = topic ? matchMemories(topic, memories).map((r) => r.item.id) : [];

  return (
    <div className="stack">
      <p className="hint">
        기억은 회의 주제와 겹치는 것만 골라 프롬프트에 넣습니다. ‘폐기된 정보’는 참고용으로만 쓰이고 점수가 낮습니다.
      </p>
      <ul className="memory-list">
        {memories.length === 0 ? <li className="hint">저장된 기억이 없습니다.</li> : null}
        {[...memories]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((m) => (
            <li key={m.id} className={`memory-item ${related.includes(m.id) ? 'related' : ''}`}>
              <div className="row between">
                <b>{m.title}</b>
                <button className="link danger" onClick={() => onDelete(m.id)} aria-label="기억 삭제">
                  삭제
                </button>
              </div>
              <p>{m.body}</p>
              <p className="hint">
                {m.status} · {m.type} · {formatDateTime(m.updatedAt)}
              </p>
            </li>
          ))}
      </ul>

      <div className="section-title">새 기억</div>
      <input placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea placeholder="내용" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="row wrap">
        <select value={status} onChange={(e) => setStatus(e.target.value as MemoryItem['status'])}>
          {MEMORY_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as MemoryItem['type'])}>
          {MEMORY_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <input placeholder="태그(쉼표)" value={tags} onChange={(e) => setTags(e.target.value)} />
      <button
        className="btn primary"
        onClick={() => {
          if (!title.trim()) {
            setMsg('제목을 입력하세요.');
            return;
          }
          onAdd({ title, body, status, type, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
          setTitle('');
          setBody('');
          setTags('');
          setMsg('추가했습니다.');
        }}
      >
        기억 추가
      </button>
      <div className="section-title">가져오기</div>
      <textarea
        className="textarea small"
        placeholder="기억 JSON을 붙여넣기"
        value={importText}
        onChange={(e) => setImportText(e.target.value)}
      />
      <button
        className="btn"
        onClick={() => {
          try {
            onImport(importText);
            setImportText('');
            setMsg('가져왔습니다.');
          } catch (e) {
            setMsg(e instanceof Error ? `실패: ${e.message}` : '실패');
          }
        }}
      >
        JSON 가져오기
      </button>
      {msg ? <p className="hint">{msg}</p> : null}
    </div>
  );
}
