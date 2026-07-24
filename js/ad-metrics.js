// ============================================================
//  광고 지표 탭
//  data/ad-performance.csv (일자별 광고 지표) 를
//  data/promotions.csv (이벤트 일정 마스터) 와 대조해
//  [이벤트 선택 → 매체별 ROAS · 일자별 추이 · 제품별] 로 보여준다.
//  - 어떤 이벤트 기간(+리테일)에도 안 걸리는 행은 '상시광고'.
//  - 제품은 광고명에서 키워드로 추정(사전 기반) — 미매칭은 '기타'.
// ============================================================

const AM_AD_URL = 'data/ad-performance.csv';
const AM_PROMO_URL = 'data/promotions.csv';

let _amRows = null;          // [{date, brand, retail, media, product, event, imp, click, cost, cv, rev}]
let _amEvents = null;        // [{start, end, name, grade, retail}]
let _amLoadPromise = null;
let _amSelectedEvent = '전체';
let _amDailyChart = null;
let _amMediaChart = null;

// ── 숫자 파싱: "381,724" · "161%" · "" → number ──
function _amNum(v) {
    if (v == null) return 0;
    const n = parseFloat(String(v).replace(/[₩%,\s]/g, ''));
    return isNaN(n) ? 0 : n;
}
function _amEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _amKRW(v) { return '₩' + Math.round(v).toLocaleString(); }
function _amKRWshort(v) {
    const a = Math.abs(v);
    if (a >= 1e8) return '₩' + (v / 1e8).toFixed(1) + '억';
    if (a >= 1e4) return '₩' + Math.round(v / 1e4).toLocaleString() + '만';
    return '₩' + Math.round(v).toLocaleString();
}
function _amInt(v) { return Math.round(v).toLocaleString(); }
function _amPct(v) { return (v || 0).toFixed(0) + '%'; }

// ── 매체 정규화: SingleOne_ 접두 제거 → 플랫폼 단위 ──
function _amMedia(raw) {
    let s = (raw || '').trim();
    s = s.replace(/^SingleOne[_-]?/i, '');
    const low = s.toLowerCase();
    if (low.includes('meta')) return 'Meta';
    if (low.includes('tiktok')) return 'TikTok';
    if (low.includes('google')) return 'Google';
    if (low.includes('criteo')) return 'Criteo';
    if (low.startsWith('line')) return 'LINE';
    if (low === 'x') return 'X';
    if (low.includes('logicad')) return 'LOGICAD';
    if (low.includes('qanda')) return 'Qanda';
    return s || '기타';
}

// ── 제품 추정: 광고명 키워드 사전 (앞쪽 = 우선순위 높음) ──
const AM_PRODUCTS = [
    { name: '크림더블', kw: ['크림더블', 'クリームダブル', 'CreamDouble'] },
    { name: '아사츄르', kw: ['아사츄르', '요루탄', 'アサチュル', 'ヨルタン', 'Asachuru'] },
    { name: '소프트블러링 아이팔레트', kw: ['소블아', '소프트블러', 'ソフトブラー', 'SoftBlur'] },
    { name: '심리스 파운데이션', kw: ['심리스웨어', '심리스위어', 'シームレス', 'Seamless'] },
    { name: '겔미스트', kw: ['겔미스트', '세럼미스트', 'ゲルミスト', 'GelMist', 'コラーゲンミスト'] },
    { name: '3D크림', kw: ['3D', '本格的ハリ', 'ハリケア', 'ハリケアセット'] },
    { name: '슈링크(PDRN)', kw: ['슈링크', 'シュリンク', 'Shurink', 'PDRN'] },
    { name: '워터풀글로우틴트', kw: ['워터풀글로우', 'ウォータフルグロウ', 'WaterfulGlow'] },
    { name: '누디블러틴트', kw: ['누디블러', 'ヌーディーブラー', 'NudeBlur', 'NudieBlur'] },
    { name: '실버크러쉬 브러쉬', kw: ['실버크러쉬', '스파츌라', '스파출라', 'シルバー', 'SilverCrush'] },
    { name: 'NAD크림', kw: ['NAD'] },
    { name: '아이크림', kw: ['아이크림', 'アイクリーム', 'EyeCream'] },
    { name: '스킨버스터', kw: ['스킨버스터', 'SkinBuster'] },
    { name: '갸루키티세트', kw: ['갸루키티', 'GyaruKitty', 'ギャルキティ'] },
    { name: '콜라겐(기획)', kw: ['콜라겐', 'コラーゲン', 'Collagen'] },
];
function _amProduct(adName) {
    const s = adName || '';
    for (const p of AM_PRODUCTS) {
        if (p.kw.some(k => s.includes(k))) return p.name;
    }
    return '기타';
}

