import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiId, AppData, Attachment, ChatMessage, MemoryItem, Meeting, Settings } from './lib/types';
import { AI_IDS } from './lib/types';
import { analyzeTopic } from './lib/topics';
import { createMemory, matchMemories, newId, parseMeetingsImport, parseMemoryImport } from './lib/memory';
import { collectLegacyData, exportAll, loadActiveMeetingId, loadSettings, saveSession, saveSettings } from './lib/storage';
import { parseMentions } from './lib/mentions';
import {
  afterSpeech,
  applyDecision,
  buildTurnRequest,
  endReasonFor,
  pendingUserDirective,
  planNextTurn,
  type EndedReason,
} from './lib/meetingEngine';
import { loadWorkspace, saveWorkspace } from './lib/db';
import { buildLocalSummary } from './lib/summary';
import { isWorkerConfigured, requestSummary, requestTurn, WorkerError } from './lib/workerClient';
import { scanSensitive } from '../shared/sensitive';
import { MEETING_TUNING, callBudget } from './config/meeting';
import { PARTICIPANTS } from './lib/participants';
import { HomeScreen } from './components/HomeScreen';
import { RoomScreen } from './components/RoomScreen';
import { Sheet } from './components/Sheet';
import { MemorySheet, SettingsSheet } from './components/DataSheets';

export type TurnStatus = 'idle' | 'thinking' | 'done' | 'error';

/** 무료 한도(Groq TPM 8K, Gemini RPM) 안에서 호출 간격을 벌린다. 값은 config/meeting.ts. */
const MIN_GAP_MS =
  typeof localStorage !== 'undefined' && Number.isFinite(Number(localStorage.getItem('airt3.test.gapMs')))
    ? { gptoss: Number(localStorage.getItem('airt3.test.gapMs')), gemini: Number(localStorage.getItem('airt3.test.gapMs')) }
    : MEETING_TUNING.callGapMs; // airt3.test.gapMs 는 자동 E2E 전용(사람용 설정 아님)

function appNotice(text: string): ChatMessage {
  return {
    id: newId('msg'),
    authorId: 'system',
    text,
    createdAt: Date.now(),
    source: 'local',
    roleAtTime: '앱',
  };
}

/**
 * 회의를 멈춘 이유를 사용자 말로. 숫자를 지어내지 않고 실제 값만 쓴다.
 */
function endNotice(reason: EndedReason): string {
  switch (reason) {
    case 'moderator_done':
      return '사회자가 더 확인할 것이 없다고 판단해 회의를 마무리했다.';
    case 'budget':
      return `회의당 호출 예산(${callBudget()}회)에 닿아 자동으로 정리하고 멈췄다.`;
    case 'repeat':
      return '같은 말이 세 번 이어져 되풀이를 감지하고 멈췄다. 주제를 좁혀 새로 시작하는 편이 낫다.';
    case 'all_disabled':
      return '켜져 있는 AI가 없어 멈췄다. 참가자를 하나 이상 켜고 재개해 달라.';
    case 'sensitive':
      return '민감정보가 감지되어 외부로 보내지 않고 멈췄다.';
    case 'error':
      return 'Worker 호출이 실패해 멈췄다.';
    default:
      return '회의를 멈췄다.';
  }
}

