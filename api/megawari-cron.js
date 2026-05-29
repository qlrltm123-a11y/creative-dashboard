// GET /api/megawari-cron  (Vercel Cron Job)
// 매일 정해진 시간에 자동으로 메가와리 리포트를 카카오 나에게 보내기로 전송
//
// 필요 환경변수 (Vercel → Settings → Environment Variables):
//   KAKAO_REFRESH_TOKEN  — /api/kakao-callback 로그인 후 발급
//   KAKAO_APP_KEY        — Kakao 개발자 콘솔 REST API 키
//   SHEET_CSV_URL        — 구글 시트 CSV Export URL (광고 데이터)
//   BRAND_FILTER         — (선택) 특정 브랜드만 필터링, 없으면 전체

module.exports = async function handler(req, res) {
  // Vercel Cron은 GET으로 호출됨 / 수동 테스트도 GET
  // 인증: CRON_SECRET 환경변수가 있으면 header 검증
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const refreshToken = process.env.KAKAO_REFRESH_TOKEN || '';
  const appKey       = process.env.KAKAO_APP_KEY       || '';
  const sheetCsvUrl  = process.env.SHEET_CSV_URL        || '';
  const brandFilter  = process.env.BRAND_FILTER         || '';

  if (!refreshToken || !appKey) {
    return res.status(500).json({ error: 'KAKAO_REFRESH_TOKEN / KAKAO_APP_KEY 환경변수 없음' });
  }
  if (!sheetCsvUrl) {
    return res.status(500).json({ error: 'SHEET_CSV_URL 환경변수 없음' });
  }

  // ── 1. 구글 시트 CSV 로드 ──────────────────────────────────
  let rows;
  try {
    const csvRes = await fetch(sheetCsvUrl);
    if (!csvRes.ok) throw new Error(`CSV fetch failed: ${csvRes.status}`);
    const csvText = await csvRes.text();
    rows = parseCsv(csvText);
  } catch (e) {
    return res.status(502).json({ error: `CSV 로드 실패: ${e.message}` });
  }

  // ── 2. Megawari 필터 + 집계 ───────────────────────────────
  let data = rows.filter(r => {
    const ev = (r.event || '').toLowerCase().replace(/\s/g, '');
    return ev.includes('megawari') || ev.includes('mega');
  });
  if (brandFilter) data = data.filter(r => r.brand === brandFilter);

  if (!data.length) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'Megawari 데이터 없음' });
  }

  const byDate = aggregateMw(data);
  const todayIso = new Date().toISOString().split('T')[0];

  // 오늘 날짜가 없으면 가장 최근 날짜 사용
  const sortedDates = Object.keys(byDate).sort();
  const targetDate = byDate[todayIso] ? todayIso : sortedDates[sortedDates.length - 1];
  if (!byDate[targetDate]) {
    return res.status(200).json({ ok: true, skipped: true, reason: '전송할 데이터 없음' });
  }

  const reportText = buildReportText(targetDate, byDate, brandFilter || '전체');

  // ── 3. 카카오 나에게 보내기 ────────────────────────────────
  // 먼저 Access Token 갱신
  let accessToken;
  try {
    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     appKey,
        refresh_token: refreshToken,
      }).toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(401).json({ error: 'Access Token 갱신 실패', detail: tokenData });
    }
    accessToken = tokenData.access_token;
  } catch (e) {
    return res.status(502).json({ error: `Token 갱신 실패: ${e.message}` });
  }

  // 메시지 전송
  try {
    const template = {
      object_type: 'text',
      text: reportText.length > 9000 ? reportText.slice(0, 8990) + '…' : reportText,
      link: { web_url: 'https://developers.kakao.com', mobile_web_url: 'https://developers.kakao.com' },
      button_title: '대시보드 열기',
    };
    const sendRes = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams({ template_object: JSON.stringify(template) }).toString(),
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok) return res.status(sendRes.status).json({ error: '카카오 전송 실패', detail: sendData });
    return res.status(200).json({ ok: true, date: targetDate, sent: true });
  } catch (e) {
    return res.status(502).json({ error: `메시지 전송 실패: ${e.message}` });
  }
};

// ── CSV 파서 (헤더 첫 줄 기준) ────────────────────────────────
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g,'_'));
  return lines.slice(1).map(line => {
    const cols = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || '').trim(); });
    // 숫자 필드 변환
    ['spend','revenue','impressions','clicks','roas','ctr'].forEach(f => {
      if (obj[f] !== undefined) obj[f] = parseFloat(obj[f].replace(/,/g,'')) || 0;
    });
    return obj;
  });
}
function splitCsvLine(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQ = !inQ; continue; }
    if (line[i] === ',' && !inQ) { cols.push(cur); cur = ''; continue; }
    cur += line[i];
  }
  cols.push(cur);
  return cols;
}

