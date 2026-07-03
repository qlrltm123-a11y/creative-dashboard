// GET /api/admin-logs?key=YOUR_ADMIN_SECRET[&page=0][&q=검색어][&clear=1]
//
// 환경변수 (Vercel → Settings → Environment Variables):
//   ADMIN_SECRET   — 어드민 접근용 비밀 키 (본인만 아는 문자열)
//   KV_REST_API_URL   — Vercel KV 연동 시 자동 생성
//   KV_REST_API_TOKEN — Vercel KV 연동 시 자동 생성

const PAGE_SIZE = 100;
const LOG_KEY   = 'chat_logs';

async function kvFetch(path, opts = {}) {
  // 프리픽스는 연동 방식에 따라 KV_ / STORAGE_ / UPSTASH_ 로 달라질 수 있어 모두 지원
  const url   = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('KV 환경변수 미설정');
  const r = await fetch(`${url}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  return r.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // 인증
  const key = req.query.key || req.headers['x-admin-key'] || '';
  if (!key || key !== (process.env.ADMIN_SECRET || '')) {
    return res.status(401).json({ error: '인증 실패 — ?key=ADMIN_SECRET 파라미터가 필요합니다.' });
  }

  // 전체 삭제 (커맨드 배열 방식 — path 방식은 body가 추가 인자로 붙는 문제가 있음)
  if (req.query.clear === '1') {
    await kvFetch('', { method: 'POST', body: JSON.stringify(['DEL', LOG_KEY]) });
    return res.status(200).json({ ok: true, message: '로그가 삭제되었습니다.' });
  }

  // 전체 개수
  const lenData = await kvFetch(`/llen/${LOG_KEY}`);
  const total   = lenData.result || 0;

  // 페이지 단위 조회 (최신 순 — lpush라 index 0이 최신)
  const page  = Math.max(0, parseInt(req.query.page || '0'));
  const start = page * PAGE_SIZE;
  const stop  = start + PAGE_SIZE - 1;
  const rangeData = await kvFetch(`/lrange/${LOG_KEY}/${start}/${stop}`);
  let logs = (rangeData.result || []).map((s, i) => {
    try {
      let obj = JSON.parse(s);
      // 초기 버전이 ["{...}"] 형태로 이중 포장해 저장한 로그 복구
      if (Array.isArray(obj)) obj = JSON.parse(obj[0]);
      obj._idx = start + i + 1;
      return obj;
    } catch {
      return { _idx: start + i + 1, t: '', q: s, m: '', rl: 0 };
    }
  });

  // 검색어 필터 (서버사이드)
  const q = (req.query.q || '').toLowerCase().trim();
  if (q) logs = logs.filter(l => (l.q || '').toLowerCase().includes(q));

  return res.status(200).json({ total, page, pageSize: PAGE_SIZE, logs });
};
