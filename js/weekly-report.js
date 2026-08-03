// ============================================================
//  주간 업무 보고서 (Weekly Work Report)  ── weekly-report.js
// ============================================================

/* ── 필터 상태 (window 노출 — HTML onchange에서 접근) ── */
window._wr = { product: '', event: '', dateFrom: '', dateTo: '' };
let _wr = window._wr;

/* ── 필터 localStorage 저장/복원 ── */
const _WR_LS_KEY = 'wr_filter_v1';

function _wrSaveFilter() {
    try { localStorage.setItem(_WR_LS_KEY, JSON.stringify({
        product:  _wr.product,
        event:    _wr.event,
        dateFrom: _wr.dateFrom,
        dateTo:   _wr.dateTo,
    })); } catch(e) {}
}

function _wrLoadFilter() {
    try {
        const saved = JSON.parse(localStorage.getItem(_WR_LS_KEY) || 'null');
        if (!saved) return;
        _wr.product  = saved.product  || '';
        _wr.event    = saved.event    || '';
        _wr.dateFrom = saved.dateFrom || '';
        _wr.dateTo   = saved.dateTo   || '';
    } catch(e) {}
}

// 초기 로드 시 저장된 필터 복원 (없으면 전체 기간)
_wrLoadFilter();

/* ── 날짜 퀵셋 (0=이번주, -1=저번주) ── */
window._wrSetWeek = function(offset) {
    const now = new Date();
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - ((day + 6) % 7) + offset * 7);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt = d => d.toISOString().slice(0, 10);
    _wr.dateFrom = fmt(mon);
    _wr.dateTo   = fmt(sun);
    const fe = document.getElementById('wr-date-from');
    const te = document.getElementById('wr-date-to');
    if (fe) fe.value = _wr.dateFrom;
    if (te) te.value = _wr.dateTo;
    renderWeeklyReport();
};

/* ── 날짜 필터 전체 해제 ── */
window._wrClearDates = function() {
    _wr.dateFrom = '';
    _wr.dateTo   = '';
    const fe = document.getElementById('wr-date-from');
    const te = document.getElementById('wr-date-to');
    if (fe) fe.value = '';
    if (te) te.value = '';
    renderWeeklyReport();
};

/* ── 브랜드 필터 적용된 기본 목록 (main.js getBrandCreatives 미러) ── */
function _wrBrandList() {
    const brand = (typeof window.getCurrentBrand === 'function' ? window.getCurrentBrand() : null) || 'ALL';
    const all   = window.allCreatives || [];
    return brand === 'ALL' ? all : all.filter(c => c.brand === brand);
}

/* ── 필터 적용 데이터 ── */
function _wrGetList() {
    let list = _wrBrandList();
    if (_wr.product) list = list.filter(c => (c.product || '').trim() === _wr.product);
    if (_wr.event)   list = list.filter(c => (c.event   || '').trim() === _wr.event);
    if (_wr.dateFrom || _wr.dateTo) {
        list = list.filter(c => {
            const d = (c.start_date || '').slice(0, 10);
            if (!d) return true;
            if (_wr.dateFrom && d < _wr.dateFrom) return false;
            if (_wr.dateTo   && d > _wr.dateTo)   return false;
            return true;
        });
    }
    return list;
}

/* ── KPI 집계 ── */
function _wrSum(list) {
    let spend=0, impr=0, clicks=0, rev=0, conv=0, atc=0;
    list.forEach(c => {
        spend  += c.spend        || 0;
        impr   += c.impressions  || 0;
        clicks += c.clicks       || 0;
        rev    += c.revenue      || 0;
        conv   += c.conversions  || 0;
        atc    += c.add_to_cart  || 0;
    });
    return {
        spend, impr, clicks, rev, conv, atc,
        ctr:  impr  > 0 ? clicks / impr  : 0,
        roas: spend > 0 ? rev    / spend  : 0,
        cpa:  conv  > 0 ? spend  / conv   : 0,
    };
}

/* ── 제품별 집계 (매체별과 동일한 형식의 단순 합계표) ── */
function _wrByProduct(list) {
    const m = {};
    list.forEach(c => {
        const p = (c.product || '기타').trim() || '기타';
        if (!m[p]) m[p] = {spend:0,impr:0,clicks:0,rev:0,conv:0};
        m[p].spend  += c.spend       || 0;
        m[p].impr   += c.impressions || 0;
        m[p].clicks += c.clicks      || 0;
        m[p].rev    += c.revenue     || 0;
        m[p].conv   += c.conversions || 0;
    });
    return Object.entries(m).map(([p, d]) => ({
        product: p, ...d,
        ctr:  d.impr  > 0 ? d.clicks / d.impr  : 0,
        roas: d.spend > 0 ? d.rev    / d.spend  : 0,
    })).sort((a, b) => b.spend - a.spend);
}

/* ── 매체별 집계 ── */
function _wrByPlatform(list) {
    const m = {};
    list.forEach(c => {
        const p = c.platform || '기타';
        if (!m[p]) m[p] = {spend:0,impr:0,clicks:0,rev:0,conv:0};
        m[p].spend  += c.spend       || 0;
        m[p].impr   += c.impressions || 0;
        m[p].clicks += c.clicks      || 0;
        m[p].rev    += c.revenue     || 0;
        m[p].conv   += c.conversions || 0;
    });
    return Object.entries(m).map(([p, d]) => ({
        platform: p, ...d,
        ctr:  d.impr  > 0 ? d.clicks / d.impr  : 0,
        roas: d.spend > 0 ? d.rev    / d.spend  : 0,
    })).sort((a, b) => b.spend - a.spend);
}

/* ── Drive URL → img HTML 헬퍼 (fallback 체인 포함) ── */
function _wrThumbHtml(url, className, fallbackHtml) {
    const fb = fallbackHtml || `<div class="${className}-fallback" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:18px"><i class="fas fa-image"></i></div>`;
    if (!url) return fb;
    if (typeof window.buildDriveImgHtml === 'function') {
        return window.buildDriveImgHtml(url, { className, loading: 'lazy', finalFallbackHtml: fb });
    }
    return `<img class="${className}" src="${url}" loading="lazy" onerror="this.outerHTML='${fb.replace(/'/g, "\\'")}'">`;
}

/* ── 소재명 정규화 키 (대소문자·공백·특수공백 무시) ── */
function _wrCreativeKey(c) {
    return (c.ad_name || c.creative_name || String(c.id || ''))
        .trim().replace(/\s+/g, ' ').toLowerCase();
}

/* ── 캐치카피 정규화 키 (구두점·전각/반각·공백 제거 → 유사 문구 통합) ──
   예) "綺麗な肌へ！" ≡ "綺麗な肌へ"  /  "SALE 50%OFF" ≡ "sale 50% off"  */
