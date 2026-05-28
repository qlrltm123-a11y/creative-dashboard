module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hf-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.HF_CREDENTIALS || '';

  // ── 디버그: GET /api/hf?debug=1 ──────────────────────────────
  if (req.method === 'GET' && req.query?.debug === '1') {
    const keyInfo = apiKey
      ? { set: true, length: apiKey.length, hasColon: apiKey.includes(':'), preview: apiKey.slice(0,4) + '...' + apiKey.slice(-4) }
      : { set: false };

    // Higgsfield 루트 GET 테스트
    const testResults = [];
    for (const [label, authHeader] of [
      ['Key format',    `Key ${apiKey}`],
      ['Bearer format', `Bearer ${apiKey}`],
      ['Raw key',       apiKey],
    ]) {
      try {
        const r = await fetch('https://platform.higgsfield.ai/', {
          headers: { 'Authorization': authHeader, 'User-Agent': 'higgsfield-server-js/2.0' },
        });
        const body = (await r.text()).slice(0, 200);
        testResults.push({ label, status: r.status, body });
      } catch (e) {
        testResults.push({ label, error: e.message });
      }
    }
    return res.status(200).json({ keyInfo, testResults });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!apiKey) return res.status(401).json({
    error: 'HF_CREDENTIALS 없음',
    fix: 'Vercel → Settings → Environment Variables → HF_CREDENTIALS = KEY_ID:KEY_SECRET 추가 후 Redeploy'
  });

  const { prompt, aspect_ratio = '1:1', type = 'image' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt 필드 필요' });

  const endpoints = type === 'video'
    ? ['/v1/image2video/dop']
    : ['/nano_banana_flash/text-to-image', '/nano_banana_2/text-to-image', '/flux-pro/kontext/max/text-to-image'];

  // Key 형식과 Bearer 형식 둘 다 시도
  const authVariants = [`Key ${apiKey}`, `Bearer ${apiKey}`];
  const logs = [];

  for (const ep of endpoints) {
    for (const auth of authVariants) {
      const url  = 'https://platform.higgsfield.ai' + ep;
      const body = type === 'video'
        ? { model: 'dop-turbo', prompt, aspect_ratio }
        : { prompt, aspect_ratio, safety_tolerance: 2 };

      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'User-Agent': 'higgsfield-server-js/2.0' },
          body: JSON.stringify(body),
        });
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

        console.log(`[HF] ${auth.slice(0,6)} ${ep} → ${r.status}: ${text.slice(0,150)}`);
        logs.push({ ep, auth: auth.slice(0,6), status: r.status, body: text.slice(0,150) });

        if (r.status >= 200 && r.status < 300) {
          const resultUrl = data.images?.[0]?.url || data.image?.url || data.url
            || data.results?.[0]?.rawUrl || data.output?.[0] || data.video?.url || null;
          return res.status(200).json({ url: resultUrl, raw: data, _ep: ep });
        }
        if (r.status === 401 || r.status === 403) continue; // 이 auth 형식 틀림 → 다음 시도
        if (data.request_id || data.id) {
          return res.status(200).json({ requestId: data.request_id || data.id, _ep: ep });
        }
      } catch (e) {
        logs.push({ ep, auth: auth.slice(0,6), error: e.message });
      }
    }
  }

  return res.status(502).json({ error: '모든 시도 실패', logs });
};