// ── 프로모션 마스터 → 이벤트 캘린더 ──
function _amBuildEvents(rows) {
    const events = [];
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    rows.forEach(r => {
        const start = (r[0] || '').trim();
        const end = (r[1] || '').trim();
        const grade = (r[2] || '').trim();
        const name = (r[3] || '').trim();
        const retail = (r[5] || '').trim();
        if (!dateRe.test(start) || !dateRe.test(end) || !name) return;
        if (retail !== 'Qoo10' && retail !== 'RKT') return;
        events.push({ start, end, name, grade, retail });
    });
    return events;
}

const _AM_GRADE_PRI = { S: 3, A: 2, B: 1, '': 0 };
// 날짜(+리테일)로 이벤트 매칭 — 겹치면 등급 높은 것 우선, 없으면 상시광고
function _amEventFor(date, retail) {
    let best = null;
    for (const e of _amEvents) {
        if (e.retail !== retail) continue;
        if (date < e.start || date > e.end) continue;
        if (!best || (_AM_GRADE_PRI[e.grade] || 0) > (_AM_GRADE_PRI[best.grade] || 0)) best = e;
    }
    return best ? best.name : '상시광고';
}

// ── 데이터 로드 (탭 첫 진입 시에만) ──
function _amEnsureData() {
    if (_amRows) return Promise.resolve(_amRows);
    if (!_amLoadPromise) {
        _amLoadPromise = Promise.all([
            fetch(AM_AD_URL, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('ad ' + r.status); return r.text(); }),
            fetch(AM_PROMO_URL, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('promo ' + r.status); return r.text(); }),
        ]).then(([adText, promoText]) => {
            const parse = (typeof parseCSV === 'function') ? parseCSV : _amParseCSVFallback;
            _amEvents = _amBuildEvents(parse(promoText));

            const rows = parse(adText);
            // 헤더 매핑
            const header = rows[0] || [];
            const idx = {};
            header.forEach((h, i) => { idx[(h || '').trim()] = i; });
            const col = {
                date: idx['날짜'], brand: idx['브랜드'], retail: idx['Retail'], media: idx['매체'],
                obj: idx['목적'], ctype: idx['소재타입'], adname: idx['광고명'],
                imp: idx['노출수'], click: idx['클릭수'], cost: idx['광고비(₩)'],
                cv: idx['구매수'], rev: idx['구매전환값(₩)'],
            };
            _amRows = [];
            for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                if (!r || r.length < 5) continue;
                const date = (r[col.date] || '').trim();
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
                const retail = (r[col.retail] || '').trim();
                _amRows.push({
                    date, brand: (r[col.brand] || '').trim(), retail,
                    media: _amMedia(r[col.media]),
                    adname: (r[col.adname] || '').trim() || '(광고명 없음)',
                    product: _amProduct(r[col.adname]),
                    event: _amEventFor(date, retail),
                    imp: _amNum(r[col.imp]), click: _amNum(r[col.click]),
                    cost: _amNum(r[col.cost]), cv: _amNum(r[col.cv]), rev: _amNum(r[col.rev]),
                });
            }
            return _amRows;
        }).finally(() => { _amLoadPromise = null; });
    }
    return _amLoadPromise;
}

function _amParseCSVFallback(text) {
    const rows = []; let cur = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i], n = text[i + 1];
        if (q) { if (c === '"' && n === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
        else {
            if (c === '"') q = true;
            else if (c === ',') { cur.push(field); field = ''; }
            else if (c === '\n' || c === '\r') { if (field !== '' || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ''; } if (c === '\r' && n === '\n') i++; }
            else field += c;
        }
    }
    if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
    return rows;
}

