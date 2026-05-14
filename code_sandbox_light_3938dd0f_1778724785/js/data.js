/* ============================
   data.js - 광고 소재 & 퍼포먼스 데이터
   ============================ */

/* ──────────────────────────────────────────
   🔗 Google Sheets 연동 설정
   Apps Script 배포 후 아래 URL을 교체하세요
   비워두면 로컬 샘플 데이터로 동작합니다
────────────────────────────────────────── */
const SHEET_API_URL = '';   // 예: 'https://script.google.com/macros/s/AKfy.../exec'

const CREATIVES = [
  {
    id: 'cr001', brand: 'BOH', title: 'BOH 봄 신메뉴 배너',
    type: 'image', format: '배너 1200x628',
    media_url: 'https://placehold.co/1200x628/FF6B35/FFFFFF?text=BOH+Spring+Menu',
    concept: '신메뉴 프로모션', copy: '봄의 맛을 담은 새로운 메뉴 출시!',
    landing_url: '#', start_date: '2025-03-01', end_date: '2025-03-31', status: 'ended'
  },
  {
    id: 'cr002', brand: 'BOH', title: 'BOH 브랜드 영상 15s',
    type: 'video', format: '피드 영상 1:1',
    media_url: 'https://placehold.co/600x600/FF6B35/FFFFFF?text=BOH+Brand+Video+▶',
    concept: '브랜드 인지도', copy: '당신의 일상에 BOH가 함께합니다',
    landing_url: '#', start_date: '2025-04-01', end_date: '2025-04-30', status: 'ended'
  },
  {
    id: 'cr003', brand: 'BOH', title: 'BOH 할인 프로모션',
    type: 'image', format: '스토리 9:16',
    media_url: 'https://placehold.co/600x1067/FF6B35/FFFFFF?text=BOH+Sale+30%25',
    concept: '프로모션/할인', copy: '지금 바로 30% 할인 혜택을 누리세요!',
    landing_url: '#', start_date: '2025-05-01', end_date: '2025-05-31', status: 'active'
  },
  {
    id: 'cr004', brand: 'BOH', title: 'BOH 리타겟팅 배너',
    type: 'image', format: '배너 300x250',
    media_url: 'https://placehold.co/300x250/FF6B35/FFFFFF?text=BOH+Back',
    concept: '리타겟팅', copy: '다시 돌아오세요, 특별한 혜택이 기다려요',
    landing_url: '#', start_date: '2025-05-01', end_date: '2025-05-31', status: 'active'
  },
  {
    id: 'cr005', brand: 'WM', title: 'WM 신규 가입 피드',
    type: 'image', format: '피드 1:1',
    media_url: 'https://placehold.co/600x600/4A90E2/FFFFFF?text=WM+Join+Now',
    concept: '신규 획득', copy: '지금 가입하면 첫 달 무료!',
    landing_url: '#', start_date: '2025-03-15', end_date: '2025-04-15', status: 'ended'
  },
  {
    id: 'cr006', brand: 'WM', title: 'WM 서비스 소개 영상',
    type: 'video', format: '인스트림 16:9',
    media_url: 'https://placehold.co/1280x720/4A90E2/FFFFFF?text=WM+Service+▶',
    concept: '서비스 인지도', copy: 'WM과 함께 더 스마트하게',
    landing_url: '#', start_date: '2025-04-01', end_date: '2025-05-31', status: 'active'
  },
  {
    id: 'cr007', brand: 'WM', title: 'WM 쿠폰 프로모션',
    type: 'image', format: '배너 728x90',
    media_url: 'https://placehold.co/728x90/4A90E2/FFFFFF?text=WM+Coupon+5만원',
    concept: '프로모션/쿠폰', copy: '5만원 즉시 할인 쿠폰 지금 받기',
    landing_url: '#', start_date: '2025-05-01', end_date: '2025-05-31', status: 'active'
  },
  {
    id: 'cr008', brand: 'WM', title: 'WM 카카오 메시지 배너',
    type: 'image', format: '카카오 비즈보드',
    media_url: 'https://placehold.co/1029x258/4A90E2/FFFFFF?text=WM+Kakao+Banner',
    concept: '신규 획득', copy: '지금 바로 확인하세요!',
    landing_url: '#', start_date: '2025-04-15', end_date: '2025-05-15', status: 'paused'
  },
  {
    id: 'cr009', brand: 'CG', title: 'CG 봄 컬렉션 피드',
    type: 'image', format: '피드 4:5',
    media_url: 'https://placehold.co/480x600/7B68EE/FFFFFF?text=CG+Spring+2025',
    concept: '신상품 출시', copy: '2025 봄 컬렉션, 지금 만나보세요',
    landing_url: '#', start_date: '2025-03-01', end_date: '2025-03-31', status: 'ended'
  },
  {
    id: 'cr010', brand: 'CG', title: 'CG 브랜드 릴스',
    type: 'video', format: '릴스 9:16',
    media_url: 'https://placehold.co/600x1067/7B68EE/FFFFFF?text=CG+Reels+▶',
    concept: '브랜드 인지도', copy: 'CG와 함께하는 특별한 순간',
    landing_url: '#', start_date: '2025-04-01', end_date: '2025-05-31', status: 'active'
  },
  {
    id: 'cr011', brand: 'CG', title: 'CG 멤버십 가입 유도',
    type: 'image', format: '배너 1200x628',
    media_url: 'https://placehold.co/1200x628/7B68EE/FFFFFF?text=CG+Membership',
    concept: '멤버십/구독', copy: 'CG 멤버십 가입하고 exclusive 혜택 받기',
    landing_url: '#', start_date: '2025-05-01', end_date: '2025-05-31', status: 'active'
  },
  {
    id: 'cr012', brand: 'CG', title: 'CG TikTok 숏폼',
    type: 'video', format: '틱톡 9:16',
    media_url: 'https://placehold.co/600x1067/7B68EE/FFFFFF?text=CG+TikTok+▶',
    concept: '바이럴/챌린지', copy: '#CG챌린지 지금 참여하세요!',
    landing_url: '#', start_date: '2025-04-15', end_date: '2025-05-31', status: 'active'
  }
];

