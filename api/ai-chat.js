// POST /api/ai-chat  — Gemini 프록시 (서버에서 API 키 관리)
//
// 필요 환경변수 (Vercel → Settings → Environment Variables):
//   GEMINI_API_KEY  — Google AI Studio API 키 (aistudio.google.com/apikey)
//   GEMINI_MODEL    — (선택) 기본 'gemini-2.0-flash-exp'
//
// 클라이언트는 키 없이 { contents, generationConfig } 만 보내면 됨.

// Vercel KV에 대화 로그 저장 (fire-and-forget, 실패해도 무시)
// 프리픽스는 연동 방식에 따라 KV_ / STORAGE_ / UPSTASH_ 로 달라질 수 있어 모두 지원
function _saveLog(question, model, answerLen) {
  const url  = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  const entry = JSON.stringify({
    t:  new Date().toISOString(),
    q:  (question || '').slice(0, 600),
    m:  model || '',
    rl: answerLen || 0,
  });
  // fire-and-forget — await 없이 전송
  fetch(`${url}/lpush/chat_logs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([entry]),
  }).catch(() => {});
}

module.exports = async function handler(req, res) {
  // CORS (동일 origin이지만 안전하게)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Vercel → Settings → Environment Variables에서 추가해주세요.' });
  }
  // body 파싱 (Vercel은 보통 자동 파싱하지만 방어적으로 처리)
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || !Array.isArray(body.contents)) {
    return res.status(400).json({ error: 'contents 배열이 필요합니다.' });
  }

  // 첫 번째 사용자 메시지 추출 (로깅용)
  const _question = (() => {
    const first = body.contents.find(c => c.role === 'user');
    if (!first) return '';
    const parts = first.parts || [];
    return parts.map(p => p.text || '').join(' ').trim();
  })();

  // generationConfig 정규화 — 클라이언트가 뭘 보내든 thinking 끄고 토큰 한도 보장
  // (gemini-2.5-flash는 thinking 모델이라 thinkingBudget을 안 끄면 사고 토큰이 본문을 잡아먹어 답변이 잘림)
  const gc = Object.assign({ temperature: 0.4 }, body.generationConfig || {});
  if (gc.thinkingConfig == null) gc.thinkingConfig = { thinkingBudget: 0 };
  if (!gc.maxOutputTokens || gc.maxOutputTokens < 8192) gc.maxOutputTokens = 8192;
  const payload = JSON.stringify({ contents: body.contents, generationConfig: gc });

  const callModel = async (model) => {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }
    );
    const data = await r.json();
    return { ok: r.ok, status: r.status, data };
  };

  // 후보 모델 순서 (만료 대비 폴백). GEMINI_MODEL 지정 시 최우선.
  const candidates = [];
  if (process.env.GEMINI_MODEL) candidates.push(process.env.GEMINI_MODEL);
  candidates.push('gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest');

  try {
    let last = null;
    for (const m of candidates) {
      const r = await callModel(m);
      if (r.ok) {
        const cand = r.data.candidates?.[0];
        const text = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
        const finish = cand?.finishReason || '';
        // 사고 토큰으로 본문이 잘린 경우 안내
        if (!text && finish === 'MAX_TOKENS') {
          _saveLog(_question, m, 0);
          return res.status(200).json({ text: '⚠️ 답변 생성 중 토큰 한도에 도달했습니다. 질문을 더 구체적으로(예: 특정 브랜드·기간) 좁혀주세요.', model: m, finishReason: finish });
        }
        // 본문은 있으나 한도로 끊긴 경우 — 끝에 안내 덧붙임
        if (text && finish === 'MAX_TOKENS') {
          _saveLog(_question, m, text.length);
          return res.status(200).json({ text: text + '\n\n---\n⚠️ *답변이 길어 일부에서 끊겼습니다. 더 필요한 부분을 콕 집어 물어보세요.*', model: m, finishReason: finish });
        }
        _saveLog(_question, m, text.length);
        return res.status(200).json({ text, model: m, finishReason: finish });
      }
      last = r;
      const msg = r.data?.error?.message || '';
      // 모델 없음/만료 계열이면 다음 후보 시도, 그 외(인증·쿼터 등)는 즉시 중단
      if (!/not found|no longer available|not supported|unsupported/i.test(msg)) break;
    }

    // 후보 전부 실패 → ListModels로 실제 사용 가능한 flash 모델 자동 탐색
    try {
      const lr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`);
      const lm = await lr.json();
      const avail = (lm.models || [])
        .filter(x => (x.supportedGenerationMethods || []).includes('generateContent'))
        .map(x => (x.name || '').replace('models/', ''));
      const pick = avail.find(n => /flash/i.test(n)) || avail[0];
      if (pick) {
        const r = await callModel(pick);
        if (r.ok) {
          const text = r.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          _saveLog(_question, pick, text.length);
          return res.status(200).json({ text, model: pick });
        }
        last = r;
      }
      return res.status((last&&last.status)||502).json({
        error: (last?.data?.error?.message || '사용 가능한 모델을 찾지 못했습니다.'),
        availableModels: avail.slice(0, 20),
      });
    } catch (e2) {
      return res.status((last&&last.status)||502).json({ error: last?.data?.error?.message || e2.message });
    }
  } catch (e) {
    return res.status(502).json({ error: `Gemini 호출 실패: ${e.message}` });
  }
};
