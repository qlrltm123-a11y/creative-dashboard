module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hf-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.HF_CREDENTIALS || '';

  // ── 폴링 프록시: GET /api/hf?poll=REQUEST_ID ─────────────────
  if (req.method === 'GET' && req.query?.poll) {
    if (!apiKey) return res.status(401).json({ error: 'HF_CREDENTIALS 없음' });
    const requestId = req.query.poll;
    const pollUrl = `https://platform.higgsfield.ai/requests/${requestId}/status`;
    try {
      const r = await fetch(pollUrl, {
        headers: {
          'Authorization': `Key ${apiKey}`,
          'User-Agent': 'higgsfield-server-js/2.0',
        },
      });
      const data = await r.json();
      return res.status(r.status).json(data);
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }

  // ── 디버그: GET /api/hf?debug=1 ──────────────────────────────
  if (req.method === 'GET' && req.query?.debug === '1') {
    const keyInfo = apiKey
      ? { set: true, length: apiKey.length, hasColon: apiKey.includes(':'), preview: apiKey.slice(0,4) + '...' + apiKey.slice(-4) }
      : { set: false };

    const testResults = [];
    const authHeader = `Key ${apiKey}`;

    // 영상 엔드포인트 경로 탐색
    const videoBody = { prompt: 'test video', aspect_ratio: '16:9' };
    const tests = [
      { label: 'video / grok_video/text-to-video',           url: 'https://platform.higgsfield.ai/grok_video/text-to-video',           body: videoBody },
      { label: 'video / grok-video/text-to-video',           url: 'https://platform.higgsfield.ai/grok-video/text-to-video',           body: videoBody },
      { label: 'video / grok-imagine/text-to-video',         url: 'https://platform.higgsfield.ai/grok-imagine/text-to-video',         body: videoBody },
      { label: 'video / xai-grok/text-to-video',             url: 'https://platform.higgsfield.ai/xai-grok/text-to-video',             body: videoBody },
      { label: 'video / seedance_2_0/text-to-video',         url: 'https://platform.higgsfield.ai/seedance_2_0/text-to-video',         body: videoBody },
      { label: 'video / seedance-2-0/text-to-video',         url: 'https://platform.higgsfield.ai/seedance-2-0/text-to-video',         body: videoBody },
      { label: 'video / minimax_hailuo/text-to-video',       url: 'https://platform.higgsfield.ai/minimax_hailuo/text-to-video',       body: videoBody },
      { label: 'video / v1/generate-video model:grok_video', url: 'https://platform.higgsfield.ai/v1/generate/video',                  body: { model: 'grok_video', ...videoBody } },
      { label: 'video / v1/text-to-video model:grok_video',  url: 'https://platform.higgsfield.ai/v1/text-to-video',                   body: { model: 'grok_video', ...videoBody } },
    ];

    for (const t of tests) {
      try {
        const r = await fetch(t.url, {
          method: 'POST',
          headers: {
            'Authorization': t.auth || authHeader,
            'Content-Type': 'application/json',
            'User-Agent': 'higgsfield-server-js/2.0',
          },
          body: JSON.stringify(t.body),
        });
        const body = (await r.text()).slice(0, 300);
        testResults.push({ label: t.label, status: r.status, body });
      } catch (e) {
        testResults.push({ label: t.label, error: e.message });
      }
    }

    return res.status(200).json({ keyInfo, testResults });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!apiKey) return res.status(401).json({
    error: 'HF_CREDENTIALS 없음',
    fix: 'Vercel → Settings → Environment Variables → HF_CREDENTIALS 추가 후 Redeploy',
  });

  const { prompt, aspect_ratio = '1:1', type = 'image' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt 필드 필요' });

  const authKey = `Key ${apiKey}`;
  const logs = [];

  // ── 이미지 생성 ────────────────────────────────────────────────
  if (type !== 'video') {
    const imageEndpoints = [
      'https://platform.higgsfield.ai/nano_banana_2/text-to-image',
      'https://platform.higgsfield.ai/nano_banana/text-to-image',
      'https://platform.higgsfield.ai/flux-pro/kontext/max/text-to-image',
    ];

    // input wrapper 형식 먼저, flat 형식 나중에
    const bodyVariants = [
      { input: { prompt, aspect_ratio, safety_tolerance: 2 } },
      { prompt, aspect_ratio, safety_tolerance: 2 },
    ];

    for (const url of imageEndpoints) {
      for (const body of bodyVariants) {
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': authKey,
              'Content-Type': 'application/json',
              'User-Agent': 'higgsfield-server-js/2.0',
            },
            body: JSON.stringify(body),
          });
          const text = await r.text();
          let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

          const isInputWrapper = 'input' in body;
          console.log(`[HF img] ${url} ${isInputWrapper ? 'wrapped' : 'flat'} → ${r.status}: ${text.slice(0,150)}`);
          logs.push({ url, format: isInputWrapper ? 'wrapped' : 'flat', status: r.status, body: text.slice(0,200) });

          if (r.status >= 200 && r.status < 300) {
            // 비동기 큐 응답 (queued / in_progress)
            if (data.request_id) {
              return res.status(200).json({
                requestId: data.request_id,
                statusUrl: data.status_url || null,
                _ep: url,
              });
            }
            // 즉시 완료 — URL 추출
            const resultUrl =
              data.images?.[0]?.url ||
              data.image?.url ||
              data.url ||
              data.results?.[0]?.rawUrl ||
              data.results?.[0]?.url ||
              data.output?.[0] ||
              data.data?.url ||
              null;
            return res.status(200).json({ url: resultUrl, raw: data, _ep: url });
          }

          if (r.status === 401 || r.status === 403) {
            return res.status(401).json({ error: '인증 실패 - API 키를 확인해주세요', status: r.status });
          }

        } catch (e) {
          logs.push({ url, error: e.message });
        }
      }
    }
  }

  // ── 비디오 생성 ────────────────────────────────────────────────
  if (type === 'video') {
    // grok_video: text-to-video (이미지 불필요)
    // 바디 형식: flat { prompt, aspect_ratio }
    const videoEndpoints = [
      { url: 'https://platform.higgsfield.ai/grok_video/text-to-video',   body: { prompt, aspect_ratio } },
      { url: 'https://platform.higgsfield.ai/v1/grok_video/text-to-video', body: { prompt, aspect_ratio } },
      { url: 'https://platform.higgsfield.ai/v1/image2video/dop',          body: { params: { prompt, aspect_ratio } } },
    ];
    for (const { url, body } of videoEndpoints) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': authKey,
            'Content-Type': 'application/json',
            'User-Agent': 'higgsfield-server-js/2.0',
          },
          body: JSON.stringify(body),
        });
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
        logs.push({ url, status: r.status, body: text.slice(0,200) });

        if (r.status === 404 || r.status === 422) continue; // 다음 엔드포인트 시도

        if (r.status >= 200 && r.status < 300) {
          if (data.request_id) {
            return res.status(200).json({
              requestId: data.request_id,
              statusUrl: data.status_url || null,
              _ep: url,
            });
          }
          const resultUrl = data.video?.url || data.url || data.results?.[0]?.rawUrl || null;
          return res.status(200).json({ url: resultUrl, raw: data, _ep: url });
        }
        if (r.status === 401 || r.status === 403) {
          return res.status(401).json({ error: '인증 실패', status: r.status });
        }
      } catch (e) {
        logs.push({ url, error: e.message });
      }
    }
  }

  return res.status(502).json({ error: '모든 시도 실패', logs });
};
