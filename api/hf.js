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

    // 영상 엔드포인트 경로 탐색 (image2video 패턴 기반)
    const videoBody = { prompt: 'test video', aspect_ratio: '16:9' };
    const videoBodyParams = { params: { prompt: 'test video', aspect_ratio: '16:9' } };
    const tests = [
      { label: 'v1/text2video/grok_video flat',        url: 'https://platform.higgsfield.ai/v1/text2video/grok_video',   body: videoBody },
      { label: 'v1/text2video/grok_video params',      url: 'https://platform.higgsfield.ai/v1/text2video/grok_video',   body: videoBodyParams },
      { label: 'v1/text2video/seedance_2_0 flat',      url: 'https://platform.higgsfield.ai/v1/text2video/seedance_2_0', body: videoBody },
      { label: 'v1/text2video/minimax_hailuo flat',    url: 'https://platform.higgsfield.ai/v1/text2video/minimax_hailuo',body: videoBody },
      { label: 'v1/text2video/kling3_0 flat',          url: 'https://platform.higgsfield.ai/v1/text2video/kling3_0',     body: videoBody },
      { label: 'text2video/grok_video flat',           url: 'https://platform.higgsfield.ai/text2video/grok_video',      body: videoBody },
      { label: 'v1/video/grok_video flat',             url: 'https://platform.higgsfield.ai/v1/video/grok_video',        body: videoBody },
      { label: 'v1/grok_video/generate flat',          url: 'https://platform.higgsfield.ai/v1/grok_video/generate',     body: videoBody },
      { label: 'v1/grok_video flat',                   url: 'https://platform.higgsfield.ai/v1/grok_video',              body: videoBody },
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

  // ── 영상 Step2: 이미지URL → 영상 변환 ─────────────────────────
  // type='video-step2' + imageUrl 필드로 호출
  if (type === 'video-step2') {
    const imageUrl = req.body?.imageUrl;
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl 필드 필요' });

    try {
      const r = await fetch('https://platform.higgsfield.ai/v1/image2video/dop', {
        method: 'POST',
        headers: { 'Authorization': authKey, 'Content-Type': 'application/json', 'User-Agent': 'higgsfield-server-js/2.0' },
        body: JSON.stringify({
          params: {
            input_images: [{ url: imageUrl }],
            prompt: prompt.slice(0, 200), // 짧고 안전한 프롬프트
            aspect_ratio,
            safety_tolerance: 6,
          },
        }),
      });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      logs.push({ step: 'image2video', status: r.status, body: text.slice(0, 200) });

      if (r.status >= 200 && r.status < 300) {
        if (data.request_id) {
          return res.status(200).json({
            requestId: data.request_id,
            statusUrl: data.status_url || null,
            _ep: '/v1/image2video/dop',
          });
        }
        const resultUrl = data.video?.url || data.url || data.results?.[0]?.rawUrl || null;
        return res.status(200).json({ url: resultUrl, raw: data });
      }
      return res.status(r.status).json({ error: '영상 변환 실패', raw: data, logs });
    } catch (e) {
      return res.status(502).json({ error: e.message, logs });
    }
  }

  return res.status(502).json({ error: '모든 시도 실패', logs });
};
