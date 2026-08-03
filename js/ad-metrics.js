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
const AM_CREATIVES_URL = 'data/creatives.csv';
// 이 날짜 이후는 creatives 탭(event 컬럼) 기반으로 이벤트 라벨링 (과거=ad-performance+promotions)
const AM_FUTURE_CUTOFF = '2026-08-01';
// creatives event 컬럼값 중 실제 행사가 아닌 것(상시/타겟팅)
const AM_NON_EVENTS = new Set(['AO', 'RT', 'UA', 'ao', 'rt', 'ua', '']);
// creatives event(반복 행사) → 'N월 EVENT' 라벨 (예: 8월 Megapo → '8월 MEGAPO')
function _amCreativeEvent(code, date) {
    const c = (code || '').trim();
    if (AM_NON_EVENTS.has(c)) return '상시광고';
    const m = parseInt((date || '').slice(5, 7), 10);
    return (m ? m + '월 ' : '') + c.toUpperCase();
}

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

// ── 기간 비교용 날짜 헬퍼 ──
function _amShiftDays(d, n) { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
function _amShiftYears(d, n) { const x = new Date(d + 'T00:00:00'); x.setFullYear(x.getFullYear() + n); return x.toISOString().slice(0, 10); }
function _amDaysInclusive(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000) + 1; }
// 이벤트명에서 회차 접두(2607 / 262Q / 8월 등) 제거 → 이벤트 '유형'
// (예: '2607 메가포' → '메가포', '8월 MEGAPO' → 'MEGAPO')
function _amEventType(name) { return (name || '').replace(/^\s*(\d{3,4}[QqＱ]?|\d{1,2}월)\s+/, '').trim(); }
// 증감 셀: goodUp=true면 상승이 긍정(초록). 비교 기간 값이 0이면 '-'
function _amDeltaCell(cur, prev, goodUp) {
    if (!prev) return '<td class="am-d-na">-</td>';
    const d = (cur - prev) / prev * 100;
    const up = d >= 0;
    const good = goodUp ? up : !up;
    return `<td class="am-delta ${good ? 'am-good' : 'am-low'}">${up ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%</td>`;
}

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