const PERFORMANCE = [
  { id:'p001', creative_id:'cr001', brand:'BOH', channel:'Meta',    date:'2025-03-15', impressions:125000, clicks:3750,  spend:850000,  conversions:187, revenue:4250000, ctr:3.0,  cpc:226, cpa:4545, roas:500  },
  { id:'p002', creative_id:'cr001', brand:'BOH', channel:'Google',  date:'2025-03-15', impressions:98000,  clicks:2450,  spend:620000,  conversions:145, revenue:3200000, ctr:2.5,  cpc:253, cpa:4275, roas:516  },
  { id:'p003', creative_id:'cr002', brand:'BOH', channel:'Meta',    date:'2025-04-10', impressions:210000, clicks:5460,  spend:1200000, conversions:312, revenue:8100000, ctr:2.6,  cpc:219, cpa:3846, roas:675  },
  { id:'p004', creative_id:'cr002', brand:'BOH', channel:'YouTube', date:'2025-04-10', impressions:380000, clicks:3800,  spend:750000,  conversions:198, revenue:5200000, ctr:1.0,  cpc:197, cpa:3787, roas:693  },
  { id:'p005', creative_id:'cr003', brand:'BOH', channel:'Meta',    date:'2025-05-05', impressions:175000, clicks:6125,  spend:980000,  conversions:408, revenue:9800000, ctr:3.5,  cpc:160, cpa:2402, roas:1000 },
  { id:'p006', creative_id:'cr003', brand:'BOH', channel:'TikTok',  date:'2025-05-05', impressions:290000, clicks:8700,  spend:760000,  conversions:356, revenue:8200000, ctr:3.0,  cpc:87,  cpa:2134, roas:1078 },
  { id:'p007', creative_id:'cr004', brand:'BOH', channel:'Google',  date:'2025-05-07', impressions:65000,  clicks:1950,  spend:430000,  conversions:265, revenue:7200000, ctr:3.0,  cpc:220, cpa:1622, roas:1674 },
  { id:'p008', creative_id:'cr005', brand:'WM',  channel:'Meta',    date:'2025-03-20', impressions:145000, clicks:4785,  spend:920000,  conversions:382, revenue:6500000, ctr:3.3,  cpc:192, cpa:2408, roas:706  },
  { id:'p009', creative_id:'cr005', brand:'WM',  channel:'Naver',   date:'2025-03-20', impressions:88000,  clicks:2640,  spend:580000,  conversions:211, revenue:3800000, ctr:3.0,  cpc:219, cpa:2748, roas:655  },
  { id:'p010', creative_id:'cr006', brand:'WM',  channel:'YouTube', date:'2025-04-15', impressions:320000, clicks:3840,  spend:880000,  conversions:276, revenue:6200000, ctr:1.2,  cpc:229, cpa:3188, roas:704  },
  { id:'p011', creative_id:'cr006', brand:'WM',  channel:'Meta',    date:'2025-04-15', impressions:195000, clicks:5850,  spend:1050000, conversions:415, revenue:9800000, ctr:3.0,  cpc:179, cpa:2530, roas:933  },
  { id:'p012', creative_id:'cr007', brand:'WM',  channel:'Google',  date:'2025-05-03', impressions:72000,  clicks:2880,  spend:510000,  conversions:324, revenue:7100000, ctr:4.0,  cpc:177, cpa:1574, roas:1392 },
  { id:'p013', creative_id:'cr007', brand:'WM',  channel:'Naver',   date:'2025-05-03', impressions:55000,  clicks:1925,  spend:380000,  conversions:210, revenue:4600000, ctr:3.5,  cpc:197, cpa:1809, roas:1210 },
  { id:'p014', creative_id:'cr008', brand:'WM',  channel:'Kakao',   date:'2025-04-20', impressions:112000, clicks:2240,  spend:650000,  conversions:168, revenue:3200000, ctr:2.0,  cpc:290, cpa:3869, roas:492  },
  { id:'p015', creative_id:'cr009', brand:'CG',  channel:'Meta',    date:'2025-03-10', impressions:165000, clicks:4125,  spend:780000,  conversions:248, revenue:5600000, ctr:2.5,  cpc:189, cpa:3145, roas:717  },
  { id:'p016', creative_id:'cr009', brand:'CG',  channel:'Google',  date:'2025-03-10', impressions:92000,  clicks:2300,  spend:520000,  conversions:165, revenue:3800000, ctr:2.5,  cpc:226, cpa:3151, roas:730  },
  { id:'p017', creative_id:'cr010', brand:'CG',  channel:'Meta',    date:'2025-04-20', impressions:245000, clicks:7350,  spend:1100000, conversions:495, revenue:12500000,ctr:3.0,  cpc:149, cpa:2222, roas:1136 },
  { id:'p018', creative_id:'cr010', brand:'CG',  channel:'TikTok',  date:'2025-04-20', impressions:412000, clicks:12360, spend:890000,  conversions:618, revenue:15200000,ctr:3.0,  cpc:72,  cpa:1440, roas:1707 },
  { id:'p019', creative_id:'cr011', brand:'CG',  channel:'Meta',    date:'2025-05-08', impressions:188000, clicks:5640,  spend:950000,  conversions:380, revenue:9500000, ctr:3.0,  cpc:168, cpa:2500, roas:1000 },
  { id:'p020', creative_id:'cr011', brand:'CG',  channel:'Naver',   date:'2025-05-08', impressions:78000,  clicks:2340,  spend:460000,  conversions:195, revenue:4800000, ctr:3.0,  cpc:196, cpa:2359, roas:1043 },
  { id:'p021', creative_id:'cr012', brand:'CG',  channel:'TikTok',  date:'2025-05-02', impressions:520000, clicks:15600, spend:1050000, conversions:720, revenue:18500000,ctr:3.0,  cpc:67,  cpa:1458, roas:1761 },
  { id:'p022', creative_id:'cr012', brand:'CG',  channel:'Meta',    date:'2025-05-02', impressions:198000, clicks:5940,  spend:870000,  conversions:412, revenue:10200000,ctr:3.0,  cpc:146, cpa:2111, roas:1172 }
];

