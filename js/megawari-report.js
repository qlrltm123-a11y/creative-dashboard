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
function _fmtAtcRate(v) { return v > 0 ? `ATC ${(v * 100).toFixed(2)}%` : 'ATC -'; }
function _fmtMoney(v, unit) {
    if (!v || v === 0) return '-';
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M${unit||''}`;
    if (Math.abs(v) >= 10_000)    return `${Math.round(v / 1_000)}K${unit||''}`;
    return `${Math.round(v).toLocaleString()}${unit||''}`;
}
function _roasClass(roas) {
    if (roas >= 3)   return 'roas-high';
    if (roas >= 1.5) return 'roas-mid';
    if (roas >= 1)   return 'roas-low';
    return 'roas-bad';
}
function _atcClass(rate) {
    if (rate >= 0.05)  return 'roas-high';
    if (rate >= 0.02)  return 'roas-mid';
    if (rate >= 0.005) return 'roas-low';
    return 'roas-bad';
}
function _diffBadge(curr, prev) {
    if (!prev || !curr || prev === 0) return '';
    const p = ((curr - prev) / Math.abs(prev)) * 100;
    if (p > 3)  return `<span class="mw-diff up">▲${Math.abs(Math.round(p))}%</span>`;
    if (p < -3) return `<span class="mw-diff dn">▼${Math.abs(Math.round(p))}%</span>`;
    return `<span class="mw-diff flat">→</span>`;
}

// ── 메가와리 데이터 필터 ──────────────────────────────────────
function _getMwData() {
    const raw = Array.isArray(window.allCreatives) ? window.allCreatives : [];
    const brand = (typeof currentBrand !== 'undefined' && currentBrand !== 'ALL') ? currentBrand : null;
    let data = raw.filter(c => {
        const ev = (c.event || '').toLowerCase().replace(/\s/g, '');
        return ev.includes('megawari') || ev.includes('メガワリ') || ev.includes('mega');
    });
    if (brand) data = data.filter(c => c.brand === brand);
    return data;
}

// ── 날짜별 집계 ───────────────────────────────────────────────
function _aggregateMw(data) {
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

// ── 리포트 텍스트 포맷 ───────────────────────────────────────
function buildReportText(dateIso, byDate) {
    const today = byDate[dateIso];
    if (!today) return '해당 날짜 데이터 없음';
    const sortedDates = Object.keys(byDate).sort();
    const prevIso = sortedDates[sortedDates.indexOf(dateIso) - 1];
    const yesterday = prevIso ? byDate[prevIso] : null;
    const dayInfo = _getMwDayLabel(dateIso);
    const brand = (typeof currentBrand !== 'undefined' && currentBrand !== 'ALL') ? currentBrand : '전체';
    const periodLabel = dayInfo.period ? `${dayInfo.badge}${dayInfo.period.label}` : 'Megawari';

    let txt = `📊 [${brand}] メガワリ ${periodLabel} ${dayInfo.label}\n`;
    txt += `📅 ${dateIso.replace(/-/g,'.')}\n${'─'.repeat(22)}\n`;
    txt += `🏆 전체\n`;
    txt += `• ROAS: ${_fmtRoas(today.roas)}${yesterday ? ` (전일比 ${today.roas>yesterday.roas?'+':''}${Math.round((today.roas-yesterday.roas)/(yesterday.roas||1)*100)}%)` : ''}\n`;
    txt += `• CTR:  ${_fmtCtr(today.ctr)}\n`;
    txt += `• 매출: ${_fmtMoney(today.revenue,'원')} / 지출: ${_fmtMoney(today.spend,'원')}\n\n`;

    const prods = Object.entries(today.byProduct).sort((a,b)=>b[1].roas-a[1].roas);
    if (prods.length) {
        txt += `📦 제품별\n`;
        prods.forEach(([name, p]) => {
            txt += `[${name}] ROAS ${_fmtRoas(p.roas)} / CTR ${_fmtCtr(p.ctr)} / 매출 ${_fmtMoney(p.revenue,'원')}\n`;
            Object.entries(p.byPlatform).sort((a,b)=>b[1].roas-a[1].roas).forEach(([pl,v]) => {
                txt += `  • ${pl}: ${_fmtRoas(v.roas)} / ${_fmtCtr(v.ctr)}\n`;
            });
        });
        txt += '\n';
    }

    const all = today.creatives.filter(c=>(c.roas||0)>0).sort((a,b)=>(b.roas||0)-(a.roas||0));
    if (all.length) {
        txt += `🎯 고효율 TOP3\n`;
        all.slice(0,3).forEach((c,i) => txt += `${i+1}. ${c.ad_name||c.creative_name||'-'} (${_fmtRoas(c.roas||0)})\n`);
        txt += '\n';
    }
    const worst = all.filter(c=>(c.roas||0)<1).slice(-2).reverse();
    if (worst.length) {
        txt += `⚠️ 저효율 소재\n`;
        worst.forEach(c => txt += `• ${c.ad_name||c.creative_name||'-'} (${_fmtRoas(c.roas||0)})\n`);
        txt += '\n';
    }

    const comment = _genAiComment(today, yesterday, dayInfo, dateIso);
    if (comment) txt += `💡 AI 코멘트\n${comment}\n\n`;
    txt += `📲 Creative Dashboard`;
    return txt;
}

// ── 패널 렌더 ─────────────────────────────────────────────────
function renderMegawariPanel() {
    const container = document.getElementById('megawari-panel-body');
    if (!container) return;

    const mwData = _getMwData();
    if (!mwData.length) {
        container.innerHTML = `<div class="mw-empty"><i class="fas fa-fire text-3xl text-slate-200 mb-3"></i><p class="font-semibold text-slate-500">Megawari 이벤트 데이터가 없어요</p><p class="text-xs text-slate-400 mt-1">이벤트 필터에 "megawari" 항목이 있는 데이터를 불러와주세요</p></div>`;
        return;
    }

    const byDate = _aggregateMw(mwData);
    // 메가와리 기간(티저+본기간) 안에 있는 날짜만 탭에 표시
    const periodStart = MW_PERIODS[0].start;
    const periodEnd   = MW_PERIODS[MW_PERIODS.length - 1].end;
    const sortedDates = Object.keys(byDate).sort()
        .filter(iso => iso >= periodStart && iso <= periodEnd);
    window._mwSelectedDate = window._mwSelectedDate && sortedDates.includes(window._mwSelectedDate)
        ? window._mwSelectedDate : sortedDates[sortedDates.length - 1];

    const sel = window._mwSelectedDate;
    const today = byDate[sel];
    const dayInfo = _getMwDayLabel(sel);
    const prevIso = sortedDates[sortedDates.indexOf(sel) - 1];
    const prev = prevIso ? byDate[prevIso] : null;

    // ── 날짜 탭 ───────────────────────────────────────────────
    let dateTabs = '';
    let lastKey = null;
    sortedDates.forEach(iso => {
        const info = _getMwDayLabel(iso);
        if (info.period?.key !== lastKey) {
            lastKey = info.period?.key || null;
            if (info.period) dateTabs += `<span class="mw-period-chip" style="color:${info.period.color};border-color:${info.period.color}20;background:${info.period.color}0d">${info.badge} ${info.period.label}</span>`;
        }
        const isActive = iso === sel;
        dateTabs += `<button class="mw-date-tab${isActive?' active':''}" onclick="_mwSelectDate('${iso}')"
            style="${isActive?`border-color:${info.color};box-shadow:0 0 0 3px ${info.color}22`:''}" >
            <span class="mw-dtab-d" style="color:${info.color}">${info.label}</span>
            <span class="mw-dtab-date">${info.sub}</span>
        </button>`;
    });

    // ── 기간 판단 (전체에서 공유) ────────────────────────────
    const isTeaser = dayInfo.period?.key === 'teaser';
    const hasAtc   = today.creatives.some(c => (c.add_to_cart||0) > 0);
    const useAtc   = isTeaser && hasAtc;

    // ── 제품 × 매체 테이블 ────────────────────────────────────
    const prods = Object.entries(today.byProduct).sort((a,b) => b[1].roas - a[1].roas);
    // 전체 매체 목록
    const allPlats = [...new Set(prods.flatMap(([,p]) => Object.keys(p.byPlatform)))].sort();

    // 테이블 헤더: 티저면 ATC율 컬럼 추가
    const tableHead = `<thead><tr>
        <th class="mw-th mw-th-prod">제품</th>
        <th class="mw-th">ROAS</th>
        ${isTeaser ? `<th class="mw-th" title="Add To Cart율 (티저 핵심지표)">ATC율</th>` : ''}
        <th class="mw-th">CTR</th>
        <th class="mw-th">매출</th>
        ${allPlats.map(pl=>`<th class="mw-th mw-th-plat">${pl}</th>`).join('')}
    </tr></thead>`;

    const tableBody = prods.map(([name, p]) => {
        const platCells = allPlats.map(pl => {
            const v = p.byPlatform[pl];
            if (!v || v.roas === 0) return `<td class="mw-td mw-td-plat"><span class="text-slate-300">-</span></td>`;
            const mainMetric = isTeaser && v.atc_rate > 0
                ? `<span class="mw-cell-roas ${_atcClass(v.atc_rate)}">${_fmtAtcRate(v.atc_rate)}</span>`
                : `<span class="mw-cell-roas ${_roasClass(v.roas)}">${_fmtRoas(v.roas)}</span>`;
            return `<td class="mw-td mw-td-plat">
                ${mainMetric}
                <span class="mw-cell-ctr">${_fmtCtr(v.ctr)}</span>
            </td>`;
        }).join('');

        // 해당 제품 TOP 소재 (티저: ATC율 기준)
        const sortedP = p.creatives
            .filter(c => useAtc ? (c.add_to_cart||0)>0 : (c.roas||0)>0)
            .sort((a,b) => useAtc
                ? (b.add_to_cart||0)/(b.clicks||1) - (a.add_to_cart||0)/(a.clicks||1)
                : (b.roas||0)-(a.roas||0));
        const top = sortedP[0];
        const bot = !useAtc && sortedP.length > 1 && (sortedP[sortedP.length-1].roas||0) < 1
            ? sortedP[sortedP.length-1] : null;

        return `<tr class="mw-tr">
            <td class="mw-td mw-td-prod">
                <div class="mw-prod-name">${name}</div>
                ${top ? `<div class="mw-prod-top">🏆 ${(top.ad_name||top.creative_name||'').slice(0,20)}</div>` : ''}
                ${bot ? `<div class="mw-prod-bot">⚠️ ${(bot.ad_name||bot.creative_name||'').slice(0,20)}</div>` : ''}
            </td>
            <td class="mw-td"><span class="mw-roas-badge ${_roasClass(p.roas)}">${_fmtRoas(p.roas)}</span>${_diffBadge(p.roas, prev?.byProduct?.[name]?.roas)}</td>
            ${isTeaser ? `<td class="mw-td mw-td-num"><span class="mw-roas-badge ${_atcClass(p.atc_rate)}">${_fmtAtcRate(p.atc_rate)}</span>${_diffBadge(p.atc_rate, prev?.byProduct?.[name]?.atc_rate)}</td>` : ''}
            <td class="mw-td mw-td-num">${_fmtCtr(p.ctr)}</td>
            <td class="mw-td mw-td-num">${_fmtMoney(p.revenue)}</td>
            ${platCells}
        </tr>`;
    }).join('');

    // ── 소재 리스트 (티저: ATC율 기준 / 본기간: ROAS 기준) ─

    // 유효 소재 정렬
    const sortedC = today.creatives
        .filter(c => useAtc ? (c.add_to_cart||0) > 0 : (c.roas||0) > 0)
        .sort((a,b) => useAtc
            ? (b.add_to_cart||0)/(b.clicks||1) - (a.add_to_cart||0)/(a.clicks||1)
            : (b.roas||0) - (a.roas||0)
        );

    // ── 고효율: 제품별 최고 소재 ──────────────────────────
    const topByProd = {};
    sortedC.forEach(c => {
        const prod = (c.product||'기타').trim();
        if (!topByProd[prod]) topByProd[prod] = c;
    });
    const topRows = Object.entries(topByProd).map(([prod, c]) => {
        const rate    = useAtc ? (c.add_to_cart||0)/(c.clicks||1) : (c.roas||0);
        const metricHtml = useAtc
            ? `<span class="mw-cr-roas ${_atcClass(rate)}">${_fmtAtcRate(rate)}</span>`
            : `<span class="mw-cr-roas ${_roasClass(rate)}">${_fmtRoas(rate)}</span>`;
        return `
        <div class="mw-creative-item top">
            <span class="mw-cr-prod-badge">${prod}</span>
            <span class="mw-cr-name">${(c.ad_name||c.creative_name||'-').slice(0,28)}</span>
            ${metricHtml}
        </div>`;
    }).join('');

    // ── 저효율: 하위 3개 ──────────────────────────────────
    const worstC = useAtc
        ? today.creatives
            .filter(c => (c.add_to_cart||0) === 0 && (c.clicks||0) > 50)
            .sort((a,b) => (a.clicks||0) - (b.clicks||0))
            .slice(0, 3)
        : sortedC.filter(c=>(c.roas||0)<1).slice(-3).reverse();
    const botRows = worstC.map(c => {
        const metricHtml = useAtc
            ? `<span class="mw-cr-roas roas-bad">ATC 0%</span>`
            : `<span class="mw-cr-roas roas-bad">${_fmtRoas(c.roas||0)}</span>`;
        return `
        <div class="mw-creative-item bot">
            <span class="mw-cr-rank">⚠️</span>
            <span class="mw-cr-name">${(c.ad_name||c.creative_name||'-').slice(0,28)}</span>
            <span class="mw-cr-prod">${c.product||''}</span>
            ${metricHtml}
        </div>`;
    }).join('');

    // ── 카카오 설정 상태 ──────────────────────────────────────
    const kakaoKey    = localStorage.getItem('mw_kakao_app_key')       || '';
    const kakaoSecret = localStorage.getItem('mw_kakao_client_secret') || '';
    const kakaoToken  = localStorage.getItem('mw_kakao_refresh_token') || '';
    const kakaoTime   = localStorage.getItem('mw_kakao_send_time')     || '09:00';
    const kakaoEnabled = localStorage.getItem('mw_kakao_enabled') === '1';
    const vercelUrl = (localStorage.getItem('hf_vercel_url') || '').replace(/\/$/, '');

    const kakaoStatus = kakaoKey && kakaoToken
        ? `<span class="mw-kakao-ok">✅ 연결됨 — 매일 ${kakaoTime} 자동발송${kakaoEnabled?' 켜짐':' 꺼짐'}</span>`
        : `<span class="mw-kakao-warn">⚙️ 카카오 설정 필요</span>`;

    // AI 코멘트
    const aiComment = _genAiComment(today, prev, dayInfo, sel);

    container.innerHTML = `
    <!-- 날짜 탭 -->
    <div class="mw-date-tabs">${dateTabs}</div>

    <!-- KPI 바 -->
    <div class="mw-kpi-bar">
        <div class="mw-kpi-item">
            <div class="mw-kpi-lbl">전체 ROAS</div>
            <div class="mw-kpi-val ${_roasClass(today.roas)}">${_fmtRoas(today.roas)}</div>
            <div>${_diffBadge(today.roas, prev?.roas)}</div>
        </div>
        <div class="mw-kpi-item">
            <div class="mw-kpi-lbl">CTR</div>
            <div class="mw-kpi-val">${_fmtCtr(today.ctr)}</div>
            <div>${_diffBadge(today.ctr, prev?.ctr)}</div>
        </div>
        <div class="mw-kpi-item">
            <div class="mw-kpi-lbl">매출</div>
            <div class="mw-kpi-val">${_fmtMoney(today.revenue)}</div>
            <div class="mw-kpi-unit">원</div>
        </div>
        <div class="mw-kpi-item">
            <div class="mw-kpi-lbl">지출</div>
            <div class="mw-kpi-val">${_fmtMoney(today.spend)}</div>
            <div class="mw-kpi-unit">원</div>
        </div>
    </div>

    <!-- AI 코멘트 -->
    <div class="mw-ai-box">
        <div class="mw-ai-hd"><i class="fas fa-robot"></i> AI 코멘트</div>
        <div class="mw-ai-body">${aiComment.replace(/\n/g,'<br>')}</div>
    </div>

    <!-- 제품 × 매체 테이블 -->
    <div class="mw-section-hd">📦 제품별 성과 (매체 교차)</div>
    <div class="mw-table-wrap">
        <table class="mw-table"><${tableHead}<tbody>${tableBody}</tbody></table>
    </div>

    <!-- 소재 리스트 -->
    <div class="mw-two-col">
        <div>
            <div class="mw-section-hd">
                🏆 고효율 소재 (제품별)
                <span class="mw-metric-badge ${useAtc?'atc':'roas'}">${useAtc?'ATC율 기준':'ROAS 기준'}</span>
            </div>
            <div class="mw-creative-list">${topRows||'<p class="mw-no-data">데이터 없음</p>'}</div>
        </div>
        <div>
            <div class="mw-section-hd">
                ⚠️ 저효율 소재
                <span class="mw-metric-badge ${useAtc?'atc':'roas'}">${useAtc?'ATC 미발생':'ROAS 기준'}</span>
            </div>
            <div class="mw-creative-list">${botRows||'<p class="mw-no-data">없음 👍</p>'}</div>
        </div>
    </div>

    <!-- 카카오 자동발송 설정 -->
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
                        <button class="mw-kakao-btn kakao-yellow" onclick="_mwKakaoLogin()">
                            카카오 로그인
                        </button>
                        ${kakaoToken ? `<span class="text-xs text-emerald-600 self-center">✅ 토큰 저장됨</span>` : ''}
                    </div>
                    ${kakaoToken ? `<p class="text-xs text-slate-500">Refresh Token (Vercel 환경변수 <code>KAKAO_REFRESH_TOKEN</code>에도 등록):</p>
                    <input type="text" class="mw-kakao-input w-full mt-1" value="${kakaoToken}" readonly onclick="this.select()">` : ''}
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
                    ${vercelUrl ? `<p class="text-xs text-slate-400 mt-2">Vercel Cron 엔드포인트: <code>${vercelUrl}/api/megawari-cron</code></p>` : '<p class="text-xs text-amber-600 mt-2">⚠️ Vercel URL이 설정되어야 자동발송이 작동합니다 (광고 생성 탭에서 설정)</p>'}
                </div>
            </div>
        </div>
    </details>

    <!-- 하단 버튼 -->
    <div class="mw-share-bar">
        <button class="mw-btn-copy" onclick="_mwCopyReport()">
            <i class="fas fa-copy mr-1.5"></i>리포트 복사
        </button>
        <button class="mw-btn-kakao" onclick="_mwSendNow()">
            <i class="fas fa-comment mr-1.5"></i>카카오 전송
        </button>
    </div>`;
}

// ── 날짜 선택 ─────────────────────────────────────────────────
function _mwSelectDate(iso) {
    window._mwSelectedDate = iso;
    renderMegawariPanel();
    setTimeout(() => document.querySelector('.mw-date-tab.active')?.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'}), 50);
}
window._mwSelectDate = _mwSelectDate;

// ── 리포트 텍스트 가져오기 ────────────────────────────────────
function _mwGetReportText() {
    const byDate = _aggregateMw(_getMwData());
    return buildReportText(window._mwSelectedDate || Object.keys(byDate).sort().pop(), byDate);
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
    const vercelBase = (localStorage.getItem('hf_vercel_url') || '').replace(/\/$/, '');
    const refreshToken = localStorage.getItem('mw_kakao_refresh_token') || '';
    const appKey = localStorage.getItem('mw_kakao_app_key') || '';

    if (!vercelBase || !refreshToken || !appKey) {
        // fallback: Web Share API
        if (navigator.share) { await navigator.share({ text }); return; }
        await navigator.clipboard.writeText(text);
        alert('리포트가 클립보드에 복사됐어요!\n카카오톡에 붙여넣기 해주세요.');
        return;
    }

    const clientSecret = localStorage.getItem('mw_kakao_client_secret') || '';
    const res = await fetch(`${vercelBase}/api/kakao-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, refresh_token: refreshToken, app_key: appKey, client_secret: clientSecret }),
    });
    const data = await res.json();
    if (res.ok) {
        alert('✅ 카카오톡으로 전송됐어요!');
    } else {
        alert(`❌ 전송 실패: ${data.error || res.status}\n클립보드에 복사합니다.`);
        await navigator.clipboard.writeText(text);
    }
}

function _mwSendNow() { _mwSendViaKakao(_mwGetReportText()); }
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
