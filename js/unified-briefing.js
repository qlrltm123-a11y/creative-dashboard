// ============================================================
//  통합 데일리 브리핑 (Unified Daily Briefing)
//  GMV 페이스 × 소재 효율 × 퍼널 전환 → 모닝 스탠드업 단일 뷰
//  - 동일 origin: GMV(localStorage+공유타겟) / 소재(allCreatives) /
//    퍼널(iframe contentWindow.brandData best-effort)
// ============================================================

const _UB_BRANDS = ['BOH', 'WM', 'CG'];
const _UB_COLOR  = { BOH: '#7c3aed', WM: '#059669', CG: '#d97706' };

let _ubDate = null; // 선택된 브리핑 날짜 (ISO)

/* ── 엔화→원화 환율 (GMV 원본은 JPY) ── */
function _ubFx() {
    try { const v = parseFloat(localStorage.getItem('jpy_to_krw_rate')); if (!isNaN(v) && v > 0) return v; } catch(e) {}
    return 9.5;
}
/* GMV 목표/실적 조회 (원화 환산) */
function _ubTgt(brand, date) { return ((window.GMV_TARGETS?.[brand]?.[date]) || 0) * _ubFx(); }
function _ubAct(actualsByDate, date, brand) { return ((actualsByDate?.[date]?.[brand]) || 0) * _ubFx(); }

/* ── 포맷 ── */
function _ubKRW(v) {
    if (!v) return '₩0';
    const a = Math.abs(v);
    if (a >= 100000000) return '₩' + (v/100000000).toFixed(2) + '억';
    if (a >= 10000000)  return '₩' + (v/10000000).toFixed(1) + '천만';
    if (a >= 10000)     return '₩' + Math.round(v/10000) + '만';
    return '₩' + Math.round(v).toLocaleString();
}
function _ubPct(r) { return (r*100).toFixed(0) + '%'; }
function _ubRoas(r){ return r > 0 ? Math.round(r*100) + '%' : '-'; }
function _ubCtr(r) { return r > 0 ? (r*100).toFixed(2) + '%' : '-'; }

/* ── 날짜 헬퍼 ── */
function _ubTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _ubTargetDates() {
    const t = window.GMV_TARGETS || {};
    const all = new Set();
    Object.values(t).forEach(o => Object.keys(o).forEach(d => all.add(d)));
    return [...all].sort();
}
function _ubResolveDate() {
    if (_ubDate) return _ubDate;
    const dates = _ubTargetDates();
    if (!dates.length) return _ubTodayStr();
    const today = _ubTodayStr();
    if (dates.includes(today)) return today;
    // 오늘 이전 중 가장 최근, 없으면 마지막
    const past = dates.filter(d => d <= today);
    return past.length ? past[past.length-1] : dates[dates.length-1];
}

/* ── GMV 실적 (localStorage smDash2, 동일 origin) ── */
function _ubGmvActuals() {
    try {
        const d = JSON.parse(localStorage.getItem('smDash2') || '{}');
        return d.actualsByDate || {};
    } catch(e) { return {}; }
}

/* ── 이벤트 마감 페이스 전망 (브랜드별, 이벤트 전체 기간) ── */
function _ubPaceToFinish(brand, actualsByDate) {
    const tgt = window.GMV_TARGETS?.[brand];
    if (!tgt) return null;
    const dates = Object.keys(tgt).sort();
    if (!dates.length) return null;

    const today = _ubTodayStr();
    const first = dates[0], last = dates[dates.length - 1];
    // 오늘을 이벤트 창 안으로 클램프
    const cutoff = today < first ? first : (today > last ? last : today);
    const eventOver = today > last;

    const fx = _ubFx();
    const eventTarget = dates.reduce((s, d) => s + (tgt[d] || 0), 0) * fx;
    const elapsedDates = dates.filter(d => d <= cutoff);
    const daysElapsed = elapsedDates.length;
    const daysLeft = eventOver ? 0 : (dates.length - daysElapsed);

    // 누적 실적 = 경과일 실적 합 / 평균은 '입력된 날'로만 나눔(빈날 보정) — 원화 환산
    let cumulative = 0, enteredDays = 0;
    elapsedDates.forEach(d => {
        const v = (actualsByDate[d]?.[brand] || 0) * fx;
        cumulative += v;
        if (v > 0) enteredDays++;
    });
    const avgDaily = cumulative / Math.max(enteredDays, 1);
    const projectedEOD = cumulative + avgDaily * daysLeft;
    const gap = eventTarget - projectedEOD;
    const requiredRunRate = daysLeft > 0 ? Math.max(0, (eventTarget - cumulative)) / daysLeft : 0;

    // 상태: 전망/목표
    const projRate = eventTarget > 0 ? projectedEOD / eventTarget : 0;
    let status = 'on';
    if (eventOver)        status = cumulative >= eventTarget ? 'ahead' : 'behind';
    else if (projRate < 0.97) status = 'behind';
    else if (projRate >= 1.03) status = 'ahead';

    return {
        eventTarget, cumulative, projectedEOD, gap, requiredRunRate, avgDaily,
        daysElapsed, daysLeft, totalDays: dates.length, enteredDays,
        cumRate: eventTarget > 0 ? cumulative / eventTarget : 0,
        projRate, status, eventOver, hasActual: enteredDays > 0,
    };
}

