// ============================
// Megawari 일일 성과 리포트
// ============================

// ── 기간 정의 ─────────────────────────────────────────────────
const MW_PERIODS = [
    { key: 'teaser', label: '티저',   start: '2026-05-25', end: '2026-05-28', color: '#8b5cf6', badge: '🎬' },
    { key: 'main',   label: '본기간', start: '2026-05-29', end: '2026-06-10', color: '#f97316', badge: '🔥' },
];

function _getMwPeriod(isoDate) {
    return MW_PERIODS.find(p => isoDate >= p.start && isoDate <= p.end) || null;
}

function _getMwDayLabel(isoDate) {
    const period = _getMwPeriod(isoDate);
    if (!period) return { label: isoDate.slice(5).replace('-','/'), sub: '', badge: '', color: '#64748b', period: null };
    const diffDays = Math.round((new Date(isoDate) - new Date(period.start)) / 86400000) + 1;
    return { label: `D+${diffDays}`, sub: isoDate.slice(5).replace('-','/'), badge: period.badge, color: period.color, period };
}

// ── 유틸 ──────────────────────────────────────────────────────
function _fmtRoas(v)    { return v > 0 ? `${Math.round(v * 100)}%` : '-'; }
function _fmtCtr(v)     { return v > 0 ? `${(v * 100).toFixed(2)}%` : '-'; }
// 장바구니 담기: 건수 + 율
function _fmtAtc(count, rate) {
    if (!count || count === 0) return '담기 0건';
    const rateStr = rate > 0 ? ` (${(rate * 100).toFixed(1)}%)` : '';
    return `담기 ${Math.round(count)}건${rateStr}`;
}
function _fmtAtcRate(v) { return v > 0 ? `${(v * 100).toFixed(1)}%` : '-'; }
function _fmtMoney(v, unit) {
    if (!v || v === 0) return '-';
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M${unit||''}`;
    if (Math.abs(v) >= 10_000)    return `${Math.round(v / 1_000)}K${unit||''}`;
    return `${Math.round(v).toLocaleString()}${unit||''}`;
}
// KPI 바 전용: ₩ + 한국식 억/만 단위
function _fmtKRW(v) {
    if (!v || v === 0) return '-';
    const abs = Math.abs(v);
    if (abs >= 100_000_000) return `₩${(v / 100_000_000).toFixed(2)}억`;
    if (abs >= 10_000_000)  return `₩${(v / 10_000_000).toFixed(1)}천만`;
    if (abs >= 1_000_000)   return `₩${(v / 1_000_000).toFixed(1)}백만`;
    if (abs >= 10_000)      return `₩${Math.round(v / 10_000)}만`;
    return `₩${Math.round(v).toLocaleString()}`;
}
function _roasClass(roas) {
    if (roas >= 3)   return 'roas-high';
    if (roas >= 1.5) return 'roas-mid';
    if (roas >= 1)   return 'roas-low';
    return 'roas-bad';
}
// 장바구니 담기 색상: 건수 기준
function _atcClass(count) {
    if (count >= 10) return 'roas-high';
    if (count >= 3)  return 'roas-mid';
    if (count >= 1)  return 'roas-low';
    return 'roas-bad';
}
// 소재 정렬 점수: 담기 건수 우선, 율 보조
function _atcScore(c) {
    const cnt = c.add_to_cart || 0;
    const rate = (c.clicks||0) > 0 ? cnt / c.clicks : 0;
    return cnt * 1000 + rate; // 건수 우선 정렬
}
function _diffBadge(curr, prev) {
    if (!prev || !curr || prev === 0) return '';
    const p = ((curr - prev) / Math.abs(prev)) * 100;
    if (p > 3)  return `<span class="mw-diff up">▲${Math.abs(Math.round(p))}%</span>`;
    if (p < -3) return `<span class="mw-diff dn">▼${Math.abs(Math.round(p))}%</span>`;
    return `<span class="mw-diff flat">→</span>`;
}

// ── 메가와리 데이터 필터 (캐시) ──────────────────────────────
let _mwDataCache = null;   // { src, brand, data }
let _mwAggCache  = null;   // { src, result }
let _mwHtmlCache = {};     // { [dateKey]: htmlString }
let _mwShiftCache = {};    // { [prevIso+'_'+selIso]: shifts }
let _mwSortedDates = null; // 마지막 계산된 sortedDates

function _getMwData() {
    const raw = Array.isArray(window.allCreatives) ? window.allCreatives : [];
    const brand = (typeof currentBrand !== 'undefined' && currentBrand !== 'ALL') ? currentBrand : null;
    if (_mwDataCache && _mwDataCache.src === raw && _mwDataCache.brand === brand) return _mwDataCache.data;
    let data = raw.filter(c => {
        const ev = (c.event || '').toLowerCase().replace(/\s/g, '');
        return ev.includes('megawari') || ev.includes('メガワリ') || ev.includes('mega');
    });
    if (brand) data = data.filter(c => c.brand === brand);
    _mwDataCache = { src: raw, brand, data };
    return data;
}

// 캐시 무효화 (데이터 새로고침 시 호출)
function _invalidateMwCache() {
    _mwDataCache = null; _mwAggCache = null;
    _mwHtmlCache = {}; _mwShiftCache = {}; _mwSortedDates = null;
}
window._invalidateMwCache = _invalidateMwCache;

// ── 날짜별 집계 (캐시) ────────────────────────────────────────
function _aggregateMw(data) {
    if (_mwAggCache && _mwAggCache.src === data) return _mwAggCache.result;
    const result = _aggregateMwImpl(data);
    _mwAggCache = { src: data, result };
    return result;
}
function _aggregateMwImpl(data) {
    const byDate = {};
    data.forEach(c => {
        const raw = c.start_date || c.date || '';
        const iso = raw ? new Date(raw).toISOString().split('T')[0] : '0000-00-00';
        if (!byDate[iso]) byDate[iso] = { iso, spend:0, revenue:0, impressions:0, clicks:0, byProduct:{}, byPlatform:{}, creatives:[] };
        const d = byDate[iso];
        d.spend += c.spend||0; d.revenue += c.revenue||0;
        d.impressions += c.impressions||0; d.clicks += c.clicks||0;
        d.creatives.push(c);

        const prod = (c.product||'기타').trim();
        const plat = (c.platform||'기타').trim();

        if (!d.byProduct[prod]) d.byProduct[prod] = { spend:0,revenue:0,impressions:0,clicks:0,add_to_cart:0,creatives:[],byPlatform:{} };
        const dp = d.byProduct[prod];
        dp.spend+=c.spend||0; dp.revenue+=c.revenue||0; dp.impressions+=c.impressions||0; dp.clicks+=c.clicks||0;
        dp.add_to_cart+=c.add_to_cart||0;
        dp.creatives.push(c);
        if (!dp.byPlatform[plat]) dp.byPlatform[plat]={spend:0,revenue:0,impressions:0,clicks:0,add_to_cart:0};
        dp.byPlatform[plat].spend+=c.spend||0; dp.byPlatform[plat].revenue+=c.revenue||0;
        dp.byPlatform[plat].impressions+=c.impressions||0; dp.byPlatform[plat].clicks+=c.clicks||0;
        dp.byPlatform[plat].add_to_cart+=c.add_to_cart||0;

        if (!d.byPlatform[plat]) d.byPlatform[plat]={spend:0,revenue:0,impressions:0,clicks:0,add_to_cart:0};
        d.byPlatform[plat].spend+=c.spend||0; d.byPlatform[plat].revenue+=c.revenue||0;
        d.byPlatform[plat].impressions+=c.impressions||0; d.byPlatform[plat].clicks+=c.clicks||0;
        d.byPlatform[plat].add_to_cart+=c.add_to_cart||0;

        d.add_to_cart = (d.add_to_cart||0) + (c.add_to_cart||0);
    });

    const calc = o => {
        o.roas    = o.spend>0       ? o.revenue/o.spend           : 0;
        o.ctr     = o.impressions>0 ? o.clicks/o.impressions       : 0;
        o.atc_rate= o.clicks>0      ? (o.add_to_cart||0)/o.clicks  : 0;
    };
    Object.values(byDate).forEach(d => {
        calc(d);
        Object.values(d.byProduct).forEach(p => { calc(p); Object.values(p.byPlatform).forEach(calc); });
        Object.values(d.byPlatform).forEach(calc);
    });
    return byDate;
}

// ── AI 코멘트 ─────────────────────────────────────────────────
function _genAiComment(today, yesterday, dayInfo, isoDate) {
    const lines = [];
    const period = _getMwPeriod(isoDate);
    if (period?.key === 'teaser') {
        lines.push(`🎬 티저 기간 중. 본기간(5/29) 대비 소재·예산 준비 점검.`);
    } else if (period?.key === 'main') {
        const mainDay = Math.round((new Date(isoDate) - new Date('2026-05-29')) / 86400000) + 1;
        if (mainDay <= 2)  lines.push(`🚀 본기간 시작! 초반 모멘텀이 전체 성과를 결정합니다.`);
        if (mainDay >= 10) lines.push(`📅 본기간 후반 (${mainDay}/13일차). 소재 피로도 점검 필요.`);
    }
    if (yesterday) {
        const d = (today.roas - yesterday.roas) / (yesterday.roas||1) * 100;
        if (d >= 15)      lines.push(`✅ ROAS ${Math.round(d)}% 상승. 이벤트 모멘텀 강함.`);
        else if (d >= 3)  lines.push(`📈 ROAS 소폭 상승 (+${Math.round(d)}%).`);
        else if (d >= -5) lines.push(`➡️ ROAS 전일 대비 유사 수준.`);
        else if (d >= -15)lines.push(`⚠️ ROAS ${Math.abs(Math.round(d))}% 하락. 소재 피로도 확인.`);
        else              lines.push(`🔴 ROAS 급락 (${Math.round(d)}%). 즉시 점검 필요.`);
    }
    const prods = Object.entries(today.byProduct).sort((a,b)=>b[1].roas-a[1].roas);
    if (prods.length) {
        lines.push(`🏆 주력: ${prods[0][0]} (ROAS ${_fmtRoas(prods[0][1].roas)})`);
        const worst = prods[prods.length-1];
        if (prods.length > 1 && worst[1].roas < 1) lines.push(`⚠️ ${worst[0]} 저효율 (${_fmtRoas(worst[1].roas)}) — 예산 조정 검토.`);
    }
    const plats = Object.entries(today.byPlatform).sort((a,b)=>b[1].roas-a[1].roas);
    if (plats.length && plats[0][1].roas > 2) lines.push(`📱 ${plats[0][0]} 최고효율 (${_fmtRoas(plats[0][1].roas)}) — 집중 권장.`);
    return lines.join('\n');
}

// ── 리포트 텍스트 포맷 (카카오톡 최적화) ────────────────────
function buildReportText(dateIso, byDate) {
    const today = byDate[dateIso];
    if (!today) return '해당 날짜 데이터 없음';

    const sortedDates = Object.keys(byDate).sort();
    const prevIso    = sortedDates[sortedDates.indexOf(dateIso) - 1];
    const yesterday  = prevIso ? byDate[prevIso] : null;
    const dayInfo    = _getMwDayLabel(dateIso);
    const brand      = (typeof currentBrand !== 'undefined' && currentBrand !== 'ALL') ? currentBrand : '전체';
    const periodLabel = dayInfo.period ? `${dayInfo.badge} ${dayInfo.period.label}` : 'Megawari';
    const isTeaser   = dayInfo.period?.key === 'teaser';
    const hasAtc     = today.creatives.some(c => (c.add_to_cart||0) > 0);
    const useAtc     = isTeaser && hasAtc;

    const D   = '━━━━━━━━━━━━━━━━━━━━━━━';
    const d   = '─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─';
    const nl  = '\n';

    // ROAS 전일비
    const roasDiff = yesterday
        ? (() => {
            const p = Math.round((today.roas - yesterday.roas) / (yesterday.roas||1) * 100);
            return p > 0 ? ` ▲${p}%` : p < 0 ? ` ▼${Math.abs(p)}%` : ' →';
          })()
        : '';

    // 제품별 ROAS 아이콘
    const roasIcon = r => r >= 3 ? '🟢' : r >= 1.5 ? '🔵' : r >= 1 ? '🟡' : '🔴';

    let txt = '';
    txt += `${D}${nl}`;
    txt += `📊 メガワリ ${periodLabel} ${dayInfo.label}${nl}`;
    txt += `     ${brand}  ·  ${dateIso.replace(/-/g,'.')}${nl}`;
    txt += `${D}${nl}${nl}`;

    // ── KPI ──
    txt += `🎯 오늘의 전체 성과${nl}`;
    txt += `├ ROAS   ${_fmtRoas(today.roas)}${roasDiff}${nl}`;
    if (useAtc) {
        txt += `├ 담기   ${_fmtAtc(today.add_to_cart||0, today.atc_rate)}${nl}`;
    }
    txt += `├ CTR    ${_fmtCtr(today.ctr)}${nl}`;
    txt += `├ 매출   ${_fmtMoney(today.revenue,'원')}${nl}`;
    txt += `└ 지출   ${_fmtMoney(today.spend,'원')}${nl}${nl}`;

    // ── 제품별 ──
    const prods = Object.entries(today.byProduct).sort((a,b) => b[1].roas - a[1].roas);
    if (prods.length) {
        txt += `${d}${nl}`;
        txt += `📦 제품별 성과${nl}`;
        txt += `${d}${nl}`;
        prods.forEach(([name, p], i) => {
            const mainVal = useAtc
                ? `ATC ${(p.atc_rate*100).toFixed(1)}%`
                : `ROAS ${_fmtRoas(p.roas)}`;
            const icon = roasIcon(p.roas);
            const isLast = i === prods.length - 1;
            const connector = isLast ? '└' : '├';
            txt += `${connector} ${icon} ${name}  ${mainVal}${nl}`;
            // 매체별 한 줄 요약
            const platList = Object.entries(p.byPlatform)
                .sort((a,b) => b[1].roas - a[1].roas)
                .map(([pl,v]) => `${pl} ${useAtc ? (v.atc_rate*100).toFixed(1)+'%' : _fmtRoas(v.roas)}`)
                .join('  ·  ');
            if (platList) txt += `${isLast?'  ':'│'}    ${platList}${nl}`;
        });
        txt += nl;
    }

    // ── 소재 ──
    txt += `${d}${nl}`;
    if (useAtc) {
        // 티저: 장바구니 담기 건수 기준
        const atcSorted = today.creatives
            .filter(c => (c.add_to_cart||0) > 0)
            .sort((a,b) => _atcScore(b) - _atcScore(a));
        if (atcSorted.length) {
            txt += `🏆 고효율 소재 (장바구니 담기 기준)${nl}`;
            atcSorted.slice(0,3).forEach((c,i) => {
                const cnt  = c.add_to_cart||0;
                const rate = (c.clicks||0)>0 ? cnt/c.clicks : 0;
                const medals = ['🥇','🥈','🥉'];
                txt += `${medals[i]} ${(c.ad_name||c.creative_name||'-').slice(0,22)}${nl}`;
                txt += `     ${c.product||''}  ${_fmtAtc(cnt,rate)}${nl}`;
            });
            txt += nl;
        }
        const topNmsKakao = new Set(atcSorted.slice(0,3).map(c=>c.ad_name||c.creative_name||''));
        const noAtc = today.creatives
            .filter(c=>(c.add_to_cart||0)===0 && !topNmsKakao.has(c.ad_name||c.creative_name||''))
            .sort((a,b)=>(b.clicks||0)-(a.clicks||0));
        if (noAtc.length) {
            txt += `⚠️ 담기 0건 소재${nl}`;
            noAtc.slice(0,3).forEach(c => {
                txt += `· ${(c.ad_name||c.creative_name||'-').slice(0,22)}  (${c.product||''})${nl}`;
            });
            txt += nl;
        }
    } else {
        // 본기간: ROAS 기준
        const sorted = today.creatives.filter(c=>(c.roas||0)>0).sort((a,b)=>(b.roas||0)-(a.roas||0));
        if (sorted.length) {
            txt += `🏆 고효율 소재 TOP3${nl}`;
            sorted.slice(0,3).forEach((c,i) => {
                const medals = ['🥇','🥈','🥉'];
                txt += `${medals[i]} ${(c.ad_name||c.creative_name||'-').slice(0,22)}${nl}`;
                txt += `     ${c.product||''}  ROAS ${_fmtRoas(c.roas||0)}${nl}`;
            });
            txt += nl;
        }
        const worst = sorted.filter(c=>(c.roas||0)<1).slice(-3).reverse();
        if (worst.length) {
            txt += `⚠️ 저효율 소재${nl}`;
            worst.forEach(c => {
                txt += `· ${(c.ad_name||c.creative_name||'-').slice(0,22)}  ROAS ${_fmtRoas(c.roas||0)}${nl}`;
            });
            txt += nl;
        }
    }

    // ── AI 코멘트 ──
    const comment = _genAiComment(today, yesterday, dayInfo, dateIso);
    if (comment) {
        txt += `${d}${nl}`;
        txt += `💡 AI 코멘트${nl}`;
        txt += `${comment}${nl}${nl}`;
    }

    txt += `${D}${nl}`;
    txt += `📲 Creative Dashboard`;
    return txt;
}

// ── 이벤트 전체 누적 KPI 바 ───────────────────────────────────
function _buildEventTotalBar(byDate, sortedDates) {
    let spend = 0, revenue = 0, impr = 0, clicks = 0, atc = 0;
    sortedDates.forEach(iso => {
        const d = byDate[iso]; if (!d) return;
        spend   += d.spend       || 0;
        revenue += d.revenue     || 0;
        impr    += d.impressions || 0;
        clicks  += d.clicks      || 0;
        atc     += d.add_to_cart || 0;
    });
    const roas = spend > 0 ? revenue / spend : 0;
    const ctr  = impr  > 0 ? clicks  / impr  : 0;
    const days = sortedDates.length;

    return `<div class="mw-event-total">
        <span class="mw-event-total-lbl">📊 이벤트 누계 (${days}일)</span>
        <span class="mw-event-kpi"><span>ROAS</span><strong class="${_roasClass(roas)}" style="font-size:13px">${_fmtRoas(roas)}</strong></span>
        <span class="mw-event-kpi"><span>광고비</span><strong>${_fmtKRW(spend)}</strong></span>
        <span class="mw-event-kpi"><span>매출</span><strong>${_fmtKRW(revenue)}</strong></span>
        <span class="mw-event-kpi"><span>CTR</span><strong>${_fmtCtr(ctr)}</strong></span>
        <span class="mw-event-kpi"><span>클릭</span><strong>${clicks.toLocaleString()}</strong></span>
        ${atc > 0 ? `<span class="mw-event-kpi"><span>장바구니</span><strong>${atc}건</strong></span>` : ''}
    </div>`;
}

// ── 날짜 탭 HTML 생성 (분리) ──────────────────────────────────
function _buildDateTabs(sortedDates, sel, byDate) {
    let html = '';
    let lastKey = null;
    sortedDates.forEach(iso => {
        const info = _getMwDayLabel(iso);
        if (info.period?.key !== lastKey) {
            lastKey = info.period?.key || null;
            if (info.period) html += `<span class="mw-period-chip" style="color:${info.period.color};border-color:${info.period.color}20;background:${info.period.color}0d">${info.badge} ${info.period.label}</span>`;
        }
        const isActive  = iso === sel;
        const dayRoas   = byDate[iso]?.roas || 0;
        const roasCls   = _roasClass(dayRoas);
        // 전일 대비 ROAS 델타
        const prevIdx   = sortedDates.indexOf(iso) - 1;
        const prevRoas  = prevIdx >= 0 ? (byDate[sortedDates[prevIdx]]?.roas || 0) : null;
        let deltaHtml   = '';
        if (prevRoas !== null && prevRoas > 0 && dayRoas > 0) {
            const dp = Math.round((dayRoas - prevRoas) / prevRoas * 100);
            if (Math.abs(dp) >= 3) {
                deltaHtml = `<span class="mw-dtab-delta ${dp>0?'up':'dn'}">${dp>0?'▲':'▼'}${Math.abs(dp)}%</span>`;
            }
        }
        html += `<button class="mw-date-tab${isActive?' active':''}" onclick="_mwSelectDate('${iso}')"
            style="${isActive?`border-color:${info.color};box-shadow:0 0 0 3px ${info.color}22`:''}" >
            <span class="mw-dtab-d" style="color:${info.color}">${info.label}</span>
            <span class="mw-dtab-date">${info.sub}</span>
            <span class="mw-dtab-roas ${roasCls}">${dayRoas > 0 ? _fmtRoas(dayRoas) : '-'}</span>
            ${deltaHtml}
        </button>`;
    });
    return html;
}

// ── 본문 HTML 생성 (날짜별 캐시) ─────────────────────────────
function _buildMwBodyHtml(sel, byDate, sortedDates) {
    if (_mwHtmlCache[sel]) return _mwHtmlCache[sel];

    const today  = byDate[sel];
    const prevIso = sortedDates[sortedDates.indexOf(sel) - 1];
    const prev   = prevIso ? byDate[prevIso] : null;
    const dayInfo = _getMwDayLabel(sel);
    const isTeaser = dayInfo.period?.key === 'teaser';
    const hasAtc   = today.creatives.some(c => (c.add_to_cart||0) > 0);
    const useAtc   = isTeaser && hasAtc;

    // ── KPI 바 ───────────────────────────────────────────────
    const kpiHtml = `<div class="mw-kpi-day-lbl">📅 선택일 실적 — ${sel}</div>
    <div class="mw-kpi-bar">
        <div class="mw-kpi-item">
            <div class="mw-kpi-lbl">ROAS</div>
            <div class="mw-kpi-val ${_roasClass(today.roas)}">${_fmtRoas(today.roas)}</div>
            <div>${_diffBadge(today.roas, prev?.roas)}</div>
        </div>
        <div class="mw-kpi-item">
            <div class="mw-kpi-lbl">광고비</div>
            <div class="mw-kpi-val">${_fmtKRW(today.spend)}</div>
            <div>${_diffBadge(today.spend, prev?.spend)}</div>
        </div>
        <div class="mw-kpi-item">
            <div class="mw-kpi-lbl">매출</div>
            <div class="mw-kpi-val">${_fmtKRW(today.revenue)}</div>
            <div>${_diffBadge(today.revenue, prev?.revenue)}</div>
        </div>
        <div class="mw-kpi-item">
            <div class="mw-kpi-lbl">CTR</div>
            <div class="mw-kpi-val">${_fmtCtr(today.ctr)}</div>
            <div>${_diffBadge(today.ctr, prev?.ctr)}</div>
        </div>
        <div class="mw-kpi-item">
            <div class="mw-kpi-lbl">노출</div>
            <div class="mw-kpi-val">${today.impressions >= 10000 ? (today.impressions/10000).toFixed(1)+'만' : (today.impressions||0).toLocaleString()}</div>
            <div>${_diffBadge(today.impressions, prev?.impressions)}</div>
        </div>
        <div class="mw-kpi-item">
            <div class="mw-kpi-lbl">클릭</div>
            <div class="mw-kpi-val">${(today.clicks||0).toLocaleString()}</div>
            <div>${_diffBadge(today.clicks, prev?.clicks)}</div>
        </div>
        ${useAtc ? `<div class="mw-kpi-item">
            <div class="mw-kpi-lbl">장바구니</div>
            <div class="mw-kpi-val">${(today.add_to_cart||0)}건</div>
            <div class="mw-kpi-unit">${_fmtAtcRate(today.atc_rate)}</div>
        </div>` : ''}
    </div>`;

    // ── AI 코멘트 ───────────────────────────────────────────
    const aiComment = _genAiComment(today, prev, dayInfo, sel);

    // ── 제품 × 매체 테이블 ──────────────────────────────────
    const prods   = Object.entries(today.byProduct).sort((a,b) => b[1].roas - a[1].roas);
    const allPlats = [...new Set(prods.flatMap(([,p]) => Object.keys(p.byPlatform)))].sort();
    const tableHead = `<thead><tr>
        <th class="mw-th mw-th-prod">제품</th>
        <th class="mw-th">ROAS</th>
        ${isTeaser ? `<th class="mw-th" title="장바구니 담기">담기</th>` : ''}
        <th class="mw-th">CTR</th>
        <th class="mw-th">매출</th>
        ${allPlats.map(pl=>`<th class="mw-th mw-th-plat">${pl}</th>`).join('')}
    </tr></thead>`;
    const tableBody = prods.map(([name, p]) => {
        const platCells = allPlats.map(pl => {
            const v = p.byPlatform[pl];
            if (!v || v.roas === 0) return `<td class="mw-td mw-td-plat"><span class="text-slate-300">-</span></td>`;
            const mainMetric = isTeaser
                ? `<span class="mw-cell-roas ${_atcClass(v.add_to_cart||0)}">${_fmtAtc(v.add_to_cart||0, v.atc_rate)}</span>`
                : `<span class="mw-cell-roas ${_roasClass(v.roas)}">${_fmtRoas(v.roas)}</span>`;
            return `<td class="mw-td mw-td-plat">${mainMetric}<span class="mw-cell-ctr">${_fmtCtr(v.ctr)}</span></td>`;
        }).join('');
        const sortedP = p.creatives.filter(c => useAtc ? (c.add_to_cart||0)>0 : (c.roas||0)>0)
            .sort((a,b) => useAtc ? _atcScore(b)-_atcScore(a) : (b.roas||0)-(a.roas||0));
        const top = sortedP[0];
        const bot = !useAtc && sortedP.length > 1 && (sortedP[sortedP.length-1].roas||0) < 1 ? sortedP[sortedP.length-1] : null;
        return `<tr class="mw-tr">
            <td class="mw-td mw-td-prod">
                <div class="mw-prod-name">${name}</div>
                ${top ? `<div class="mw-prod-top">🏆 ${(top.ad_name||top.creative_name||'').slice(0,20)}</div>` : ''}
                ${bot ? `<div class="mw-prod-bot">⚠️ ${(bot.ad_name||bot.creative_name||'').slice(0,20)}</div>` : ''}
            </td>
            <td class="mw-td"><span class="mw-roas-badge ${_roasClass(p.roas)}">${_fmtRoas(p.roas)}</span>${_diffBadge(p.roas, prev?.byProduct?.[name]?.roas)}</td>
            ${isTeaser ? `<td class="mw-td mw-td-num"><span class="mw-roas-badge ${_atcClass(p.add_to_cart||0)}">${_fmtAtc(p.add_to_cart||0, p.atc_rate)}</span></td>` : ''}
            <td class="mw-td mw-td-num">${_fmtCtr(p.ctr)}</td>
            <td class="mw-td mw-td-num">${_fmtMoney(p.revenue)}</td>
            ${platCells}
        </tr>`;
    }).join('');

    // ── 소재 변동 감지 (캐시) ───────────────────────────────
    const shiftKey = `${prevIso||''}__${sel}`;
    if (!_mwShiftCache[shiftKey]) {
        _mwShiftCache[shiftKey] = _buildShiftAlert(_detectCreativeShifts(
            today.creatives || [], prev ? prev.creatives || [] : []));
    }
    const shiftHtml = _mwShiftCache[shiftKey];

    // ── 소재 리스트 ─────────────────────────────────────────
    const _isSinglePlat = c => /meta|tiktok|틱톡/i.test(c.platform||'');
    const sortedC = today.creatives
        .filter(c => _isSinglePlat(c) && (useAtc ? (c.add_to_cart||0) > 0 : (c.roas||0) > 0))
        .sort((a,b) => useAtc ? _atcScore(b)-_atcScore(a) : (b.roas||0)-(a.roas||0));
    const topCreativeIds = new Set(sortedC.slice(0,5).map(c => c.ad_name||c.creative_name||''));
    const topRows = sortedC.slice(0,5).map(c => {
        const cnt  = c.add_to_cart||0; const rate = (c.clicks||0)>0 ? cnt/c.clicks : 0;
        const metricHtml = useAtc
            ? `<span class="mw-cr-roas ${_atcClass(cnt)}">${_fmtAtc(cnt, rate)}</span>`
            : `<span class="mw-cr-roas ${_roasClass(c.roas||0)}">${_fmtRoas(c.roas||0)}</span>`;
        const thumbHtml = _mwThumbHtml(
            c.thumbnail_url || c.media_url || '', 'mw-cr-thumb');
        return `<div class="mw-creative-item top">${thumbHtml}
            <div class="mw-cr-info">
                <span class="mw-cr-prod-badge">${(c.product||'기타').slice(0,10)}</span>
                <span class="mw-cr-name">${(c.ad_name||c.creative_name||'-').slice(0,26)}</span>
            </div>${metricHtml}</div>`;
    }).join('');
    const worstC = useAtc
        ? today.creatives.filter(c => { const nm=c.ad_name||c.creative_name||''; return _isSinglePlat(c)&&(c.add_to_cart||0)===0&&!topCreativeIds.has(nm); })
            .sort((a,b)=>(b.clicks||0)-(a.clicks||0)).slice(0,5)
        : sortedC.filter(c=>(c.roas||0)<1).slice(-3).reverse();
    const botRows = worstC.map(c => {
        const cnt=c.add_to_cart||0; const rate=(c.clicks||0)>0?cnt/c.clicks:0;
        const metricHtml = useAtc
            ? `<span class="mw-cr-roas roas-bad">${_fmtAtc(cnt, rate)}</span>`
            : `<span class="mw-cr-roas roas-bad">${_fmtRoas(c.roas||0)}</span>`;
        return `<div class="mw-creative-item bot">
            ${_mwThumbHtml(c.thumbnail_url || c.media_url || '', 'mw-cr-thumb')}
            <div class="mw-cr-info">
                <span class="mw-cr-prod-badge" style="background:#fee2e2;color:#991b1b">${(c.product||'기타').slice(0,8)}</span>
                <span class="mw-cr-name">${(c.ad_name||c.creative_name||'-').slice(0,26)}</span>
            </div>${metricHtml}</div>`;
    }).join('');

    const html = `
    ${kpiHtml}
    <!-- ROW 1: AI 코멘트(좌) + D+N 차트(우) -->
    <div class="mw-row-ab">
        <div class="mw-ai-box mw-row-ab-a">
            <div class="mw-ai-hd"><i class="fas fa-robot"></i> AI 코멘트</div>
            <div class="mw-ai-body">${aiComment.replace(/\n/g,'<br>')}</div>
        </div>
        <div class="mw-row-ab-b">
            <div class="mw-section-hd">📈 D+N 누적 ROAS 추이</div>
            <div class="chart-card" style="padding:14px">
                <canvas id="mwRoasLineChart" style="height:180px;max-height:180px"></canvas>
            </div>
        </div>
    </div>
    <!-- ROW 2: 제품별 성과 테이블 -->
    <div class="mw-section-hd">📊 제품별 성과 (매체 교차)</div>
    <div class="mw-table-wrap mb-4">
        <table class="mw-table">${tableHead}<tbody>${tableBody}</tbody></table>
    </div>
    <!-- ROW 3: 제품 비교 카드 + 소재 변동 감지 -->
    <div class="mw-row-cd">
        <div class="mw-row-cd-a">
            <div class="mw-section-hd">📦 제품별 효율 비교</div>
            <div class="mw-pcc-grid">${_buildProductCompareCards(prods, isTeaser)}</div>
        </div>
        <div class="mw-row-cd-b">
            <div class="mw-section-hd">🚨 소재 변동 감지 <span style="font-size:10px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px;font-weight:600">전일 대비 ±30%</span></div>
            <div class="mw-shift-wrap">${shiftHtml}</div>
        </div>
    </div>
    <!-- ROW 4: 고효율/저효율 소재 -->
    <div class="mw-two-col">
        <div>
            <div class="mw-section-hd">🏆 고효율 소재 TOP5
                <span class="mw-metric-badge ${useAtc?'atc':'roas'}">${useAtc?'장바구니 담기 기준':'ROAS 기준'}</span>
                <span class="mw-metric-badge roas" style="background:#f1f5f9;color:#475569">Meta·TikTok</span>
            </div>
            <div class="mw-creative-list">${topRows||'<p class="mw-no-data">데이터 없음</p>'}</div>
        </div>
        <div>
            <div class="mw-section-hd">⚠️ 저효율 소재
                <span class="mw-metric-badge ${useAtc?'atc':'roas'}">${useAtc?'담기 0건':'ROAS 기준'}</span>
                <span class="mw-metric-badge roas" style="background:#f1f5f9;color:#475569">Meta·TikTok</span>
            </div>
            <div class="mw-creative-list">${botRows||'<p class="mw-no-data">없음 👍</p>'}</div>
        </div>
    </div>
    <!-- ROW 5: 소재 인사이트 (소구포인트 / 후킹유형 / 타입) -->
    ${_buildMwCreativeInsightHtml(today.creatives)}`;

    _mwHtmlCache[sel] = html;
    return html;
}

// ── 소재 인사이트 (소구포인트 / 후킹유형 / 소재타입) ──────────
function _buildMwCreativeInsightHtml(creatives) {
    if (!creatives || creatives.length < 2) return '';

    // ── 소구포인트 집계 (ROAS 가중 평균) ──
    const appealMap = {};
    creatives.forEach(c => {
        const roas  = c.roas  || 0;
        const spend = c.spend || 0;
        const aps = Array.isArray(c.appeal_points)
            ? c.appeal_points
            : (c.appeal_points
                ? String(c.appeal_points).split(/[,、，·・]/).map(s => s.trim()).filter(Boolean)
                : []);
        aps.forEach(ap => {
            if (!ap || ap.startsWith('❌')) return;
            if (!appealMap[ap]) appealMap[ap] = { count: 0, roasSum: 0, spendSum: 0 };
            appealMap[ap].count++;
            appealMap[ap].roasSum  += roas;
            appealMap[ap].spendSum += spend;
        });
    });
    const appeals = Object.entries(appealMap)
        .map(([tag, d]) => ({ tag, count: d.count, avgRoas: d.count > 0 ? d.roasSum / d.count : 0 }))
        .sort((a, b) => b.avgRoas - a.avgRoas || b.count - a.count);

    // ── 후킹유형 집계 ──
    const hookMap = {};
    creatives.forEach(c => {
        const roas  = c.roas  || 0;
        const hooks = Array.isArray(c.hook_type)
            ? c.hook_type
            : (c.hook_type
                ? String(c.hook_type).split(/[,、，·・]/).map(s => s.trim()).filter(Boolean)
                : []);
        hooks.forEach(h => {
            if (!h || h.startsWith('❌')) return;
            if (!hookMap[h]) hookMap[h] = { count: 0, roasSum: 0 };
            hookMap[h].count++;
            hookMap[h].roasSum += roas;
        });
    });
    const hooks = Object.entries(hookMap)
        .map(([tag, d]) => ({ tag, count: d.count, avgRoas: d.count > 0 ? d.roasSum / d.count : 0 }))
        .sort((a, b) => b.avgRoas - a.avgRoas || b.count - a.count);

    // ── 소재 타입별 성과 (이미지 vs 영상) ──
    const typeMap = {};
    creatives.forEach(c => {
        const url   = c.media_url || c.thumbnail_url || '';
        const isVid = c.media_type === 'video' || /\.(mp4|mov|webm|m4v)/i.test(url);
        const t = isVid ? 'video' : 'image';
        if (!typeMap[t]) typeMap[t] = { count: 0, spend: 0, revenue: 0, clicks: 0, impr: 0 };
        typeMap[t].count++;
        typeMap[t].spend   += c.spend       || 0;
        typeMap[t].revenue += c.revenue     || 0;
        typeMap[t].clicks  += c.clicks      || 0;
        typeMap[t].impr    += c.impressions || 0;
    });
    const types = Object.entries(typeMap).map(([t, d]) => ({
        type: t,
        count: d.count,
        spend: d.spend,
        roas:  d.spend > 0 ? d.revenue / d.spend : 0,
        ctr:   d.impr  > 0 ? d.clicks  / d.impr  : 0,
    })).sort((a, b) => b.roas - a.roas);

    if (!appeals.length && !hooks.length) return '';

    // ── 전체 평균 ROAS (해당 날짜 소재 기준) ──
    // 소구포인트/후킹이 있는 소재만으로 기준 계산 (공정 비교)
    const validCreatives = creatives.filter(c => (c.roas || 0) > 0);
    const overallAvgRoas = validCreatives.length > 0
        ? validCreatives.reduce((s, c) => s + (c.roas || 0), 0) / validCreatives.length
        : 1;

    // 상대 티어 함수: 전체 평균 대비 상대적 위치로 색상 결정
    const _roasTier = (avgRoas) => {
        const ratio = overallAvgRoas > 0 ? avgRoas / overallAvgRoas : 0;
        if (ratio >= 1.25) return { color: '#059669', bg: '#f0fdf4' }; // 평균 대비 +25% 이상 → 초록
        if (ratio >= 0.85) return { color: '#6366f1', bg: '#eef2ff' }; // ±15% 이내 → 보라(양호)
        if (ratio >= 0.55) return { color: '#f59e0b', bg: '#fffbeb' }; // -15~45% → 노랑(미달)
        return { color: '#94a3b8', bg: '#f8fafc' };                     // -45% 이하 → 회색
    };

    // ── 소구포인트 태그 HTML ──
    const appealHtml = appeals.length ? appeals.slice(0, 14).map(a => {
        const { color, bg } = _roasTier(a.avgRoas);
        return `<span class="mw-ins-tag" style="background:${bg};color:${color};border-color:${color}40">
            <span class="mw-ins-tag-name">${a.tag}</span>
            <span class="mw-ins-tag-cnt">×${a.count}</span>
            <span class="mw-ins-tag-roas">${_fmtRoas(a.avgRoas)}</span>
        </span>`;
    }).join('') : '<span class="mw-no-data">소구포인트 데이터 없음</span>';

    // ── 후킹유형 바 HTML ──
    const maxHookRoas = hooks.length ? Math.max(...hooks.map(h => h.avgRoas), 0.01) : 1;
    const hookHtml = hooks.length ? hooks.slice(0, 7).map((h, i) => {
        const pct = Math.round(h.avgRoas / maxHookRoas * 100);
        const { color } = _roasTier(h.avgRoas);
        return `<div class="mw-ins-hook-row">
            <span class="mw-ins-hook-rank">${i+1}</span>
            <span class="mw-ins-hook-label" title="${h.tag}">${h.tag}</span>
            <div class="mw-ins-hook-bar-wrap">
                <div class="mw-ins-hook-bar" style="width:${pct}%;background:${color}20;border-right:3px solid ${color}"></div>
            </div>
            <span class="mw-ins-hook-roas" style="color:${color}">${_fmtRoas(h.avgRoas)}</span>
            <span class="mw-ins-hook-cnt">×${h.count}</span>
        </div>`;
    }).join('') : '<span class="mw-no-data">후킹유형 데이터 없음</span>';

    // ── 소재 타입 카드 HTML ──
    const typeIcons = { image: '🖼️', video: '🎬' };
    const typeLabel = { image: '이미지', video: '영상' };
    const typeHtml = types.length >= 2 ? `
        <div class="mw-section-hd" style="margin-top:14px">📽️ 소재 타입별 성과</div>
        <div class="mw-ins-types">
            ${types.map(t => `
            <div class="mw-ins-type-card">
                <div class="mw-ins-type-lbl">${typeIcons[t.type]||'📄'} ${typeLabel[t.type]||t.type}</div>
                <div class="mw-ins-type-cnt">${t.count}개 소재</div>
                <div class="mw-ins-type-row"><span>ROAS</span>
                    <strong style="color:${t.roas>=2?'#059669':t.roas>=1?'#6366f1':'#ef4444'}">${_fmtRoas(t.roas)}</strong></div>
                <div class="mw-ins-type-row"><span>CTR</span><strong>${_fmtCtr(t.ctr)}</strong></div>
                <div class="mw-ins-type-row"><span>집행비</span><strong>${_fmtMoney(t.spend,'원')}</strong></div>
            </div>`).join('')}
        </div>` : '';

    return `
    <div class="mw-insight-wrap">
        <div class="mw-insight-grid">
            <div class="mw-insight-col">
                <div class="mw-section-hd">💡 소구포인트 효율 분석
                    <span class="mw-ins-legend">전체 평균 ROAS 대비 · <span style="color:#059669">◆</span>+25% <span style="color:#6366f1">◆</span>±15% <span style="color:#f59e0b">◆</span>미달 <span style="color:#94a3b8">◆</span>저효율</span>
                </div>
                <div class="mw-ins-tags">${appealHtml}</div>
            </div>
            <div class="mw-insight-col">
                <div class="mw-section-hd">⚡ 후킹유형 효율 분석 <span style="font-size:10px;color:#94a3b8">평균 ROAS 기준</span></div>
                <div class="mw-ins-hooks">${hookHtml}</div>
                ${typeHtml}
            </div>
        </div>
    </div>`;
}

// ── 전체 기간 베스트 소재 ─────────────────────────────────────
function _buildEventBestCreativesHtml(byDate, sortedDates) {
    // Single One 매체만 (Single One Meta / Single One TikTok 등)
    const isSingleOne = c => /single/i.test(c.platform || '');

    const creMap = {};
    sortedDates.forEach(iso => {
        const d = byDate[iso]; if (!d) return;
        d.creatives.forEach(c => {
            if (!isSingleOne(c)) return; // Single One 이외 제외
            // 광고명 기준 집계 (대소문자·공백 무시 → 같은 소재 하나로)
            const key = (c.ad_name || c.creative_name || String(c.id||''))
                .trim().toLowerCase().replace(/\s+/g, ' ');
            if (!key) return;
            if (!creMap[key]) creMap[key] = {
                name: c.ad_name || c.creative_name || key,
                thumb: '', product: c.product||'',
                spend:0, revenue:0, clicks:0, impr:0,
            };
            if (!creMap[key].thumb && (c.thumbnail_url || c.media_url))
                creMap[key].thumb = c.thumbnail_url || c.media_url;
            creMap[key].spend   += c.spend       || 0;
            creMap[key].revenue += c.revenue     || 0;
            creMap[key].clicks  += c.clicks      || 0;
            creMap[key].impr    += c.impressions || 0;
        });
    });

    const top = Object.values(creMap)
        .map(d => ({ ...d,
            roas: d.spend > 0 ? d.revenue / d.spend : 0,
            ctr:  d.impr  > 0 ? d.clicks  / d.impr  : 0,
        }))
        .filter(d => d.spend > 0)
        .sort((a, b) => b.roas - a.roas)
        .slice(0, 8);

    if (!top.length) return '';

    const items = top.map((c, i) => {
        return `<div class="mw-evt-best-item">
            <div style="position:relative;flex-shrink:0">
                ${_mwThumbHtml(c.thumb || '', 'mw-cr-thumb')}
                <span class="mw-evt-best-rank" style="background:${i===0?'#f97316':i<=2?'#6366f1':'rgba(0,0,0,0.45)'}">${i+1}</span>
            </div>
            <div class="mw-evt-best-info">
                <div class="mw-evt-best-name" title="${c.name}">${c.name.slice(0,28)}</div>
                <div class="mw-evt-best-meta">
                    <span class="mw-cr-prod-badge">${(c.product||'기타').slice(0,10)}</span>
                    <span class="mw-evt-best-roas ${_roasClass(c.roas)}">${_fmtRoas(c.roas)}</span>
                    <span class="mw-evt-best-ctr">CTR ${_fmtCtr(c.ctr)}</span>
                    <span class="mw-evt-best-spend">${_fmtKRW(c.spend)}</span>
                </div>
            </div>
        </div>`;
    }).join('');

    return `
    <div class="mw-section-hd" style="margin-top:16px">🏅 이벤트 전체 베스트 소재
        <span style="font-size:10px;color:#94a3b8;font-weight:400">전체 기간 합산 ROAS 순 · Single One</span>
    </div>
    <div class="mw-evt-best-grid">${items}</div>`;
}

// ── 패널 렌더 (초기 / 전체 재렌더) ──────────────────────────
function renderMegawariPanel() {
    const container = document.getElementById('megawari-panel-body');
    if (!container) return;

    try {
    const mwData = _getMwData();
    if (!mwData.length) {
        container.innerHTML = `<div class="mw-empty"><i class="fas fa-fire text-3xl text-slate-200 mb-3"></i><p class="font-semibold text-slate-500">Megawari 이벤트 데이터가 없어요</p><p class="text-xs text-slate-400 mt-1">이벤트 필터에 "megawari" 항목이 있는 데이터를 불러와주세요</p></div>`;
        return;
    }

    const byDate = _aggregateMw(mwData);
    // 기간 필터 없이 전체 날짜 사용 (데이터가 없으면 빈 탭 표시 방지)
    const periodStart = MW_PERIODS[0].start;
    const periodEnd   = MW_PERIODS[MW_PERIODS.length - 1].end;
    let sortedDates = Object.keys(byDate).sort()
        .filter(iso => iso >= periodStart && iso <= periodEnd);
    // 기간 내 데이터가 없으면 전체 날짜 사용
    if (!sortedDates.length) sortedDates = Object.keys(byDate).sort();
    _mwSortedDates = sortedDates;

    if (!sortedDates.length) {
        container.innerHTML = `<div class="mw-empty"><p class="font-semibold text-slate-500">날짜 데이터가 없어요</p></div>`;
        return;
    }

    window._mwSelectedDate = window._mwSelectedDate && sortedDates.includes(window._mwSelectedDate)
        ? window._mwSelectedDate : sortedDates[sortedDates.length - 1];

    const sel = window._mwSelectedDate;
    if (!sel || !byDate[sel]) {
        container.innerHTML = `<div class="mw-empty"><p class="font-semibold text-slate-500">선택한 날짜 데이터가 없어요</p></div>`;
        return;
    }

    // ── 카카오 설정 (렌더마다 최신 값) ──────────────────────
    const kakaoKey    = localStorage.getItem('mw_kakao_app_key')       || '';
    const kakaoToken  = localStorage.getItem('mw_kakao_refresh_token') || '';
    const kakaoSecret = localStorage.getItem('mw_kakao_client_secret') || '';
    const kakaoTime   = localStorage.getItem('mw_kakao_send_time')     || '09:00';
    const kakaoEnabled = localStorage.getItem('mw_kakao_enabled') === '1';
    const vercelUrl = (localStorage.getItem('hf_vercel_url') || '').replace(/\/$/, '');
    const kakaoStatus = kakaoKey && kakaoToken
        ? `<span class="mw-kakao-ok">✅ 연결됨 — 매일 ${kakaoTime} 자동발송${kakaoEnabled?' 켜짐':' 꺼짐'}</span>`
        : `<span class="mw-kakao-warn">⚙️ 카카오 설정 필요</span>`;

    // ── 날짜 탭 + 누적 KPI 바 + 본문(캐시) + 전체 베스트 소재 ──
    const dateTabs    = _buildDateTabs(sortedDates, sel, byDate);
    const eventTotBar = _buildEventTotalBar(byDate, sortedDates);
    const bodyHtml    = _buildMwBodyHtml(sel, byDate, sortedDates);
    const eventBest   = _buildEventBestCreativesHtml(byDate, sortedDates);

    container.innerHTML = `
    <div class="mw-date-tabs">${dateTabs}</div>
    ${eventTotBar}
    ${bodyHtml}
    <div class="mw-evt-best-wrap">${eventBest}</div>
    <details class="mw-kakao-wrap" ${!kakaoKey&&!kakaoToken?'open':''}>
        <summary class="mw-kakao-summary">
            <i class="fas fa-comment" style="color:#3b1f1f"></i>
            카카오톡 자동발송 설정 &nbsp; ${kakaoStatus}
        </summary>
        <div class="mw-kakao-body">
            <div class="mw-kakao-step">
                <div class="mw-kakao-step-num">1</div>
                <div class="mw-kakao-step-content">
                    <p class="font-semibold text-sm mb-1">카카오 REST API 키 입력</p>
                    <p class="text-xs text-slate-500 mb-2"><a href="https://developers.kakao.com/console/app" target="_blank" class="text-indigo-500 underline">developers.kakao.com</a> → 내 애플리케이션 → REST API 키</p>
                    <div class="flex gap-2 mb-2">
                        <input id="mw-kakao-key-input" type="text" class="mw-kakao-input flex-1" placeholder="REST API 키" value="${kakaoKey}">
                        <button class="mw-kakao-btn" onclick="_mwSaveKakaoKey()">저장</button>
                    </div>
                    <p class="text-xs text-slate-500 mb-1">Client Secret (보안 탭에서 활성화한 경우)</p>
                    <div class="flex gap-2">
                        <input id="mw-kakao-secret-input" type="text" class="mw-kakao-input flex-1" placeholder="Client Secret 코드 (없으면 비워두기)" value="${kakaoSecret}">
                        <button class="mw-kakao-btn" onclick="_mwSaveKakaoSecret()">저장</button>
                    </div>
                </div>
            </div>
            <div class="mw-kakao-step">
                <div class="mw-kakao-step-num">2</div>
                <div class="mw-kakao-step-content">
                    <p class="font-semibold text-sm mb-1">카카오 로그인 → Refresh Token 발급</p>
                    <p class="text-xs text-slate-500 mb-2">로그인 후 나에게 보내기 권한(talk_message)을 허용해주세요</p>
                    <div class="flex gap-2 mb-2">
                        <button class="mw-kakao-btn kakao-yellow" onclick="_mwKakaoLogin()">카카오 로그인</button>
                        ${kakaoToken ? `<span class="text-xs text-emerald-600 self-center">✅ 토큰 저장됨</span>` : ''}
                    </div>
                    ${kakaoToken ? `<p class="text-xs text-slate-500">Refresh Token:</p><input type="text" class="mw-kakao-input w-full mt-1" value="${kakaoToken}" readonly onclick="this.select()">` : ''}
                </div>
            </div>
            <div class="mw-kakao-step">
                <div class="mw-kakao-step-num">3</div>
                <div class="mw-kakao-step-content">
                    <p class="font-semibold text-sm mb-2">발송 시간 설정 (JST)</p>
                    <div class="flex gap-2 items-center">
                        <input id="mw-kakao-time-input" type="time" class="mw-kakao-input w-28" value="${kakaoTime}">
                        <span class="text-xs text-slate-500">매일 이 시간에 자동발송</span>
                    </div>
                    <div class="flex gap-2 mt-3">
                        <button class="mw-kakao-btn" onclick="_mwSaveAutoSend()" style="background:#f97316">
                            <i class="fas fa-clock mr-1"></i>${kakaoEnabled ? '설정 업데이트' : '자동발송 활성화'}
                        </button>
                        <button class="mw-kakao-btn" onclick="_mwTestSend()" style="background:#6366f1">
                            <i class="fas fa-paper-plane mr-1"></i>지금 바로 전송
                        </button>
                    </div>
                    ${vercelUrl ? `<p class="text-xs text-slate-400 mt-2">Vercel Cron: <code>${vercelUrl}/api/megawari-cron</code></p>` : '<p class="text-xs text-amber-600 mt-2">⚠️ Vercel URL 설정 필요 (광고 생성 탭)</p>'}
                </div>
            </div>
        </div>
    </details>
    <div class="mw-share-bar">
        <button class="mw-btn-copy" onclick="_mwCopyReport()"><i class="fas fa-copy mr-1.5"></i>리포트 복사</button>
        <button class="mw-btn-kakao" onclick="_mwSendNow()"><i class="fas fa-comment mr-1.5"></i>카카오 전송</button>
    </div>`;

    _renderMwRoasChart(byDate, sortedDates);

    } catch(e) {
        console.error('[Megawari] renderMegawariPanel error:', e);
        container.innerHTML = `<div class="mw-empty"><p class="font-semibold text-slate-500">렌더링 오류: ${e.message}</p><p class="text-xs text-slate-400 mt-1">콘솔(F12)에서 상세 오류를 확인해주세요</p></div>`;
    }
}

// ── 날짜 선택 (빠른 전환: 탭 토글 + 본문만 교체) ───────────
function _mwSelectDate(iso) {
    if (window._mwSelectedDate === iso) return; // 동일 날짜 클릭 무시
    window._mwSelectedDate = iso;

    const container = document.getElementById('megawari-panel-body');
    const mwData = _getMwData();
    if (!container || !mwData.length) { renderMegawariPanel(); return; }

    const byDate = _aggregateMw(mwData);
    const sortedDates = _mwSortedDates || Object.keys(byDate).sort();

    // 1. 날짜 탭 active 클래스만 DOM 직접 업데이트
    const tabs = container.querySelectorAll('.mw-date-tab');
    tabs.forEach(btn => {
        const btnIso = btn.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        if (!btnIso) return;
        const info = _getMwDayLabel(btnIso);
        const isActive = btnIso === iso;
        btn.className = `mw-date-tab${isActive ? ' active' : ''}`;
        btn.style.borderColor = isActive ? info.color : '';
        btn.style.boxShadow   = isActive ? `0 0 0 3px ${info.color}22` : '';
    });
    setTimeout(() => container.querySelector('.mw-date-tab.active')?.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'}), 30);

    // 2. 본문은 캐시 or 새로 빌드 후 교체 (날짜탭 제외한 영역)
    const bodyHtml = _buildMwBodyHtml(iso, byDate, sortedDates);

    // 날짜탭 다음 형제부터 전체베스트(mw-evt-best-wrap) 직전까지 교체
    // eventTotBar + bodyHtml 영역만 교체, mw-evt-best-wrap·카카오는 유지
    const tabsEl    = container.querySelector('.mw-date-tabs');
    const kakaoEl   = container.querySelector('.mw-kakao-wrap');
    const bestWrap  = container.querySelector('.mw-evt-best-wrap');
    const stopEl    = bestWrap || kakaoEl; // 교체 종료 경계

    if (tabsEl && stopEl) {
        let node = tabsEl.nextSibling;
        while (node && node !== stopEl) {
            const next = node.nextSibling;
            container.removeChild(node);
            node = next;
        }
        // 이벤트 누적바 + 새 본문 삽입
        const eventTotBar = _buildEventTotalBar(byDate, sortedDates);
        const tmp = document.createElement('div');
        tmp.innerHTML = eventTotBar + bodyHtml;
        while (tmp.firstChild) container.insertBefore(tmp.firstChild, stopEl);
    } else {
        renderMegawariPanel(); return;
    }

    _renderMwRoasChart(byDate, sortedDates);
}
window._mwSelectDate = _mwSelectDate;

// ── Drive URL → img HTML (fallback 체인) ─────────────────────
function _mwThumbHtml(url, className, fallbackHtml) {
    const fb = fallbackHtml || `<div class="${className} ${className}-empty"><i class="fas fa-image"></i></div>`;
    if (!url) return fb;
    if (typeof window.buildDriveImgHtml === 'function') {
        return window.buildDriveImgHtml(url, { className, loading: 'lazy', finalFallbackHtml: fb });
    }
    // 폴백: Drive ID 추출 후 thumbnail API
    const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const src = m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w240` : url;
    return `<img class="${className}" src="${src}" loading="lazy" onerror="this.outerHTML='${fb.replace(/'/g, "\\'")}'">`;
}

