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
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  // body 파싱 (Vercel은 보통 자동 파싱하지만 방어적으로 처리)
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || !Array.isArray(body.contents)) {
    return res.status(400).json({ error: 'contents 배열이 필요합니다.' });
  }

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: body.contents,
          generationConfig: body.generationConfig || { temperature: 0.4, maxOutputTokens: 1200 },
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data.error?.message || `Gemini ${r.status}` });
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: `Gemini 호출 실패: ${e.message}` });
  }
};
