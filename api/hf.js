// Vercel 서버리스 함수 — SDK 없이 순수 fetch 사용
// CommonJS 형식으로 모듈 오류 없음

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hf-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // HF_CREDENTIALS 환경변수 (Vercel dashboard에서 설정)
  const apiKey = process.env.HF_CREDENTIALS || '';
  console.log('[HF] apiKey set:', apiKey ? `YES (${apiKey.slice(0,6)}...)` : 'NO - HF_CREDENTIALS 환경변수 없음!');

  if (!apiKey) {
    return res.status(401).json({
      error: 'HF_CREDENTIALS 환경변수가 설정되지 않았습니다.',
      fix: 'Vercel Dashboard → Settings → Environment Variables → HF_CREDENTIALS = KEY_ID:KEY_SECRET 추가 후 Redeploy'
    });
  }

  const { prompt, aspect_ratio = '1:1', type = 'image' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt 필드 필요' });

  const endpoints = type === 'video'
    ? ['/v1/image2video/dop']
    : [
        '/nano_banana_flash/text-to-image',
        '/nano_banana_2/text-to-image',
        '/flux-pro/kontext/max/text-to-image',
        '/v1/text2image/nano_banana_flash',
      ];

  const logs = [];

  for (const ep of endpoints) {
    const url = 'https://platform.higgsfield.ai' + ep;
    const body = type === 'video'
      ? { model: 'dop-turbo', prompt, aspect_ratio }
      : { prompt, aspect_ratio, safety_tolerance: 2 };

    console.log(`[HF] POST ${url}`);

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'higgsfield-server-js/2.0',
        },
        body: JSON.stringify(body),
      });

      const text = await r.text();
      console.log(`[HF] ${ep} → ${r.status}: ${text.slice(0, 300)}`);
      logs.push({ ep, status: r.status, body: text.slice(0, 200) });

      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      // 성공
      if (r.status >= 200 && r.status < 300) {
        const url = data.images?.[0]?.url
          || data.image?.url
          || data.results?.[0]?.rawUrl
          || data.url
          || data.output?.[0]
          || data.video?.url
          || null;
        return res.status(200).json({ url, raw: data, _ep: ep });
      }

      // 인증 오류 → 재시도 무의미
      if (r.status === 401 || r.status === 403) {
        return res.status(r.status).json({ error: `인증 오류 (${r.status})`, detail: data, _ep: ep });
      }

      // 비동기 작업 시작 (request_id 반환)
      if (data.request_id || data.id || data.job_id) {
        const requestId = data.request_id || data.id || data.job_id;
        return res.status(200).json({ requestId, _ep: ep, raw: data });
      }

      // 404/500 → 다음 엔드포인트 시도
      if (r.status === 404 || r.status === 500) {
        console.log(`[HF] Skipping ${ep} (${r.status})`);
        continue;
      }

      return res.status(r.status).json({ ...data, _ep: ep, _logs: logs });

    } catch (e) {
      console.error(`[HF] ${ep} fetch error:`, e.message);
      logs.push({ ep, error: e.message });
      continue;
    }
  }

  return res.status(502).json({ error: '모든 엔드포인트 실패', logs });
};
