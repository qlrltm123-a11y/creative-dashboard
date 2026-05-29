// ============================
// Megawari 일일 성과 리포트
// ============================

// ── 유틸 ──────────────────────────────────────────────────────
function _fmtRoas(v) { return v > 0 ? `${Math.round(v * 100)}%` : '-'; }
function _fmtCtr(v)  { return v > 0 ? `${(v * 100).toFixed(2)}%` : '-'; }
function _fmtMoney(v, unit) {
    if (!v || v === 0) return '-';
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M${unit||''}`;
    if (Math.abs(v) >= 10_000)    return `${Math.round(v / 1_000)}K${unit||''}`;
    return `${Math.round(v).toLocaleString()}${unit||''}`;
}
function _arrow(curr, prev) {
    if (!prev || !curr) return '';
    const diff = ((curr - prev) / Math.abs(prev)) * 100;
    if (diff > 3)  return `📈+${Math.round(diff)}%`;
    if (diff < -3) return `📉${Math.round(diff)}%`;
    return '➡️';
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

        if (!byDate[iso]) {
            byDate[iso] = {
                iso,
                spend: 0, revenue: 0, impressions: 0, clicks: 0,
                byProduct: {}, byPlatform: {},
                creatives: [],
            };
        }
        const d = byDate[iso];
        d.spend       += c.spend       || 0;
        d.revenue     += c.revenue     || 0;
        d.impressions += c.impressions || 0;
        d.clicks      += c.clicks      || 0;
        d.creatives.push(c);

        const prod = (c.product || '기타').trim();
        const plat = (c.platform || '기타').trim();

        if (!d.byProduct[prod]) d.byProduct[prod] = { spend:0, revenue:0, impressions:0, clicks:0, creatives:[], byPlatform:{} };
        const dp = d.byProduct[prod];
        dp.spend += c.spend || 0; dp.revenue += c.revenue || 0;
        dp.impressions += c.impressions || 0; dp.clicks += c.clicks || 0;
        dp.creatives.push(c);

        if (!dp.byPlatform[plat]) dp.byPlatform[plat] = { spend:0, revenue:0, impressions:0, clicks:0 };
        dp.byPlatform[plat].spend += c.spend || 0;
        dp.byPlatform[plat].revenue += c.revenue || 0;
        dp.byPlatform[plat].impressions += c.impressions || 0;
        dp.byPlatform[plat].clicks += c.clicks || 0;

        if (!d.byPlatform[plat]) d.byPlatform[plat] = { spend:0, revenue:0, impressions:0, clicks:0 };
        d.byPlatform[plat].spend += c.spend || 0;
        d.byPlatform[plat].revenue += c.revenue || 0;
        d.byPlatform[plat].impressions += c.impressions || 0;
        d.byPlatform[plat].clicks += c.clicks || 0;
    });

    // ROAS / CTR 파생
    const calc = obj => {
        obj.roas = obj.spend > 0 ? obj.revenue / obj.spend : 0;
        obj.ctr  = obj.impressions > 0 ? obj.clicks / obj.impressions : 0;
    };
    Object.values(byDate).forEach(d => {
        calc(d);
        Object.values(d.byProduct).forEach(p => { calc(p); Object.values(p.byPlatform).forEach(calc); });
        Object.values(d.byPlatform).forEach(calc);
    });

    return byDate;
}

// ── AI 코멘트 (rule-based) ────────────────────────────────────
function _genAiComment(today, yesterday, dayN) {
    const lines = [];

    // ROAS 추세
    if (yesterday) {
        const roasDiff = (today.roas - yesterday.roas) / (yesterday.roas || 1) * 100;
        if (roasDiff >= 10)       lines.push(`✅ ${dayN}일차 ROAS ${Math.round(roasDiff)}% 상승. 이벤트 모멘텀 살아있음.`);
        else if (roasDiff >= 0)   lines.push(`➡️ ROAS 전일 대비 소폭 유지 (${Math.round(roasDiff)}%)`);
        else if (roasDiff >= -10) lines.push(`⚠️ ROAS 전일 대비 ${Math.abs(Math.round(roasDiff))}% 하락. 소재 피로도 확인 권장.`);
        else                      lines.push(`🔴 ROAS 급락 (${Math.round(roasDiff)}%). 소재·예산 즉시 점검 필요.`);
    }

    // 최고/최저 제품
    const prods = Object.entries(today.byProduct).sort((a,b) => b[1].roas - a[1].roas);
    if (prods.length > 0) {
        const best = prods[0];
        lines.push(`🏆 오늘의 주력 제품: ${best[0]} (ROAS ${_fmtRoas(best[1].roas)})`);
        if (prods.length > 1) {
            const worst = prods[prods.length - 1];
            if (worst[1].roas < 1) lines.push(`⚠️ ${worst[0]} ROAS ${_fmtRoas(worst[1].roas)} — 예산 조정 검토.`);
        }
    }

    // 매체 추천
    const plats = Object.entries(today.byPlatform).sort((a,b) => b[1].roas - a[1].roas);
    if (plats.length > 0) {
        const bestPlat = plats[0];
        if (bestPlat[1].roas > 2) {
            lines.push(`📱 ${bestPlat[0]} 효율 최고 (ROAS ${_fmtRoas(bestPlat[1].roas)}) — 예산 집중 권장.`);
        }
        if (plats.length > 1) {
            const worstPlat = plats[plats.length-1];
            if (worstPlat[1].ctr < 0.01) {
                lines.push(`📉 ${worstPlat[0]} CTR ${_fmtCtr(worstPlat[1].ctr)} — 크리에이티브 교체 검토.`);
            }
        }
    }

    // 이벤트 후반부 코멘트
    if (dayN >= 7) lines.push(`📅 이벤트 ${dayN}일차. 후반 피로도 대비 소재 리프레시 권장.`);
    if (dayN <= 2) lines.push(`🚀 이벤트 초반. 성과 데이터 축적 중.`);

    return lines.join('\n');
}

// ── 리포트 텍스트 포맷 ───────────────────────────────────────
function buildReportText(dateIso, byDate, startIso) {
    const today = byDate[dateIso];
    if (!today) return '해당 날짜 데이터 없음';

    const sortedDates = Object.keys(byDate).sort();
    const prevIso = sortedDates[sortedDates.indexOf(dateIso) - 1];
    const yesterday = prevIso ? byDate[prevIso] : null;

    const dayN = sortedDates.indexOf(dateIso) + 1;
    const dateLabel = dateIso.replace(/-/g, '.');
    const brand = (typeof currentBrand !== 'undefined' && currentBrand !== 'ALL') ? currentBrand : '전체';
    const eventLabel = _getMwData()[0]?.event || 'Megawari';

    // 헤더
    let txt = `📊 [${brand}] ${eventLabel} D+${dayN} 성과 리포트\n`;
    txt    += `📅 ${dateLabel}\n`;
    txt    += `${'─'.repeat(24)}\n`;

    // 전체 KPI
    txt += `🏆 전체 성과\n`;
    txt += `• ROAS: ${_fmtRoas(today.roas)} ${yesterday ? _arrow(today.roas, yesterday.roas) : ''}\n`;
    txt += `• CTR: ${_fmtCtr(today.ctr)} ${yesterday ? _arrow(today.ctr, yesterday.ctr) : ''}\n`;
    txt += `• 매출: ${_fmtMoney(today.revenue, '원')}\n`;
    txt += `• 지출: ${_fmtMoney(today.spend, '원')}\n`;
    txt += `\n`;

    // 제품별
    const products = Object.entries(today.byProduct).sort((a,b) => b[1].roas - a[1].roas);
    if (products.length > 0) {
        txt += `📦 제품별 성과\n`;
        products.forEach(([name, p]) => {
            txt += `[${name}] ROAS ${_fmtRoas(p.roas)} / CTR ${_fmtCtr(p.ctr)}\n`;
            const plats = Object.entries(p.byPlatform).sort((a,b) => b[1].roas - a[1].roas);
            plats.forEach(([pl, v]) => {
                txt += `  • ${pl}: ROAS ${_fmtRoas(v.roas)} / CTR ${_fmtCtr(v.ctr)}\n`;
            });
        });
        txt += `\n`;
    }

    // 고효율 소재 TOP3
    const allCreatives = today.creatives
        .filter(c => (c.roas || 0) > 0)
        .sort((a,b) => (b.roas||0) - (a.roas||0));
    if (allCreatives.length > 0) {
        txt += `🎯 고효율 소재 TOP3\n`;
        allCreatives.slice(0, 3).forEach((c, i) => {
            const name = c.ad_name || c.creative_name || '소재명없음';
            txt += `${i+1}위. ${name} (ROAS ${_fmtRoas(c.roas || 0)})\n`;
        });
        txt += `\n`;
    }

    // 저효율 소재
    const bottom = allCreatives.filter(c => (c.roas || 0) < 1).slice(-3).reverse();
    if (bottom.length > 0) {
        txt += `⚠️ 저효율 소재 (ROAS 100% 미만)\n`;
        bottom.forEach(c => {
            const name = c.ad_name || c.creative_name || '소재명없음';
            txt += `• ${name} (ROAS ${_fmtRoas(c.roas || 0)})\n`;
        });
        txt += `\n`;
    }

    // AI 코멘트
    const comment = _genAiComment(today, yesterday, dayN);
    if (comment) {
        txt += `💡 AI 코멘트\n${comment}\n`;
    }

    txt += `\n${'-'.repeat(20)}\n`;
    txt += `📲 Creative Dashboard`;

    return txt;
}

// ── 패널 렌더 ─────────────────────────────────────────────────
function renderMegawariPanel() {
    const container = document.getElementById('megawari-panel-body');
    if (!container) return;

    const mwData = _getMwData();
    if (!mwData.length) {
        container.innerHTML = `
        <div class="mw-empty">
            <i class="fas fa-calendar-xmark text-3xl text-slate-300 mb-2"></i>
            <p class="font-semibold text-slate-500">Megawari 이벤트 데이터가 없어요</p>
            <p class="text-xs text-slate-400 mt-1">이벤트 필터에 "megawari" 항목이 있는 데이터를 불러와주세요</p>
        </div>`;
        return;
    }

    const byDate = _aggregateMw(mwData);
    const sortedDates = Object.keys(byDate).sort();
    const startIso = sortedDates[0];
    const latestIso = sortedDates[sortedDates.length - 1];

    // 선택된 날짜 (state)
    window._mwSelectedDate = window._mwSelectedDate || latestIso;
    if (!byDate[window._mwSelectedDate]) window._mwSelectedDate = latestIso;

    const selected = window._mwSelectedDate;
    const today = byDate[selected];
    const dayN = sortedDates.indexOf(selected) + 1;
    const brand = (typeof currentBrand !== 'undefined' && currentBrand !== 'ALL') ? currentBrand : '전체';

    // 날짜 탭
    const dateTabs = sortedDates.map((iso, i) => {
        const isActive = iso === selected;
        const label = iso.slice(5).replace('-', '/');
        return `<button class="mw-date-tab ${isActive ? 'active' : ''}" data-iso="${iso}" onclick="_mwSelectDate('${iso}')">
            <span class="mw-date-tab-day">D+${i+1}</span>
            <span class="mw-date-tab-date">${label}</span>
        </button>`;
    }).join('');

    // 제품별 카드
    const products = Object.entries(today.byProduct).sort((a,b) => b[1].roas - a[1].roas);
    const productCards = products.map(([name, p]) => {
        const platRows = Object.entries(p.byPlatform).sort((a,b) => b[1].roas - a[1].roas).map(([pl, v]) =>
            `<div class="mw-plat-row">
                <span class="mw-plat-name">${pl}</span>
                <span class="mw-plat-roas">${_fmtRoas(v.roas)}</span>
                <span class="mw-plat-ctr">${_fmtCtr(v.ctr)}</span>
            </div>`
        ).join('');

        // 해당 제품 TOP/WORST 소재
        const sorted = p.creatives.filter(c => (c.roas || 0) > 0).sort((a,b) => (b.roas||0) - (a.roas||0));
        const topCreative  = sorted[0];
        const worstCreative = sorted[sorted.length - 1];

        return `<div class="mw-product-card">
            <div class="mw-product-header">
                <span class="mw-product-name">📦 ${name}</span>
                <span class="mw-product-roas">${_fmtRoas(p.roas)}</span>
            </div>
            <div class="mw-product-ctr">CTR ${_fmtCtr(p.ctr)} · 매출 ${_fmtMoney(p.revenue,'원')}</div>
            ${platRows ? `<div class="mw-plat-table">${platRows}</div>` : ''}
            ${topCreative ? `<div class="mw-creative-row top">🏆 <b>${topCreative.ad_name || topCreative.creative_name || '-'}</b> ROAS ${_fmtRoas(topCreative.roas)}</div>` : ''}
            ${worstCreative && worstCreative !== topCreative && (worstCreative.roas||0) < 1 ? `<div class="mw-creative-row worst">⚠️ <b>${worstCreative.ad_name || worstCreative.creative_name || '-'}</b> ROAS ${_fmtRoas(worstCreative.roas)}</div>` : ''}
        </div>`;
    }).join('');

    // 전체 KPI 바
    const prevIso = sortedDates[sortedDates.indexOf(selected) - 1];
    const prev = prevIso ? byDate[prevIso] : null;

    function kpiDiff(curr, pr, field) {
        if (!pr) return '';
        const diff = ((curr[field] - pr[field]) / (Math.abs(pr[field]) || 1)) * 100;
        if (diff > 3)  return `<span class="mw-kpi-up">▲${Math.abs(Math.round(diff))}%</span>`;
        if (diff < -3) return `<span class="mw-kpi-down">▼${Math.abs(Math.round(diff))}%</span>`;
        return `<span class="mw-kpi-flat">→</span>`;
    }

    // AI 코멘트
    const aiComment = _genAiComment(today, prev, dayN);

    container.innerHTML = `
    <!-- 날짜 탭 -->
    <div class="mw-date-tabs" id="mw-date-tabs">${dateTabs}</div>

    <!-- 전체 KPI -->
    <div class="mw-kpi-bar">
        <div class="mw-kpi-item">
            <div class="mw-kpi-label">ROAS</div>
            <div class="mw-kpi-value">${_fmtRoas(today.roas)}</div>
            <div>${kpiDiff(today, prev, 'roas')}</div>
        </div>
        <div class="mw-kpi-item">
            <div class="mw-kpi-label">CTR</div>
            <div class="mw-kpi-value">${_fmtCtr(today.ctr)}</div>
            <div>${kpiDiff(today, prev, 'ctr')}</div>
        </div>
        <div class="mw-kpi-item">
            <div class="mw-kpi-label">매출</div>
            <div class="mw-kpi-value">${_fmtMoney(today.revenue)}</div>
            <div class="mw-kpi-sub">원</div>
        </div>
        <div class="mw-kpi-item">
            <div class="mw-kpi-label">지출</div>
            <div class="mw-kpi-value">${_fmtMoney(today.spend)}</div>
            <div class="mw-kpi-sub">원</div>
        </div>
    </div>

    <!-- AI 코멘트 -->
    <div class="mw-ai-comment">
        <div class="mw-ai-label"><i class="fas fa-robot mr-1.5"></i>AI 코멘트</div>
        <div class="mw-ai-text">${aiComment.replace(/\n/g, '<br>')}</div>
    </div>

    <!-- 제품별 -->
    <div class="mw-section-title">📦 제품별 성과</div>
    <div class="mw-product-grid">${productCards || '<p class="text-sm text-slate-400 p-3">제품 데이터 없음</p>'}</div>

    <!-- 공유 버튼 -->
    <div class="mw-share-bar">
        <button class="mw-btn-copy" onclick="_mwCopyReport()">
            <i class="fas fa-copy mr-1.5"></i>리포트 복사
        </button>
        <button class="mw-btn-kakao" onclick="_mwShareKakao()">
            <img src="https://developers.kakao.com/assets/img/about/logos/kakaolink/kakaolink_btn_medium.png"
                 style="width:20px;height:20px;object-fit:contain;vertical-align:middle;margin-right:6px" alt=""> 카카오톡 공유
        </button>
    </div>
    `;
}

// ── 날짜 선택 ──────────────────────────────────────────────────
function _mwSelectDate(iso) {
    window._mwSelectedDate = iso;
    renderMegawariPanel();
    // 탭 스크롤
    setTimeout(() => {
        const active = document.querySelector('.mw-date-tab.active');
        active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }, 50);
}
window._mwSelectDate = _mwSelectDate;

// ── 리포트 복사 ───────────────────────────────────────────────
function _mwCopyReport() {
    const mwData = _getMwData();
    const byDate = _aggregateMw(mwData);
    const text = buildReportText(window._mwSelectedDate, byDate, Object.keys(byDate).sort()[0]);

    navigator.clipboard.writeText(text).then(() => {
        const btn = document.querySelector('.mw-btn-copy');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check mr-1.5"></i>복사됨!';
            btn.style.background = '#059669';
            setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; }, 2000);
        }
    });
}
window._mwCopyReport = _mwCopyReport;

// ── 카카오톡 공유 (Web Share API → 카카오 앱 선택 가능) ────────
function _mwShareKakao() {
    const mwData = _getMwData();
    const byDate = _aggregateMw(mwData);
    const text = buildReportText(window._mwSelectedDate, byDate, Object.keys(byDate).sort()[0]);

    // Web Share API (모바일 브라우저에서 카카오톡 선택 가능)
    if (navigator.share) {
        navigator.share({ text })
            .catch(e => { if (e.name !== 'AbortError') _mwCopyReport(); });
        return;
    }

    // 데스크탑 fallback: 클립보드 복사 후 안내
    navigator.clipboard.writeText(text).then(() => {
        alert('리포트가 클립보드에 복사됐어요!\n카카오톡 채팅창에 붙여넣기(Ctrl+V)해주세요.');
    });
}
window._mwShareKakao = _mwShareKakao;

// 전역 노출
window.renderMegawariPanel = renderMegawariPanel;
