import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiId, AppData, Attachment, ChatMessage, MemoryItem, Meeting, Settings } from './lib/types';
import { analyzeTopic } from './lib/topics';
import { createMemory, matchMemories, newId, parseMeetingsImport, parseMemoryImport } from './lib/memory';
import { exportAll, loadData, saveMeetings, saveMemories, saveSession, saveSettings } from './lib/storage';
import { parseMentions } from './lib/mentions';
import { nextSpeaker, registerAnswer, skipSpeaker, systemMessage } from './lib/turn';
import { buildSummaryPrompt, buildTurnPrompt } from './lib/prompt';
import { buildLocalSummary } from './lib/summary';
import { callAi } from './lib/api';
import { HomeScreen } from './components/HomeScreen';
import { RoomScreen } from './components/RoomScreen';
import { Sheet } from './components/Sheet';
import { MemorySheet, SettingsSheet } from './components/DataSheets';

export default function App() {
  const [data, setData] = useState<AppData>(() => loadData());
  const [toast, setToast] = useState('');
  const [homeSheet, setHomeSheet] = useState<'settings' | 'memory' | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => saveMeetings(data.meetings), [data.meetings]);
  useEffect(() => saveMemories(data.memories), [data.memories]);
  useEffect(() => saveSettings(data.settings), [data.settings]);
  useEffect(() => saveSession(data.activeMeetingId), [data.activeMeetingId]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  }, []);

  const active = useMemo(
    () => data.meetings.find((m) => m.id === data.activeMeetingId) ?? null,
    [data.meetings, data.activeMeetingId],
  );

  const patch = useCallback((id: string, changes: Partial<Meeting>) => {
    setData((prev) => ({
      ...prev,
      meetings: prev.meetings.map((m) => (m.id === id ? { ...m, ...changes, updatedAt: Date.now() } : m)),
    }));
  }, []);

  const copy = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        showToast(label);
        return;
      } catch {
        /* fallback below */
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast(label);
      } catch {
        showToast('복사에 실패했습니다. 길게 눌러 직접 복사하세요.');
      }
      document.body.removeChild(ta);
    },
    [showToast],
  );

  function startMeeting(topic: string) {
    const analysis = analyzeTopic(topic);
    const related = matchMemories(topic, data.memories);
    const now = Date.now();
    const meeting: Meeting = {
      id: newId('mt'),
      title: topic.length > 28 ? `${topic.slice(0, 28)}…` : topic,
      topic,
      domain: analysis.domain,
      createdAt: now,
      updatedAt: now,
      roles: analysis.roles,
      status: 'active',
      messages: [],
      queue: [],
      usedMemoryIds: related.map((r) => r.item.id),
      repeatWarnings: 0,
    };
    setData((prev) => ({ ...prev, meetings: [meeting, ...prev.meetings], activeMeetingId: meeting.id }));
    showToast(`회의방을 열었습니다. 관련 기억 ${related.length}건을 불러왔습니다.`);
  }

  const target: AiId | null = active ? nextSpeaker(active) : null;

  const usedMemories = useMemo(() => {
    if (!active) return [];
    return active.usedMemoryIds
      .map((id) => data.memories.find((m) => m.id === id))
      .filter((m): m is MemoryItem => Boolean(m));
  }, [active, data.memories]);

  const prompt = useMemo(
    () => (active && target ? buildTurnPrompt(active, target, usedMemories, data.settings.displayName || '나') : ''),
    [active, target, usedMemories, data.settings.displayName],
  );

  const summaryPrompt = useMemo(
    () => (active ? buildSummaryPrompt(active, usedMemories, data.settings.displayName || '나') : ''),
    [active, usedMemories, data.settings.displayName],
  );

  function addMemoryItem(draft: {
    title: string;
    body: string;
    status: MemoryItem['status'];
    type: MemoryItem['type'];
    tags: string[];
  }) {
    const item = createMemory({ ...draft, sourceMeetingId: active?.id });
    setData((prev) => ({ ...prev, memories: [item, ...prev.memories] }));
    showToast('기억을 추가했습니다.');
  }

  function importMemoryText(text: string) {
    const items = parseMemoryImport(text);
    setData((prev) => {
      const ids = new Set(prev.memories.map((m) => m.id));
      return { ...prev, memories: [...items.filter((i) => !ids.has(i.id)), ...prev.memories] };
    });
    showToast(`기억 ${items.length}건을 가져왔습니다.`);
  }

  function exportAllData() {
    const blob = new Blob([exportAll(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-roundtable-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('전체 JSON을 내보냈습니다.');
  }

  function importAllData(text: string) {
    const memories = parseMemoryImport(text);
    const meetings = parseMeetingsImport(text);
    setData((prev) => {
      const memIds = new Set(prev.memories.map((m) => m.id));
      const mtIds = new Set(prev.meetings.map((m) => m.id));
      return {
        ...prev,
        memories: [...memories.filter((m) => !memIds.has(m.id)), ...prev.memories],
        meetings: [...meetings.filter((m) => !mtIds.has(m.id)), ...prev.meetings],
      };
    });
    showToast('전체 데이터를 가져왔습니다.');
  }

  async function runApi() {
    if (!active || !target) return;
    if (target === 'pickle') {
      showToast('Pickle은 API 자동 호출 대상이 아닙니다(수동 입력/로컬 규칙 엔진).');
      return;
    }
    showToast('API 호출 중입니다...');
    try {
      const res = await callAi(target, prompt, data.settings);
      const r = registerAnswer(active, target, res.text, 'api', active.roles[target]);
      patch(active.id, {
        messages: r.messages,
        repeatWarnings: r.repeatWarnings,
        status: r.status,
        queue: active.queue.filter((id) => id !== target),
        lastSpeaker: target,
      });
      showToast(`${res.model} 응답을 등록했습니다.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : '알 수 없는 오류';
      patch(active.id, {
        messages: [
          ...active.messages,
          systemMessage(`API 호출에 실패해 회의를 멈췄습니다. 수동 연결로 이어가세요. (원인: ${message.slice(0, 160)})`),
        ],
        status: 'paused',
      });
      showToast('API 호출 실패 — 회의를 일시정지했습니다.');
    }
  }

  const actions = {
    send(text: string, attachment?: Attachment) {
      if (!active || active.status === 'ended') return;
      const msg: ChatMessage = {
        id: newId('msg'),
        authorId: 'me',
        text,
        createdAt: Date.now(),
        source: 'user',
        roleAtTime: '나',
        attachment,
      };
      const mentions = parseMentions(text);
      patch(active.id, { messages: [...active.messages, msg], queue: mentions.targets, lastSpeaker: 'me' });
      if (mentions.targets.length) {
        showToast(
          `${mentions.targets
            .map((t) => (t === 'chatgpt' ? 'ChatGPT' : t === 'gemini' ? 'Gemini' : 'Pickle'))
            .join(', ')} 우선 응답 대기열에 올렸습니다.`,
        );
      }
    },
    register(text: string, source: 'manual' | 'api') {
      if (!active || !target) return;
      const r = registerAnswer(active, target, text, source, active.roles[target]);
      patch(active.id, {
        messages: r.messages,
        repeatWarnings: r.repeatWarnings,
        status: r.status,
        queue: active.queue.filter((id) => id !== target),
        lastSpeaker: target,
      });
      if (r.status === 'paused' && active.status !== 'paused') {
        showToast('반복 발언이 3회 연속 감지되어 회의를 일시정지했습니다.');
      } else {
        showToast(
          `${target === 'chatgpt' ? 'ChatGPT' : target === 'gemini' ? 'Gemini' : 'Pickle'} 발언을 등록했습니다.`,
        );
      }
    },
    skip() {
      if (!active) return;
      patch(active.id, skipSpeaker(active));
      showToast('이번 발언자를 건너뜁니다.');
    },
    pause() {
      if (!active) return;
      patch(active.id, { status: 'paused' });
      showToast('회의를 일시정지했습니다.');
    },
    resume() {
      if (!active) return;
      patch(active.id, { status: 'active' });
      showToast('회의를 재개했습니다.');
    },
    end() {
      if (!active) return;
      patch(active.id, { status: 'ended', summary: buildLocalSummary(active) });
      showToast('회의를 종료하고 로컬 요약을 만들었습니다.');
    },
    reopen() {
      if (!active) return;
      patch(active.id, { status: 'active' });
      showToast('회의를 다시 이어갑니다.');
    },
    pin(id: string) {
      if (!active) return;
      const isPinned = active.messages.find((m) => m.id === id)?.pinned;
      patch(active.id, {
        messages: active.messages.map((m) => ({ ...m, pinned: m.id === id ? !isPinned : false })),
      });
      showToast(isPinned ? '고정을 해제했습니다.' : '메시지를 상단에 고정했습니다.');
    },
    edit(id: string, text: string) {
      if (!active) return;
      patch(active.id, {
        messages: active.messages.map((m) => (m.id === id ? { ...m, text, editedAt: Date.now() } : m)),
      });
      showToast('메시지를 수정했습니다.');
    },
    remove(id: string) {
      if (!active) return;
      patch(active.id, {
        messages: active.messages.map((m) => (m.id === id ? { ...m, deleted: true, text: '' } : m)),
      });
      showToast('메시지를 삭제했습니다.');
    },
    saveMemory(msg: ChatMessage, draft: { status: MemoryItem['status']; type: MemoryItem['type']; tags: string[] }) {
      if (!active) return;
      const item = createMemory({
        title: msg.text.replace(/\s+/g, ' ').slice(0, 40) || '메시지',
        body: msg.text,
        status: draft.status,
        type: draft.type,
        tags: draft.tags,
        sourceMeetingId: active.id,
      });
      setData((prev) => ({
        ...prev,
        memories: [item, ...prev.memories],
        meetings: prev.meetings.map((m) =>
          m.id === active.id
            ? {
                ...m,
                updatedAt: Date.now(),
                messages: m.messages.map((x) => (x.id === msg.id ? { ...x, memoryId: item.id } : x)),
              }
            : m,
        ),
      }));
      showToast('기억 저장소에 저장했습니다.');
    },
    addMemory: addMemoryItem,
    deleteMemory(id: string) {
      setData((prev) => ({ ...prev, memories: prev.memories.filter((m) => m.id !== id) }));
      showToast('기억을 삭제했습니다.');
    },
    importMemories: importMemoryText,
    exportAll: exportAllData,
    importAll: importAllData,
    saveSettings(s: Settings) {
      setData((prev) => ({ ...prev, settings: s }));
      showToast('설정을 저장했습니다.');
    },
    copy(text: string, label: string) {
      void copy(text, label);
    },
    runApi,
  };

  if (!active) {
    return (
      <>
        <HomeScreen
          meetings={data.meetings}
          memories={data.memories}
          onStart={startMeeting}
          onOpen={(id) => setData((prev) => ({ ...prev, activeMeetingId: id }))}
          onDelete={(id) =>
            setData((prev) => ({
              ...prev,
              meetings: prev.meetings.filter((m) => m.id !== id),
              activeMeetingId: prev.activeMeetingId === id ? null : prev.activeMeetingId,
            }))
          }
          onOpenSettings={() => setHomeSheet('settings')}
          onOpenMemories={() => setHomeSheet('memory')}
        />
        <Sheet title="기억 저장소" open={homeSheet === 'memory'} onClose={() => setHomeSheet(null)}>
          <MemorySheet
            memories={data.memories}
            topic=""
            onAdd={addMemoryItem}
            onDelete={(id) => setData((prev) => ({ ...prev, memories: prev.memories.filter((m) => m.id !== id) }))}
            onImport={importMemoryText}
          />
        </Sheet>
        <Sheet title="설정" open={homeSheet === 'settings'} onClose={() => setHomeSheet(null)}>
          <SettingsSheet
            settings={data.settings}
            onSave={(s) => {
              setData((prev) => ({ ...prev, settings: s }));
              showToast('설정을 저장했습니다.');
            }}
            onExportAll={exportAllData}
            onImportAll={importAllData}
          />
        </Sheet>
        {toast ? (
          <div className="toast" data-testid="toast">
            {toast}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <RoomScreen
      meeting={active}
      memories={data.memories}
      settings={data.settings}
      target={target}
      prompt={prompt}
      summaryPrompt={summaryPrompt}
      actions={actions}
      onBack={() => setData((prev) => ({ ...prev, activeMeetingId: null }))}
      toast={toast}
    />
  );
}