// 필터된 데이터 가져오기
function getFilteredPerformance(brand = 'ALL', channel = 'ALL', datePrefix = null) {
  return PERFORMANCE.filter(p => {
    const bOk = brand === 'ALL' || p.brand === brand;
    const cOk = channel === 'ALL' || p.channel === channel;
    const dOk = !datePrefix || p.date.startsWith(datePrefix);
    return bOk && cOk && dOk;
  });
}

function getFilteredCreatives(brand = 'ALL') {
  return brand === 'ALL' ? [...CREATIVES] : CREATIVES.filter(c => c.brand === brand);
}

// 소재별 집계 퍼포먼스
function getCreativePerf(creativeId, brand = 'ALL', channel = 'ALL', datePrefix = null) {
  const rows = getFilteredPerformance(brand, channel, datePrefix).filter(p => p.creative_id === creativeId);
  if (!rows.length) return null;
  return aggregatePerf(rows);
}

// 집계 함수
function aggregatePerf(rows) {
  const imp  = rows.reduce((s, r) => s + r.impressions, 0);
  const cl   = rows.reduce((s, r) => s + r.clicks, 0);
  const sp   = rows.reduce((s, r) => s + r.spend, 0);
  const cv   = rows.reduce((s, r) => s + r.conversions, 0);
  const rv   = rows.reduce((s, r) => s + r.revenue, 0);
  return {
    impressions: imp,
    clicks: cl,
    spend: sp,
    conversions: cv,
    revenue: rv,
    ctr: imp > 0 ? ((cl / imp) * 100) : 0,
    cpc: cl > 0 ? Math.round(sp / cl) : 0,
    cpa: cv > 0 ? Math.round(sp / cv) : 0,
    roas: sp > 0 ? Math.round((rv / sp) * 100) : 0
  };
}