/* ── 소재 성과 (allCreatives, 특정 날짜·브랜드) ── */
function _ubCreativeForDate(date, brand) {
    const list = (window.allCreatives || []).filter(c => {
        const d = (c.start_date || '').slice(0,10);
        if (d !== date) return false;
        if (brand && c.brand !== brand) return false;
        return true;
    });
    let spend=0, revenue=0, impr=0, clicks=0, conv=0;
    list.forEach(c => {
        spend += c.spend||0; revenue += c.revenue||0;
        impr += c.impressions||0; clicks += c.clicks||0; conv += c.conversions||0;
    });
    return {
        spend, revenue, impr, clicks, conv,
        roas: spend>0 ? revenue/spend : 0,
        ctr:  impr>0  ? clicks/impr   : 0,
        cvr:  clicks>0? conv/clicks   : 0,
        count: list.length,
    };
}

/* ── 퍼널 데이터: 시트 직접 fetch (3개 브랜드 전체) ─────────────
   iframe은 한 브랜드만 로드하므로, 브리핑은 시트를 직접 받아 캐시 */
const _UB_FUNNEL_URLS = {
    BOH: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSxHghkM9L-_feMHIjG2ki5I1bvVYONcCQ6HST0nprxSc32Z2oe_4MrMb8jMqJyPZBiAExfIp6xEoOs/pub?gid=0&single=true&output=csv',
    WM:  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSxHghkM9L-_feMHIjG2ki5I1bvVYONcCQ6HST0nprxSc32Z2oe_4MrMb8jMqJyPZBiAExfIp6xEoOs/pub?gid=1580512303&single=true&output=csv',
    CG:  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSxHghkM9L-_feMHIjG2ki5I1bvVYONcCQ6HST0nprxSc32Z2oe_4MrMb8jMqJyPZBiAExfIp6xEoOs/pub?gid=1712106452&single=true&output=csv',
};
const _UB_F262 = { date:1, product:2, inflow:3, cart:4, buy:5 };
let _ubFunnelCache = {};   // brand -> {inflow,cart,buy,cartRate,buyRate}
let _ubFunnelLoading = false;
let _ubFunnelDone = false;

function _ubParseCSV(text) {
    return text.split(/\r?\n/).filter(l => l.trim()).map(line => {
        const cols = []; let cur = '', q = false;
        for (let i=0;i<line.length;i++){ const ch=line[i];
            if (ch==='"'){q=!q;continue;}
            if (ch===','&&!q){cols.push(cur.trim());cur='';continue;}
            cur+=ch; }
        cols.push(cur.trim()); return cols;
    });
}
function _ubNum(v){ if(!v||v==='-')return 0; const n=parseFloat(String(v).replace(/,/g,'')); return isNaN(n)?0:n; }

// 262Q 누적 합산 → 브랜드 전환율
function _ubAggFunnel(rows) {
    let inflow=0, cart=0, buy=0;
    for (let i=1;i<rows.length;i++){
        const r = rows[i]; if(!r||r.length<=_UB_F262.buy) continue;
        const prod=(r[_UB_F262.product]||'').trim(), date=(r[_UB_F262.date]||'').trim();
        if(!prod||!date||prod==='제품'||date==='date') continue;
        inflow+=_ubNum(r[_UB_F262.inflow]); cart+=_ubNum(r[_UB_F262.cart]); buy+=_ubNum(r[_UB_F262.buy]);
    }
    if(inflow===0&&cart===0) return null;
    return { inflow, cart, buy,
        cartRate: inflow>0?cart/inflow*100:null,
        buyRate:  cart>0?buy/cart*100:null };
}