// ── 집계 ──
function _amAgg(list) {
    const s = { imp: 0, click: 0, cost: 0, cv: 0, rev: 0 };
    list.forEach(r => { s.imp += r.imp; s.click += r.click; s.cost += r.cost; s.cv += r.cv; s.rev += r.rev; });
    s.ctr = s.imp > 0 ? s.click / s.imp * 100 : 0;
    s.roas = s.cost > 0 ? s.rev / s.cost * 100 : 0;
    s.cpa = s.cv > 0 ? s.cost / s.cv : 0;
    return s;
}
function _amGroup(list, keyFn) {
    const m = new Map();
    list.forEach(r => { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return [...m.entries()].map(([k, rows]) => ({ key: k, ...(_amAgg(rows)) }));
}

function _amBrand() {
    return (typeof currentBrand !== 'undefined' && currentBrand && currentBrand !== 'ALL') ? currentBrand : '';
}

// ── 렌더 ──
window.renderAdMetrics = function () {
    const root = document.getElementById('admetrics-root');
    if (!root) return;
    root.innerHTML = `<div class="text-center text-slate-300 py-16"><i class="fas fa-spinner fa-spin text-4xl mb-3 opacity-30"></i><p class="text-sm">광고 지표 불러오는 중…</p></div>`;
    _amEnsureData().then(() => _amRender()).catch(e => {
        root.innerHTML = `<div class="text-center text-rose-400 py-16"><i class="fas fa-triangle-exclamation text-4xl mb-3 opacity-40"></i><p class="text-sm">데이터를 불러오지 못했습니다 (${_amEsc(e.message)})</p></div>`;
    });
};

function _amEventOptions(brandRows) {
    // 이 브랜드 데이터에 실제 존재하는 이벤트만, 최근(시작일) 순
    const present = new Set(brandRows.map(r => r.event));
    const evMeta = new Map(_amEvents.map(e => [e.name, e]));
    const named = [...present].filter(n => n !== '상시광고');
    named.sort((a, b) => {
        const ea = evMeta.get(a), eb = evMeta.get(b);
        return (eb ? eb.start : '').localeCompare(ea ? ea.start : '');
    });
    const opts = ['전체', ...named];
    if (present.has('상시광고')) opts.push('상시광고');
    return opts;
}

function _amRender() {
    const root = document.getElementById('admetrics-root');
    if (!root) return;
    const brand = _amBrand();
    const brandRows = brand ? _amRows.filter(r => r.brand === brand) : _amRows;

    const options = _amEventOptions(brandRows);
    if (!options.includes(_amSelectedEvent)) _amSelectedEvent = '전체';

    const rows = _amSelectedEvent === '전체' ? brandRows : brandRows.filter(r => r.event === _amSelectedEvent);
    const evMeta = _amEvents.find(e => e.name === _amSelectedEvent);
    const total = _amAgg(rows);

    // 이벤트 셀렉트
    const selHtml = `
        <div class="am-toolbar">
            <span class="am-tl-lbl"><i class="fas fa-calendar-star"></i> 이벤트</span>
            <select id="am-event-sel" class="am-select">
                ${options.map(o => `<option value="${_amEsc(o)}"${o === _amSelectedEvent ? ' selected' : ''}>${_amEsc(o)}${o === '전체' ? ` (전체 기간)` : ''}</option>`).join('')}
            </select>
            ${evMeta ? `<span class="am-ev-meta">${evMeta.start} ~ ${evMeta.end} · ${_amEsc(evMeta.retail)}${evMeta.grade ? ` · ${evMeta.grade}급` : ''}</span>`
            : (_amSelectedEvent === '상시광고' ? `<span class="am-ev-meta">이벤트 기간에 걸리지 않는 상시 운영 광고</span>` : `<span class="am-ev-meta">${brand || '전체 브랜드'} · 전 기간 합산</span>`)}
        </div>`;

    // KPI
    const kpis = [
        { l: '광고비', v: _amKRWshort(total.cost) },
        { l: '노출', v: _amInt(total.imp) },
        { l: '클릭', v: _amInt(total.click) },
        { l: 'CTR', v: total.ctr.toFixed(2) + '%' },
        { l: '구매수', v: _amInt(total.cv) },
        { l: '매출', v: _amKRWshort(total.rev) },
        { l: 'ROAS', v: _amPct(total.roas), hi: true },
        { l: 'CPA', v: total.cv > 0 ? _amKRWshort(total.cpa) : '-' },
    ];
    const kpiHtml = `<div class="am-kpis">${kpis.map(k => `
        <div class="am-kpi${k.hi ? ' am-kpi--hi' : ''}"><div class="am-kpi-l">${k.l}</div><div class="am-kpi-v">${k.v}</div></div>`).join('')}</div>`;

    // 매체별 ROAS
    const media = _amGroup(rows, r => r.media).filter(m => m.cost > 0).sort((a, b) => b.cost - a.cost);
    const mediaHtml = `
        <div class="am-card">
            <div class="am-card-h"><i class="fas fa-tower-broadcast"></i> 매체별 ROAS <span class="am-card-sub">광고비 큰 순</span></div>
            <div class="am-chart-wrap"><canvas id="am-media-chart"></canvas></div>
            <table class="am-table">
                <thead><tr><th>매체</th><th>광고비</th><th>비중</th><th>매출</th><th>ROAS</th><th>CTR</th><th>구매</th></tr></thead>
                <tbody>${media.map(m => `<tr>
                    <td class="am-t-name">${_amEsc(m.key)}</td>
                    <td>${_amKRWshort(m.cost)}</td>
                    <td>${total.cost > 0 ? (m.cost / total.cost * 100).toFixed(0) + '%' : '-'}</td>
                    <td>${_amKRWshort(m.rev)}</td>
                    <td class="am-t-roas ${m.roas >= 200 ? 'am-good' : m.roas >= 100 ? 'am-mid' : 'am-low'}">${_amPct(m.roas)}</td>
                    <td>${m.ctr.toFixed(2)}%</td>
                    <td>${_amInt(m.cv)}</td></tr>`).join('') || `<tr><td colspan="7" class="am-empty">데이터 없음</td></tr>`}</tbody>
            </table>
        </div>`;

    // 일자별 추이
    const dailyHtml = `
        <div class="am-card">
            <div class="am-card-h"><i class="fas fa-chart-line"></i> 일자별 추이 <span class="am-card-sub">광고비(막대) · ROAS(선)</span></div>
            <div class="am-chart-wrap am-chart-wrap--tall"><canvas id="am-daily-chart"></canvas></div>
        </div>`;

    // 제품별
    const products = _amGroup(rows, r => r.product).filter(p => p.cost > 0).sort((a, b) => b.rev - a.rev);
    // 기타(미분류) 상세 — 광고명별로 펼쳐보기
    const etcRows = rows.filter(r => r.product === '기타');
    const etcByName = _amGroup(etcRows, r => r.adname).filter(x => x.cost > 0).sort((a, b) => b.cost - a.cost);
    const etcHtml = etcByName.length ? `
        <details class="am-etc">
            <summary><i class="fas fa-chevron-right am-etc-chev"></i> 기타(미분류) 광고명 ${etcByName.length}개 펼쳐보기 <span class="am-card-sub">광고비 큰 순</span></summary>
            <table class="am-table am-etc-table">
                <thead><tr><th>광고명</th><th>광고비</th><th>매출</th><th>ROAS</th><th>구매</th></tr></thead>
                <tbody>${etcByName.slice(0, 60).map(e => `<tr>
                    <td class="am-t-name am-etc-name" title="${_amEsc(e.key)}">${_amEsc(e.key)}</td>
                    <td>${_amKRWshort(e.cost)}</td>
                    <td>${_amKRWshort(e.rev)}</td>
                    <td class="am-t-roas ${e.roas >= 200 ? 'am-good' : e.roas >= 100 ? 'am-mid' : 'am-low'}">${_amPct(e.roas)}</td>
                    <td>${_amInt(e.cv)}</td></tr>`).join('')}</tbody>
            </table>
            ${etcByName.length > 60 ? `<div class="am-etc-more">상위 60개만 표시 (전체 ${etcByName.length}개)</div>` : ''}
        </details>` : '';
    const prodHtml = `
        <div class="am-card">
            <div class="am-card-h"><i class="fas fa-boxes-stacked"></i> 제품별 <span class="am-card-sub">매출 큰 순 · 광고명 키워드 기반 추정</span></div>
            <table class="am-table">
                <thead><tr><th>제품</th><th>광고비</th><th>매출</th><th>ROAS</th><th>구매</th><th>CPA</th></tr></thead>
                <tbody>${products.map(p => `<tr${p.key === '기타' ? ' class="am-t-etc"' : ''}>
                    <td class="am-t-name">${_amEsc(p.key)}${p.key === '기타' ? ' <span class="am-etc-tag">↓ 아래 상세</span>' : ''}</td>
                    <td>${_amKRWshort(p.cost)}</td>
                    <td>${_amKRWshort(p.rev)}</td>
                    <td class="am-t-roas ${p.roas >= 200 ? 'am-good' : p.roas >= 100 ? 'am-mid' : 'am-low'}">${_amPct(p.roas)}</td>
                    <td>${_amInt(p.cv)}</td>
                    <td>${p.cv > 0 ? _amKRWshort(p.cpa) : '-'}</td></tr>`).join('') || `<tr><td colspan="6" class="am-empty">데이터 없음</td></tr>`}</tbody>
            </table>
            ${etcHtml}
        </div>`;

    root.innerHTML = `<div class="am-wrap">${selHtml}${kpiHtml}${mediaHtml}${dailyHtml}${prodHtml}</div>`;

    document.getElementById('am-event-sel').addEventListener('change', e => {
        _amSelectedEvent = e.target.value;
        _amRender();
    });

    _amDrawMediaChart(media);
    _amDrawDailyChart(rows);
}

function _amDrawMediaChart(media) {
    const cv = document.getElementById('am-media-chart');
    if (!cv || typeof Chart === 'undefined') return;
    if (_amMediaChart) _amMediaChart.destroy();
    const top = media.slice(0, 8);
    _amMediaChart = new Chart(cv, {
        type: 'bar',
        data: {
            labels: top.map(m => m.key),
            datasets: [{ label: 'ROAS %', data: top.map(m => Math.round(m.roas)), backgroundColor: top.map(m => m.roas >= 200 ? '#10b981' : m.roas >= 100 ? '#f59e0b' : '#f87171'), borderRadius: 4 }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `ROAS ${c.parsed.y}%` } } },
            scales: { y: { beginAtZero: true, ticks: { callback: v => v + '%' } } },
        },
    });
}