// 채널별 색상
const CHANNEL_COLORS = {
  Meta:    '#1877F2',
  Google:  '#EA4335',
  Kakao:   '#d4a400',
  Naver:   '#03C75A',
  TikTok:  '#ee1d52',
  YouTube: '#FF0000'
};

const CHANNEL_ICONS = {
  Meta:    'fa-brands fa-meta',
  Google:  'fa-brands fa-google',
  Kakao:   'fa-regular fa-comment-dots',
  Naver:   'fa-solid fa-n',
  TikTok:  'fa-brands fa-tiktok',
  YouTube: 'fa-brands fa-youtube'
};

const BRAND_COLORS = { BOH: '#FF6B35', WM: '#4A90E2', CG: '#A78BFA' };

// 포맷 유틸
function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 10000)   return (n / 10000).toFixed(1) + '만';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
}
function fmtWon(n) {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '억';
  if (n >= 10000)     return (n / 10000).toFixed(0) + '만원';
  return n.toLocaleString() + '원';
}
function fmtPct(n) { return n.toFixed(2) + '%'; }
function roasClass(v) {
  if (v >= 1000) return 'roas-high';
  if (v >= 600)  return 'roas-mid';
  return 'roas-low';
}
function statusLabel(s) {
  const map = { active: '진행중', paused: '일시정지', ended: '종료' };
  return map[s] || s;
}
function brandBadge(b) {
  return `<span class="brand-badge ${b}">${b}</span>`;
}
function statusBadge(s) {
  return `<span class="status-badge ${s}">${statusLabel(s)}</span>`;
}
function channelBadge(ch) {
  const c = CHANNEL_COLORS[ch] || '#888';
  const icon = CHANNEL_ICONS[ch] || 'fa-solid fa-globe';
  return `<span class="channel-badge" style="background:${c}22;color:${c}">
    <i class="${icon}"></i>${ch}
  </span>`;
}

/* ============================
   Google Sheets 연동 함수
   ============================ */

/**
 * Apps Script에서 performance + creatives 동시 로드
 * SHEET_API_URL 이 비어있으면 로컬 샘플 데이터 사용
 */