// 타임아웃 fetch
function _ubFetchTimeout(url, ms) {
    return new Promise((resolve, reject) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => { ctrl.abort(); reject(new Error('timeout')); }, ms);
        fetch(url, { cache:'no-store', signal: ctrl.signal })
            .then(r => { clearTimeout(t); r.ok ? r.text().then(resolve) : reject(new Error('http '+r.status)); })
            .catch(e => { clearTimeout(t); reject(e); });
    });
}
// 프록시 폴백 체인으로 1개 URL 텍스트 가져오기
async function _ubFetchCsv(url) {
    const tries = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
        url, // 직접 (CORS 허용 시)
    ];
    for (const u of tries) {
        try { const txt = await _ubFetchTimeout(u, 9000); if (txt && txt.length > 20) return txt; } catch(e) {}
    }
    return null;
}

async function _ubFetchFunnel() {
    if (_ubFunnelLoading || _ubFunnelDone) return;
    _ubFunnelLoading = true;
    const brands = Object.keys(_UB_FUNNEL_URLS);
    // 브랜드별 개별 처리 — 하나 도착할 때마다 재렌더 (전체 대기 안 함)
    await Promise.allSettled(brands.map(async b => {
        const text = await _ubFetchCsv(_UB_FUNNEL_URLS[b]);
        if (text) { try { _ubFunnelCache[b] = _ubAggFunnel(_ubParseCSV(text)); } catch(e) {} }
        renderUnifiedBriefing(); // 부분 도착 즉시 반영
    }));
    _ubFunnelLoading = false;
    _ubFunnelDone = true;
    renderUnifiedBriefing();
}

function _ubFunnelForBrand(brand) {
    return _ubFunnelCache[brand] || null;
}

/* ── 브랜드별 진단 메시지 (룰 기반) ── */
function _ubDiagnose(g, cr, fn) {
    // g: {target, actual, rate}  cr: creative  fn: funnel|null
    const msgs = [];
    if (g.target > 0) {
        if (g.rate >= 1)      msgs.push({ t:'🟢 목표 달성', cls:'ub-good' });
        else if (g.rate >= 0.8) msgs.push({ t:`🟡 목표 ${_ubPct(g.rate)} · 막판 푸시 필요`, cls:'ub-warn' });
        else                  msgs.push({ t:`🔴 목표 ${_ubPct(g.rate)} · 격차 ${_ubKRW(g.target-g.actual)}`, cls:'ub-bad' });
    }
    // 격차 원인 귀속: 소재 효율 vs 퍼널 전환
    if (g.target > 0 && g.rate < 0.9) {
        if (cr.count > 0 && cr.roas > 0 && cr.roas < 2) {
            msgs.push({ t:`소재 효율 저조 (ROAS ${_ubRoas(cr.roas)}) → 고효율 소재로 예산 이동`, cls:'ub-hint' });
        }
        if (fn && fn.buyRate != null && fn.buyRate < 30) {
            msgs.push({ t:`퍼널 구매전환 ${fn.buyRate.toFixed(1)}% → 장바구니→구매 이탈 점검`, cls:'ub-hint' });
        }
        if (cr.count > 0 && cr.ctr > 0 && cr.ctr < 0.01) {
            msgs.push({ t:`CTR ${_ubCtr(cr.ctr)} 낮음 → 유입 단계(소재 후킹) 약화`, cls:'ub-hint' });
        }
    }
    return msgs;
}