// ── 제품 추정: 광고명 키워드 사전 (브랜드별 + 앞쪽 = 우선순위 높음) ──
// brand를 지정하면 그 브랜드 행에서만 매칭 → WM 광고에 섞인 BOH 제품명(크림더블 등)이
// WM 제품으로 잘못 잡히는 것을 방지. 같은 브랜드 안에서는 구체적 변형을 앞에 둔다.
const AM_PRODUCTS = [
    // ── CG (컬러그램) — 한국어 제품명, 구체 변형을 앞에 ──
    { name: '탕후루 밀크', brand: 'CG', kw: ['タンフルグラスティントミルク', 'タンフルーティント ミルク', 'タンフルミルク', 'T-Milk'] },
    { name: '탕후루 딥글레이즈', brand: 'CG', kw: ['タンフルグラスティントディープグレーズ', 'タンフルディープグレーズ', 'T-DeepGlaze', 'DeepGlaze', 'ディープグレーズ'] },
    { name: '탕후루 틴트', brand: 'CG', kw: ['タンフルグラスティント', 'タンフルーティント', 'タンフル', 'Tanghuru', 'Tanfru', 'Tanful'] },
    { name: '컬러커버틴트', brand: 'CG', kw: ['ColorCoverTint', 'カラーカバー', 'ギークヌードカラーカバー'] },
    { name: '누디블러 틴트', brand: 'CG', kw: ['ヌーディーブラー', 'ヌーディブラー', 'NudeBlur', 'NudieBlur', 'NudyBlur', 'Noody', '누디블러'] },
    { name: '쥬시잼 블러틴트', brand: 'CG', kw: ['ジューシージャム', 'JuicyJam'] },
    { name: '입체창조 쉐딩스틱', brand: 'CG', kw: ['ShadingStick', 'シェーディングスティック', '쉐딩스틱'] },
    { name: '젤리빔 스틱', brand: 'CG', kw: ['ジェリービーム', 'JellyBeam'] },
    { name: '애교살 메이커', brand: 'CG', kw: ['AegyoMaker', '애교살', '애교메이커', '目元チュートリアル', 'チュートリアルアイパレット'] },
    { name: '립듀오 세트', brand: 'CG', kw: ['LipDuoSet', 'LipDuo', '립듀오', 'リップデュオ'] },
    { name: '래스팅 글로우 스틱', brand: 'CG', kw: ['LastingGlowStick', 'LastingGlow', '래스팅글로우', 'ラスティンググロウ'] },
    { name: '짱구 콜라보', brand: 'CG', kw: ['クレヨンしんちゃん', 'Shinchan', '짱구'] },
    // ── WM (웨이크메이크) ──
    { name: '소프트블러링 아이팔레트', brand: 'WM', kw: ['소블아', '소프트블러', 'ソフトブラー', 'SoftBlurEye', 'SoftBlur'] },
    { name: '심리스 파운데이션', brand: 'WM', kw: ['심리스웨어', '심리스위어', 'シームレス', 'Seamless', 'SeamlessFd'] },
    { name: '워터풀글로우 틴트', brand: 'WM', kw: ['워터풀글로우', 'ウォータフルグロウ', 'WaterfulGlow'] },
    { name: '소프트시어 멀티팔레트', brand: 'WM', kw: ['ソフトシアーマルチパレット', 'シアーマルチパレット', 'SoftSheer', 'SheerMulti'] },
    { name: '셰이킹블러 치크', brand: 'WM', kw: ['シェイキングブラーチーク', 'シェイキング', 'ShakingBlur', 'Shebulchi'] },
    { name: '스테이픽서 파우더', brand: 'WM', kw: ['ステイフィクサー', 'StayFixer'] },
    { name: '갸루키티 세트', brand: 'WM', kw: ['갸루키티', 'GyaruKitty', 'ギャルキティ', 'GyaruKittySET'] },
    { name: '파데 브러시', brand: 'WM', kw: ['FdBrush', 'FoundationBrush', 'ファンデーションブラシ', 'スパチュラワイド'] },
    { name: '실버크러쉬 브러쉬', brand: 'WM', kw: ['실버크러쉬', '스파츌라', '스파출라', 'SilverCrush'] },
    { name: '베이스락 세트', brand: 'WM', kw: ['BaseLockSET', 'BaseLock'] },
    { name: '하이글로우밤', brand: 'WM', kw: ['H-GlowBalm', 'GlowBalm', '글로우밤'] },
    { name: '래스팅 글로우 스틱', brand: 'WM', kw: ['LastingGlowStick', 'LastingGlow', '래스팅글로우'] },
    { name: '립듀오 세트', brand: 'WM', kw: ['LipDuoSet', 'LipDuo', '립듀오'] },
    { name: '6색 팔레트', brand: 'WM', kw: ['6色パレット', '6색팔레트'] },
    // ── BOH (스킨케어: 탄탄크림 라인) ──
    { name: '아사츄르', brand: 'BOH', kw: ['아사츄르', '요루탄', '朝ちゅる', '夜タン', 'アサチュル', 'Asachuru'] },
    { name: '크림더블', brand: 'BOH', kw: ['크림더블', 'クリームダブル', 'CreamDouble'] },
    { name: '겔미스트', brand: 'BOH', kw: ['겔미스트', '세럼미스트', 'ゲルミスト', 'GelMist', 'コラーゲンミスト', 'CollagenMist'] },
    { name: '3D크림(탄탄)', brand: 'BOH', kw: ['3D', '本格的ハリ', 'ハリケア', 'タンタン弾力', '弾力ケア', '3Dクリーム', '3D-refill', '3DCream', 'Refill', 'タンタン'] },
    { name: '콜라겐', brand: 'BOH', kw: ['콜라겐', 'コラーゲン', 'Collagen'] },
    { name: 'NAD크림', brand: 'BOH', kw: ['NAD'] },
    { name: '슈링크', brand: 'BOH', kw: ['슈링크', 'シュリンク', 'Shurink', 'PDRN'] },
    { name: '스킨버스터', brand: 'BOH', kw: ['스킨버스터', 'SkinBuster'] },
    { name: '아이크림', brand: 'BOH', kw: ['아이크림', 'アイクリーム', 'EyeCream'] },
    { name: '3스텝세트', brand: 'BOH', kw: ['3StepSet', '3스텝'] },
    { name: '클렌징밤', brand: 'BOH', kw: ['클렌징밤', 'クレンジングバーム'] },
    { name: '기획박스(세트)', brand: 'BOH', kw: ['GiftBox', '기획박스'] },
];
function _amProduct(adName, brand) {
    const s = adName || '';
    for (const p of AM_PRODUCTS) {
        if (p.brand && p.brand !== brand) continue;   // 같은 브랜드에서만 매칭
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
            fetch(AM_CREATIVES_URL, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => ''),
        ]).then(([adText, promoText, crText]) => {
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
            // 1) 과거(CUTOFF 이전): ad-performance — 이벤트는 promotions 날짜+리테일 대조
            for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                if (!r || r.length < 5) continue;
                const date = (r[col.date] || '').trim();
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= AM_FUTURE_CUTOFF) continue;
                const retail = (r[col.retail] || '').trim();
                _amRows.push({
                    date, brand: (r[col.brand] || '').trim(), retail,
                    media: _amMedia(r[col.media]),
                    adname: (r[col.adname] || '').trim() || '(광고명 없음)',
                    product: _amProduct(r[col.adname], (r[col.brand] || '').trim()),
                    event: _amEventFor(date, retail),
                    imp: _amNum(r[col.imp]), click: _amNum(r[col.click]),
                    cost: _amNum(r[col.cost]), cv: _amNum(r[col.cv]), rev: _amNum(r[col.rev]),
                });
            }
            // 2) 미래(CUTOFF 이후): creatives 탭 — 이벤트는 event 컬럼(N월 라벨). cost/sales 이미 원화.
            if (crText) _amAddCreativeRows(parse(crText));
            // 3) creatives 기반 미래 이벤트를 캘린더에 합성 추가 (직전/전년 비교 가능하도록)
            _amAddFutureEvents();
            return _amRows;
        }).finally(() => { _amLoadPromise = null; });
    }
    return _amLoadPromise;
}

