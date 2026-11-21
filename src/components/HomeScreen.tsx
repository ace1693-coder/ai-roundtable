import { useState } from 'react';
import type { Meeting, MemoryItem } from '../lib/types';
import { analyzeTopic } from '../lib/topics';
import { matchMemories } from '../lib/memory';
import { formatDateTime } from '../lib/format';
import { PARTICIPANTS } from '../lib/participants';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

interface Props {
  meetings: Meeting[];
  memories: MemoryItem[];
  onStart: (topic: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onOpenMemories: () => void;
}

const EXAMPLES = ['코팅 공정 불량 개선', '부업 수익 구조 점검', 'PWA 앱 배포 설계', '수면 습관 개선'];

export function HomeScreen({ meetings, memories, onStart, onOpen, onDelete, onOpenSettings, onOpenMemories }: Props) {
  const [topic, setTopic] = useState('');
  const [error, setError] = useState('');
  const analysis = analyzeTopic(topic);
  const related = matchMemories(topic, memories);

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <p className="eyebrow">AI 단체 채팅 회의</p>
          <h1>AI Roundtable</h1>
        </div>
        <div className="row">
          <button className="icon-btn" onClick={onOpenMemories} aria-label="기억 저장소" data-testid="home-memories">
            <Icon name="brain" size={21} />
          </button>
          <button className="icon-btn" onClick={onOpenSettings} aria-label="설정" data-testid="home-settings">
            <Icon name="gear" size={21} />
          </button>
        </div>
      </header>

      <section className="card">
        <h2>새 회의</h2>
        <input
          className="topic-input"
          data-testid="new-topic"
          placeholder="회의 주제를 입력하세요 (예: 코팅 공정 불량 개선)"
          value={topic}
          onChange={(e) => {
            setTopic(e.target.value);
            setError('');
          }}
        />
        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => setTopic(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <div className="role-preview" data-testid="role-preview">
          <div className="row between">
            <span className="hint">주제 분석 · {analysis.label}</span>
            <span className="hint">
              관련 기억 {related.length}건 자동 불러오기
            </span>
          </div>
          {(['chatgpt', 'gemini', 'pickle'] as const).map((id) => (
            <div className="role-row" key={id}>
              <Avatar id={id} size={26} />
              <span className="role-name">{PARTICIPANTS[id].name}</span>
              <span className="role-value">· {analysis.roles[id]}</span>
            </div>
          ))}
        </div>
        {error ? <p className="hint warn">{error}</p> : null}
        <button
          className="btn primary wide"
          data-testid="create-room"
          onClick={() => {
            if (!topic.trim()) {
              setError('회의 주제를 입력하세요.');
              return;
            }
            onStart(topic.trim());
            setTopic('');
          }}
        >
          회의방 만들기
        </button>
        <p className="hint">
          기본은 <b>수동 연결</b>입니다. 앱이 프롬프트를 만들어 주면 ChatGPT·Gemini 웹에서 받은 답변을 붙여넣어 회의를
          이어갑니다. 가짜 읽음·접속·입력 중 표시는 만들지 않습니다.
        </p>
      </section>

      <section className="card">
        <div className="row between">
          <h2>이전 회의</h2>
          <span className="hint">{meetings.length}개</span>
        </div>
        {meetings.length === 0 ? (
          <p className="hint">아직 회의가 없습니다. 위에서 주제를 정해 시작하세요.</p>
        ) : (
          <ul className="meeting-list" data-testid="meeting-list">
            {[...meetings]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((m) => {
                const last = m.messages.filter((x) => x.source !== 'local').slice(-1)[0];
                return (
                  <li key={m.id} className="meeting-item" data-testid="meeting-item">
                    <button className="meeting-open" onClick={() => onOpen(m.id)}>
                      <div className="meeting-title">
                        <b>{m.title}</b>
                        <span className={`state-dot state-${m.status}`} title={m.status} />
                      </div>
                      <div className="meeting-sub">
                        {last ? `${last.authorId === 'me' ? '나' : PARTICIPANTS[last.authorId as 'chatgpt'].name}: ${last.text.slice(0, 40)}` : '발언 없음'}
                      </div>
                      <div className="meeting-meta">
                        <span>{formatDateTime(m.updatedAt)}</span>
                        <span>
                          {m.status === 'active' ? '진행 중' : m.status === 'paused' ? '일시정지' : '종료'}
                        </span>
                        <span>{m.messages.filter((x) => x.source !== 'local').length}개 메시지</span>
                      </div>
                    </button>
                    <button
                      className="icon-btn danger"
                      aria-label="회의 삭제"
                      data-testid="meeting-delete"
                      onClick={() => {
                        if (confirm(`'${m.title}' 회의를 삭제할까요? 되돌릴 수 없습니다.`)) onDelete(m.id);
                      }}
                    >
                      🗑
                    </button>
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      <footer className="home-foot">
        <p>
          AI Roundtable 3.0 · 정적 PWA · 데이터는 이 기기에만 저장(localStorage)
        </p>
        <p className="hint">
          홈 화면에 추가하면 앱처럼 열립니다. 오프라인에서도 저장된 회의를 볼 수 있습니다.
        </p>
      </footer>
    </div>
  );
}