/* ── 이벤트 마감 페이스 스트립 HTML ── */
function _ubPaceStripHtml(brand, actualsByDate) {
    const p = _ubPaceToFinish(brand, actualsByDate);
    if (!p || p.eventTarget <= 0) return '';
    if (!p.hasActual) {
        return `<div class="ub-pace ub-pace-empty">📅 이벤트 페이스: GMV 실적 입력 시 마감 전망 표시</div>`;
    }
    const stCls = p.status === 'ahead' ? 'ub-pace-ahead' : p.status === 'behind' ? 'ub-pace-behind' : 'ub-pace-on';
    const stTxt = p.status === 'ahead' ? '초과 전망' : p.status === 'behind' ? '뒤처짐' : '정상 페이스';
    const cumW  = Math.min(100, p.cumRate * 100);
    const projW = Math.min(100, Math.max(p.projRate * 100 - p.cumRate * 100, 0));
    const tick  = Math.min(100, (p.daysElapsed / p.totalDays) * 100); // 오늘 기대 위치
    const runHint = p.daysLeft > 0
        ? `잔여 ${p.daysLeft}일 · 필요 일평균 <b>${_ubKRW(p.requiredRunRate)}</b>${p.requiredRunRate > p.avgDaily ? ' <span style="color:#dc2626">▲</span>' : ' <span style="color:#059669">▼</span>'}`
        : (p.eventOver ? '이벤트 종료' : '마지막 날');
    return `
    <div class="ub-pace">
        <div class="ub-pace-top">
            <span class="ub-pace-pill ${stCls}">${stTxt}</span>
            <span class="ub-pace-proj">전망 ${_ubKRW(p.projectedEOD)} / 목표 ${_ubKRW(p.eventTarget)} (${_ubPct(p.projRate)})</span>
        </div>
        <div class="ub-pace-bar">
            <div class="ub-pace-fill" style="width:${cumW}%"></div>
            <div class="ub-pace-ghost" style="left:${cumW}%;width:${projW}%"></div>
            <div class="ub-pace-tick" style="left:${tick}%" title="오늘 기대 위치"></div>
        </div>
        <div class="ub-pace-foot">${runHint}</div>
    </div>`;
}

/* ── 브랜드 카드 HTML ── */
function _ubBrandCard(brand, date, actualsByDate) {
    const color  = _UB_COLOR[brand];
    const target = _ubTgt(brand, date);          // 원화 환산
    const actual = _ubAct(actualsByDate, date, brand);
    const rate   = target > 0 ? actual/target : 0;
    const gap    = target - actual;
    const cr = _ubCreativeForDate(date, brand);
    const fn = _ubFunnelForBrand(brand);
    const diag = _ubDiagnose({target, actual, rate}, cr, fn);

    const rateColor = rate >= 1 ? '#059669' : rate >= 0.8 ? '#d97706' : '#dc2626';
    const barW = Math.min(100, rate*100);

    return `
    <div class="ub-card" style="border-top:3px solid ${color}">
        <div class="ub-card-hd">
            <span class="ub-brand" style="color:${color}">${brand}</span>
            <span class="ub-rate" style="color:${rateColor}">${target>0?_ubPct(rate):'-'}</span>
        </div>
        <div class="ub-bar"><div class="ub-bar-fill" style="width:${barW}%;background:${rateColor}"></div></div>

        ${_ubPaceStripHtml(brand, actualsByDate)}

        <div class="ub-gmv-row">
            <div><span class="ub-lbl">목표</span><span class="ub-val">${_ubKRW(target)}</span></div>
            <div><span class="ub-lbl">실적</span><span class="ub-val">${_ubKRW(actual)}</span></div>
            <div><span class="ub-lbl">${gap>0?'잔여':'초과'}</span><span class="ub-val" style="color:${gap>0?'#dc2626':'#059669'}">${_ubKRW(Math.abs(gap))}</span></div>
        </div>

        <div class="ub-sub-hd">📣 오늘 광고 성과 ${cr.count>0?`<span class="ub-cnt">${cr.count}개</span>`:''}</div>
        ${cr.count>0 ? `<div class="ub-metrics">
            <div class="ub-m"><span>ROAS</span><b style="color:${cr.roas>=2?'#059669':cr.roas>=1?'#6366f1':'#dc2626'}">${_ubRoas(cr.roas)}</b></div>
            <div class="ub-m"><span>광고비</span><b>${_ubKRW(cr.spend)}</b></div>
            <div class="ub-m"><span>CTR</span><b>${_ubCtr(cr.ctr)}</b></div>
            <div class="ub-m"><span>전환</span><b>${cr.conv>0?Math.round(cr.conv).toLocaleString():'-'}</b></div>
        </div>` : `<div class="ub-empty-s">해당일 광고 데이터 없음</div>`}

        <div class="ub-sub-hd">🛒 퍼널 전환 <span style="font-size:9px;color:#94a3b8;font-weight:400">262Q 누적</span></div>
        ${fn ? `<div class="ub-metrics">
            <div class="ub-m"><span>장바구니율</span><b style="color:#6366f1">${fn.cartRate!=null?fn.cartRate.toFixed(1)+'%':'-'}</b></div>
            <div class="ub-m"><span>구매율</span><b style="color:#7c3aed">${fn.buyRate!=null?fn.buyRate.toFixed(1)+'%':'-'}</b></div>
            <div class="ub-m"><span>유입</span><b>${fn.inflow?Math.round(fn.inflow).toLocaleString():'-'}</b></div>
            <div class="ub-m"><span>구매</span><b>${fn.buy?Math.round(fn.buy).toLocaleString():'-'}</b></div>
        </div>` : `<div class="ub-empty-s">${_ubFunnelLoading?'퍼널 데이터 로딩 중…':'퍼널 데이터 없음'}</div>`}

        <div class="ub-diag">
            ${diag.map(d => `<div class="ub-diag-line ${d.cls}">${d.t}</div>`).join('')}
        </div>
    </div>`;
}