// creatives.csv(미래 CUTOFF 이후)를 _amRows에 추가 — event 컬럼으로 이벤트 라벨링
function _amAddCreativeRows(crows) {
    if (!crows || crows.length < 2) return;
    const h = crows[0] || [];
    const ci = {};
    h.forEach((c, i) => { ci[(c || '').trim().toLowerCase()] = i; });
    const cc = {
        date: ci['date'], brand: ci['brand'], retail: ci['retail'], media: ci['media'],
        adname: ci['ad_name'], imp: ci['impressions'], click: ci['clicks'],
        cost: ci['cost'], rev: ci['sales'], cv: ci['conversions'], event: ci['event'],
    };
    if (cc.date == null) return;
    for (let i = 1; i < crows.length; i++) {
        const r = crows[i]; if (!r) continue;
        const date = (r[cc.date] || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < AM_FUTURE_CUTOFF) continue;
        const brand = (r[cc.brand] || '').trim();
        _amRows.push({
            date, brand, retail: (r[cc.retail] || '').trim(),
            media: _amMedia(r[cc.media]),
            adname: (r[cc.adname] || '').trim() || '(광고명 없음)',
            product: _amProduct(r[cc.adname], brand),
            event: _amCreativeEvent(r[cc.event], date),
            imp: _amNum(r[cc.imp]), click: _amNum(r[cc.click]),
            cost: _amNum(r[cc.cost]), cv: _amNum(r[cc.cv]), rev: _amNum(r[cc.rev]),
        });
    }
}