// ── Drive URL → 공개 썸네일 URL 변환 (카카오 리포트용) ──────
function _toPublicThumb(url) {
    if (!url) return null;
    const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
              url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
              url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w480`;
    if (/^https?:\/\//.test(url)) return url;
    return null;
}

// ── 리포트 텍스트 가져오기 ────────────────────────────────────
function _mwGetReportText() {
    const byDate = _aggregateMw(_getMwData());
    return buildReportText(window._mwSelectedDate || Object.keys(byDate).sort().pop(), byDate);
}

// ── 고효율 소재 + 썸네일 수집 ────────────────────────────────
function _mwGetTopCreativesForKakao() {
    const byDate  = _aggregateMw(_getMwData());
    const dateIso = window._mwSelectedDate || Object.keys(byDate).sort().pop();
    const today   = byDate[dateIso];
    if (!today) return [];

    const isTeaser = _getMwPeriod(dateIso)?.key === 'teaser';
    const hasAtc   = today.creatives.some(c => (c.add_to_cart||0) > 0);
    const useAtc   = isTeaser && hasAtc;

    const sorted = today.creatives
        .filter(c => useAtc ? (c.add_to_cart||0) > 0 : (c.roas||0) > 0)
        .sort((a,b) => useAtc
            ? (b.add_to_cart||0)/(b.clicks||1) - (a.add_to_cart||0)/(a.clicks||1)
            : (b.roas||0) - (a.roas||0));

    return sorted.slice(0, 3).map(c => {
        const thumbUrl = _toPublicThumb(c.thumbnail_url || c.media_url || '');
        const metric   = useAtc
            ? `ATC ${((c.add_to_cart||0)/(c.clicks||1)*100).toFixed(1)}%`
            : `ROAS ${_fmtRoas(c.roas||0)}`;
        return {
            name:      (c.ad_name || c.creative_name || '-').slice(0, 25),
            product:   c.product || '',
            platform:  c.platform || '',
            metric,
            thumb_url: thumbUrl,
        };
    }).filter(c => c.thumb_url); // 썸네일 없는 소재 제외
}

// ── 복사 ──────────────────────────────────────────────────────
function _mwCopyReport() {
    navigator.clipboard.writeText(_mwGetReportText()).then(() => {
        const btn = document.querySelector('.mw-btn-copy');
        if (!btn) return;
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check mr-1.5"></i>복사됨!';
        btn.style.background = '#059669';
        setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; }, 2000);
    });
}
window._mwCopyReport = _mwCopyReport;

// ── 카카오 API로 전송 ─────────────────────────────────────────
async function _mwSendViaKakao(text) {
    const vercelBase   = (localStorage.getItem('hf_vercel_url') || '').replace(/\/$/, '');
    const refreshToken = localStorage.getItem('mw_kakao_refresh_token') || '';
    const appKey       = localStorage.getItem('mw_kakao_app_key') || '';

    if (!vercelBase || !refreshToken || !appKey) {
        if (navigator.share) { await navigator.share({ text }); return; }
        await navigator.clipboard.writeText(text);
        alert('리포트가 클립보드에 복사됐어요!\n카카오톡에 붙여넣기 해주세요.');
        return;
    }

    const clientSecret = localStorage.getItem('mw_kakao_client_secret') || '';
    const res  = await fetch(`${vercelBase}/api/kakao-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, refresh_token: refreshToken, app_key: appKey, client_secret: clientSecret }),
    });
    const data = await res.json();
    if (res.ok) {
        alert('✅ 카카오톡으로 전송됐어요!');
    } else {
        const detail = data.detail ? `\n카카오 오류: ${JSON.stringify(data.detail)}` : '';
        alert(`❌ 전송 실패 (${res.status}): ${data.error || ''}${detail}\n\n클립보드에 복사합니다.`);
        await navigator.clipboard.writeText(text);
    }
}

