module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hf-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.HF_CREDENTIALS || '';
  const WORKSPACE_ID = process.env.HF_WORKSPACE_ID || 'b3a6bab3-3047-49bf-9dd8-0fd38e8fda8f';

  // ── 디버그: GET /api/hf?debug=1 ──────────────────────────────
  if (req.method === 'GET' && req.query?.debug === '1') {
    const keyInfo = apiKey
      ? { set: true, length: apiKey.length, hasColon: apiKey.includes(':'), preview: apiKey.slice(0,4) + '...' + apiKey.slice(-4) }
      : { set: false };

    // POST 테스트: 다양한 엔드포인트 + 바디 조합
    const testResults = [];
    const testBody = JSON.stringify({
      workspace_id: WORKSPACE_ID,
      prompt: 'test',
      aspect_ratio: '1:1',
      resolution: '1k',
    });

    const authHeaders = [
      ['Key',    `Key ${apiKey}`],
      ['Bearer', `Bearer ${apiKey}`],
    ];

    const testEndpoints = [
      '/v1/nano_banana_2/text-to-image',
      '/nano_banana_2/text-to-image',
      '/v1/generate/image',
      '/api/v1/generate/image',
    ];

    for (const ep of testEndpoints) {
      for (const [authLabel, authHeader] of authHeaders) {
        try {
          const r = await fetch('https://platform.higgsfield.ai' + ep, {
            method: 'POST',
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json',
              'User-Agent': 'higgsfield-server-js/2.0',
            },
            body: testBody,
          });
          const body = (await r.text()).slice(0, 300);
          testResults.push({ ep, auth: authLabel, status: r.status, body });
        } catch (e) {
          testResults.push({ ep, auth: authLabel, error: e.message });
        }
      }
    }

    return res.status(200).json({ keyInfo, workspaceId: WORKSPACE_ID, testResults });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!apiKey) return res.status(401).json({
    error: 'HF_CREDENTIALS 없음',
    fix: 'Vercel → Settings → Environment Variables → HF_CREDENTIALS = your_api_key 추가 후 Redeploy',
  });

  const { prompt, aspect_ratio = '1:1', type = 'image' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt 필드 필요' });

  // 이미지 엔드포인트 목록 (우선순위 순)
  const imageEndpoints = [
    '/v1/nano_banana_2/text-to-image',
    '/nano_banana_2/text-to-image',
    '/v1/nano_banana_flash/text-to-image',
    '/nano_banana_flash/text-to-image',
    '/v1/nano_banana/text-to-image',
    '/nano_banana/text-to-image',
  ];

  const videoEndpoints = [
    '/v1/image2video/dop',
    '/v1/dop-turbo/text-to-video',
  ];

  const endpoints = type === 'video' ? videoEndpoints : imageEndpoints;

  // 바디 빌드
  const buildBody = (ep) => {
    if (type === 'video') {
      return { workspace_id: WORKSPACE_ID, model: 'dop-turbo', prompt, aspect_ratio };
    }
    return { workspace_id: WORKSPACE_ID, prompt, aspect_ratio, resolution: '1k' };
  };

  // Key 형식과 Bearer 형식 둘 다 시도
  const authVariants = [`Key ${apiKey}`, `Bearer ${apiKey}`];
  const logs = [];

  for (const ep of endpoints) {
    for (const auth of authVariants) {
      const url = 'https://platform.higgsfield.ai' + ep;
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': auth,
            'Content-Type': 'application/json',
            'User-Agent': 'higgsfield-server-js/2.0',
          },
          body: JSON.stringify(buildBody(ep)),
        });
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

        console.log(`[HF] ${auth.slice(0,6)} ${ep} → ${r.status}: ${text.slice(0,150)}`);
        logs.push({ ep, auth: auth.slice(0,6), status: r.status, body: text.slice(0,200) });

        if (r.status >= 200 && r.status < 300) {
          // 다양한 응답 형식에서 URL 추출
          const resultUrl =
            data.images?.[0]?.url ||
            data.image?.url ||
            data.url ||
            data.results?.[0]?.rawUrl ||
            data.results?.[0]?.url ||
            data.output?.[0] ||
            data.video?.url ||
            data.data?.url ||
            null;
          return res.status(200).json({ url: resultUrl, raw: data, _ep: ep });
        }

        // 401/403 → 이 auth 형식 틀림 → 다음
        if (r.status === 401 || r.status === 403) continue;

        // 요청 접수형 응답
        if (data.request_id || data.id || data.job_id) {
          return res.status(200).json({
            requestId: data.request_id || data.id || data.job_id,
            _ep: ep,
          });
        }

        // 400 → 이 엔드포인트 형식 맞음, 바디 문제 (다음 auth 시도 불필요)
        if (r.status === 400) {
          logs.push({ note: '400 bad request - endpoint exists but body wrong', ep });
          break;
        }

      } catch (e) {
        logs.push({ ep, auth: auth.slice(0,6), error: e.message });
      }
    }
  }

  return res.status(502).json({ error: '모든 시도 실패', logs });
};
