import type { AiId, Settings } from './types';

/**
 * 선택 기능: 사용자가 자기 API 키를 넣고 '자동 응답'을 켰을 때만 실제 호출한다.
 * 키가 없으면 호출하지 않고, 화면은 "API 미연결"로 표시한다. 기본은 수동 릴레이.
 */
export interface ApiResult {
  text: string;
  model: string;
}

export function hasApiKey(ai: AiId, keys: { openai: string; gemini: string }): boolean {
  if (ai === 'chatgpt') return Boolean(keys.openai.trim());
  if (ai === 'gemini') return Boolean(keys.gemini.trim());
  return false; // Pickle은 로컬 규칙 엔진/수동 입력만
}

async function callOpenAI(key: string, model: string, prompt: string): Promise<ApiResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI 호출 실패 (HTTP ${res.status}) ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenAI 응답이 비었습니다.');
  return { text, model };
}

async function callGemini(key: string, model: string, prompt: string): Promise<ApiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini 호출 실패 (HTTP ${res.status}) ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new Error('Gemini 응답이 비었습니다.');
  return { text, model };
}

export async function callAi(ai: AiId, prompt: string, settings: Settings): Promise<ApiResult> {
  if (ai === 'chatgpt') {
    if (!settings.apiKeys.openai.trim()) throw new Error('OpenAI API 키가 없습니다. 설정에서 키를 넣거나 수동 연결을 쓰세요.');
    return callOpenAI(settings.apiKeys.openai.trim(), settings.models.openai, prompt);
  }
  if (ai === 'gemini') {
    if (!settings.apiKeys.gemini.trim()) throw new Error('Gemini API 키가 없습니다. 설정에서 키를 넣거나 수동 연결을 쓰세요.');
    return callGemini(settings.apiKeys.gemini.trim(), settings.models.gemini, prompt);
  }
  throw new Error('Pickle은 API 자동 호출 대상이 아닙니다(로컬 규칙 엔진/수동 입력).');
}