/* ── 메인 렌더 ── */
function renderUnifiedBriefing() {
    const body = document.getElementById('unified-body');
    if (!body) return;

    const date = _ubResolveDate();
    const actualsByDate = _ubGmvActuals();
    const globalBrand = (typeof window.getCurrentBrand === 'function' ? window.getCurrentBrand() : 'ALL') || 'ALL';
    const brands = globalBrand === 'ALL' ? _UB_BRANDS : [globalBrand];

    // 전체 합산 헤드라인
    let totT=0, totA=0;
    brands.forEach(b => {
        totT += _ubTgt(b, date);          // 원화 환산
        totA += _ubAct(actualsByDate, date, b);
    });
    const totRate = totT>0 ? totA/totT : 0;
    const totColor = totRate>=1 ? '#059669' : totRate>=0.8 ? '#d97706' : '#dc2626';

    const dates = _ubTargetDates();
    const dateOpts = dates.map(d => `<option value="${d}"${d===date?' selected':''}>${d}</option>`).join('');

    const funnelStatus = _ubFunnelDone ? '' : (_ubFunnelLoading
        ? `<span class="ub-scope"><i class="fas fa-spinner fa-spin mr-1"></i>퍼널 로딩중</span>` : '');

    body.innerHTML = `
    <div class="ub-toolbar">
        <div class="ub-date-wrap">
            <span class="ub-toolbar-lbl">📅 브리핑 날짜</span>
            <select id="ub-date-sel" class="ub-date-sel" onchange="window._ubSetDate(this.value)">${dateOpts}</select>
        </div>
        ${funnelStatus}
        <span class="ub-scope">${globalBrand==='ALL'?'전체 브랜드':globalBrand}</span>
    </div>

    <div class="ub-headline" style="border-color:${totColor}33">
        <div class="ub-hl-left">
            <div class="ub-hl-lbl">${date} · ${globalBrand==='ALL'?'전체':globalBrand} 목표 달성률</div>
            <div class="ub-hl-rate" style="color:${totColor}">${totT>0?_ubPct(totRate):'-'}</div>
        </div>
        <div class="ub-hl-right">
            <div><span class="ub-lbl">목표</span><span class="ub-val">${_ubKRW(totT)}</span></div>
            <div><span class="ub-lbl">실적</span><span class="ub-val">${_ubKRW(totA)}</span></div>
            <div><span class="ub-lbl">${totT-totA>0?'잔여':'초과'}</span><span class="ub-val" style="color:${totT-totA>0?'#dc2626':'#059669'}">${_ubKRW(Math.abs(totT-totA))}</span></div>
        </div>
    </div>

    <div class="ub-grid">
        ${brands.map(b => _ubBrandCard(b, date, actualsByDate)).join('')}
    </div>

    <div class="ub-note">
        💡 GMV 실적은 GMV 탭 입력값 기준 · 광고 성과는 시트 소재 데이터 · 퍼널은 자동 동기화됩니다.
    </div>`;

    // 퍼널 데이터: 시트 직접 fetch (3개 브랜드) → 도착 시 자동 재렌더
    if (!_ubFunnelDone) _ubFetchFunnel();
}
window.renderUnifiedBriefing = renderUnifiedBriefing;

/* ── 날짜 변경 ── */
window._ubSetDate = function(d) { _ubDate = d; renderUnifiedBriefing(); };

/* ── 퍼널 수동 재동기화 ── */
window._ubSyncFunnel = function() { _ubFunnelDone = false; _ubFunnelCache = {}; _ubFetchFunnel(); };
