// Vercel 서버리스 함수 — Higgsfield API 프록시
// Node.js/AWS 환경 → IP 차단 없음

const HF_BASE = 'https://platform.higgsfield.ai';

// 이미지 엔드포인트 후보 (응답이 404가 아닌 첫 번째 사용)
const IMAGE_ENDPOINTS = [
  { path: '/nano_banana_flash/text-to-image', body: (p, ar) => ({ prompt: p, aspect_ratio: ar, safety_tolerance: 2 }) },
  { path: '/nano_banana_2/text-to-image',     body: (p, ar) => ({ prompt: p, aspect_ratio: ar, safety_tolerance: 2 }) },
  { path: '/nano_banana/text-to-image',        body: (p, ar) => ({ prompt: p, aspect_ratio: ar, safety_tolerance: 2 }) },
  { path: '/flux-pro/kontext/max/text-to-image', body: (p, ar) => ({ prompt: p, aspect_ratio: ar, safety_tolerance: 2 }) },
  { path: '/v1/text2image/nano_banana_flash',  body: (p, ar) => ({ prompt: p, aspect_ratio: ar, resolution: '1k' }) },
  { path: '/v1/text2image/nano_banana_2',      body: (p, ar) => ({ prompt: p, aspect_ratio: ar, resolution: '1k' }) },
];

const VIDEO_ENDPOINTS = [
  { path: '/v1/image2video/dop',  body: (p, ar) => ({ model: 'dop-turbo', prompt: p, aspect_ratio: ar }) },
  { path: '/dop/image-to-video',  body: (p, ar) => ({ prompt: p, aspect_ratio: ar, safety_tolerance: 2 }) },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hf-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = req.headers['x-hf-key']
    || (req.headers.authorization || '').replace(/^Key\s*/i, '')
    || process.env.HF_CREDENTIALS
    || '';

  if (!apiKey) return res.status(401).json({ error: 'API 키 없음 (X-Hf-Key 헤더 또는 HF_CREDENTIALS 환경변수)' });

  const { prompt, aspect_ratio = '1:1', type = 'image' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt 필드 필요' });

  const endpoints = type === 'video' ? VIDEO_ENDPOINTS : IMAGE_ENDPOINTS;
  const logs = [];

  for (const ep of endpoints) {
    const url    = HF_BASE + ep.path;
    const body   = ep.body(prompt, aspect_ratio);
    const reqLog = `${ep.path}`;

    try {
      const hfRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type':  'application/json',
          'Accept':        'application/json',
          'User-Agent':    'higgsfield-server-js/2.0',
        },
        body: JSON.stringify(body),
      });

      const text = await hfRes.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      logs.push({ path: reqLog, status: hfRes.status, body: text.slice(0, 200) });
      console.log(`[HF] ${ep.path} → ${hfRes.status}: ${text.slice(0, 200)}`);

      // 404/405 = 경로 없음 → 다음 시도
      if (hfRes.status === 404 || hfRes.status === 405) continue;

      // 200~299 또는 다른 코드 → 결과 반환
      return res.status(hfRes.status).json({ ...data, _used_endpoint: ep.path, _logs: logs });

    } catch (e) {
      logs.push({ path: reqLog, error: e.message });
      console.error(`[HF] ${ep.path} error:`, e.message);
      continue;
    }
  }

  return res.status(502).json({ error: '모든 엔드포인트 실패', logs });
}