function _amDrawDailyChart(rows) {
    const cv = document.getElementById('am-daily-chart');
    if (!cv || typeof Chart === 'undefined') return;
    if (_amDailyChart) _amDailyChart.destroy();
    const byDay = _amGroup(rows, r => r.date).sort((a, b) => a.key.localeCompare(b.key));
    _amDailyChart = new Chart(cv, {
        data: {
            labels: byDay.map(d => d.key),
            datasets: [
                { type: 'bar', label: '광고비', data: byDay.map(d => Math.round(d.cost)), backgroundColor: '#c7d2fe', yAxisID: 'y', order: 2 },
                { type: 'line', label: 'ROAS %', data: byDay.map(d => Math.round(d.roas)), borderColor: '#6366f1', backgroundColor: '#6366f1', pointRadius: byDay.length > 40 ? 0 : 2, borderWidth: 2, yAxisID: 'y1', order: 1, tension: 0.25 },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: { label: c => c.dataset.yAxisID === 'y1' ? `ROAS ${c.parsed.y}%` : `광고비 ₩${c.parsed.y.toLocaleString()}` } },
            },
            scales: {
                x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 10 } } },
                y: { position: 'left', beginAtZero: true, title: { display: true, text: '광고비', font: { size: 10 } }, ticks: { callback: v => v >= 1e4 ? (v / 1e4) + '만' : v, font: { size: 10 } } },
                y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'ROAS %', font: { size: 10 } }, ticks: { callback: v => v + '%', font: { size: 10 } } },
            },
        },
    });
}
