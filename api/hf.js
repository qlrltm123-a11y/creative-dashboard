// Vercel 서버리스 함수 — Higgsfield API 프록시
// Node.js 환경에서 실행되므로 platform.higgsfield.ai IP 차단 우회 가능

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hf-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // API 키: 요청 헤더 또는 환경변수
  const apiKey = req.headers['x-hf-key']
    || (req.headers.authorization || '').replace(/^Key\s*/i, '')
    || process.env.HF_CREDENTIALS
    || '';

  if (!apiKey) return res.status(401).json({ error: 'API 키가 없습니다. X-Hf-Key 헤더 또는 HF_CREDENTIALS 환경변수를 설정해주세요.' });

  const { prompt, aspect_ratio = '1:1', type = 'image' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt 필드가 필요합니다.' });

  // 엔드포인트 & body 결정
  let endpoint, body;
  if (type === 'video') {
    endpoint = '/v1/image2video/dop';
    body = { model: 'dop-turbo', prompt, aspect_ratio };
  } else {
    endpoint = '/nano_banana_flash/text-to-image';
    body = { prompt, aspect_ratio, safety_tolerance: 2 };
  }

  try {
    const hfRes = await fetch(`https://platform.higgsfield.ai${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'higgsfield-server-js/2.0',
      },
      body: JSON.stringify(body),
    });

    const text = await hfRes.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return res.status(hfRes.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