// ── 집계 ─────────────────────────────────────────────────────
function aggregateMw(data) {
  const byDate = {};
  data.forEach(c => {
    const raw = c.start_date || c.date || '';
    const iso = raw ? new Date(raw).toISOString().split('T')[0] : '0000-00-00';
    if (!byDate[iso]) byDate[iso] = { iso, spend:0, revenue:0, impressions:0, clicks:0, byProduct:{}, byPlatform:{}, creatives:[] };
    const d = byDate[iso];
    d.spend+=c.spend||0; d.revenue+=c.revenue||0; d.impressions+=c.impressions||0; d.clicks+=c.clicks||0;
    d.creatives.push(c);
    const prod = (c.product||'기타').trim();
    const plat = (c.platform||'기타').trim();
    if (!d.byProduct[prod]) d.byProduct[prod]={spend:0,revenue:0,impressions:0,clicks:0,creatives:[]};
    const dp = d.byProduct[prod];
    dp.spend+=c.spend||0; dp.revenue+=c.revenue||0; dp.impressions+=c.impressions||0; dp.clicks+=c.clicks||0;
    dp.creatives.push(c);
    if (!d.byPlatform[plat]) d.byPlatform[plat]={spend:0,revenue:0,impressions:0,clicks:0};
    d.byPlatform[plat].spend+=c.spend||0; d.byPlatform[plat].revenue+=c.revenue||0;
    d.byPlatform[plat].impressions+=c.impressions||0; d.byPlatform[plat].clicks+=c.clicks||0;
  });
  const calc = o => { o.roas = o.spend>0 ? o.revenue/o.spend : 0; o.ctr = o.impressions>0 ? o.clicks/o.impressions : 0; };
  Object.values(byDate).forEach(d => {
    calc(d);
    Object.values(d.byProduct).forEach(calc);
    Object.values(d.byPlatform).forEach(calc);
  });
  return byDate;
}

// ── 리포트 텍스트 ─────────────────────────────────────────────
const MW_PERIODS = [
  { key:'teaser', label:'티저',   start:'2026-05-25', end:'2026-05-28', badge:'🎬' },
  { key:'main',   label:'본기간', start:'2026-05-29', end:'2026-06-10', badge:'🔥' },
];
function getMwDayLabel(iso) {
  const p = MW_PERIODS.find(x => iso >= x.start && iso <= x.end);
  if (!p) return { label: iso.slice(5).replace('-','/'), badge:'', period:null };
  const d = Math.round((new Date(iso)-new Date(p.start))/86400000)+1;
  return { label:`D+${d}`, badge:p.badge, period:p };
}
function fmtRoas(v)      { return v>0 ? `${Math.round(v*100)}%` : '-'; }
function fmtCtr(v)       { return v>0 ? `${(v*100).toFixed(2)}%` : '-'; }
function fmtMoney(v,u)   { if(!v||v===0)return'-'; if(Math.abs(v)>=1e6)return`${(v/1e6).toFixed(1)}M${u||''}`; if(Math.abs(v)>=1e4)return`${Math.round(v/1e3)}K${u||''}`; return`${Math.round(v).toLocaleString()}${u||''}`; }

function buildReportText(dateIso, byDate, brand) {
  const today = byDate[dateIso];
  if (!today) return '데이터 없음';
  const sortedDates = Object.keys(byDate).sort();
  const prevIso = sortedDates[sortedDates.indexOf(dateIso)-1];
  const prev = prevIso ? byDate[prevIso] : null;
  const di = getMwDayLabel(dateIso);
  const pLabel = di.period ? `${di.badge}${di.period.label}` : 'Megawari';

  let txt = `📊 [${brand||'전체'}] メガワリ ${pLabel} ${di.label}\n`;
  txt += `📅 ${dateIso.replace(/-/g,'.')}\n${'─'.repeat(22)}\n`;
  txt += `🏆 전체\n`;
  txt += `• ROAS: ${fmtRoas(today.roas)}${prev?` (전일比 ${today.roas>prev.roas?'+':''}${Math.round((today.roas-prev.roas)/(prev.roas||1)*100)}%)`:''}  \n`;
  txt += `• CTR:  ${fmtCtr(today.ctr)}\n`;
  txt += `• 매출: ${fmtMoney(today.revenue,'원')} / 지출: ${fmtMoney(today.spend,'원')}\n\n`;

  const prods = Object.entries(today.byProduct).sort((a,b)=>b[1].roas-a[1].roas);
  if (prods.length) {
    txt += `📦 제품별\n`;
    prods.forEach(([name,p]) => { txt += `[${name}] ROAS ${fmtRoas(p.roas)} / CTR ${fmtCtr(p.ctr)} / 매출 ${fmtMoney(p.revenue,'원')}\n`; });
    txt += '\n';
  }
  const all = today.creatives.filter(c=>(c.roas||0)>0).sort((a,b)=>(b.roas||0)-(a.roas||0));
  if (all.length) {
    txt += `🎯 고효율 TOP3\n`;
    all.slice(0,3).forEach((c,i)=>{ txt+=`${i+1}. ${c.ad_name||c.creative_name||'-'} (${fmtRoas(c.roas||0)})\n`; });
    txt += '\n';
  }
  txt += `📲 Creative Dashboard`;
  return txt;
}
