// GET /api/kakao-callback?code=...
// 카카오 OAuth 콜백 — authorization code → tokens
// 완료 후 팝업 닫으며 부모창 window._kakaoLoginCallback(refresh_token) 호출

module.exports = async function handler(req, res) {
  const { code, error: oauthErr, error_description } = req.query || {};

  if (oauthErr) {
    return res.status(200).send(htmlPage('❌ 로그인 취소', `오류: ${oauthErr}<br>${error_description||''}`, null));
  }
  if (!code) {
    return res.status(400).send(htmlPage('❌ code 없음', 'Authorization code가 없어요.', null));
  }

  // Vercel 배포 URL 기반으로 redirect_uri 재구성
  const host     = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto    = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${proto}://${host}/api/kakao-callback`;

  // app_key: env 우선, 없으면 OAuth state 파라미터에서 꺼냄
  let stateData = {};
  try { stateData = JSON.parse(decodeURIComponent(req.query.state || '{}')); } catch {}
  const appKey = process.env.KAKAO_APP_KEY || stateData.appKey || '';
  if (!appKey) {
    return res.status(500).send(htmlPage('❌ 설정 오류', 'KAKAO_APP_KEY 환경변수가 없어요.<br>Vercel → Settings → Environment Variables에서 추가하세요.', null));
  }

  try {
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        client_id:    appKey,
        redirect_uri: redirectUri,
        code,
      }).toString(),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.refresh_token) {
      return res.status(500).send(htmlPage('❌ 토큰 발급 실패', JSON.stringify(data), null));
    }
    return res.status(200).send(htmlPage('✅ 로그인 완료', '이 창을 닫아주세요.', data.refresh_token));
  } catch (e) {
    return res.status(502).send(htmlPage('❌ 네트워크 오류', e.message, null));
  }
};

function htmlPage(title, msg, refreshToken) {
  const script = refreshToken
    ? `<script>
        try {
          if (window.opener && window.opener._kakaoLoginCallback) {
            window.opener._kakaoLoginCallback(${JSON.stringify(refreshToken)});
          } else if (window.opener) {
            window.opener.postMessage({ type:'KAKAO_TOKEN', refreshToken: ${JSON.stringify(refreshToken)} }, '*');
          }
        } catch(e) {}
        setTimeout(() => window.close(), 1500);
      </script>`
    : '';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc}
  .box{text-align:center;padding:32px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:360px}
  h2{margin:0 0 12px;font-size:22px}p{color:#64748b;font-size:14px;margin:0}</style>
  </head><body>
  <div class="box"><h2>${title}</h2><p>${msg}</p></div>
  ${script}
  </body></html>`;
}
