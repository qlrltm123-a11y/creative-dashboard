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
// 실제 값은 로드 시 creatives 시트 첫 날짜(2026-04-28)로 덮어씀 — 그 이후 행은 시트 AB열(event)·AC열
// (Teaser/MainEvent) 기준으로 행사를 판정하고, 이전 행만 promotions.csv 일정(날짜 겹침)으로 판정한다.
let AM_FUTURE_CUTOFF = '2026-08-01';
// AB열 값 중 특정 행사가 아닌 것 — 캠페인명 표기로 다시 판정 (AO는 날짜 겹침으로 행사 편입 판정)
const AM_NON_EVENTS = new Set(['AO', 'RT', 'UA', 'ao', 'rt', 'ua', '', '#REF!']);
// 캠페인명의 행사 표기 (예: ..._Purchase_UA_Megapo_261001 → MEGAPO, ..._JP_AO_AO_RT_... → AO)
const AM_CAMP_EVENT_RE = /_(After-Megawari|Megawari|Megapo|SuperSale|Marathon|Kankos|Kamitoku|AO)(?=_|$)/i;
// 시트 AB열 값 우선, AO는 'AO'(이후 날짜 겹침으로 판정), RT/UA/#REF!/공란·시트 미등록 캠페인은 캠페인명 표기로 판정
function _amEventCode(abValue, camp) {
    const c = (abValue || '').trim();
    if (/^ao$/i.test(c)) return 'AO';
    if (c && !AM_NON_EVENTS.has(c)) return c.toUpperCase();
    const m = (camp || '').match(AM_CAMP_EVENT_RE);
    return m ? m[1].toUpperCase() : null;
}
// 같은 유형 이벤트 사이 공백이 이 일수 이하면 한 회차(티저→본행사→애프터)로 묶는다.
const AM_ROUND_GAP_DAYS = 4;

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
// UTC 기준으로 계산 — 로컬 자정을 toISOString하면 KST에서 하루 밀린다.
function _amShiftDays(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function _amShiftYears(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCFullYear(x.getUTCFullYear() + n); return x.toISOString().slice(0, 10); }
function _amDaysInclusive(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000) + 1; }
// 이벤트명에서 회차 접두(2607 / 262Q / 8월 등) 제거 → 이벤트 '유형'
// (예: '2607 메가포' → '메가포', '8월 MEGAPO' → 'MEGAPO')
function _amEventType(name) { return (name || '').replace(/^\s*(\d{3,4}[QqＱ]?|\d{1,2}월)\s+/, '').trim(); }
// 과거(한국어 프로모션명 "메가포")와 미래(creatives 영문 코드 "MEGAPO")는 같은 행사인데 표기 언어가
// 달라 _amEventType만으로는 '다른 유형'으로 갈린다 → 캐노니컬 키로 묶어 직전/전년 비교가
// 과거·미래 데이터 경계를 넘어 매칭되게 한다. (본행사/애프터/티저 등 세부 접미는 뭉뚱그림 —
// creatives의 미래 이벤트가 그 세부 구분 없이 들어오기 때문)
const AM_EVENT_CANON = [
    { canon: 'MEGAWARI(QOO10LIVE)', kw: ['MEGAWARI(QOO10LIVE)', '메가와리(QOO10LIVE)'] },
    { canon: 'MEGAWARI', kw: ['메가와리', 'MEGAWARI'] },
    { canon: 'MEGAPO', kw: ['메가포', 'MEGAPO'] },
    { canon: 'SUPERSALE', kw: ['슈퍼세일', 'SUPERSALE'] },
    { canon: 'MARATHON', kw: ['마라톤', 'MARATHON'] },
    { canon: 'KAMITOKU', kw: ['카미토쿠', 'KAMITOKU'] },
    { canon: 'KANKOS', kw: ['칸코스', 'KANKOS'] },
    { canon: 'HATSUURI', kw: ['하츠우리', 'HATSUURI'] },
];
function _amCanonicalType(name) {
    const stripped = _amEventType(name);
    const up = stripped.toUpperCase();
    for (const c of AM_EVENT_CANON) {
        if (c.kw.some(k => stripped.includes(k) || up.includes(k.toUpperCase()))) return c.canon;
    }
    return up; // 매핑 안 된 유형은 기존처럼 이름 그대로 비교(정확히 같은 이름끼리만 매칭)
}
// 회차 내 구간: 티저/애프터/본행사. creatives 기반 'N월 CODE'는 티저+본행사가 한 라벨로
// 섞여 있어 'all'로 본다.
function _amEvPart(name) {
    const s = (name || '').toUpperCase();
    if (/애프터|AFTER/.test(s)) return 'after';
    if (/티져|티저|TEASER/.test(s)) return 'teaser';
    return /^\d{1,2}월\s/.test(name || '') ? 'all' : 'main';
}
// 현재 구간과 비교할 상대 회차의 구간 (본행사끼리, 티저끼리 … / 'all'은 티저+본행사)
const AM_PART_MATCH = { all: ['teaser', 'main', 'all'], main: ['main', 'all'], teaser: ['teaser'], after: ['after'] };
// 같은 리테일·같은 유형 이벤트를 날짜순으로 이어 붙여 회차 목록 생성
function _amRoundsOf(retail, canon) {
    const evs = _amEvents
        .filter(e => e.retail === retail && _amCanonicalType(e.name) === canon)
        .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    const rounds = [];
    evs.forEach(e => {
        const last = rounds[rounds.length - 1];
        if (last && _amDaysInclusive(last.end, e.start) - 1 <= AM_ROUND_GAP_DAYS) {
            last.events.push(e);
            if (e.end > last.end) last.end = e.end;
        } else rounds.push({ start: e.start, end: e.end, events: [e] });
    });
    // 회차별 본행사 오픈일. 오픈일을 특정 못 하는 creatives 회차(예: 8/24~ 메가와리 — 티저와
    // 본행사가 한 라벨)는 가장 최근 회차의 티저 일수만큼 밀어 추정한다 (262Q: 티저 4일 → 8/28).
    let teaserDays = 0;
    rounds.forEach(rd => {
        const r = _amMainStart(rd.events, rd.start, rd.end);
        rd.mainStart = r.sure ? r.date
            : (teaserDays && _amShiftDays(rd.start, teaserDays) <= rd.end ? _amShiftDays(rd.start, teaserDays) : rd.start);
        const teaser = rd.events.find(e => _amEvPart(e.name) === 'teaser');
        if (teaser && rd.mainStart > teaser.start) teaserDays = _amDaysInclusive(teaser.start, rd.mainStart) - 1;
    });
    return rounds;
}
// 본행사 오픈일: 과거 프로모션은 본행사 이벤트의 시작일. creatives 기반 'N월 CODE'는 티저와
// 본행사가 한 라벨이라, 회차가 라벨 월 1일 이전에 시작했으면(월말 티저) 그 1일을 오픈일로 본다.
// sure=false면 날짜만으로 오픈일을 특정 못 한 것 — _amRoundsOf가 직전 회차 티저 일수로 보정.
function _amMainStart(evs, start, end) {
    const main = evs.find(e => _amEvPart(e.name) === 'main');
    if (main) return { date: main.start, sure: true };
    const tagged = evs.map(e => e.mainStart).filter(Boolean).sort()[0];
    if (tagged) return { date: tagged, sure: true };
    const lbl = evs.map(e => (e.name.match(/^(\d{1,2})월\s/) || [])[1]).find(Boolean);
    if (lbl) {
        const first = `${_amShiftDays(start, 3).slice(0, 4)}-${String(lbl).padStart(2, '0')}-01`;
        if (first >= start && first <= end) return { date: first, sure: true };
    }
    return { date: start, sure: false };
}
function _amRoundSlice(round, part) {
    const parts = AM_PART_MATCH[part] || [part];
    const evs = round.events.filter(e => parts.includes(_amEvPart(e.name)));
    if (!evs.length) return null;
    const main = evs.find(e => _amEvPart(e.name) !== 'teaser') || evs[0];
    const start = evs.reduce((m, e) => e.start < m ? e.start : m, evs[0].start);
    const end = evs.reduce((m, e) => e.end > m ? e.end : m, evs[0].end);
    const hasMain = evs.some(e => ['main', 'all'].includes(_amEvPart(e.name)));
    const mainStart = hasMain && round.mainStart >= start && round.mainStart <= end ? round.mainStart : start;
    return { name: main.name, names: new Set(evs.map(e => e.name)), start, end, mainStart };
}

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
    { name: '퍼펙팅 쿠션', brand: 'WM', kw: ['PerfectingCushion', '퍼펙팅쿠션', '퍼펙팅 쿠션', 'パーフェクティングクッション'] },
    { name: '워터풀글로우 틴트', brand: 'WM', kw: ['워터풀글로우', 'ウォータフルグロウ', 'WaterfulGlow'] },
    { name: '소프트시어 멀티팔레트', brand: 'WM', kw: ['ソフトシアーマルチパレット', 'シアーマルチパレット', 'SoftSheer', 'SheerMulti'] },
    { name: '셰이킹블러 치크', brand: 'WM', kw: ['シェイキングブラーチーク', 'シェイキング', 'ShakingBlur', 'Shebulchi'] },
    { name: '스테이픽서 파우더', brand: 'WM', kw: ['ステイフィクサー', 'StayFixer'] },
    { name: '갸루키티 세트', brand: 'WM', kw: ['갸루키티', 'GyaruKitty', 'ギャルキティ', 'GyaruKittySET'] },
    { name: '브러시 듀오 기획', brand: 'WM', kw: ['SpatulaMiniDuo', 'spatulaminiduo', '스파츌라미니듀오'] },
    { name: '파데브러시', brand: 'WM', kw: ['FdBrush', 'FDbrush', 'FDBrush', 'FoundationBrush', 'ファンデーションブラシ', 'スパチュラワイド'] },
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
            const crRows = crText ? parse(crText) : null;
            const crMin = _amCreativesMinDate(crRows);
            if (crMin) AM_FUTURE_CUTOFF = crMin;
            // promotions 일정은 creatives 시트가 없는 기간에만 사용 (이후는 시트 AB·AC열이 기준)
            _amEvents = _amBuildEvents(parse(promoText)).filter(e => e.start < AM_FUTURE_CUTOFF);

            const rows = parse(adText);
            // 헤더 매핑
            const header = rows[0] || [];
            const idx = {};
            header.forEach((h, i) => { idx[(h || '').trim()] = i; });
            const col = {
                date: idx['날짜'], brand: idx['브랜드'], retail: idx['Retail'], media: idx['매체'],
                obj: idx['목적'], ctype: idx['소재타입'], adname: idx['광고명'], camp: idx['캠페인'],
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
            // 2) CUTOFF 이후: creatives 탭 — 행사는 AB열(event), 티저/본기간은 AC열. cost/sales 이미 원화.
            if (crRows) _amAddCreativeRows(crRows);
            // 2-1) creatives 탭에 캠페인이 통째로 빠진 경우(본기간 Purchase·Challengers·Criteo 등)
            //      실제 소진과 일치하는 ad-performance에서 (캠페인×날짜) 누락분만 보충.
            //      행사는 캠페인명 표기로 판정(없으면 4)에서 날짜 겹침).
            const crKeys = new Set(_amRows.filter(r => r.date >= AM_FUTURE_CUTOFF).map(r => r.camp + '|' + r.date));
            for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                if (!r || r.length < 5) continue;
                const date = (r[col.date] || '').trim();
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < AM_FUTURE_CUTOFF) continue;
                const camp = (r[col.camp] || '').trim().toLowerCase();
                if (crKeys.has(camp + '|' + date)) continue;
                const brand = (r[col.brand] || '').trim();
                const code = _amEventCode('', r[col.camp]);
                _amRows.push({
                    date, brand, retail: (r[col.retail] || '').trim(), camp,
                    media: _amMedia(r[col.media]),
                    adname: (r[col.adname] || '').trim() || '(광고명 없음)',
                    product: _amProduct(r[col.adname], brand),
                    event: code === 'AO' ? null : code, ao: code === 'AO', phase: '',
                    imp: _amNum(r[col.imp]), click: _amNum(r[col.click]),
                    cost: _amNum(r[col.cost]), cv: _amNum(r[col.cv]), rev: _amNum(r[col.rev]),
                });
            }
            // 2-2) 행사 코드별 연속 구간 → 회차 라벨('10월 MEGAPO' 등). 보충 행까지 넣은 뒤에 묶어야 같은 회차로 합쳐짐
            _amLabelCreativeRounds();
            // 3) creatives 기반 미래 이벤트를 캘린더에 합성 추가 (직전/전년 비교 가능하도록)
            _amAddFutureEvents();
            // 4) AO는 상시광고, 행사 판정이 안 된 나머지(RT/UA 등)만 날짜 겹침으로 판정
            _amResolveOpenEvents();
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
        cost: ci['cost'], rev: ci['sales'], cv: ci['conversions'], event: ci['event'], camp: ci['campaign_name'],
    };
    if (cc.date == null) return;
    const phaseCol = _amFindPhaseCol(crows);
    for (let i = 1; i < crows.length; i++) {
        const r = crows[i]; if (!r) continue;
        const date = (r[cc.date] || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < AM_FUTURE_CUTOFF) continue;
        const brand = (r[cc.brand] || '').trim();
        const code = _amEventCode(r[cc.event], r[cc.camp]);
        _amRows.push({
            date, brand, retail: (r[cc.retail] || '').trim(),
            camp: (r[cc.camp] || '').trim().toLowerCase(),
            media: _amMedia(r[cc.media]),
            adname: (r[cc.adname] || '').trim() || '(광고명 없음)',
            product: _amProduct(r[cc.adname], brand),
            event: code === 'AO' ? null : code, ao: code === 'AO',
            phase: phaseCol < 0 ? '' : _amPhase(r[phaseCol]),
            imp: _amNum(r[cc.imp]), click: _amNum(r[cc.click]),
            cost: _amNum(r[cc.cost]), cv: _amNum(r[cc.cv]), rev: _amNum(r[cc.rev]),
        });
    }
}
function _amCreativesMinDate(crows) {
    if (!crows || crows.length < 2) return '';
    const di = (crows[0] || []).findIndex(c => (c || '').trim().toLowerCase() === 'date');
    if (di < 0) return '';
    let min = '';
    for (let i = 1; i < crows.length; i++) { const d = ((crows[i] || [])[di] || '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!min || d < min)) min = d; }
    return min;
}

// creatives AC열: 행사 소재는 Teaser/MainEvent, AO는 공란. 헤더 이름이 정해져 있지 않아
// 값(Teaser/MainEvent)이 들어 있는 열을 찾아 쓴다. 없으면 -1 → 기존 날짜 추정 규칙 사용.
function _amPhase(v) {
    const s = (v || '').trim().toLowerCase().replace(/[\s_-]/g, '');
    return s === 'teaser' ? 'teaser' : (s === 'mainevent' || s === 'main') ? 'main' : '';
}
function _amFindPhaseCol(crows) {
    const width = crows.reduce((m, r) => Math.max(m, r ? r.length : 0), 0);
    let best = -1, bestHits = 0;
    for (let j = 0; j < width; j++) {
        let hits = 0, other = 0;
        for (let i = 1; i < crows.length; i++) {
            const v = (crows[i] || [])[j];
            if (!v || !v.trim()) continue;
            if (v.length <= 12 && _amPhase(v)) hits++; else other++;
            if (other > 200 && hits * 9 < other) break; // 다른 값이 대부분인 열은 조기 종료
        }
        if (hits > bestHits && hits >= other * 9) { best = j; bestHits = hits; }
    }
    return best;
}

// 같은 행사 코드의 연속 구간(공백 AM_ROUND_GAP_DAYS 이하)을 한 회차로 묶어 'N월 CODE'로 라벨링.
// 월은 회차 시작일+3일 기준 — 월말 티저(예: 9/28~)가 다음 달 본행사와 한 회차('10월 MEGAPO')로
// 묶이게 한다. (행 날짜의 월로 붙이면 9/28~9/30이 '9월 MEGAPO'로 쪼개져 직전 비교가 깨진다)
function _amLabelCreativeRounds() {
    const byCode = new Map(), mainDates = new Set();
    _amRows.forEach(r => {
        if (r.date < AM_FUTURE_CUTOFF || !r.event) return;
        if (!byCode.has(r.event)) byCode.set(r.event, new Set());
        byCode.get(r.event).add(r.date);
        if (r.phase === 'main') mainDates.add(r.event + '|' + r.date);
    });
    const labelOf = new Map();
    byCode.forEach((dates, code) => {
        const sorted = [...dates].sort();
        let start = sorted[0], prev = sorted[0], members = [];
        // AC열 MainEvent가 있으면 본행사 첫날의 월, 없으면 시작일+3일의 월
        const flush = () => {
            const firstMain = members.find(d => mainDates.has(code + '|' + d));
            const m = parseInt((firstMain || _amShiftDays(start, 3)).slice(5, 7), 10);
            members.forEach(d => labelOf.set(code + '|' + d, `${m}월 ${code}`));
        };
        sorted.forEach(d => {
            if (members.length && _amDaysInclusive(prev, d) - 1 > AM_ROUND_GAP_DAYS) { flush(); start = d; members = []; }
            members.push(d); prev = d;
        });
        flush();
    });
    _amRows.forEach(r => {
        if (r.date < AM_FUTURE_CUTOFF || !r.event) return;
        r.event = labelOf.get(r.event + '|' + r.date) || r.event;
    });
}

// creatives 기반 미래 이벤트(예: '8월 MEGAPO')를 날짜범위·리테일과 함께 _amEvents에 합성 추가
// (event=null인 AO/RT/UA 행은 아직 특정 행사가 아니므로 제외 — 캘린더가 완성된 뒤 재판정)
function _amAddFutureEvents() {
    const fut = new Map();
    _amRows.forEach(r => {
        if (r.date < AM_FUTURE_CUTOFF || !r.event) return;
        if (!fut.has(r.event)) fut.set(r.event, { min: r.date, max: r.date, retail: {}, main: '' });
        const f = fut.get(r.event);
        if (r.date < f.min) f.min = r.date;
        if (r.date > f.max) f.max = r.date;
        if (r.phase === 'main' && (!f.main || r.date < f.main)) f.main = r.date;
        f.retail[r.retail] = (f.retail[r.retail] || 0) + 1;
    });
    fut.forEach((f, name) => {
        if (_amEvents.some(e => e.name === name)) return;
        const retail = (Object.entries(f.retail).sort((a, b) => b[1] - a[1])[0] || [''])[0];
        // mainStart: AC열 MainEvent 첫날 (없으면 '' → _amMainStart가 날짜로 추정)
        _amEvents.push({ start: f.min, end: f.max, name, grade: '', retail, mainStart: f.main });
    });
}

// 행사 미판정 행 처리 — AO(상시) 및 판정이 안 된 행(RT/UA 태그, 캠페인명에 행사 표기 없는 보충 행)은
// 날짜+리테일이 겹치는 행사가 있으면 그 행사로 편입(행사 기간에 함께 돌린 상시 소재도 행사 성과에 포함),
// 없으면 '상시광고'. 행사 기간 자체는 시트 AB·AC열로 정해진 캘린더 기준.
// 미래 이벤트 캘린더가 완성된 뒤(=_amAddFutureEvents 이후) 호출해야 한다.
function _amResolveOpenEvents() {
    _amRows.forEach(r => {
        if (r.date < AM_FUTURE_CUTOFF || r.event) return;
        r.event = _amEventFor(r.date, r.retail);
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
    // 직전/전년은 '같은 이벤트 유형'의 이전 회차·1년 전 회차와 비교 — 티저/본행사/애프터를 한
    // 회차로 묶어서 고르므로 '직전 달 아무 이벤트'나 같은 회차의 티저가 직전으로 잡히지 않는다.
    // (예: 10월 MEGAPO → 직전=8월 MEGAPO, 전년=2510 메가포). 같은 리테일끼리만 매칭.
    // 진행 중인 행사는 본행사 오픈일(D1)부터 최신 데이터일까지(DN)만, 직전·전년 회차도 각자의
    // 오픈일부터 같은 N일만 잘라 비교 (티저 유무가 회차마다 달라 첫날 기준으로 맞추면 왜곡됨).
    let prevAgg = null, yoyAgg = null, cmpLabel = '', cmpNote = '', curAgg = total;
    if (evMeta) {
        const rounds = _amRoundsOf(evMeta.retail, _amCanonicalType(evMeta.name));
        const idx = rounds.findIndex(rd => rd.events.some(e => e.name === evMeta.name));
        const curRound = rounds[idx];
        const part = _amEvPart(evMeta.name);
        const prevSlice = idx > 0 ? _amRoundSlice(rounds[idx - 1], part) : null;
        // 전년 동행사: 회차 시작일이 (올해 회차 시작 -1년)에 가장 가까운 회차 (90일 이내)
        const yTarget = _amShiftYears(curRound ? curRound.start : evMeta.start, -1);
        let yoyRound = null, best = Infinity;
        rounds.forEach((rd, i) => {
            if (i === idx) return;
            const diff = Math.abs(_amDaysInclusive(yTarget, rd.start) - 1);
            if (diff <= 90 && diff < best) { best = diff; yoyRound = rd; }
        });
        const yoySlice = yoyRound ? _amRoundSlice(yoyRound, part) : null;

        const latest = brandAll.reduce((m, r) => r.date > m ? r.date : m, '');
        const inProgress = latest && evMeta.end >= latest;
        const curMain = curRound && part === 'all' && curRound.mainStart >= evMeta.start && curRound.mainStart <= evMeta.end
            ? curRound.mainStart : evMeta.start;
        const dayN = inProgress ? _amDaysInclusive(curMain, latest) : 0;
        const winEnd = sl => inProgress ? _amShiftDays(sl.mainStart, dayN - 1) : sl.end;
        const winStart = sl => inProgress ? sl.mainStart : sl.start;
        const sliceRows = sl => brandAll.filter(r => sl.names.has(r.event) && r.date >= winStart(sl) && r.date <= winEnd(sl));
        const periodOf = sl => `${winStart(sl).slice(2)}~${winEnd(sl).slice(5)}`;
        if (inProgress && dayN <= 0) {
            cmpLabel = `본행사 오픈(${curMain.slice(5)}) 전 티저 기간 — 오픈 후부터 직전·전년 비교`;
            cmpNote = '본행사 오픈일 기준으로 비교하므로 티저 기간에는 비교 값을 표시하지 않습니다.';
        } else {
            if (inProgress) curAgg = _amAgg(rows.filter(r => r.date >= curMain && r.date <= latest));
            if (prevSlice) prevAgg = _amAgg(sliceRows(prevSlice));
            if (yoySlice) yoyAgg = _amAgg(sliceRows(yoySlice));
            cmpLabel = `직전: ${prevSlice ? `${_amEsc(prevSlice.name)} (${periodOf(prevSlice)})` : '없음'} · 전년: ${yoySlice ? `${_amEsc(yoySlice.name)} (${periodOf(yoySlice)})` : '없음'}`
                + (inProgress ? ` · <b>본행사 D1~D${dayN} 기준</b>` : '');
            cmpNote = inProgress
                ? `진행 중이라 본행사 오픈일 기준으로 맞춰 비교합니다 — 현재 ${curMain.slice(5)}~${latest.slice(5)}(D1~D${dayN}, 티저 제외) vs 직전·전년 회차의 오픈일부터 ${dayN}일.`
                : '직전 행사·전년 동행사 = 같은 이벤트 유형의 이전 회차 / 1년 전 회차 전체 기간 기준.';
        }
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
        ? `<td>${m.f(agg)}</td>${_amDeltaCell(curAgg[m.k], agg[m.k], m.g)}`
        : `<td class="am-d-na">-</td><td class="am-d-na">-</td>`;
    const kpiHtml = `
        <div class="am-card am-sum-card">
            <div class="am-card-h"><i class="fas fa-calculator"></i> 합계 ${hasCmp ? `<span class="am-card-sub">${cmpLabel}</span>` : `<span class="am-card-sub">${_amEsc(brand || '전체 브랜드')} · ${_amEsc(_amSelectedEvent)}</span>`}</div>
            <table class="am-table am-sum-table">
                <thead><tr><th>지표</th><th>현재</th>${hasCmp ? '<th>직전 행사</th><th>직전비</th><th>전년 동행사</th><th>YoY</th>' : ''}</tr></thead>
                <tbody>${metricDefs.map(m => `<tr>
                    <td class="am-t-name">${m.l}</td>
                    <td class="am-sum-cur">${m.f(curAgg)}</td>
                    ${hasCmp ? cmpPair(m, prevAgg) + cmpPair(m, yoyAgg) : ''}
                </tr>`).join('')}</tbody>
            </table>
            ${!hasCmp ? `<p class="am-sum-note">특정 이벤트를 선택하면 직전 행사·전년 동행사 증감이 표시됩니다.</p>` : `<p class="am-sum-note">${cmpNote}</p>`}
        </div>`;

    // 역대 회차 추이 — 선택 이벤트와 같은 유형의 모든 회차(티저~애프터 전체). 진행 중 회차는
    // 최신 데이터일까지 누적. 날짜 필터와 무관하게 전 기간 기준.
    let roundSeries = null, roundsHtml = '';
    if (evMeta) {
        const canon = _amCanonicalType(evMeta.name);
        const latestAll = brandAll.reduce((m, r) => r.date > m ? r.date : m, '');
        roundSeries = _amRoundsOf(evMeta.retail, canon).map(rd => {
            const names = new Set(rd.events.map(e => e.name));
            const a = _amAgg(brandAll.filter(r => names.has(r.event)));
            const ongoing = !!latestAll && rd.end >= latestAll;
            return {
                ...a, ongoing,
                label: rd.mainStart.slice(2, 7).replace('-', '.'),
                period: `${rd.start.slice(5)}~${(ongoing ? latestAll : rd.end).slice(5)}`,
                dayN: ongoing ? Math.max(0, _amDaysInclusive(rd.mainStart, latestAll)) : 0,
                cur: rd.events.some(e => e.name === evMeta.name),
                noRev: a.rev === 0,
            };
        }).filter(s => s.cost > 0);
        roundSeries.forEach(s => {
            s.cvr = !s.noRev && s.click > 0 ? s.cv / s.click * 100 : null;
            s.cpc = s.click > 0 ? s.cost / s.click : 0;
        });
        const typeKo = { MEGAPO: '메가포', MEGAWARI: '메가와리' }[canon] || canon;
        roundsHtml = roundSeries.length > 1 ? `
        <div class="am-card">
            <div class="am-card-h"><i class="fas fa-chart-column"></i> 역대 ${_amEsc(typeKo)} 회차 추이 <span class="am-card-sub">진행 중 회차는 최신일까지 누적 · 전 기간 기준</span></div>
            <div class="am-seg">
                <button data-v="inflow" onclick="_amSetRoundView('inflow')">유입</button>
                <button data-v="conv" onclick="_amSetRoundView('conv')">전환</button>
            </div>
            <div id="am-rounds-body"></div>
        </div>` : '';
    }

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

    root.innerHTML = `<div class="am-wrap">${selHtml}${kpiHtml}${roundsHtml}${mediaHtml}${dailyHtml}${prodHtml}</div>`;

    document.getElementById('am-event-sel').addEventListener('change', e => {
        _amSelectedEvent = e.target.value;
        _amRender();
    });

    _amRoundSeries = roundSeries;
    _amRenderRoundsBody();
    _amDrawMediaChart(media);
    _amDrawDailyChart(rows);
}

// ── 역대 회차 추이: 유입(노출·클릭·CTR·CPC) / 전환(광고비·매출·ROAS·구매·CVR) 토글 ──
// 매출을 집계하지 않던 매체를 쓰던 과거 회차도 유입 지표로는 비교할 수 있게 나눈다.
let _amRoundsChart = null, _amRoundSeries = null, _amRoundView = 'conv';
window._amSetRoundView = function (v) { _amRoundView = v; _amRenderRoundsBody(); };
const _amRoasCls = s => s.noRev ? '' : s.roas >= 200 ? 'am-good' : s.roas >= 100 ? 'am-mid' : 'am-low';
function _amRenderRoundsBody() {
    const body = document.getElementById('am-rounds-body');
    if (!body || !_amRoundSeries) { if (_amRoundsChart) { _amRoundsChart.destroy(); _amRoundsChart = null; } return; }
    document.querySelectorAll('.am-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === _amRoundView));
    const series = _amRoundSeries;
    const inflow = _amRoundView === 'inflow';
    const head = inflow
        ? '<th>광고비</th><th>노출</th><th>클릭</th><th>CTR</th><th>CPC</th>'
        : '<th>광고비</th><th>매출</th><th>ROAS</th><th>구매</th><th>CVR</th><th>CPA</th>';
    const cells = s => inflow
        ? `<td>${_amKRWshort(s.cost)}</td><td>${_amInt(s.imp)}</td><td>${_amInt(s.click)}</td><td class="am-t-roas">${s.ctr.toFixed(2)}%</td><td>${s.click > 0 ? _amKRW(s.cpc) : '-'}</td>`
        : `<td>${_amKRWshort(s.cost)}</td><td>${s.noRev ? '-' : _amKRWshort(s.rev)}</td>`
          + `<td class="am-t-roas ${_amRoasCls(s)}">${s.noRev ? '-' : _amPct(s.roas)}</td><td>${s.noRev ? '-' : _amInt(s.cv)}</td>`
          + `<td>${s.cvr == null ? '-' : s.cvr.toFixed(2) + '%'}</td><td>${s.cv > 0 ? _amKRW(s.cpa) : '-'}</td>`;
    const hasNoRev = series.some(s => s.noRev);
    body.innerHTML = `
        <div class="am-chart-wrap am-chart-wrap--tall"><canvas id="am-rounds-chart"></canvas></div>
        <div class="am-table-scroll"><table class="am-table">
            <thead><tr><th>회차</th><th>기간</th>${head}</tr></thead>
            <tbody>${series.map(s => `<tr${s.cur ? ' style="font-weight:600;background:#eef2ff"' : ''}>
                <td class="am-t-name">${s.label}${s.ongoing ? ` <span class="am-etc-tag">진행 중${s.dayN ? ` D${s.dayN}` : ' 티저'}</span>` : ''}</td>
                <td>${s.period}</td>${cells(s)}</tr>`).join('')}</tbody>
        </table></div>
        ${!inflow && hasNoRev ? `<p class="am-sum-note">'-'인 회차는 당시 운영 매체가 매출(전환)을 집계하지 않던 기간 — 광고비만 표시합니다. 이 회차들은 [유입] 탭의 CTR·CPC로 비교하세요.</p>` : ''}`;
    _amDrawRoundsChart(series, inflow);
}

function _amDrawRoundsChart(series, inflow) {
    if (_amRoundsChart) { _amRoundsChart.destroy(); _amRoundsChart = null; }
    const cv = document.getElementById('am-rounds-chart');
    if (!cv || !series || typeof Chart === 'undefined') return;
    const labels = series.map(s => s.ongoing ? [s.label, '진행중'] : s.label);
    const pick = (cur, base) => series.map(s => s.cur ? cur : base);
    const line = (label, data, color, axis) => ({ type: 'line', label, data, borderColor: color, backgroundColor: color, pointRadius: 4, borderWidth: 2, yAxisID: axis, order: 1, tension: 0.25, spanGaps: false });
    const won = v => v >= 1e8 ? (v / 1e8).toFixed(1) + '억' : v >= 1e4 ? Math.round(v / 1e4) + '만' : v;
    const cnt = v => v >= 1e4 ? Math.round(v / 1e4) + '만' : v;
    const pctAxis = (pos, text, extra) => ({ position: pos, beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text, font: { size: 10 } }, ticks: { callback: v => v + '%', font: { size: 10 } }, ...extra });
    const datasets = inflow ? [
        { type: 'bar', label: '클릭(유입)', data: series.map(s => Math.round(s.click)), backgroundColor: pick('#818cf8', '#c7d2fe'), yAxisID: 'y', order: 2, borderRadius: 3 },
        line('CTR %', series.map(s => +s.ctr.toFixed(2)), '#f97316', 'y1'),
    ] : [
        { type: 'bar', label: '광고비', data: series.map(s => Math.round(s.cost)), backgroundColor: pick('#818cf8', '#c7d2fe'), yAxisID: 'y', order: 2, borderRadius: 3 },
        { type: 'bar', label: '매출', data: series.map(s => s.noRev ? null : Math.round(s.rev)), backgroundColor: pick('#34d399', '#a7f3d0'), yAxisID: 'y', order: 2, borderRadius: 3 },
        line('ROAS %', series.map(s => s.noRev ? null : Math.round(s.roas)), '#6366f1', 'y1'),
        line('CVR %', series.map(s => s.cvr == null ? null : +s.cvr.toFixed(2)), '#a855f7', 'y2'),
    ];
    const scales = {
        x: { ticks: { maxRotation: 45, autoSkip: false, font: { size: 10 } } },
        y: { position: 'left', beginAtZero: true, title: { display: true, text: inflow ? '클릭수' : '광고비·매출', font: { size: 10 } }, ticks: { callback: inflow ? cnt : won, font: { size: 10 } } },
        y1: pctAxis('right', inflow ? 'CTR %' : 'ROAS %'),
    };
    if (!inflow) scales.y2 = pctAxis('right', 'CVR %');
    _amRoundsChart = new Chart(cv, {
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
                tooltip: { callbacks: {
                    title: items => { const s = series[items[0].dataIndex]; return `${s.label} · ${s.period}${s.ongoing ? ` (진행 중${s.dayN ? ` D${s.dayN}` : ''} 누적)` : ''}`; },
                    label: c => c.parsed.y == null ? `${c.dataset.label}: 데이터 없음`
                        : c.dataset.type === 'line' ? `${c.dataset.label.replace(' %', '')} ${c.parsed.y}%`
                        : c.dataset.label.startsWith('클릭') ? `클릭 ${c.parsed.y.toLocaleString()}` : `${c.dataset.label} ₩${c.parsed.y.toLocaleString()}`,
                } },
            },
            scales,
        },
    });
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