function _mwSendNow()  { _mwSendViaKakao(_mwGetReportText()); }
window._mwSendNow = _mwSendNow;
function _mwTestSend() { _mwSendViaKakao(_mwGetReportText()); }
window._mwTestSend = _mwTestSend;

// ── 카카오 설정 저장 ──────────────────────────────────────────
function _mwSaveKakaoKey() {
    const key = document.getElementById('mw-kakao-key-input')?.value?.trim();
    if (!key) return alert('REST API 키를 입력해주세요');
    localStorage.setItem('mw_kakao_app_key', key);
    alert('✅ 저장됐어요!');
}
window._mwSaveKakaoKey = _mwSaveKakaoKey;

function _mwSaveKakaoSecret() {
    const secret = document.getElementById('mw-kakao-secret-input')?.value?.trim();
    if (secret === undefined) return;
    if (secret) {
        localStorage.setItem('mw_kakao_client_secret', secret);
        alert('✅ Client Secret 저장됐어요!');
    } else {
        localStorage.removeItem('mw_kakao_client_secret');
        alert('Client Secret을 삭제했어요.');
    }
}
window._mwSaveKakaoSecret = _mwSaveKakaoSecret;

function _mwSaveAutoSend() {
    const time = document.getElementById('mw-kakao-time-input')?.value || '09:00';
    localStorage.setItem('mw_kakao_send_time', time);
    localStorage.setItem('mw_kakao_enabled', '1');
    renderMegawariPanel();
    alert(`✅ 매일 ${time} 자동발송이 설정됐어요!\nVercel 환경변수에 KAKAO_REFRESH_TOKEN과 KAKAO_APP_KEY를 추가해주세요.`);
}
window._mwSaveAutoSend = _mwSaveAutoSend;