// creatives 기반 미래 이벤트(예: '8월 MEGAPO')를 날짜범위·리테일과 함께 _amEvents에 합성 추가
function _amAddFutureEvents() {
    const fut = new Map();
    _amRows.forEach(r => {
        if (r.date < AM_FUTURE_CUTOFF || r.event === '상시광고') return;
        if (!fut.has(r.event)) fut.set(r.event, { min: r.date, max: r.date, retail: {} });
        const f = fut.get(r.event);
        if (r.date < f.min) f.min = r.date;
        if (r.date > f.max) f.max = r.date;
        f.retail[r.retail] = (f.retail[r.retail] || 0) + 1;
    });
    fut.forEach((f, name) => {
        if (_amEvents.some(e => e.name === name)) return;
        const retail = (Object.entries(f.retail).sort((a, b) => b[1] - a[1])[0] || [''])[0];
        _amEvents.push({ start: f.min, end: f.max, name, grade: '', retail });
    });
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
    const brandAll = brand ? _amRows.filter(r => r.brand === brand) : _amRows; // 직전/전년 비교용(날짜필터 무관)
    // 우측 상단 전역 날짜 필터 반영 (dateFrom/dateTo는 main.js 전역)
    const _df = (typeof dateFrom !== 'undefined' && dateFrom) ? dateFrom : '';
    const _dt = (typeof dateTo !== 'undefined' && dateTo) ? dateTo : '';
    let brandRows = brandAll;
    if (_df) brandRows = brandRows.filter(r => r.date >= _df);
    if (_dt) brandRows = brandRows.filter(r => r.date <= _dt);

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
            ${(_df || _dt) ? `<span class="am-date-chip"><i class="fas fa-calendar-day"></i> ${_df || '처음'} ~ ${_dt || '끝'}</span>` : ''}
            ${evMeta ? `<span class="am-ev-meta">${evMeta.start} ~ ${evMeta.end} · ${_amEsc(evMeta.retail)}${evMeta.grade ? ` · ${evMeta.grade}급` : ''}</span>`
            : (_amSelectedEvent === '상시광고' ? `<span class="am-ev-meta">이벤트 기간에 걸리지 않는 상시 운영 광고</span>` : `<span class="am-ev-meta">${brand || '전체 브랜드'} · ${(_df || _dt) ? '선택 기간' : '전 기간'} 합산</span>`)}
        </div>`;

    // 합계 요약 표 (+ 직전 행사 · 전년 동행사 증감)
    // 직전/전년은 '같은 이벤트 유형'의 이전 회차·1년 전 회차와 비교
    // (예: 7월 메가포 → 직전=직전 메가포(5월), 전년=작년 7월 메가포). 같은 리테일끼리만 매칭.
    let prevAgg = null, yoyAgg = null, cmpLabel = '';
    if (evMeta) {
        const curType = _amEventType(evMeta.name);
        const sameType = _amEvents
            .filter(e => e.retail === evMeta.retail && _amEventType(e.name) === curType)
            .sort((a, b) => a.start.localeCompare(b.start));
        const idx = sameType.findIndex(e => e.name === evMeta.name);
        const prevEv = idx > 0 ? sameType[idx - 1] : null;
        // 전년 동행사: 같은 유형 중 시작일이 (올해 시작 -1년)에 가장 가까운 회차 (90일 이내)
        const yTarget = _amShiftYears(evMeta.start, -1);
        let yoyEv = null, best = Infinity;
        sameType.forEach(e => {
            if (e.name === evMeta.name) return;
            const diff = Math.abs((new Date(e.start) - new Date(yTarget)) / 86400000);
            if (diff <= 90 && diff < best) { best = diff; yoyEv = e; }
        });
        if (prevEv) prevAgg = _amAgg(brandAll.filter(r => r.event === prevEv.name));
        if (yoyEv) yoyAgg = _amAgg(brandAll.filter(r => r.event === yoyEv.name));
        cmpLabel = `직전: ${prevEv ? _amEsc(prevEv.name) : '없음'} · 전년: ${yoyEv ? _amEsc(yoyEv.name) : '없음'}`;
    }
    const metricDefs = [
        { l: '광고비', f: v => _amKRWshort(v.cost), g: false, k: 'cost' },
        { l: '노출', f: v => _amInt(v.imp), g: true, k: 'imp' },
        { l: '클릭', f: v => _amInt(v.click), g: true, k: 'click' },
        { l: 'CTR', f: v => v.ctr.toFixed(2) + '%', g: true, k: 'ctr' },
        { l: '구매수', f: v => _amInt(v.cv), g: true, k: 'cv' },
        { l: '매출', f: v => _amKRWshort(v.rev), g: true, k: 'rev' },
        { l: 'ROAS', f: v => _amPct(v.roas), g: true, k: 'roas' },
        { l: 'CPA', f: v => v.cv > 0 ? _amKRW(v.cpa) : '-', g: false, k: 'cpa' },
    ];
    const hasCmp = !!evMeta;
    const cmpPair = (m, agg) => agg
        ? `<td>${m.f(agg)}</td>${_amDeltaCell(total[m.k], agg[m.k], m.g)}`
        : `<td class="am-d-na">-</td><td class="am-d-na">-</td>`;
    const kpiHtml = `
        <div class="am-card am-sum-card">
            <div class="am-card-h"><i class="fas fa-calculator"></i> 합계 ${hasCmp ? `<span class="am-card-sub">${cmpLabel}</span>` : `<span class="am-card-sub">${_amEsc(brand || '전체 브랜드')} · ${_amEsc(_amSelectedEvent)}</span>`}</div>
            <table class="am-table am-sum-table">
                <thead><tr><th>지표</th><th>현재</th>${hasCmp ? '<th>직전 행사</th><th>직전비</th><th>전년 동행사</th><th>YoY</th>' : ''}</tr></thead>
                <tbody>${metricDefs.map(m => `<tr>
                    <td class="am-t-name">${m.l}</td>
                    <td class="am-sum-cur">${m.f(total)}</td>
                    ${hasCmp ? cmpPair(m, prevAgg) + cmpPair(m, yoyAgg) : ''}
                </tr>`).join('')}</tbody>
            </table>
            ${!hasCmp ? `<p class="am-sum-note">특정 이벤트를 선택하면 직전 행사·전년 동행사 증감이 표시됩니다.</p>` : `<p class="am-sum-note">직전 행사·전년 동행사 = 같은 이벤트 유형의 이전 회차 / 1년 전 회차 기준.</p>`}
        </div>`;

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

    // 일자별 추이 (그래프 + 접이식 상세표)
    const byDayDetail = _amGroup(rows, r => r.date).sort((a, b) => a.key.localeCompare(b.key));
    const dailyDetailHtml = byDayDetail.length ? `
        <details class="am-daily-detail">
            <summary><i class="fas fa-chevron-right am-etc-chev"></i> 일자별 상세 지표 ${byDayDetail.length}일 펼쳐보기</summary>
            <div class="am-daily-scroll">
            <table class="am-table am-daily-table">
                <thead><tr><th>날짜</th><th>광고비</th><th>노출</th><th>클릭</th><th>CTR</th><th>구매</th><th>매출</th><th>ROAS</th><th>CPA</th></tr></thead>
                <tbody>${byDayDetail.map(d => `<tr>
                    <td class="am-t-name">${d.key}</td>
                    <td>${_amKRWshort(d.cost)}</td>
                    <td>${_amInt(d.imp)}</td>
                    <td>${_amInt(d.click)}</td>
                    <td>${d.ctr.toFixed(2)}%</td>
                    <td>${_amInt(d.cv)}</td>
                    <td>${_amKRWshort(d.rev)}</td>
                    <td class="am-t-roas ${d.roas >= 200 ? 'am-good' : d.roas >= 100 ? 'am-mid' : 'am-low'}">${_amPct(d.roas)}</td>
                    <td>${d.cv > 0 ? _amKRW(d.cpa) : '-'}</td></tr>`).join('')}</tbody>
            </table></div>
        </details>` : '';
    const dailyHtml = `
        <div class="am-card">
            <div class="am-card-h"><i class="fas fa-chart-line"></i> 일자별 추이 <span class="am-card-sub">광고비(막대) · ROAS(선)</span></div>
            <div class="am-chart-wrap am-chart-wrap--tall"><canvas id="am-daily-chart"></canvas></div>
            ${dailyDetailHtml}
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
                    <td>${p.cv > 0 ? _amKRW(p.cpa) : '-'}</td></tr>`).join('') || `<tr><td colspan="6" class="am-empty">데이터 없음</td></tr>`}</tbody>
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
