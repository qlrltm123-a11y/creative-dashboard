// POST /api/kakao-send
// body: { text, refresh_token?, app_key? }
// 서버 env: KAKAO_REFRESH_TOKEN, KAKAO_APP_KEY (Vercel Cron 전용)
// 브라우저에서 호출 시 body 쪽 token/key 우선 사용

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
  } = req.body || {};

  if (!text) return res.status(400).json({ error: 'text 필요' });

  const refreshToken = bodyRefresh || process.env.KAKAO_REFRESH_TOKEN  || '';
  const appKey       = bodyAppKey  || process.env.KAKAO_APP_KEY        || '';
  const clientSecret = bodySecret  || process.env.KAKAO_CLIENT_SECRET  || '';

  if (!refreshToken || !appKey) {
    return res.status(401).json({
      error: 'Kakao 인증 정보 없음 — refresh_token 또는 KAKAO_REFRESH_TOKEN 환경변수 필요',
    });
  }

  // ── 1. Refresh Token → Access Token ────────────────────────
  let accessToken;
  try {
    const tokenParams = {
      grant_type:    'refresh_token',
      client_id:     appKey,
      refresh_token: refreshToken,
    };
    if (clientSecret) tokenParams.client_secret = clientSecret;

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
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
    return res.status(502).json({ error: `Token 갱신 네트워크 오류: ${e.message}` });
  }

  // ── 2. 나에게 보내기 ───────────────────────────────────────
  // text template 사용 (최대 200자 / 링크 포함 시 더 짧게)
  // text를 여러 행으로 나눠 template에 맞게 구성
  const truncated = text.length > 9000 ? text.slice(0, 8990) + '…' : text;

  const template = {
    object_type: 'text',
    text: truncated,
    link: {
      web_url: 'https://developers.kakao.com',
      mobile_web_url: 'https://developers.kakao.com',
    },
    button_title: '대시보드 열기',
  };

  try {
    const sendRes = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams({
        template_object: JSON.stringify(template),
      }).toString(),
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      return res.status(sendRes.status).json({ error: '카카오 전송 실패', detail: sendData });
    }
    return res.status(200).json({ ok: true, result: sendData });
  } catch (e) {
    return res.status(502).json({ error: `메시지 전송 네트워크 오류: ${e.message}` });
  }
};