// ── 카카오 OAuth 로그인 ───────────────────────────────────────
function _mwKakaoLogin() {
    const appKey = document.getElementById('mw-kakao-key-input')?.value?.trim()
                || localStorage.getItem('mw_kakao_app_key') || '';
    if (!appKey) return alert('먼저 REST API 키를 입력하고 저장해주세요');
    const vercelBase = (localStorage.getItem('hf_vercel_url') || '').replace(/\/$/, '');
    if (!vercelBase) return alert('Vercel URL을 먼저 설정해주세요 (광고 생성 탭)');
    const redirectUri = encodeURIComponent(`${vercelBase}/api/kakao-callback`);
    const scope = encodeURIComponent('talk_message');
    // state에 appKey를 담아서 콜백에서 꺼낼 수 있게 함
    const state = encodeURIComponent(JSON.stringify({ appKey }));
    const url = `https://kauth.kakao.com/oauth/authorize?client_id=${appKey}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;
    const popup = window.open(url, 'kakao_login', 'width=500,height=600');
    // 팝업에서 token 받기
    window._kakaoLoginCallback = (refreshToken) => {
        localStorage.setItem('mw_kakao_refresh_token', refreshToken);
        renderMegawariPanel();
        alert('✅ 카카오 로그인 완료! Refresh Token이 저장됐어요.');
    };
}
window._mwKakaoLogin = _mwKakaoLogin;

window.renderMegawariPanel = renderMegawariPanel;

// ── 소재 변동 감지 ───────────────────────────────────────────
function _detectCreativeShifts(todayCreatives, prevCreatives, threshold) {
    threshold = threshold || 0.30;
    if (!prevCreatives || !prevCreatives.length) return { up: [], dn: [] };
    const prevMap = {};
    prevCreatives.forEach(function(c) {
        var key = (c.ad_name || c.creative_name || '').trim();
        if (key) prevMap[key] = c;
    });
    var up = [], dn = [];
    todayCreatives.forEach(function(c) {
        var key = (c.ad_name || c.creative_name || '').trim();
        var p = prevMap[key];
        if (!p) return;
        var prevRoas = (p.roas != null ? p.roas : (p.spend > 0 ? p.revenue / p.spend : 0));
        var currRoas = (c.roas != null ? c.roas : (c.spend > 0 ? c.revenue / c.spend : 0));
        var prevCtr  = (p.ctr  != null ? p.ctr  : (p.impressions > 0 ? p.clicks / p.impressions : 0));
        var currCtr  = (c.ctr  != null ? c.ctr  : (c.impressions > 0 ? c.clicks / c.impressions : 0));
        var roasPct  = prevRoas > 0 ? (currRoas - prevRoas) / prevRoas : null;
        var ctrPct   = prevCtr  > 0 ? (currCtr  - prevCtr)  / prevCtr  : null;
        var candidates = [roasPct, ctrPct].filter(function(v) { return v !== null; });
        if (!candidates.length) return;
        var maxPct = candidates.reduce(function(best, v) {
            return Math.abs(v) > Math.abs(best) ? v : best;
        }, 0);
        var item = {
            name: key.slice(0, 35),
            product: (c.product || '').slice(0, 12),
            platform: (c.platform || '').slice(0, 15),
            thumb: c.thumbnail_url || c.media_url || '',
            roasPct: roasPct, ctrPct: ctrPct,
            currRoas: currRoas, prevRoas: prevRoas,
            currCtr: currCtr, prevCtr: prevCtr,
            mainPct: maxPct
        };
        if (maxPct >= threshold)       up.push(item);
        else if (maxPct <= -threshold) dn.push(item);
    });
    up.sort(function(a, b) { return b.mainPct - a.mainPct; });
    dn.sort(function(a, b) { return a.mainPct - b.mainPct; });
    return { up: up, dn: dn };
}

function _buildShiftAlert(shifts) {
    var fmtPct = function(v) {
        if (v === null || v === undefined) return '-';
        return (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
    };
    if (!shifts.up.length && !shifts.dn.length) {
        return '<div class="mw-shift-empty">전일 대비 ±30% 이상 변동 소재 없음 ✅</div>';
    }
    function renderCard(item, type) {
        var isUp = type === 'up';
        // 썸네일 (fallback 체인 사용)
        var thumbHtml = item.thumb ? _mwThumbHtml(item.thumb, 'mw-shift-thumb') : '';
        // 지표 문자열
        var roasStr = item.roasPct !== null
            ? 'ROAS ' + (item.currRoas > 0 ? Math.round(item.currRoas * 100) + '%' : '-')
              + '→' + (item.prevRoas > 0 ? Math.round(item.prevRoas * 100) + '%' : '-')
              + ' <b style="color:' + (isUp?'#059669':'#dc2626') + '">' + fmtPct(item.roasPct) + '</b>' : '';
        var ctrStr = item.ctrPct !== null
            ? 'CTR ' + (item.currCtr > 0 ? (item.currCtr * 100).toFixed(2) + '%' : '-')
              + '→' + (item.prevCtr > 0 ? (item.prevCtr * 100).toFixed(2) + '%' : '-')
              + ' <b style="color:' + (isUp?'#059669':'#dc2626') + '">' + fmtPct(item.ctrPct) + '</b>' : '';
        var metrics = [roasStr, ctrStr].filter(Boolean).join(' &middot; ');
        var platBadge = item.platform
            ? '<span class="mw-shift-plat">' + item.platform + '</span>' : '';
        return '<div class="mw-shift-card ' + (isUp ? 'up' : 'dn') + '">'
            + thumbHtml
            + '<div class="mw-shift-body">'
            + '<div class="mw-shift-name-row">'
            + '<span class="mw-shift-name">' + item.name + '</span>'
            + platBadge
            + '</div>'
            + (item.product ? '<div class="mw-shift-prod">' + item.product + '</div>' : '')
            + '<div class="mw-shift-metrics">' + metrics + '</div>'
            + '</div>'
            + '<div class="mw-shift-pct ' + (isUp ? 'up' : 'dn') + '">' + fmtPct(item.mainPct) + '</div>'
            + '</div>';
    }
    var upCards = shifts.up.slice(0, 4).map(function(i) { return renderCard(i, 'up'); }).join('');
    var dnCards = shifts.dn.slice(0, 4).map(function(i) { return renderCard(i, 'dn'); }).join('');
    return '<div class="mw-shift-cols">'
        + '<div><div class="mw-shift-label up">🟢 상승 소재 (' + shifts.up.length + '건)</div>'
        + (upCards || '<div class="mw-shift-empty">없음</div>') + '</div>'
        + '<div><div class="mw-shift-label dn">🔴 하락 소재 (' + shifts.dn.length + '건)</div>'
        + (dnCards || '<div class="mw-shift-empty">없음</div>') + '</div>'
        + '</div>';
}

function _buildProductCompareCards(prods, isTeaser) {
    if (!prods || !prods.length) return '<div class="mw-shift-empty">제품 데이터 없음</div>';
    var maxRoas = Math.max.apply(null, prods.map(function(e) { return e[1].roas || 0; }).concat([0.01]));
    return prods.map(function(entry, i) {
        var name = entry[0], p = entry[1];
        var isTop = i === 0;
        var roasBarW = maxRoas > 0 ? Math.round((p.roas / maxRoas) * 100) : 0;
        var barColor = (p.roas >= 3) ? '#10b981' : (p.roas >= 1.5) ? '#3b82f6' : (p.roas >= 1) ? '#f59e0b' : '#ef4444';
        var roasStr = p.roas > 0 ? Math.round(p.roas * 100) + '%' : '-';
        var ctrStr  = p.ctr  > 0 ? (p.ctr * 100).toFixed(2) + '%' : '-';
        var atcHtml = isTeaser
            ? '<div class="mw-pcc-stat"><span class="mw-pcc-stat-lbl">담기</span>'
              + '<span class="mw-pcc-stat-val">' + (p.add_to_cart || 0).toLocaleString() + '</span></div>' : '';
        return '<div class="mw-pcc' + (isTop ? ' top' : '') + '">'
            + (isTop ? '<div class="mw-pcc-crown">👑 1위</div>' : '')
            + '<div class="mw-pcc-name">' + name + '</div>'
            + '<div class="mw-pcc-bar-wrap"><div class="mw-pcc-bar" style="width:' + roasBarW + '%;background:' + barColor + '"></div></div>'
            + '<div class="mw-pcc-roas-row">'
            + '<span style="font-size:13px;font-weight:800;color:' + barColor + '">' + roasStr + '</span>'
            + '<span class="mw-pcc-ctr">CTR ' + ctrStr + '</span>'
            + '</div>'
            + '<div class="mw-pcc-stats">'
            + '<div class="mw-pcc-stat"><span class="mw-pcc-stat-lbl">매출</span>'
            + '<span class="mw-pcc-stat-val">' + (p.revenue >= 1e8 ? (p.revenue/1e8).toFixed(1)+'억' : p.revenue >= 1e4 ? Math.round(p.revenue/1e4)+'만' : (p.revenue||0).toLocaleString()) + '</span></div>'
            + '<div class="mw-pcc-stat"><span class="mw-pcc-stat-lbl">지출</span>'
            + '<span class="mw-pcc-stat-val">' + (p.spend >= 1e8 ? (p.spend/1e8).toFixed(1)+'억' : p.spend >= 1e4 ? Math.round(p.spend/1e4)+'만' : (p.spend||0).toLocaleString()) + '</span></div>'
            + atcHtml
            + '</div></div>';
    }).join('');
}

// ── D+N 누적 ROAS 라인 차트 ─────────────────────────────────
let _mwRoasChart = null;

function _renderMwRoasChart(byDate, sortedDates) {
    const ctx = document.getElementById('mwRoasLineChart');
    if (!ctx) return;
    let cumSpend = 0, cumRevenue = 0;
    const labels = [], cumRoasData = [], dailyRoasData = [];

    sortedDates.forEach(iso => {
        const d = byDate[iso];
        if (!d) return;
        cumSpend   += d.spend   || 0;
        cumRevenue += d.revenue || 0;
        const dateObj = new Date(iso);
        labels.push(`${dateObj.getMonth()+1}/${dateObj.getDate()}`);
        cumRoasData.push(cumSpend > 0 ? Math.round(cumRevenue / cumSpend * 100) : 0);
        dailyRoasData.push(Math.round((d.roas || 0) * 100));
    });

    if (!labels.length) return;

    if (_mwRoasChart) {
        _mwRoasChart.data.labels = labels;
        _mwRoasChart.data.datasets[0].data = cumRoasData;
        _mwRoasChart.data.datasets[1].data = dailyRoasData;
        _mwRoasChart.update('none');
        return;
    }

    _mwRoasChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '누적 ROAS (%)',
                    data: cumRoasData,
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249,115,22,0.10)',
                    borderWidth: 2.5,
                    tension: 0.35,
                    fill: true,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                },
                {
                    label: '일별 ROAS (%)',
                    data: dailyRoasData,
                    borderColor: '#a78bfa',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    borderDash: [5, 4],
                    tension: 0.3,
                    fill: false,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 14 } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw}%` } }
            },
            scales: {
                y: { ticks: { callback: v => v + '%', font: { size: 10 } }, grid: { color: 'rgba(226,232,240,0.6)' } },
                x: { ticks: { font: { size: 10 } }, grid: { display: false } }
            }
        }
    });
}