async function loadFromSheets() {
  if (!SHEET_API_URL) return { ok: false, source: 'local' };

  try {
    showLoadingBanner('📡 Google Sheets에서 데이터를 불러오는 중...');

    const res  = await fetch(SHEET_API_URL + '?sheet=all', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API 오류');

    // ── performance 덮어쓰기 ──
    if (Array.isArray(json.performance) && json.performance.length) {
      const parsed = json.performance.map(normalizePerformanceRow);
      PERFORMANCE.length = 0;
      PERFORMANCE.push(...parsed);
    }

    // ── creatives 덮어쓰기 ──
    if (Array.isArray(json.creatives) && json.creatives.length) {
      const parsed = json.creatives.map(normalizeCreativeRow);
      CREATIVES.length = 0;
      CREATIVES.push(...parsed);
    }

    hideLoadingBanner();
    showSyncBadge(json.updated_at);
    return { ok: true, source: 'sheets', updated_at: json.updated_at };

  } catch (err) {
    hideLoadingBanner();
    showSyncError(err.message);
    console.warn('[AD Studio] Sheets 연동 실패 → 로컬 데이터 사용:', err.message);
    return { ok: false, source: 'local', error: err.message };
  }
}

/**
 * performance 행 정규화 (타입 변환)
 */
function normalizePerformanceRow(row) {
  return {
    id          : row.creative_id + '_' + row.channel + '_' + row.date,
    creative_id : String(row.creative_id  || ''),
    brand       : String(row.brand        || ''),
    channel     : String(row.channel      || ''),
    date        : String(row.date         || ''),
    campaign    : String(row.campaign     || ''),
    adset       : String(row.adset        || ''),
    impressions : Number(row.impressions  || 0),
    clicks      : Number(row.clicks       || 0),
    spend       : Number(row.spend        || 0),
    conversions : Number(row.conversions  || 0),
    revenue     : Number(row.revenue      || 0),
    ctr         : Number(row.ctr          || 0),
    cpc         : Number(row.cpc          || 0),
    cpa         : Number(row.cpa          || 0),
    roas        : Number(row.roas         || 0),
  };
}

/**
 * creatives 행 정규화
 */
function normalizeCreativeRow(row) {
  return {
    id          : String(row.id           || ''),
    brand       : String(row.brand        || ''),
    title       : String(row.title        || ''),
    type        : String(row.type         || 'image'),
    format      : String(row.format       || ''),
    concept     : String(row.concept      || ''),
    copy        : String(row.copy         || ''),
    media_url   : String(row.media_url    || ''),
    landing_url : String(row.landing_url  || '#'),
    start_date  : String(row.start_date   || ''),
    end_date    : String(row.end_date     || ''),
    status      : String(row.status       || 'active'),
    channels    : String(row.channels     || ''),
    note        : String(row.note         || ''),
  };
}

/* ── UI 헬퍼 ── */
function showLoadingBanner(msg) {
  let el = document.getElementById('syncBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'syncBanner';
    el.style.cssText = `
      position:fixed; top:0; left:0; right:0; z-index:9999;
      background:linear-gradient(90deg,#667eea,#764ba2);
      color:#fff; font-size:13px; font-weight:600;
      padding:9px 20px; text-align:center;
      display:flex; align-items:center; justify-content:center; gap:10px;
    `;
    document.body.appendChild(el);
  }
  el.innerHTML = `<i class="fa-solid fa-rotate fa-spin"></i> ${msg}`;
  el.style.display = 'flex';
}

function hideLoadingBanner() {
  const el = document.getElementById('syncBanner');
  if (el) el.style.display = 'none';
}

function showSyncBadge(updatedAt) {
  const el = document.querySelector('.last-updated span');
  if (!el) return;
  const time = updatedAt ? updatedAt.slice(0, 10) : '방금';
  el.innerHTML = `<i class="fa-solid fa-circle" style="color:#10b981;font-size:8px"></i> 시트 연동 · ${time}`;
}

function showSyncError(msg) {
  const el = document.getElementById('syncBanner');
  if (!el) return;
  el.style.background = 'linear-gradient(90deg,#ef4444,#dc2626)';
  el.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Sheets 연동 실패 (로컬 데이터 사용 중) — ${msg}`;
  el.style.display = 'flex';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}
