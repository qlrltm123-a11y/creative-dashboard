// POST /api/kakao-send
// body: { text, refresh_token?, app_key?, client_secret?, creatives? }
// creatives: [{ name, product, platform, metric, thumb_url }]

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    text,
    refresh_token:  bodyRefresh,
    app_key:        bodyAppKey,
    client_secret:  bodySecret,
    creatives:      bodyCreatives,
  } = req.body || {};

  if (!text) return res.status(400).json({ error: 'text 필요' });

  const refreshToken = bodyRefresh    || process.env.KAKAO_REFRESH_TOKEN  || '';
  const appKey       = bodyAppKey     || process.env.KAKAO_APP_KEY        || '';
  const clientSecret = bodySecret     || process.env.KAKAO_CLIENT_SECRET  || '';
  const creatives    = Array.isArray(bodyCreatives) ? bodyCreatives : [];

  if (!refreshToken || !appKey) {
    return res.status(401).json({ error: 'Kakao 인증 정보 없음' });
  }

  // ── 1. Access Token 갱신 ──────────────────────────────────
  let accessToken;
  try {
    const tokenParams = { grant_type: 'refresh_token', client_id: appKey, refresh_token: refreshToken };
    if (clientSecret) tokenParams.client_secret = clientSecret;

    const tokenRes  = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(tokenParams).toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(401).json({ error: 'Access Token 갱신 실패', detail: tokenData });
    }
    accessToken = tokenData.access_token;
  } catch (e) {
    return res.status(502).json({ error: `Token 갱신 오류: ${e.message}` });
  }

  // ── 헬퍼: 나에게 보내기 ────────────────────────────────────
  async function sendMemo(template) {
    const r = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams({ template_object: JSON.stringify(template) }).toString(),
    });
    return { status: r.status, data: await r.json() };
  }

  // ── 2. 텍스트 리포트 전송 ─────────────────────────────────
  const truncated = text.length > 9000 ? text.slice(0, 8990) + '…' : text;
  try {
    const { status, data } = await sendMemo({
      object_type:  'text',
      text:          truncated,
      link:          { web_url: 'https://developers.kakao.com', mobile_web_url: 'https://developers.kakao.com' },
      button_title: '대시보드 열기',
    });
    if (status >= 400) {
      return res.status(status).json({ error: '텍스트 리포트 전송 실패', detail: data });
    }
  } catch (e) {
    return res.status(502).json({ error: `텍스트 전송 오류: ${e.message}` });
  }

  // ── 3. 소재 이미지 리스트 전송 (선택) ─────────────────────
  // thumb_url이 있는 소재만 포함, 최대 3개
  const imgCreatives = creatives.filter(c => c.thumb_url).slice(0, 3);
  let imagesSent = 0;

  if (imgCreatives.length >= 2) {
    // 리스트 템플릿 (2~3개 아이템, 각각 이미지 포함)
    try {
      const contents = imgCreatives.map(c => ({
        title:       c.name.slice(0, 25),
        description: `${c.product ? c.product + '  ·  ' : ''}${c.metric}`,
        image_url:   c.thumb_url,
        link:        { web_url: 'https://developers.kakao.com', mobile_web_url: 'https://developers.kakao.com' },
      }));
      const { status, data } = await sendMemo({
        object_type:  'list',
        header_title: '🏆 고효율 소재',
        header_link:  { web_url: 'https://developers.kakao.com', mobile_web_url: 'https://developers.kakao.com' },
        contents,
        buttons: [{ title: '대시보드 열기', link: { web_url: 'https://developers.kakao.com', mobile_web_url: 'https://developers.kakao.com' } }],
      });
      if (status < 400) imagesSent = imgCreatives.length;
    } catch (_) { /* 이미지 전송 실패해도 텍스트는 이미 성공 */ }

  } else if (imgCreatives.length === 1) {
    // 피드 템플릿 (이미지 1개)
    const c = imgCreatives[0];
    try {
      const { status } = await sendMemo({
        object_type: 'feed',
        content: {
          title:       c.name.slice(0, 25),
          description: `${c.product ? c.product + '  ·  ' : ''}${c.metric}`,
          image_url:   c.thumb_url,
          link:        { web_url: 'https://developers.kakao.com', mobile_web_url: 'https://developers.kakao.com' },
        },
        buttons: [{ title: '대시보드 열기', link: { web_url: 'https://developers.kakao.com', mobile_web_url: 'https://developers.kakao.com' } }],
      });
      if (status < 400) imagesSent = 1;
    } catch (_) {}
  }

  return res.status(200).json({ ok: true, images_sent: imagesSent });
};
