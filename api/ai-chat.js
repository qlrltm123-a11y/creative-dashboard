// POST /api/ai-chat  — Gemini 프록시 (서버에서 API 키 관리)
//
// 필요 환경변수 (Vercel → Settings → Environment Variables):
//   GEMINI_API_KEY  — Google AI Studio API 키 (aistudio.google.com/apikey)
//   GEMINI_MODEL    — (선택) 기본 'gemini-2.0-flash-exp'
//
// 클라이언트는 키 없이 { contents, generationConfig } 만 보내면 됨.

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

  const payload = JSON.stringify({
    contents: body.contents,
    generationConfig: body.generationConfig || { temperature: 0.4, maxOutputTokens: 1200 },
  });

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
  candidates.push('gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-pro-latest');

  try {
    let last = null;
    for (const m of candidates) {
      const r = await callModel(m);
      if (r.ok) {
        const text = r.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return res.status(200).json({ text, model: m });
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