function _wrCopyKey(text) {
    return text
        .toLowerCase()
        // 전각→반각 숫자·알파벳
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        // 구두점·기호·특수문자 제거 (일본어 포함)
        .replace(/[！!？?。、，,・\.…‥「」『』【】〜~＊*◆▶→←↑↓【】《》〈〉#＃@＠\/／\\｜|]/g, '')
        // 공백 정규화
        .replace(/[\s　　]+/g, ' ')
        .trim();
}

/* ── 소재별 집계 ── */
function _wrByCreative(list) {
    const m = {};
    list.forEach(c => {
        const key = _wrCreativeKey(c);
        if (!key) return;
        if (!m[key]) m[key] = {
            name:     c.ad_name || c.creative_name || key,
            thumb:    c.thumbnail_url || c.media_url || '',
            platforms: new Set(),       // 매체 복수 대응
            product:  c.product  || '',
            spend:0, impr:0, clicks:0, rev:0, conv:0,
        };
        if (c.platform) m[key].platforms.add(c.platform);
        // 썸네일 있으면 덮어씌우기 (집계 중 첫 번째 있는 것 사용)
        if (!m[key].thumb && (c.thumbnail_url || c.media_url)) {
            m[key].thumb = c.thumbnail_url || c.media_url;
        }
        m[key].spend  += c.spend       || 0;
        m[key].impr   += c.impressions || 0;
        m[key].clicks += c.clicks      || 0;
        m[key].rev    += c.revenue     || 0;
        m[key].conv   += c.conversions || 0;
    });
    return Object.values(m).map(d => ({
        ...d,
        platform: [...d.platforms].join(' · '),
        ctr:  d.impr  > 0 ? d.clicks / d.impr  : 0,
        roas: d.spend > 0 ? d.rev    / d.spend  : 0,
    })).sort((a, b) => _wrSortFn()(b) - _wrSortFn()(a)).slice(0, 30);
}

// 종합 스코어: 광고효율(ROAS) × 매출 × 광고비 가중
// = 효율이 좋으면서, 매출 규모가 크고, 광고비도 충분히 집행해 검증된 소재가 상위.
//   매출·광고비는 log 가중 — 소액 편차가 순위를 과하게 흔들지 않게.
//   (광고비 가중 0.3 < 매출 가중 0.5: 광고비는 매출과 상관이 커서 중복 반영을 낮춤)
function _wrEffScore(d) {
    return (d.roas || 0)
        * (1 + Math.log10(1 + (d.rev   || 0) / 10000) * 0.5)
        * (1 + Math.log10(1 + (d.spend || 0) / 10000) * 0.3);
}

// ── TOP 소재 정렬 기준 (사용자 선택, '잘된 광고 TOP'과 '고효율 TOP 5' 공통) ──
const _WR_SORTS = {
    score: { label: '종합 (ROAS×매출×광고비)', fn: d => _wrEffScore(d) },
    roas:  { label: '광고효율(ROAS)',          fn: d => d.roas  || 0 },
    rev:   { label: '매출',                    fn: d => d.rev   || 0 },
    spend: { label: '광고비',                  fn: d => d.spend || 0 },
    conv:  { label: '구매수',                  fn: d => d.conv  || 0 },
    ctr:   { label: '클릭률(CTR)',             fn: d => d.ctr   || 0 },
};
let _wrCreativeSort = localStorage.getItem('wr_creative_sort') || 'score';
if (!_WR_SORTS[_wrCreativeSort]) _wrCreativeSort = 'score';
window._wrSetCreativeSort = v => {
    _wrCreativeSort = _WR_SORTS[v] ? v : 'score';
    localStorage.setItem('wr_creative_sort', _wrCreativeSort);
    _wrInvalidateCache();
    renderWeeklyReport();
};
const _wrSortFn    = () => _WR_SORTS[_wrCreativeSort].fn;
const _wrSortLabel = () => _WR_SORTS[_wrCreativeSort].label;

// 제품별 '고효율 TOP 5 소재' 전용 정렬 기준 (잘된 광고 TOP과 독립)
let _wrTop5Sort = localStorage.getItem('wr_top5_sort') || 'score';
if (!_WR_SORTS[_wrTop5Sort]) _wrTop5Sort = 'score';
window._wrSetTop5Sort = v => {
    _wrTop5Sort = _WR_SORTS[v] ? v : 'score';
    localStorage.setItem('wr_top5_sort', _wrTop5Sort);
    _wrInvalidateCache();
    renderWeeklyReport();
};
const _wrTop5SortFn    = () => _WR_SORTS[_wrTop5Sort].fn;
const _wrTop5SortLabel = () => _WR_SORTS[_wrTop5Sort].label;
// 정렬 셀렉트 공통 마크업
function _wrSortSelectHtml(current, setter, ariaLabel) {
    return `<select class="wr-select" style="font-size:11px;padding:4px 8px" onchange="${setter}(this.value)" aria-label="${ariaLabel}">
        ${Object.entries(_WR_SORTS).map(([k, s]) =>
            `<option value="${k}"${k === current ? ' selected' : ''}>${s.label}</option>`).join('')}
    </select>`;
}

/* ── 포맷 헬퍼 ── */
function _wrN(n)  { return Math.round(n).toLocaleString('ko-KR'); }
function _wrW(n)  { return '₩' + _wrN(n); }
function _wrP(r)  { return (r * 100).toFixed(2) + '%'; }
function _wrR(r)  { return (r * 100).toFixed(0) + '%'; }

/* ── 필터 select 옵션 채우기 (이벤트 ↔ 제품 연동 필터링) ── */
function _wrPopulateSelects() {
    // 브랜드 필터 먼저 적용 → 드롭다운에도 현재 브랜드 데이터만 표시
    const list = _wrBrandList();

    // 이벤트 선택 시 → 해당 이벤트에 속한 제품만 표시
    const forProducts = _wr.event
        ? list.filter(c => (c.event || '').trim() === _wr.event)
        : list;
    const products = [...new Set(forProducts.map(c => c.product).filter(Boolean))].sort();

    // 제품 선택 시 → 해당 제품에 속한 이벤트만 표시
    const forEvents = _wr.product
        ? list.filter(c => (c.product || '').trim() === _wr.product)
        : list;
    const events = [...new Set(forEvents.map(c => c.event).filter(Boolean))].sort();

    const pe = document.getElementById('wr-product-sel');
    const ee = document.getElementById('wr-event-sel');
    if (pe) {
        const cur = _wr.product;
        pe.innerHTML = '<option value="">전체 제품</option>' +
            products.map(p => `<option value="${p}"${p===cur?' selected':''}>${p}</option>`).join('');
        // 선택된 제품이 새 목록에 없으면 리셋
        if (cur && !products.includes(cur)) { _wr.product = ''; pe.value = ''; }
    }
    if (ee) {
        const cur = _wr.event;
        ee.innerHTML = '<option value="">전체 이벤트</option>' +
            events.map(e => `<option value="${e}"${e===cur?' selected':''}>${e}</option>`).join('');
    }
}

/* ── 플랫폼 색상 ── */
const _WR_PLAT_COLOR = {
    Meta: '#1877f2', Google: '#ea4335', Tiktok: '#000000', TikTok: '#000000',
    Naver: '#03c75a', Kakao: '#fee500', X: '#1da1f2',
};
function _wrPlatColor(p) { return _WR_PLAT_COLOR[p] || '#6366f1'; }

/* ── KPI 섹션 HTML ── */
function _wrKpiSectionHtml(kpi, count) {
    const cards = [
        { lbl:'광고비',   val: _wrW(kpi.spend),   icon:'fa-won-sign',      color:'#ef4444' },
        { lbl:'노출 수',  val: _wrN(kpi.impr),    icon:'fa-eye',           color:'#6366f1' },
        { lbl:'클릭 수',  val: _wrN(kpi.clicks),  icon:'fa-mouse-pointer', color:'#3b82f6' },
        { lbl:'클릭률(CTR)',     val: _wrP(kpi.ctr),     icon:'fa-percentage',    color:'#06b6d4' },
        { lbl:'매출',            val: _wrW(kpi.rev),     icon:'fa-chart-line',    color:'#10b981' },
        { lbl:'광고효율(ROAS)',  val: _wrR(kpi.roas),    icon:'fa-bullseye',      color:'#f97316' },
        { lbl:'구매 건수',       val: _wrN(kpi.conv),    icon:'fa-check-circle',  color:'#8b5cf6' },
        { lbl:'소재 수',  val: count + '개',       icon:'fa-image',         color:'#64748b' },
    ];
    return `
    <div class="wr-section" id="wr-kpi-section">
        <div class="wr-section-hd">
            <span><i class="fas fa-chart-bar mr-1.5" style="color:#6366f1"></i>핵심 지표 요약</span>
            <button class="wr-copy-btn" onclick="window._wrCopySection('kpi', this)">
                <i class="fas fa-copy mr-1"></i>복사
            </button>
        </div>
        <div class="wr-kpi-grid">
            ${cards.map(c => `
            <div class="wr-kpi-card">
                <div class="wr-kpi-icon" style="color:${c.color}"><i class="fas ${c.icon}"></i></div>
                <div class="wr-kpi-lbl">${c.lbl}</div>
                <div class="wr-kpi-val">${c.val}</div>
            </div>`).join('')}
        </div>
    </div>`;
}

/* ── 매체별 섹션 HTML ── */
function _wrPlatformSectionHtml(byPlatform) {
    if (!byPlatform.length) return '';
    const total = byPlatform.reduce((s, p) => s + p.spend, 0);
    const rows = byPlatform.map(p => {
        const pct = total > 0 ? (p.spend / total * 100).toFixed(1) : '0';
        return `
        <tr class="wr-tr">
            <td class="wr-td">
                <span class="wr-plat-dot" style="background:${_wrPlatColor(p.platform)}"></span>
                <strong>${p.platform}</strong>
            </td>
            <td class="wr-td wr-td-num">${_wrW(p.spend)}<span class="wr-pct-badge">${pct}%</span></td>
            <td class="wr-td wr-td-num">${_wrN(p.impr)}</td>
            <td class="wr-td wr-td-num">${_wrN(p.clicks)}</td>
            <td class="wr-td wr-td-num">${_wrP(p.ctr)}</td>
            <td class="wr-td wr-td-num">${_wrW(p.rev)}</td>
            <td class="wr-td wr-td-num wr-roas-cell">${_wrR(p.roas)}</td>
            <td class="wr-td wr-td-num">${p.conv > 0 ? _wrN(p.conv) : '-'}</td>
        </tr>`;
    }).join('');
    return `
    <div class="wr-section" id="wr-platform-section">
        <div class="wr-section-hd">
            <span><i class="fas fa-broadcast-tower mr-1.5" style="color:#3b82f6"></i>매체별 성과</span>
            <button class="wr-copy-btn" onclick="window._wrCopySection('platform', this)">
                <i class="fas fa-copy mr-1"></i>복사
            </button>
        </div>
        <div class="wr-table-wrap">
            <table class="wr-table">
                <thead><tr>
                    <th class="wr-th wr-th-left">매체</th>
                    <th class="wr-th">광고비</th>
                    <th class="wr-th">노출 수</th>
                    <th class="wr-th">클릭 수</th>
                    <th class="wr-th">클릭률</th>
                    <th class="wr-th">매출</th>
                    <th class="wr-th">광고효율</th>
                    <th class="wr-th">구매</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

/* ── 제품별 성과 섹션 HTML (매체별과 동일한 형식) ── */
function _wrProductAggSectionHtml(byProductAgg) {
    if (!byProductAgg.length) return '';
    const total = byProductAgg.reduce((s, p) => s + p.spend, 0);
    const rows = byProductAgg.map(p => {
        const pct = total > 0 ? (p.spend / total * 100).toFixed(1) : '0';
        return `
        <tr class="wr-tr">
            <td class="wr-td"><strong>${p.product}</strong></td>
            <td class="wr-td wr-td-num">${_wrW(p.spend)}<span class="wr-pct-badge">${pct}%</span></td>
            <td class="wr-td wr-td-num">${_wrN(p.impr)}</td>
            <td class="wr-td wr-td-num">${_wrN(p.clicks)}</td>
            <td class="wr-td wr-td-num">${_wrP(p.ctr)}</td>
            <td class="wr-td wr-td-num">${_wrW(p.rev)}</td>
            <td class="wr-td wr-td-num wr-roas-cell">${_wrR(p.roas)}</td>
            <td class="wr-td wr-td-num">${p.conv > 0 ? _wrN(p.conv) : '-'}</td>
        </tr>`;
    }).join('');
    return `
    <div class="wr-section" id="wr-productagg-section">
        <div class="wr-section-hd">
            <span><i class="fas fa-boxes-stacked mr-1.5" style="color:#10b981"></i>제품별 성과</span>
            <button class="wr-copy-btn" onclick="window._wrCopySection('productagg', this)">
                <i class="fas fa-copy mr-1"></i>복사
            </button>
        </div>
        <div class="wr-table-wrap">
            <table class="wr-table">
                <thead><tr>
                    <th class="wr-th wr-th-left">제품</th>
                    <th class="wr-th">광고비</th>
                    <th class="wr-th">노출 수</th>
                    <th class="wr-th">클릭 수</th>
                    <th class="wr-th">클릭률</th>
                    <th class="wr-th">매출</th>
                    <th class="wr-th">광고효율</th>
                    <th class="wr-th">구매</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

/* ── 소재별 섹션 HTML ── */
function _wrCreativeSectionHtml(byCreative) {
    if (!byCreative.length) return '';
    const cards = byCreative.map((c, i) => {
        return `
        <div class="wr-creative-card">
            <div class="wr-creative-thumb-wrap">
                ${c.thumb
                    ? _wrThumbHtml(c.thumb, 'wr-creative-thumb', '<div class="wr-no-thumb"><i class="fas fa-image"></i></div>')
                    : `<div class="wr-no-thumb"><i class="fas fa-image"></i></div>`
                }
                <span class="wr-rank-badge">#${i+1}</span>
            </div>
            <div class="wr-creative-body">
                <div class="wr-creative-name" title="${c.name.replace(/"/g,'&quot;')}">${c.name}</div>
                <div class="wr-creative-tags">
                    ${c.platform ? `<span class="wr-tag-plat" style="background:${_wrPlatColor(c.platform)}20;color:${_wrPlatColor(c.platform)}">${c.platform}</span>` : ''}
                    ${c.product  ? `<span class="wr-tag-prod">${c.product}</span>` : ''}
                </div>
                <div class="wr-creative-stats">
                    <div class="wr-stat"><div class="wr-stat-lbl">광고비</div><div class="wr-stat-val">${_wrW(c.spend)}</div></div>
                    <div class="wr-stat"><div class="wr-stat-lbl">노출 수</div><div class="wr-stat-val">${_wrN(c.impr)}</div></div>
                    <div class="wr-stat"><div class="wr-stat-lbl">클릭률</div><div class="wr-stat-val">${_wrP(c.ctr)}</div></div>
                    <div class="wr-stat"><div class="wr-stat-lbl">광고효율</div><div class="wr-stat-val wr-roas-cell">${_wrR(c.roas)}</div></div>
                    ${c.conv > 0 ? `<div class="wr-stat"><div class="wr-stat-lbl">구매</div><div class="wr-stat-val">${_wrN(c.conv)}</div></div>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
    return `
    <div class="wr-section" id="wr-creative-section">
        <div class="wr-section-hd">
            <span><i class="fas fa-images mr-1.5" style="color:#8b5cf6"></i>잘된 광고 TOP ${byCreative.length}</span>
            <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <label style="font-size:10px;color:#94a3b8;font-weight:600">정렬 기준</label>
                ${_wrSortSelectHtml(_wrCreativeSort, 'window._wrSetCreativeSort', 'TOP 소재 정렬 기준')}
                <button class="wr-copy-btn" onclick="window._wrCopySection('creatives', this)">
                    <i class="fas fa-copy mr-1"></i>복사
                </button>
            </span>
        </div>
        <div class="wr-creative-grid">
            ${cards}
        </div>
    </div>`;
}

/* ─────────────────────────────────────────────
   제품별 인사이트 섹션
───────────────────────────────────────────── */
function _wrByProductInsight(list) {
    const prodMap = {};
    list.forEach(c => {
        const prod = (c.product || '기타').trim();
        if (!prodMap[prod]) prodMap[prod] = [];
        prodMap[prod].push(c);
    });

    return Object.entries(prodMap).map(([product, items]) => {
        // 소재별 집계 — 동일 소재명(대소문자·공백 무시)은 하나로 합산
        const creMap = {};
        items.forEach(c => {
            const key = _wrCreativeKey(c);
            if (!key) return;
            if (!creMap[key]) creMap[key] = {
                name: c.ad_name || c.creative_name || key,
                thumb: c.thumbnail_url || c.media_url || '',
                platforms: new Set(),
                spend:0, impr:0, clicks:0, rev:0, conv:0,
            };
            if (c.platform) creMap[key].platforms.add(c.platform);
            if (!creMap[key].thumb && (c.thumbnail_url || c.media_url))
                creMap[key].thumb = c.thumbnail_url || c.media_url;
            creMap[key].spend  += c.spend       || 0;
            creMap[key].impr   += c.impressions || 0;
            creMap[key].clicks += c.clicks      || 0;
            creMap[key].rev    += c.revenue     || 0;
            creMap[key].conv   += c.conversions || 0;
        });
        const top5 = Object.values(creMap)
            .map(d => ({ ...d,
                platform: [...d.platforms].join(' · '),
                ctr:  d.impr>0  ? d.clicks/d.impr : 0,
                roas: d.spend>0 ? d.rev/d.spend    : 0 }))
            .sort((a, b) => _wrTop5SortFn()(b) - _wrTop5SortFn()(a))
            .slice(0, 5);

        // ── ROAS 가중 집계 헬퍼 ──
        const _aggMap = (entries) => Object.entries(entries)
            .map(([k, d]) => ({ k, count: d.c, avgRoas: d.c>0 ? d.r/d.c : 0 }))
            .sort((a,b) => b.avgRoas-a.avgRoas || b.count-a.count);

        // 소구포인트
        const appealMap = {};
        items.forEach(c => {
            const roas = c.roas||0;
            const aps = Array.isArray(c.appeal_points) ? c.appeal_points
                : (c.appeal_points ? String(c.appeal_points).split(/[,、，·・]/).map(s=>s.trim()) : []);
            aps.filter(Boolean).forEach(ap => {
                if (!appealMap[ap]) appealMap[ap] = {c:0,r:0};
                appealMap[ap].c++; appealMap[ap].r+=roas;
            });
        });
        const topAppeals = _aggMap(appealMap).slice(0,6);

        // 후킹유형
        const hookMap = {};
        items.forEach(c => {
            const roas = c.roas||0;
            const hooks = Array.isArray(c.hook_type) ? c.hook_type
                : (c.hook_type ? String(c.hook_type).split(/[,、，·・]/).map(s=>s.trim()) : []);
            hooks.filter(Boolean).forEach(h => {
                if (!hookMap[h]) hookMap[h] = {c:0,r:0};
                hookMap[h].c++; hookMap[h].r+=roas;
            });
        });
        const topHooks = _aggMap(hookMap).slice(0,4);

        // 고효율 메시지 요소 — 캐치카피 전문에서 반복 구절(키워드/바이그램) 추출 → ROAS 가중
        const phraseMap = {};       // phrase -> {c, r}
        let copySampleBest = null;  // 대표 예시 1개 (최고 ROAS 원문)
        items.forEach(c => {
            const roas = c.roas || 0;
            const raw  = (c.key_message_kr || c.key_message_jp || '').trim();
            if (!raw) return;
            if (!copySampleBest || roas > copySampleBest.roas) copySampleBest = { raw, roas };
            _wrExtractPhrases(raw).forEach(ph => {
                if (!phraseMap[ph]) phraseMap[ph] = { c:0, r:0 };
                phraseMap[ph].c++; phraseMap[ph].r += roas;
            });
        });
        // 2회 이상 등장한 구절만(노이즈 제거), ROAS 가중 정렬
        const topPhrases = Object.entries(phraseMap)
            .filter(([,d]) => d.c >= 2)
            .map(([k,d]) => ({ k, count: d.c, avgRoas: d.c>0 ? d.r/d.c : 0 }))
            .sort((a,b) => b.avgRoas - a.avgRoas || b.count - a.count)
            .slice(0, 12);

        // 키워드
        const kwMap = {};
        items.forEach(c => {
            const roas = c.roas||0;
            const kws = Array.isArray(c.keywords) ? c.keywords
                : (c.keywords ? String(c.keywords).split(/[,、，·・\s]+/).map(s=>s.trim()).filter(s=>s.length>1) : []);
            kws.filter(Boolean).forEach(kw => {
                if (!kwMap[kw]) kwMap[kw] = {c:0,r:0};
                kwMap[kw].c++; kwMap[kw].r+=roas;
            });
        });
        const topKeywords = _aggMap(kwMap).slice(0,8);

        return { product, top5, topAppeals, topHooks, topPhrases, copySampleBest, topKeywords, kpi: _wrSum(items) };
    }).sort((a,b) => b.kpi.spend - a.kpi.spend);
}

/* ── 캐치카피 문구에서 메시지 요소(키워드·바이그램) 추출 ──
   한국어 형태소 분석기 없이도 의미 단위를 잡기 위해:
   - 조사/접미사/불용어 제거, 2글자 이상 토큰
   - 인접 토큰 바이그램까지 포함("고밀착 처방", "콜라겐 보습") */
const _WR_STOP = new Set(['그리고','하지만','으로','에서','까지','부터','보다','처럼','같은','같이','위해','때문','통해','대한','관한','이런','저런','그런','어떤','모든','매우','정말','너무','바로','이제','지금','오늘','우리','당신','여러분','입니다','습니다','합니다','됩니다','있는','없는','하는','되는','이는','그는','전','후','및','또는','또','더','덜','잘','못','안','수','것','때','이','그','저','를','을','은','는','가','의','에','와','과','도','만','뿐','채','한','두','세','네']);
function _wrExtractPhrases(text) {
    // 구두점/숫자/통화/괄호 → 공백, 한글·영문만 남김
    const cleaned = String(text)
        .replace(/[0-9%¥₩$£€,.\/()\[\]{}「」『』【】〜~!！?？·・…‥+\-*=:;"'`|]/g, ' ')
        .replace(/[　\s]+/g, ' ')
        .trim();
    if (!cleaned) return [];
    const tokens = cleaned.split(' ')
        .map(t => t.trim())
        .filter(t => t.length >= 2 && !_WR_STOP.has(t) && /[가-힣A-Za-z]/.test(t));
    const out = new Set();
    tokens.forEach((t, i) => {
        out.add(t);                                   // 유니그램
        if (i < tokens.length - 1) {                  // 바이그램
            const bi = t + ' ' + tokens[i+1];
            if (bi.length <= 14) out.add(bi);
        }
    });
    return [...out];
}

function _wrProductInsightSectionHtml(productData) {
    if (!productData.length) return '';

    const COLORS = ['#6366f1','#f97316','#10b981','#ef4444','#8b5cf6','#06b6d4','#f59e0b','#ec4899'];

    const prodCards = productData.map((pd, pi) => {
        const color = COLORS[pi % COLORS.length];

        // TOP 5 소재 행
        const top5Rows = pd.top5.map((c, i) => `
            <div class="wr-pi-row">
                <span class="wr-pi-rank" style="background:${i===0?'#fbbf24':'#e2e8f0'};color:${i===0?'#78350f':'#64748b'}">${i+1}</span>
                <div class="wr-pi-thumb-wrap">
                    ${_wrThumbHtml(c.thumb, 'wr-pi-thumb', '<div class="wr-pi-no-img"><i class="fas fa-image"></i></div>')}
                </div>
                <div class="wr-pi-cre-info">
                    <div class="wr-pi-cre-name" title="${c.name.replace(/"/g,'&quot;')}">${c.name}</div>
                    <div class="wr-pi-cre-meta">
                        ${c.platform ? `<span class="wr-pi-plat">${c.platform}</span>` : ''}
                        <span class="wr-pi-roas" style="color:${color}">ROAS ${_wrR(c.roas)}</span>
                        ${c.conv > 0 ? `<span class="wr-pi-conv">주문 ${_wrN(c.conv)}건</span>` : ''}
                        <span class="wr-pi-ctr">CTR ${_wrP(c.ctr)}</span>
                        <span class="wr-pi-spend">${_wrW(c.spend)}</span>
                    </div>
                </div>
            </div>`).join('');

        // 소구포인트 태그
        const appealTags = pd.topAppeals.length
            ? pd.topAppeals.map(d =>
                `<span class="wr-insight-tag" style="background:${color}18;color:${color};border-color:${color}40">${d.k}<em>×${d.count}</em></span>`
            ).join('')
            : '<span class="wr-no-data">데이터 없음</span>';

        // 후킹유형 태그
        const hookTags = pd.topHooks.length
            ? pd.topHooks.map(d =>
                `<span class="wr-insight-tag wr-hook-tag">${d.k}<em>×${d.count}</em></span>`
            ).join('')
            : '<span class="wr-no-data">데이터 없음</span>';

        // 고효율 메시지 요소 (캐치카피에서 추출한 반복 구절, ROAS 가중) + 약기법 감수
        const _cmpl = typeof window.checkCompliance === 'function' ? window.checkCompliance : null;
        const phraseTags = (pd.topPhrases && pd.topPhrases.length)
            ? pd.topPhrases.map(d => {
                const r = d.avgRoas;
                const tier = r >= 10 ? '#059669' : r >= 5 ? color : '#94a3b8';
                const c = _cmpl ? _cmpl(d.k) : { level:'ok' };
                const warn = c.level === 'block' ? ' ⚠' : c.level === 'warn' ? ' ⚠' : '';
                const cls = c.level !== 'ok' ? ' wr-tag-risk' : '';
                const tip = c.level !== 'ok' ? ` · ⚠ 약기법 주의(${c.hits.map(h=>h.term).join(',')})` : '';
                return `<span class="wr-insight-tag${cls}" style="background:${tier}14;color:${tier};border-color:${tier}40" title="${d.count}개 소재 · 평균 ROAS ${_wrR(r)}${tip}">${d.k}<em>${_wrR(r)}</em>${warn}</span>`;
            }).join('')
            : '';
        // 약기법 컴플라이언스 요약 (소구+카피+키워드 전체 스캔)
        let cmplLine = '';
        if (typeof window.summarizeCompliance === 'function') {
            const texts = [
                ...(pd.topPhrases||[]).map(d=>d.k),
                ...(pd.topKeywords||[]).map(d=>d.k),
                ...(pd.topAppeals||[]).map(d=>d.k),
                pd.copySampleBest?.raw || '',
            ];
            const sum = window.summarizeCompliance(texts);
            if (sum.count > 0) {
                const parts = [];
                if (sum.blockTerms.length) parts.push(`<b style="color:#b91c1c">위반소지 ${sum.blockTerms.length}건</b>(${sum.blockTerms.join(', ')})`);
                if (sum.warnTerms.length)  parts.push(`<span style="color:#b45309">과장 ${sum.warnTerms.length}건</span>(${sum.warnTerms.join(', ')})`);
                cmplLine = `<div class="wr-cmpl-line">💄 약기법 감수: ${parts.join(' · ')}</div>`;
            }
        }
        // 대표 카피 예시 1개 (접힘)
        const copySample = (pd.copySampleBest && pd.copySampleBest.raw)
            ? `<details class="wr-copy-sample"><summary>대표 카피 예시 (ROAS ${_wrR(pd.copySampleBest.roas)})</summary><div class="wr-copy-sample-text">${pd.copySampleBest.raw.replace(/</g,'&lt;')}</div></details>`
            : '';

        // 키워드 태그
        const kwTags = pd.topKeywords.length
            ? pd.topKeywords.map(d =>
                `<span class="wr-insight-tag wr-kw-tag">${d.k}<em>×${d.count}</em></span>`
            ).join('')
            : '';

        return `
        <div class="wr-pi-card">
            <div class="wr-pi-header" style="border-top:3px solid ${color}">
                <div class="wr-pi-product-name" style="color:${color}">${pd.product}</div>
                <div class="wr-pi-kpis">
                    <span>광고비 <strong>${_wrW(pd.kpi.spend)}</strong></span>
                    <span>ROAS <strong style="color:${color}">${_wrR(pd.kpi.roas)}</strong></span>
                    <span>CTR <strong>${_wrP(pd.kpi.ctr)}</strong></span>
                </div>
            </div>
            <div class="wr-pi-body">
                <div class="wr-pi-col wr-pi-col-main">
                    <div class="wr-pi-sub-hd">🏆 고효율 TOP 5 소재 <span style="font-size:9px;color:#94a3b8;font-weight:400">정렬 기준: ${_wrTop5SortLabel()} 높은 순</span></div>
                    <div class="wr-pi-rows">${top5Rows}</div>
                </div>
                <div class="wr-pi-col wr-pi-col-side">
                    <div class="wr-pi-sub-hd">💡 강조 포인트 <span style="font-size:9px;color:#94a3b8;font-weight:400">(소구점)</span></div>
                    <div class="wr-insight-tags">${appealTags}</div>
                    <div class="wr-pi-sub-hd" style="margin-top:10px">⚡ 시선 끄는 방식 <span style="font-size:9px;color:#94a3b8;font-weight:400">(후킹)</span></div>
                    <div class="wr-insight-tags">${hookTags}</div>
                    ${phraseTags ? `
                    <div class="wr-pi-sub-hd" style="margin-top:10px">✍️ 고효율 메시지 요소 <span style="font-size:9px;color:#94a3b8">카피 반복구절 · ROAS 가중</span></div>
                    <div class="wr-insight-tags">${phraseTags}</div>
                    ${copySample}` : ''}
                    ${kwTags ? `
                    <div class="wr-pi-sub-hd" style="margin-top:10px">🔑 키워드</div>
                    <div class="wr-insight-tags">${kwTags}</div>` : ''}
                    ${cmplLine}
                </div>
            </div>
        </div>`;
    }).join('');

    return `
    <div class="wr-section" id="wr-product-section">
        <div class="wr-section-hd">
            <span><i class="fas fa-box-open mr-1.5" style="color:#f97316"></i>제품별 잘된 포인트 분석</span>
            <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <label style="font-size:10px;color:#94a3b8;font-weight:600">TOP 5 정렬 기준</label>
                ${_wrSortSelectHtml(_wrTop5Sort, 'window._wrSetTop5Sort', '제품별 TOP 5 소재 정렬 기준')}
                <button class="wr-copy-btn" onclick="window._wrCopySection('products', this)">
                    <i class="fas fa-copy mr-1"></i>복사
                </button>
            </span>
        </div>
        <div class="wr-pi-grid">${prodCards}</div>
    </div>`;
}

/* ── 렌더 사이클 캐시 (복사 버튼 클릭 시 재계산 방지) ── */
let _wrRenderCache = null;

/* ── 필터 변경 시 캐시 무효화 (스테일 복사 방지) ── */
function _wrInvalidateCache() { _wrRenderCache = null; }
window._wrInvalidateCache = _wrInvalidateCache;

/* ── 메인 렌더 ── */
function renderWeeklyReport() {
    // date input UI 동기화 (localStorage 복원값 반영)
    const fe = document.getElementById('wr-date-from');
    const te = document.getElementById('wr-date-to');
    if (fe && fe.value !== (_wr.dateFrom||'')) fe.value = _wr.dateFrom || '';
    if (te && te.value !== (_wr.dateTo||''))   te.value = _wr.dateTo   || '';

    _wrPopulateSelects();

    const list        = _wrGetList();
    const kpi         = _wrSum(list);
    const byPlatform    = _wrByPlatform(list);
    const byProductAgg  = _wrByProduct(list);
    const byCreative    = _wrByCreative(list);
    const byProduct     = _wrByProductInsight(list);

    // 복사 시 재계산 방지용 캐시
    _wrRenderCache = { list, kpi, byPlatform, byProductAgg, byCreative, byProduct };
    _wrSaveFilter(); // 필터 상태 localStorage 저장

    // 날짜 범위 라벨
    const rangeEl = document.getElementById('wr-range-label');
    if (rangeEl) {
        const hasDates = _wr.dateFrom || _wr.dateTo;
        rangeEl.textContent = hasDates
            ? `${_wr.dateFrom || '?'} ~ ${_wr.dateTo || '?'} · ${list.length}개 소재`
            : `전체 기간 · ${list.length}개 소재`;
    }

    const body = document.getElementById('wr-body');
    if (!body) return;

    if (!list.length) {
        body.innerHTML = `<div class="wr-empty">
            <i class="fas fa-inbox fa-2x mb-3 block opacity-30"></i>
            <p>해당 기간·조건의 데이터가 없습니다.</p>
            ${(() => {
                // 실제 데이터 날짜 범위 감지
                const allDates = (_wrBrandList()).map(c=>(c.start_date||'').slice(0,10)).filter(Boolean).sort();
                if (!allDates.length) return '<p class="text-xs text-slate-400">시트를 연동해주세요.</p>';
                const min = allDates[0], max = allDates[allDates.length-1];
                return `<p class="text-xs text-slate-400">데이터 기간: <strong>${min} ~ ${max}</strong></p>
                <button onclick="window._wrClearDates()" style="margin-top:8px;padding:6px 16px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">전체 기간으로 보기</button>`;
            })()}
        </div>`;
        return;
    }

    body.innerHTML =
        _wrKpiSectionHtml(kpi, list.length) +
        _wrPlatformSectionHtml(byPlatform) +
        _wrProductAggSectionHtml(byProductAgg) +
        _wrProductInsightSectionHtml(byProduct) +
        _wrCreativeSectionHtml(byCreative) +
        `<div class="wr-copy-all-row">
            <button class="wr-copy-all-btn" id="wr-copy-all-btn" onclick="window._wrCopyAll(this)">
                <i class="fas fa-file-export mr-2"></i>전체 보고서 복사 (Confluence 붙여넣기용)
            </button>
        </div>`;
}
window.renderWeeklyReport = renderWeeklyReport;

/* ─────────────────────────────────────────────
   제품 TOP 5 ↔ CEP 검증 연결 분석 (복사용 리포트)
   — 소재명 정규화 매칭(cepLookupCreative)으로 TOP 소재가 어떤 CEP 소속인지 찾고,
     해당 제품의 CEP별 집계·판정을 가져온다. CEP 데이터 미로드 시 null.
───────────────────────────────────────────── */
function _wrCepAnalysis(byProduct) {
    if (typeof window.cepLookupCreative !== 'function' || typeof window.cepReportForKeys !== 'function') return null;
    if (window.cepLookupCreative('__probe__') === undefined) return null; // CEP 데이터 미로드
    const entries = [];
    byProduct.forEach(pd => {
        const matched = pd.top5
            .map((c, i) => ({ rank: i + 1, info: window.cepLookupCreative(c.name) }))
            .filter(h => h.info);
        if (!matched.length) return;
        const pKeys = [...new Set(matched.map(h => h.info.pKey))];
        const cepRows = window.cepReportForKeys(pKeys) || [];
        if (!cepRows.length) return;
        const ranksByCep = {};
        matched.forEach(h => {
            (ranksByCep[h.info.cepTitle] = ranksByCep[h.info.cepTitle] || []).push(h.rank);
        });
        entries.push({ product: pd.product, cepRows, ranksByCep, matchedRanks: matched.map(h => h.rank).sort((a, b) => a - b) });
    });
    return entries.length ? entries : null;
}

/* ─────────────────────────────────────────────
   Confluence HTML 빌드
───────────────────────────────────────────── */
// imgMap: { originalUrl: base64DataUrl } — 없으면 원본 URL 폴백
function _wrBuildConfluenceHtml(sections, imgMap) {
    imgMap = imgMap || {};
    // 렌더 캐시 사용 (복사 직전 renderWeeklyReport 결과 재활용)
    const cache      = _wrRenderCache;
    const list       = cache ? cache.list       : _wrGetList();
    const kpi        = cache ? cache.kpi        : _wrSum(list);
    const byPlatform   = cache ? cache.byPlatform   : _wrByPlatform(list);
    const byProductAgg = cache ? cache.byProductAgg : _wrByProduct(list);
    const byCreative   = cache ? cache.byCreative   : _wrByCreative(list);
    const byProduct    = cache ? cache.byProduct    : _wrByProductInsight(list);

    const rangeText  = (_wr.dateFrom || _wr.dateTo)
        ? `${_wr.dateFrom || '?'} ~ ${_wr.dateTo || '?'}`
        : '전체 기간';
    const filterText = [
        _wr.product ? `제품: ${_wr.product}` : '',
        _wr.event   ? `이벤트: ${_wr.event}` : '',
    ].filter(Boolean).join(' | ') || '필터 없음';

    // URL → base64(변환 성공) 또는 thumbnail API URL 폴백
    const toThumb = (url) => {
        if (!url) return '';
        // imgMap에 base64 있으면 최우선 (클립보드 복사 시)
        if (imgMap[url]) return imgMap[url];
        // Drive URL → thumbnail API URL (Confluence에서 로드 가능)
        if (typeof window.buildDriveImgHtml === 'undefined' && url.includes('drive.google.com')) {
            const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
            if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w400`;
        }
        return url;
    };

    const css = `
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #334155; margin: 0; padding: 16px; }
        h2 { font-size: 18px; font-weight: 700; color: #1e293b; margin: 0 0 4px; }
        h3 { font-size: 13px; font-weight: 700; color: #475569; margin: 24px 0 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 4px; }
        th { background: #f8fafc; padding: 7px 10px; font-size: 11px; font-weight: 600; color: #64748b; border: 1px solid #e2e8f0; text-align: center; white-space: nowrap; }
        td { padding: 7px 10px; border: 1px solid #e2e8f0; vertical-align: middle; }
        td.left { text-align: left; }
        td.num  { text-align: right; font-variant-numeric: tabular-nums; }
        td.roas { text-align: right; font-weight: 700; color: #7c3aed; }
        img.thumb { width: 72px; height: 56px; object-fit: cover; border-radius: 6px; display: block; margin: 0 auto; }
        .meta { font-size: 10px; color: #94a3b8; margin-top: 2px; }
        .pct { font-size: 10px; color: #94a3b8; margin-left: 4px; }
    `;

    // CEP 검증 연결 분석 (전체 요약·제품별 판정 표·Next Action에 공통 사용)
    const cepEntries = _wrCepAnalysis(byProduct);
    const allCepRows = cepEntries ? cepEntries.flatMap(e => e.cepRows) : [];
    const bestCep = allCepRows.length ? allCepRows.reduce((a, b) => a.roas >= b.roas ? a : b) : null;
    const worstCep = allCepRows.length > 1 ? allCepRows.reduce((a, b) => a.roas <= b.roas ? a : b) : null;

    let html = `<html><head><meta charset="UTF-8"><style>${css}</style></head><body>`;
    html += `<h2>📋 주간 업무 보고서</h2>`;
    html += `<p style="color:#64748b;font-size:12px;margin:0 0 16px">📅 <strong>${rangeText}</strong> &nbsp;|&nbsp; 🔍 ${filterText} &nbsp;|&nbsp; 소재 수: <strong>${list.length}개</strong></p>`;

    /* 🎯 3줄 요약 (전체 보고서 복사 시에만) */
    if (!sections && list.length) {
        const topRoas = byCreative.length ? Math.max(...byCreative.map(c => c.roas || 0)) : 0;
        const gapNote = kpi.roas > 0 && topRoas > kpi.roas * 2 ? ' — 소재 간 편차 큼' : '';
        const line1 = `<strong>[성과]</strong> 소재 ${list.length}개 · 평균 ROAS ${_wrR(kpi.roas)}, TOP 소재 최고 ${_wrR(topRoas)}${gapNote}`;
        const line2 = bestCep
            ? `<strong>[원인]</strong> "${bestCep.cepTitle}" CEP가 ROAS ${bestCep.roas.toFixed(0)}%로 최고 — 소재빨이 아니라 <strong>메시지(상황 소구)가 성과를 견인</strong> (${bestCep.product})`
            : `<strong>[원인]</strong> TOP 소재와 CEP 검증 로그가 아직 연결되지 않음 — 왜 잘됐는지는 CEP 검증 필요`;
        const line3 = bestCep
            ? `<strong>[다음 주]</strong> "${bestCep.cepTitle}" 소구 소재 증액 + 동일 CEP 추가 소재 제작${worstCep && worstCep !== bestCep ? ` / "${worstCep.cepTitle}"은 감액·보류` : ''}`
            : `<strong>[다음 주]</strong> 고효율 소재 증액 테스트 + CEP 가설 수립 후 검증 시작`;
        html += `<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:12px 16px;margin-bottom:8px">
            <div style="font-size:13px;font-weight:800;color:#4338ca;margin-bottom:6px">🎯 3줄 요약 (여기만 읽어도 됨)</div>
            <ol style="margin:0;padding-left:18px;font-size:12px;color:#334155;line-height:1.9">
                <li>${line1}</li><li>${line2}</li><li>${line3}</li>
            </ol>
        </div>`;
    }

    /* KPI */
    if (!sections || sections.includes('kpi')) {
        html += `<h3>📊 KPI 요약</h3><table><thead><tr>
            <th>광고비</th><th>노출수</th><th>클릭수</th><th>CTR</th><th>매출</th><th>ROAS</th><th>전환수</th>
        </tr></thead><tbody><tr>
            <td class="num">${_wrW(kpi.spend)}</td>
            <td class="num">${_wrN(kpi.impr)}</td>
            <td class="num">${_wrN(kpi.clicks)}</td>
            <td class="num">${_wrP(kpi.ctr)}</td>
            <td class="num">${_wrW(kpi.rev)}</td>
            <td class="roas">${_wrR(kpi.roas)}</td>
            <td class="num">${kpi.conv > 0 ? _wrN(kpi.conv) : '-'}</td>
        </tr></tbody></table>`;
    }

    /* 매체별 */
    if (!sections || sections.includes('platform')) {
        const total = byPlatform.reduce((s, p) => s + p.spend, 0);
        html += `<h3>📺 매체별 성과</h3><table><thead><tr>
            <th style="text-align:left">매체</th><th>광고비</th><th>비중</th><th>노출</th><th>클릭</th><th>CTR</th><th>매출</th><th>ROAS</th><th>전환</th>
        </tr></thead><tbody>`;
        byPlatform.forEach(p => {
            const pct = total > 0 ? (p.spend / total * 100).toFixed(1) + '%' : '-';
            html += `<tr>
                <td class="left"><strong>${p.platform}</strong></td>
                <td class="num">${_wrW(p.spend)}</td>
                <td class="num">${pct}</td>
                <td class="num">${_wrN(p.impr)}</td>
                <td class="num">${_wrN(p.clicks)}</td>
                <td class="num">${_wrP(p.ctr)}</td>
                <td class="num">${_wrW(p.rev)}</td>
                <td class="roas">${_wrR(p.roas)}</td>
                <td class="num">${p.conv > 0 ? _wrN(p.conv) : '-'}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
    }

    /* 제품별 성과 (단순 합계표, 매체별과 동일 형식) */
    if (!sections || sections.includes('productagg')) {
        const totalP = byProductAgg.reduce((s, p) => s + p.spend, 0);
        html += `<h3>📦 제품별 성과</h3><table><thead><tr>
            <th style="text-align:left">제품</th><th>광고비</th><th>비중</th><th>노출</th><th>클릭</th><th>CTR</th><th>매출</th><th>ROAS</th><th>전환</th>
        </tr></thead><tbody>`;
        byProductAgg.forEach(p => {
            const pct = totalP > 0 ? (p.spend / totalP * 100).toFixed(1) + '%' : '-';
            html += `<tr>
                <td class="left"><strong>${p.product}</strong></td>
                <td class="num">${_wrW(p.spend)}</td>
                <td class="num">${pct}</td>
                <td class="num">${_wrN(p.impr)}</td>
                <td class="num">${_wrN(p.clicks)}</td>
                <td class="num">${_wrP(p.ctr)}</td>
                <td class="num">${_wrW(p.rev)}</td>
                <td class="roas">${_wrR(p.roas)}</td>
                <td class="num">${p.conv > 0 ? _wrN(p.conv) : '-'}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
    }

    /* 제품별 인사이트 */
    if (!sections || sections.includes('products')) {
        if (byProduct.length) {
            html += `<p style="font-size:11px;color:#94a3b8;margin:16px 0 0">💡 <strong>읽는 법</strong>: 제품별 TOP 소재 표는 "이번 주 예산을 어디로 옮길까"(운영)를 정하는 표입니다. 그 아래 CEP 판정 표는 "왜 잘됐나 → 다음에 뭘 만들까"(기획)에 답합니다.</p>`;
        }
        byProduct.forEach(pd => {
            html += `<h3>📦 ${pd.product} — 광고비 ${_wrW(pd.kpi.spend)} | ROAS ${_wrR(pd.kpi.roas)} | CTR ${_wrP(pd.kpi.ctr)} <span style="font-size:11px;color:#94a3b8;font-weight:400">(TOP 5 정렬: ${_wrTop5SortLabel()} 높은 순)</span></h3>`;
            // TOP 5 — 이미지 행 + 지표 행 분리 테이블
            const tdBase = `border:1px solid #e2e8f0;padding:6px 8px;text-align:center;font-size:11px;`;
            const thBase = `border:1px solid #e2e8f0;padding:6px 8px;background:#f8fafc;font-size:11px;font-weight:600;color:#64748b;text-align:left;white-space:nowrap;`;
            html += `<table style="width:100%;border-collapse:collapse"><tbody>`;
            // 행1: 소재 이미지
            html += `<tr><td style="${thBase}"></td>`;
            pd.top5.forEach((c, i) => {
                const rankBg  = i === 0 ? '#fbbf24' : '#e2e8f0';
                const rankClr = i === 0 ? '#78350f' : '#64748b';
                const thumb   = toThumb(c.thumb);
                const imgHtml = thumb
                    ? `<img src="${thumb}" alt="" style="width:100%;max-height:130px;object-fit:cover;border-radius:6px;display:block">`
                    : `<div style="width:100%;height:100px;background:#f1f5f9;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:20px">🖼</div>`;
                html += `<td style="${tdBase}vertical-align:top;padding:6px">
                    <div style="position:relative">
                        ${imgHtml}
                        <span style="position:absolute;top:4px;left:4px;background:${rankBg};color:${rankClr};font-size:9px;font-weight:800;width:18px;height:18px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center">${i+1}</span>
                    </div>
                    <div style="font-size:9px;font-weight:600;color:#1e293b;word-break:break-all;margin-top:5px;line-height:1.3;text-align:left">${c.name}</div>
                    ${c.platform ? `<div style="font-size:9px;color:#94a3b8;text-align:left">${c.platform}</div>` : ''}
                </td>`;
            });
            for (let i = pd.top5.length; i < 5; i++) html += `<td style="${tdBase}"></td>`;
            html += `</tr>`;
            // 행2~5: 지표
            const metrics = [
                { label: '광고비', fn: c => _wrW(c.spend),       color: '#334155' },
                { label: 'CTR',   fn: c => _wrP(c.ctr),          color: '#2563eb' },
                { label: '매출',   fn: c => _wrW(c.rev),          color: '#059669' },
                { label: 'ROAS',  fn: c => _wrR(c.roas),         color: '#7c3aed' },
            ];
            metrics.forEach(m => {
                html += `<tr><td style="${thBase}">${m.label}</td>`;
                pd.top5.forEach(c => {
                    html += `<td style="${tdBase}font-weight:600;color:${m.color}">${m.fn(c)}</td>`;
                });
                for (let i = pd.top5.length; i < 5; i++) html += `<td style="${tdBase}"></td>`;
                html += `</tr>`;
            });
            html += `</tbody></table>`;
            // 소구/후킹/메시지요소/키워드 인사이트
            const hasInsight = pd.topAppeals.length || pd.topHooks.length || (pd.topPhrases&&pd.topPhrases.length) || pd.topKeywords.length;
            if (hasInsight) {
                html += `<table style="margin-top:6px;width:100%"><tr>`;
                // 소구포인트
                html += `<td style="width:25%;vertical-align:top;border:1px solid #e2e8f0;padding:10px">
                    <strong style="font-size:12px">💡 소구포인트</strong><br><br>`;
                pd.topAppeals.forEach(d => {
                    html += `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;background:#eef2ff;color:#6366f1;border-radius:4px;font-size:11px">${d.k} ×${d.count}</span>`;
                });
                // 후킹유형
                html += `</td><td style="width:25%;vertical-align:top;border:1px solid #e2e8f0;padding:10px">
                    <strong style="font-size:12px">⚡ 후킹 유형</strong><br><br>`;
                pd.topHooks.forEach(d => {
                    html += `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;background:#fef3c7;color:#92400e;border-radius:4px;font-size:11px">${d.k} ×${d.count}</span>`;
                });
                // 메시지 요소 (카피 반복구절)
                html += `</td><td style="width:25%;vertical-align:top;border:1px solid #e2e8f0;padding:10px">
                    <strong style="font-size:12px">✍️ 고효율 메시지 요소</strong><br><br>`;
                if (pd.topPhrases && pd.topPhrases.length) {
                    pd.topPhrases.forEach(d => {
                        html += `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;background:#eef2ff;color:#4f46e5;border-radius:4px;font-size:11px">${d.k} ${_wrR(d.avgRoas)}</span>`;
                    });
                } else { html += '<span style="font-size:11px;color:#94a3b8">데이터 없음</span>'; }
                // 키워드
                html += `</td><td style="width:25%;vertical-align:top;border:1px solid #e2e8f0;padding:10px">
                    <strong style="font-size:12px">🔑 키워드</strong><br><br>`;
                if (pd.topKeywords.length) {
                    pd.topKeywords.forEach(d => {
                        html += `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;background:#f0fdf4;color:#166534;border-radius:4px;font-size:11px">${d.k} ×${d.count}</span>`;
                    });
                } else { html += '<span style="font-size:11px;color:#94a3b8">데이터 없음</span>'; }
                html += `</td></tr></table>`;
            }

            /* ── CEP 검증 연결: 브릿지 + 판정 표 ── */
            const cepEntry = cepEntries && cepEntries.find(e => e.product === pd.product);
            if (cepEntry) {
                const { cepRows, ranksByCep, matchedRanks } = cepEntry;
                html += `<div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:10px 14px;margin:10px 0 8px;font-size:12px;color:#5b21b6;line-height:1.7">
                    <strong>❓ 여기서 질문 — 위 소재들은 '왜' 잘됐을까?</strong><br>
                    모델 덕인지 메시지 덕인지 소재 랭킹만으로는 구분되지 않습니다.
                    같은 상황 소구(CEP)를 쓴 소재들을 묶어 검증한 결과가 아래입니다.
                    (위 TOP ${matchedRanks.join('·')}번 소재가 CEP 검증 로그와 연결됨)
                </div>`;
                const maxRev = Math.max(...cepRows.map(r => r.revenue));
                html += `<table><thead><tr>
                    <th style="text-align:left">CEP (상황 소구)</th><th>판정</th><th>ROAS</th><th>CV</th><th>매출</th><th style="text-align:left">비고</th>
                </tr></thead><tbody>`;
                cepRows.forEach((r, i) => {
                    const ranks = ranksByCep[r.cepTitle];
                    const notes = [];
                    if (i === 0 && cepRows.length > 1) notes.push('✅ 효율 1위');
                    if (r.revenue === maxRev && cepRows.length > 1) notes.push('📦 매출 최대');
                    if (ranks) notes.push(`TOP ${[...ranks].sort((a, b) => a - b).join('·')}번 소재 소속`);
                    html += `<tr>
                        <td class="left"><strong>${r.cepTitle}</strong></td>
                        <td style="text-align:center;white-space:nowrap">${r.verdict}</td>
                        <td class="roas">${r.roas.toFixed(0)}%</td>
                        <td class="num">${_wrN(r.cv)}</td>
                        <td class="num">${_wrW(r.revenue)}</td>
                        <td class="left" style="font-size:11px;color:#64748b">${notes.join(' · ') || '-'}</td>
                    </tr>`;
                });
                html += `</tbody></table>`;
                html += `<p style="font-size:11px;color:#94a3b8;margin:2px 0 0">💡 <strong>읽는 법</strong>: CEP = 소비자가 이 제품을 떠올리는 구체적 상황. 같은 CEP를 여러 소재로 표현해도 성과가 좋으면, 소재 실행이 아니라 <strong>그 메시지가 통한다</strong>는 뜻입니다.</p>`;
            }
        });
    }

    /* 소재별 (이미지 포함) — 이미지 행 + 지표 행 분리, 5열씩 */
    if (!sections || sections.includes('creatives')) {
        html += `<h3>🎨 소재별 성과 TOP ${byCreative.length} <span style="font-size:11px;color:#94a3b8;font-weight:400">(정렬 기준: ${_wrSortLabel()} 높은 순)</span></h3>`;
        html += `<p style="font-size:11px;color:#94a3b8;margin:0 0 8px">💡 <strong>읽는 법</strong>: 전 제품 통합 소재 랭킹 — 효율 좋은데 광고비가 작은 소재는 증액 여력, 돈만 쓰는 소재는 감액 후보입니다.</p>`;
        const tdB = `border:1px solid #e2e8f0;padding:6px 8px;text-align:center;font-size:11px;`;
        const thB = `border:1px solid #e2e8f0;padding:6px 8px;background:#f8fafc;font-size:11px;font-weight:600;color:#64748b;text-align:left;white-space:nowrap;`;
        const cMets = [
            { label: '광고비', fn: c => _wrW(c.spend),  color: '#334155' },
            { label: 'CTR',   fn: c => _wrP(c.ctr),     color: '#2563eb' },
            { label: '매출',   fn: c => _wrW(c.rev),     color: '#059669' },
            { label: 'ROAS',  fn: c => _wrR(c.roas),    color: '#7c3aed' },
        ];
        for (let rowStart = 0; rowStart < byCreative.length; rowStart += 5) {
            const rowItems = byCreative.slice(rowStart, rowStart + 5);
            html += `<table style="width:100%;border-collapse:collapse;margin-bottom:12px"><tbody>`;
            // 이미지 행
            html += `<tr><td style="${thB}"></td>`;
            rowItems.forEach((c, j) => {
                const i = rowStart + j;
                const rankBg  = i === 0 ? '#fbbf24' : '#e2e8f0';
                const rankClr = i === 0 ? '#78350f' : '#64748b';
                const thumb   = toThumb(c.thumb);
                const imgHtml = thumb
                    ? `<img src="${thumb}" alt="" style="width:100%;max-height:130px;object-fit:cover;border-radius:6px;display:block">`
                    : `<div style="width:100%;height:100px;background:#f1f5f9;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:20px">🖼</div>`;
                html += `<td style="${tdB}vertical-align:top;padding:6px">
                    <div style="position:relative">
                        ${imgHtml}
                        <span style="position:absolute;top:4px;left:4px;background:${rankBg};color:${rankClr};font-size:9px;font-weight:800;width:18px;height:18px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center">${i+1}</span>
                    </div>
                    <div style="font-size:9px;font-weight:600;color:#1e293b;word-break:break-all;margin-top:5px;line-height:1.3;text-align:left">${c.name}</div>
                    ${c.platform ? `<div style="font-size:9px;color:#94a3b8;text-align:left">${c.platform}${c.product ? ' · '+c.product : ''}</div>` : ''}
                </td>`;
            });
            for (let k = rowItems.length; k < 5; k++) html += `<td style="${tdB}"></td>`;
            html += `</tr>`;
            // 지표 행
            cMets.forEach(m => {
                html += `<tr><td style="${thB}">${m.label}</td>`;
                rowItems.forEach(c => {
                    html += `<td style="${tdB}font-weight:600;color:${m.color}">${m.fn(c)}</td>`;
                });
                for (let k = rowItems.length; k < 5; k++) html += `<td style="${tdB}"></td>`;
                html += `</tr>`;
            });
            html += `</tbody></table>`;
        }
    }

    /* ✅ Next Action (전체 보고서 복사 시에만) */
    if (!sections && list.length) {
        const opLine = bestCep
            ? `"${bestCep.cepTitle}" CEP 소속 소재 증액 테스트${worstCep && worstCep !== bestCep ? ` / "${worstCep.cepTitle}"(ROAS ${worstCep.roas.toFixed(0)}%)는 감액·보류` : ''}`
            : `고효율 TOP 소재 증액 테스트, 하위 소재 감액`;
        const planLine = bestCep
            ? `"${bestCep.cepTitle}" CEP를 다른 모델·영상 구성으로 2~3개 추가 제작 → 소재 실행 효과 분리 검증`
            : `TOP 소재의 소구 상황을 CEP 가설로 정리해 검증 시작 (CEP 검증 탭)`;
        html += `<h3>✅ Next Action</h3>
        <table><tbody>
            <tr><td class="left" style="width:110px;white-space:nowrap"><strong>운영 (예산)</strong></td><td class="left">${opLine}</td></tr>
            <tr><td class="left"><strong>기획 (차기 소재)</strong></td><td class="left">${planLine}</td></tr>
            <tr><td class="left"><strong>재측정</strong></td><td class="left">다음 주 이 리포트에서 증액분의 효율 유지 여부 확인</td></tr>
        </tbody></table>`;
    }

    html += `<p style="font-size:10px;color:#cbd5e1;margin-top:24px">Generated by Performance Creative Dashboard</p></body></html>`;
    return html;
}

/* ─────────────────────────────────────────────
   이미지 → Base64 변환 (Canvas 방식)
   - crossOrigin='anonymous' 로 로드 → canvas.toDataURL()
   - CORS 차단 시 원본 URL 그대로 폴백
   - 타임아웃: 8초
───────────────────────────────────────────── */
function _wrImgToBase64(url) {
    if (!url) return Promise.resolve('');
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve(url), 8000);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            clearTimeout(timer);
            try {
                const MAX = 140;
                const ratio = img.naturalWidth / (img.naturalHeight || 1);
                const w = ratio >= 1 ? MAX : Math.round(MAX * ratio);
                const h = ratio >= 1 ? Math.round(MAX / ratio) : MAX;
                const cvs = document.createElement('canvas');
                cvs.width  = w || MAX;
                cvs.height = h || MAX;
                cvs.getContext('2d').drawImage(img, 0, 0, cvs.width, cvs.height);
                resolve(cvs.toDataURL('image/jpeg', 0.85));
            } catch (e) {
                // tainted canvas (CORS 미허용) → 원본 URL 폴백
                resolve(url);
            }
        };
        img.onerror = () => { clearTimeout(timer); resolve(url); };
        img.src = url;
    });
}

/* 여러 URL 동시 변환 → { url: base64 } map 반환 */
async function _wrFetchAllBase64(urls) {
    const unique = [...new Set(urls.filter(Boolean))];
    const pairs  = await Promise.all(unique.map(async u => [u, await _wrImgToBase64(u)]));
    return Object.fromEntries(pairs);
}

/* 현재 보고서에 등장하는 썸네일 URL 전체 수집 (캐시 활용) */
function _wrCollectThumbUrls() {
    const cache      = _wrRenderCache;
    const list       = cache ? cache.list       : _wrGetList();
    const byCreative = cache ? cache.byCreative : _wrByCreative(list);
    const byProduct  = cache ? cache.byProduct  : _wrByProductInsight(list);

    const urls = new Set();
    byCreative.forEach(c => { if (c.thumb) urls.add(c.thumb); });
    byProduct.forEach(pd => pd.top5.forEach(c => { if (c.thumb) urls.add(c.thumb); }));
    return [...urls];
}

/* ── 버튼 로딩 상태 ── */
function _wrBtnLoading(btnEl) {
    if (!btnEl) return;
    btnEl._origHtml = btnEl.innerHTML;
    btnEl._origBg   = btnEl.style.background;
    btnEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>이미지 변환 중…';
    btnEl.style.background = '#64748b';
    btnEl.disabled = true;
}
function _wrBtnDone(btnEl, ok) {
    if (!btnEl) return;
    if (ok) {
        btnEl.innerHTML = '<i class="fas fa-check mr-1"></i>복사됨!';
        btnEl.style.background = '#059669';
        btnEl.style.color = '#fff';
        setTimeout(() => {
            btnEl.innerHTML = btnEl._origHtml || '복사';
            btnEl.style.background = btnEl._origBg || '';
            btnEl.style.color = '';
            btnEl.disabled = false;
        }, 2400);
    } else {
        btnEl.innerHTML = btnEl._origHtml || '복사';
        btnEl.style.background = btnEl._origBg || '';
        btnEl.disabled = false;
    }
}

/* ── 클립보드 복사 실행 ── */
async function _wrDoCopy(htmlStr, btnEl) {
    try {
        if (navigator.clipboard && window.ClipboardItem) {
            const blob = new Blob([htmlStr], { type: 'text/html' });
            await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]);
        } else {
            // 폴백: execCommand (plain HTML)
            const el = document.createElement('div');
            el.innerHTML = htmlStr;
            el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
            document.body.appendChild(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.addRange(range);
            document.execCommand('copy');
            sel.removeAllRanges();
            document.body.removeChild(el);
        }
        _wrBtnDone(btnEl, true);
    } catch (e) {
        console.error('[WR] copy failed:', e);
        _wrBtnDone(btnEl, false);
        alert('복사 실패. 브라우저 클립보드 권한을 허용해주세요.');
    }
}

/* ── 이미지 base64 변환 → HTML 빌드 → 복사 (통합 플로우) ── */
async function _wrCopyWithImages(sections, btnEl) {
    _wrBtnLoading(btnEl);
    try {
        // 0) CEP 검증 데이터 확보 (판정 표·3줄 요약용 — 4초 내 미로드 시 해당 블록 없이 진행)
        if (typeof window.cepEnsureData === 'function') {
            await Promise.race([
                window.cepEnsureData().catch(() => {}),
                new Promise(r => setTimeout(r, 4000)),
            ]);
        }
        // 1) 썸네일 URL 수집 & 병렬 base64 변환
        const thumbUrls = _wrCollectThumbUrls();
        const imgMap    = thumbUrls.length ? await _wrFetchAllBase64(thumbUrls) : {};

        // 2) imgMap을 주입해서 HTML 빌드
        const html = _wrBuildConfluenceHtml(sections, imgMap);

        // 3) 클립보드 복사
        await _wrDoCopy(html, btnEl);
    } catch(e) {
        console.error('[WR] _wrCopyWithImages error:', e);
        _wrBtnDone(btnEl, false);
    }
}

window._wrCopySection = function(section, btnEl) { _wrCopyWithImages([section], btnEl); };
window._wrCopyAll     = function(btnEl)          { _wrCopyWithImages(null,      btnEl); };

/* ── 외부에서 캐시 무효화 시 재렌더 트리거 ── */
window._invalidateWrCache = function() {
    const panel = document.querySelector('.section-panel[data-panel="weekly"]');
    if (panel && panel.classList.contains('active')) {
        // 브랜드/데이터 변경 시 선택 제품/이벤트가 새 브랜드에 없을 수 있으므로 리셋
        _wr.product = '';
        _wr.event   = '';
        const ps = document.getElementById('wr-product-sel');
        const es = document.getElementById('wr-event-sel');
        if (ps) ps.value = '';
        if (es) es.value = '';
        renderWeeklyReport();
    }
};