export default function App() {
  const [data, setData] = useState<AppData>(() => ({
    meetings: [],
    memories: [],
    settings: loadSettings(),
    activeMeetingId: null,
  }));
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState('');
  const [homeSheet, setHomeSheet] = useState<'settings' | 'memory' | null>(null);
  const [turnStatus, setTurnStatus] = useState<Record<AiId, TurnStatus>>({ gptoss: 'idle', gemini: 'idle', moderator: 'idle' });
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const toastTimer = useRef<number | null>(null);
  const dataRef = useRef(data);
  const runningRef = useRef(false);
  const lastCallAt = useRef<Record<'gptoss' | 'gemini', number>>({ gptoss: 0, gemini: 0 });
  /**
   * 일시정지·종료 때 1 올린다. 간격을 기다리던 스텝은 이 값이 바뀌면 스스로 물러나고,
   * 재개하면 그때의 대화(끼어든 말 포함)로 새 요청을 만든다.
   */
  const epochRef = useRef(0);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // 처음 한 번: IndexedDB에서 회의·기억을 읽고, 없으면 예전 localStorage 값을 옮긴다.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const snapshot = await loadWorkspace();
      const legacy = collectLegacyData();
      const meetings = snapshot.meetings.length ? snapshot.meetings : legacy.meetings;
      const memories = snapshot.memories.length ? snapshot.memories : legacy.memories;
      if (!snapshot.migrated && (legacy.meetings.length || legacy.memories.length)) {
        await saveWorkspace({ meetings, memories });
      }
      if (!alive) return;
      const activeId = loadActiveMeetingId();
      setData((prev) => ({
        ...prev,
        meetings,
        memories,
        activeMeetingId: activeId && meetings.some((m) => m.id === activeId) ? activeId : null,
      }));
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ready 전에는 저장하지 않는다. 초기 null 이 저장되면 새로고침 때 열려 있던 회의를 잃는다.
  useEffect(() => {
    if (ready) saveSettings(data.settings);
  }, [ready, data.settings]);
  useEffect(() => {
    if (ready) saveSession(data.activeMeetingId);
  }, [ready, data.activeMeetingId]);
  // 회의·기억은 IndexedDB에 저장한다(디바운스). 실패해도 화면은 계속 동작한다.
  useEffect(() => {
    if (!ready) return undefined;
    const timer = window.setTimeout(() => {
      void saveWorkspace({ meetings: data.meetings, memories: data.memories });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [ready, data.meetings, data.memories]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3000);
  }, []);

  const active = useMemo(
    () => data.meetings.find((m) => m.id === data.activeMeetingId) ?? null,
    [data.meetings, data.activeMeetingId],
  );

  const patch = useCallback((id: string, changes: Partial<Meeting> | ((m: Meeting) => Partial<Meeting>)) => {
    setData((prev) => ({
      ...prev,
      meetings: prev.meetings.map((m) =>
        m.id === id
          ? { ...m, ...(typeof changes === 'function' ? changes(m) : changes), updatedAt: Date.now() }
          : m,
      ),
    }));
  }, []);

  const append = useCallback(
    (id: string, message: ChatMessage, extra: Partial<Meeting> = {}) => {
      patch(id, (m) => ({ messages: [...m.messages, message], ...extra }));
    },
    [patch],
  );

  /**
   * 지정한 시간 동안 기다리되, 회의가 멈추거나 epoch 가 바뀌면 즉시 false 로 돌아온다.
   * 일시정지가 화면에서뿐 아니라 실제 호출도 바로 멈추게 하는 장치다.
   */
  const holdWhileRunning = useCallback(async (ms: number, meetingId: string, epoch: number): Promise<boolean> => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const m = dataRef.current.meetings.find((x) => x.id === meetingId);
      if (epochRef.current !== epoch || !m || m.status !== 'active' || !m.auto) return false;
      await new Promise((r) => setTimeout(r, Math.min(200, Math.max(0, until - Date.now()))));
    }
    return true;
  }, []);

  const copy = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        showToast(label);
        return;
      } catch {
        /* 아래 fallback */
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
    const configured = isWorkerConfigured(data.settings);
    const meeting: Meeting = {
      id: newId('mt'),
      title: topic.length > 28 ? `${topic.slice(0, 28)}…` : topic,
      topic,
      domain: analysis.domain,
      createdAt: now,
      updatedAt: now,
      roles: analysis.roles,
      status: configured ? 'active' : 'paused',
      messages: [],
      queue: [],
      usedMemoryIds: related.map((r) => r.item.id),
      repeatWarnings: 0,
      maxTurns: MEETING_TUNING.defaultMaxTurns,
      auto: configured,
      enabledAi: { gptoss: true, gemini: true, moderator: true },
      awaitingDecision: true,
      callCount: 0,
    };
    setData((prev) => ({ ...prev, meetings: [meeting, ...prev.meetings], activeMeetingId: meeting.id }));
    if (!configured) {
      showToast('Worker가 아직 설정되지 않았습니다. 설정에서 URL과 패스코드를 넣어 주세요.');
    } else {
      showToast(`회의방을 열었습니다. 관련 기억 ${related.length}건을 불러왔습니다.`);
    }
  }

  /** 회의를 끝낸다. 사회자가 켜져 있고 예산이 남아 있으면 사회자에게 최종 정리를 받는다. */
  const finishMeeting = useCallback(
    async (meeting: Meeting, reason: EndedReason, opts: { forceSummary?: boolean } = {}) => {
      const settings = dataRef.current.settings;
      const canSummarize =
        meeting.enabledAi.moderator !== false &&
        (meeting.callCount ?? 0) < callBudget() &&
        isWorkerConfigured(settings) &&
        (opts.forceSummary || !meeting.summary);
      if (!canSummarize) {
        patch(meeting.id, (m) => ({
          status: 'ended',
          auto: false,
          nextSpeaker: undefined,
          endedReason: reason,
          summary: m.summary ?? buildLocalSummary(m),
          messages: [...m.messages, appNotice(`[회의 종료] ${endNotice(reason)}`)],
        }));
        return;
      }
      const plan = {
        speaker: 'moderator' as AiId,
        phase: 'summary' as const,
        turnIndex: meeting.messages.length + 1,
        mode: 'summary' as const,
        final: true,
      };
      const req = buildTurnRequest(meeting, plan, dataRef.current.memories, settings.displayName || '나');
      try {
        const res = await requestSummary(settings, req);
        patch(meeting.id, (m) => ({
          messages: [
            ...m.messages,
            {
              id: newId('msg'),
              authorId: 'moderator',
              text: res.text,
              createdAt: Date.now(),
              source: 'api',
              roleAtTime: m.roles.moderator,
              model: res.model,
              provider: res.provider,
              latencyMs: res.latencyMs,
            },
            appNotice(`[회의 종료] ${endNotice(reason)}`),
          ],
          summary: res.text,
          status: 'ended',
          auto: false,
          nextSpeaker: undefined,
          endedReason: reason,
          callCount: (m.callCount ?? 0) + 1,
        }));
      } catch {
        patch(meeting.id, (m) => ({
          status: 'ended',
          auto: false,
          nextSpeaker: undefined,
          endedReason: reason,
          summary: m.summary ?? buildLocalSummary(m),
          messages: [...m.messages, appNotice(`[회의 종료] ${endNotice(reason)} (사회자 정리는 받지 못해 기록 요약으로 대체)` )],
        }));
      }
    },
    [patch],
  );

  /**
   * 자동 회의 한 스텝.
   * 순서: ① 사용자 지시·멘션 ② 사회자의 다음 발언자 결정 ③ 발언 ④ 종료 조건(예산·반복·사회자 done).
   * 실패하면 회의를 멈추고 원인을 그대로 보여 준다(가짜 답변으로 채우지 않는다).
   */
  const runOneStep = useCallback(async () => {
    const current = dataRef.current;
    const meeting = current.meetings.find((m) => m.id === current.activeMeetingId);
    if (!meeting || meeting.status !== 'active' || !meeting.auto) return;
    const epoch = epochRef.current;

    // ④ 멈춤 조건을 먼저 본다. 예산·반복·사회자 done 이면 더 부르지 않는다.
    const reason = endReasonFor(meeting);
    if (reason) {
      await finishMeeting(meeting, reason);
      return;
    }

    const plan = planNextTurn(meeting);
    if (!plan) {
      await finishMeeting(meeting, 'error');
      return;
    }

    const settings = current.settings;
    if (!isWorkerConfigured(settings)) {
      append(
        meeting.id,
        appNotice('Worker 주소나 개인용 패스코드가 없어 자동 회의를 멈췄습니다. 설정에서 넣어 주세요.'),
        { auto: false, status: 'paused', endedReason: 'error' },
      );
      return;
    }

    const directMsg = pendingUserDirective(meeting);
    const req = buildTurnRequest(meeting, plan, current.memories, settings.displayName || '나');
    const outbound = [req.topic, req.userDirective ?? '', ...req.transcript.map((t) => t.text)].join('\n');
    const findings = scanSensitive(outbound);
    if (findings.length) {
      append(
        meeting.id,
        appNotice(
          `외부 API로 보내지 않았습니다. 민감정보로 보이는 항목: ${findings.map((f) => f.label).join(', ')}. 해당 부분을 지운 뒤 재개해 주세요.`,
        ),
        { auto: false, status: 'paused', endedReason: 'sensitive' },
      );
      setTurnStatus((s) => ({ ...s, [plan.speaker]: 'error' }));
      return;
    }

    const providerKey: 'gptoss' | 'gemini' = plan.speaker === 'gptoss' ? 'gptoss' : 'gemini';
    const wait = MIN_GAP_MS[providerKey] - (Date.now() - lastCallAt.current[providerKey]);
    // 간격을 기다리는 동안에도 일시정지·종료를 0.2초 단위로 확인해 바로 물러난다.
    // (예전에는 대기 중에 멈춰도 그 호출이 그대로 나가 무료 한도를 썼고,
    //  재개하면 끼어든 말이 빠진 옛 요청이 그대로 다시 나갔다.)
    const interrupted = wait > 0 && !(await holdWhileRunning(wait, meeting.id, epoch));
    const still = dataRef.current.meetings.find((m) => m.id === meeting.id);
    if (
      interrupted ||
      epochRef.current !== epoch ||
      !still ||
      still.status !== 'active' ||
      !still.auto ||
      still.enabledAi[plan.speaker] === false
    ) {
      setTurnStatus((s) => ({ ...s, [plan.speaker]: 'idle' }));
      return;
    }

    setTurnStatus((s) => ({ ...s, [plan.speaker]: 'thinking' }));
    const startedAt = Date.now();
    lastCallAt.current[providerKey] = startedAt;

    try {
      const res = plan.mode === 'summary' ? await requestSummary(settings, req) : await requestTurn(settings, req);
      const message: ChatMessage = {
        id: newId('msg'),
        authorId: plan.speaker,
        text: res.text,
        createdAt: Date.now(),
        source: 'api',
        roleAtTime: meeting.roles[plan.speaker],
        model: res.model,
        provider: res.provider,
        latencyMs: res.latencyMs || Date.now() - startedAt,
      };
      setTurnStatus((s) => ({ ...s, [plan.speaker]: 'done' }));
      // 이번 요청에 실제로 실린 사용자 지시는 전달 완료로 표시한다(실패하면 남겨 두고 다음 턴에 다시 싣는다).
      const sent = directMsg ? { directiveSentId: directMsg.id } : {};
      const counted = { callCount: (meeting.callCount ?? 0) + 1 };

      if (plan.mode === 'decide') {
        // 사회자 결정 턴: 본문만 남기고 다음 발언자를 상태에 적는다.
        append(meeting.id, message, { ...applyDecision(meeting, res.decision), ...counted, ...sent });
      } else if (plan.mode === 'summary') {
        patch(meeting.id, (m) => ({
          messages: [...m.messages, message],
          summary: res.text,
          status: 'ended',
          auto: false,
          nextSpeaker: undefined,
          endedReason: 'moderator_done',
          ...counted,
          ...sent,
        }));
      } else {
        append(meeting.id, message, { ...afterSpeech(meeting, plan.speaker), ...counted, ...sent });
      }
    } catch (e) {
      const err = e instanceof WorkerError ? e : new WorkerError(e instanceof Error ? e.message : '알 수 없는 오류', 'provider_error');
      const hint =
        err.code === 'unauthorized'
          ? '패스코드가 Worker의 APP_ACCESS_TOKEN과 다릅니다. 설정에서 확인해 주세요.'
          : err.code === 'not_configured'
            ? 'Worker 비밀키(GROQ_API_KEY / GEMINI_API_KEY / APP_ACCESS_TOKEN)가 설정됐는지 확인해 주세요.'
            : err.code === 'rate_limited' || err.code === 'quota_exceeded'
              ? `무료 한도에 닿았습니다.${err.retryAfter ? ` 약 ${err.retryAfter}초 뒤에 다시 시도할 수 있습니다.` : ''} 자동 회의를 멈췄습니다.`
              : err.code === 'sensitive_blocked'
                ? '민감정보가 감지되어 전송을 막았습니다.'
                : 'Worker 호출이 실패했습니다.';
      setTurnStatus((s) => ({ ...s, [plan.speaker]: 'error' }));
      append(meeting.id, appNotice(`[자동 회의 중단] ${hint} (원인: ${err.message})`), {
        auto: false,
        status: 'paused',
        endedReason: 'error',
      });
      showToast(`${plan.speaker === 'gptoss' ? 'GPT-OSS' : plan.speaker === 'gemini' ? 'Gemini' : '사회자'} 호출 실패 — 회의를 멈췄습니다.`);
    }
  }, [append, patch, showToast, finishMeeting]);

  // 자동 루프: 회의 상태가 바뀔 때마다 다음 스텝을 이어서 실행한다.
  // tick은 스텝이 끝난 직후 한 번 더 돌게 해, 상태 갱신과 effect 실행이 엇갈려 멈추는 일을 막는다.
  useEffect(() => {
    if (!active || !active.auto || active.status !== 'active' || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    void runOneStep().finally(() => {
      runningRef.current = false;
      setRunning(false);
      setTick((t) => t + 1);
    });
  }, [active?.id, active?.auto, active?.status, active?.messages.length, active?.callCount, tick, runOneStep]);

  function beginAuto() {
    if (!active) return;
    if (!isWorkerConfigured(data.settings)) {
      showToast('먼저 설정에서 Worker URL과 개인용 패스코드를 넣어 주세요.');
      setHomeSheet('settings');
      return;
    }
    patch(active.id, { auto: true, status: 'active' });
  }

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

  const actions = {
    send(text: string, attachment?: Attachment) {
      const meeting = dataRef.current.meetings.find((m) => m.id === dataRef.current.activeMeetingId);
      if (!meeting || meeting.status === 'ended') return;
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
      const queue = mentions.targets.length ? mentions.targets : meeting.queue;
      append(meeting.id, msg, { queue, lastSpeaker: 'me' });
      if (mentions.targets.length) {
        showToast(`${mentions.targets.map((t) => (t === 'gptoss' ? 'GPT-OSS' : t === 'gemini' ? 'Gemini' : '사회자')).join(', ')} 다음 발언으로 지정했습니다.`);
      }
    },
    pause() {
      if (!active) return;
      epochRef.current += 1;
      patch(active.id, { auto: false, status: 'paused' });
      showToast('자동 회의를 멈췄습니다. 재개하면 이어갑니다.');
    },
    resume() {
      if (!active) return;
      if (!isWorkerConfigured(data.settings)) {
        showToast('먼저 설정에서 Worker URL과 개인용 패스코드를 넣어 주세요.');
        setHomeSheet('settings');
        return;
      }
      patch(active.id, { auto: true, status: 'active' });
      showToast('자동 회의를 재개했습니다.');
    },
    end() {
      if (!active) return;
      epochRef.current += 1;
      // 종료는 즉시 표시하고, 요약은 finishMeeting 이 한 번만 채운다(지역 요약으로 덮어쓰는 경합 제거).
      patch(active.id, { status: 'ended', auto: false, endedReason: 'user' });
      showToast('회의를 종료했습니다. 사회자 최종 정리를 받아오는 중…');
      void finishMeeting({ ...active, summary: undefined, endedReason: 'user' }, 'user', { forceSummary: true });
    },
    reopen() {
      if (!active) return;
      patch(active.id, { status: 'active', auto: isWorkerConfigured(data.settings) });
      showToast('회의를 다시 이어갑니다.');
    },
    pin(id: string) {
      if (!active) return;
      const isPinned = active.messages.find((m) => m.id === id)?.pinned;
      patch(active.id, (m) => ({
        messages: m.messages.map((x) => ({ ...x, pinned: x.id === id ? !isPinned : false })),
      }));
      showToast(isPinned ? '고정을 해제했습니다.' : '메시지를 상단에 고정했습니다.');
    },
    edit(id: string, text: string) {
      if (!active) return;
      patch(active.id, (m) => ({
        messages: m.messages.map((x) => (x.id === id ? { ...x, text, editedAt: Date.now() } : x)),
      }));
      showToast('메시지를 수정했습니다.');
    },
    remove(id: string) {
      if (!active) return;
      patch(active.id, (m) => ({
        messages: m.messages.map((x) => (x.id === id ? { ...x, deleted: true, text: '' } : x)),
      }));
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
            ? { ...m, updatedAt: Date.now(), messages: m.messages.map((x) => (x.id === msg.id ? { ...x, memoryId: item.id } : x)) }
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
    beginAuto,
    toggleAi(id: AiId) {
      const meeting = dataRef.current.meetings.find((m) => m.id === dataRef.current.activeMeetingId);
      if (!meeting) return;
      const on = meeting.enabledAi[id] !== false;
      const enabledAi = { ...meeting.enabledAi, [id]: !on };
      const changes: Partial<Meeting> = { enabledAi };
      // 끄는 AI가 다음 발언자로 잡혀 있으면 그 지목을 지우고 사회자에게 다시 묻는다.
      if (!on === false && meeting.nextSpeaker === id) changes.nextSpeaker = undefined;
      if (!enabledAi[id] && meeting.nextSpeaker === id) {
        changes.nextSpeaker = undefined;
        changes.awaitingDecision = enabledAi.moderator !== false;
      }
      patch(meeting.id, changes);
      showToast(`${PARTICIPANTS[id].name} ${on ? '끔 — 이제 호출하지 않는다' : '켬'}`);
      setTick((t) => t + 1);
    },
  };

  if (!ready) {
    return (
      <div className="boot" data-testid="boot-screen">
        AI Roundtable 불러오는 중…
      </div>
    );
  }

  if (!active) {
    return (
      <>
        <HomeScreen
          meetings={data.meetings}
          memories={data.memories}
          settings={data.settings}
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
      running={running}
      turnStatus={turnStatus}
      workerReady={isWorkerConfigured(data.settings)}
      actions={actions}
      onBack={() => setData((prev) => ({ ...prev, activeMeetingId: null }))}
      onOpenSettings={() => setHomeSheet('settings')}
      toast={toast}
      externalSheet={
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
      }
    />
  );
}

export { AI_IDS };
