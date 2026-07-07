// ============================================================
//  CEP 검증 로그
//  creative_template 시트의 "검증 로그" 탭(CSV 게시본)을 읽어
//  제품(좌측 목록) → 선택 시 CEP별 [종합 결과 → 소재별 성과 →
//  원인 분석 → Next Step] 상세를 우측에 보여준다.
// ============================================================

const CEP_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTVqotU6K1y0u9atjKrRpaFgDamwAdUmxldvBbYepguKNm6MzzRDm5uUMmEGFFw_R3EOxmu1_ihWfKE/pub?gid=1751932102&single=true&output=csv';

// 폴백용 고정 인덱스 (헤더 탐지 실패 시): 검증 완료,브랜드,소재명,제품,운영 시작일,운영 종료일,media urls,소구포인트,검증 상세,IMP,Click,CTR,CPC,COST,CV,CVR,CPA,Revenue,ROAS
const CEP_COL = { brand: 1, name: 2, product: 3, url: 6, cep: 7, detail: 8, imp: 9, click: 10, ctr: 11, cost: 13, cv: 14, revenue: 17, roas: 18 };

// 헤더명 → 필드 자동 매핑: 시트에 컬럼이 추가/이동돼도 헤더 텍스트로 위치를 찾는다
const CEP_HEADER_NAMES = {
    brand: '브랜드', name: '소재명', product: '제품', url: 'media urls',
    cep: '소구포인트', detail: '검증 상세',
    imp: 'IMP', click: 'Click', ctr: 'CTR', cost: 'COST', cv: 'CV', revenue: 'Revenue', roas: 'ROAS',
};
function _cepDetectCols(headerRow) {
    const norm = c => (c || '').trim().toLowerCase();
    const cells = (headerRow || []).map(norm);
    const cols = {};
    let found = 0;
    Object.entries(CEP_HEADER_NAMES).forEach(([field, label]) => {
        const idx = cells.indexOf(label.toLowerCase());
        if (idx >= 0) { cols[field] = idx; found++; }
    });
    // 핵심 컬럼(소재명/제품/소구포인트)을 못 찾으면 폴백 사용
    return (cols.name != null && cols.product != null && cols.cep != null) ? cols : CEP_COL;
}

const CEP_VERDICT_META = {
    pending: { emoji: '📝', label: '검증 대기' },
    fail:    { emoji: '❌', label: '가설 미입증' },
    win:     { emoji: '✅', label: '검증 성공' },
    mid:     { emoji: '🟡', label: '부분 검증' },
    weak:    { emoji: '🟠', label: '반응 약함' },
};

// 원인 분석 항목의 종류별 아이콘 — 글만 나열하지 않고 한눈에 어떤 종류의 원인인지 구분되게 한다
const CEP_CAUSE_ICON = {
    context: 'fa-bullseye',      // 시장 맥락(타겟 상황) 적중도
    rank: 'fa-medal',             // 같은 제품 내 다른 CEP 대비 순위
    ctr: 'fa-eye',                // 1차 주목도
    cv: 'fa-cart-shopping',       // 전환 단계
    compare: 'fa-shuffle',        // 소재간 비교
    neutral: 'fa-circle-info',
};

// 시트에 같은 제품이 옵션/구성 단위로 쪼개져 입력된 경우를 하나로 통합
const CEP_PRODUCT_ALIASES = {
    '콜라겐 세럼미스트 X 2': '콜라겐 세럼미스트',
    '3D크림 리필기획 옵션①': '3D크림 리필기획',
    '3D크림 리필기획 옵션②': '3D크림 리필기획',
};
function _cepNormalizeProduct(raw) {
    const s = (raw || '').trim();
    return CEP_PRODUCT_ALIASES[s] || s;
}

// 제품별 CEP 시장 컨텍스트 (boh-tankcream-dashboard.vercel.app 시장조사 대시보드 기반)
// 시트의 CEP 번호는 입력 오타가 섞여있어(같은 번호가 다른 CEP에 중복 사용된 경우 발견) 신뢰할 수 없다.
// 대신 CEP 제목에 포함된 키워드로 매칭한다.
const _CTX_EYECREAM = [
    { kw: ['눈가 처짐', '탄력 저하'], text: '거울에서 눈가 처짐·탄력 저하를 발견하는, 연중 발생하는 노화 인식 시점' },
    { kw: ['수면 부족', '다크서클'], text: '늦게 잔 다음날 아침 수면 부족으로 다크서클이 심해지는 시점' },
    { kw: ['에어컨'], text: '에어컨 켜진 사무실에서 종일 있으며 눈가 건조가 누적되는 여름 집중 시점' },
];
const _CTX_COLLAGEN_MIST = [
    { kw: ['메이크업 전', '수분 부스팅'], text: '메이크업 전 빠르게 수분을 채워 파운데이션 밀착력을 높이려는 프리페어 단계' },
    { kw: ['세안 직후'], text: '세안 직후 피부가 가장 건조한 순간, 시간 없이 빠르게 보습하려는 니즈' },
    { kw: ['취침 전', '원스텝'], text: '취침 전 복잡한 루틴 없이 원스텝으로 보습을 마무리하려는 저녁 니즈' },
    { kw: ['메이크업 위', '들뜸'], text: '외출 중 파운데이션이 들뜰 때 메이크업을 무너뜨리지 않고 보습하려는 니즈' },
    { kw: ['마스크'], text: '마스크 착용으로 인한 피부 건조에 빠르게 대응하려는 상황' },
    { kw: ['겨울철', '외부 건조'], text: '겨울철 외부 환경 건조에 대응하려는 계절적 니즈' },
    { kw: ['육아'], text: '육아로 바쁜 와중에 짧게 끝낼 수 있는 틈새 보습 니즈' },
    { kw: ['여행', '출장'], text: '여행·출장 이동 중 휴대성 좋은 보습 솔루션을 찾는 상황' },
    { kw: ['오피스', '에어컨 건조'], text: '에어컨이 나오는 오피스 환경에서 응급 보습·리프레시가 필요한 상황' },
    { kw: ['일정 전', '컨디션 개선'], text: '중요한 일정 전 피부 컨디션을 빠르게 개선하려는 니즈' },
];
const _CTX_TANCREAM = [
    { kw: ['시술 전'], text: '시술 비용·부담을 피해 화장품으로 먼저 리프팅 관리를 시도하려는 시술 대체 심리' },
    { kw: ['환절기'], text: '환절기 피부 탄력 저하를 느끼며 집중 케어가 필요해지는 시점' },
    { kw: ['육아', '하안부'], text: '출산·육아 스트레스로 하안부(턱선·입가) 처짐을 느낀 30-40대 여성의 고민' },
    { kw: ['사진', '노안'], text: '사진·영상 속 본인 얼굴이 실제보다 늙어 보인다고 느끼는 순간' },
    { kw: ['마스크'], text: '마스크 착용이 일상화되며 눈가 인상 관리 필요성이 높아진 상황' },
    { kw: ['40대'], text: '40대에 진입하며 눈가 탄력 저하를 예방적으로 관리하려는 심리' },
    { kw: ['마리오네트'], text: '입가~턱으로 이어지는 마리오네트 라인이 두드러질 때의 하안부 집중 관리 니즈' },
    { kw: ['모닝 리프팅'], text: '내일 아침 탄력을 위해 오늘 밤부터 투자하려는 모닝 리프팅 준비 심리' },
    { kw: ['나이트 리프팅'], text: '자기 전 마무리 단계로 자리잡은 나이트 리프팅 루틴' },
    { kw: ['화상회의', '화상 회의'], text: '화상회의 화면 속 자신의 얼굴에 놀라 생긴 긴급한 안티에이징 욕구' },
];
const _CTX_NADCREAM = [
    { kw: ['노화 체감'], text: '피부 노화를 처음 체감하며 안티에이징에 입문하는 단계, 신성분에 대한 심리적 저항감 존재' },
    { kw: ['피부 피로'], text: '나이보다 피곤해 보이는 컨디션 악화가 먼저 체감되는 시점' },
    { kw: ['성분'], text: '"이 성분이 뭔가요?" 하는 궁금증이 생기는, 신성분 정보 탐색 단계' },
    { kw: ['아침 피부컨디션', '아침 피부 컨디션'], text: '나이트 케어 후 다음날 아침 피부 변화를 기대하는 루틴 시점' },
    { kw: ['퇴근 후'], text: '퇴근 후 하루의 피로를 피부에 남기지 않으려는 저녁 집중 관리' },
    { kw: ['수면 부족'], text: '잠이 부족한 날일수록 피부 회복이 필요한, 컨디션 회복과 나이트케어가 겹치는 지점' },
    { kw: ['시술 전'], text: '시술 전 프리미엄 홈케어로 피부를 직접 준비하려는 고급 소비자층의 니즈' },
];
const CEP_CONTEXT = {
    '아이크림': _CTX_EYECREAM,
    '콜라겐 겔 미스트': _CTX_COLLAGEN_MIST,
    '콜라겐 세럼미스트': _CTX_COLLAGEN_MIST,
    '3D크림 리필기획': _CTX_TANCREAM,
    'PDRN크림': _CTX_TANCREAM,
    'NAD크림 단품': _CTX_NADCREAM,
    'NAD크림 단품-옵션2': _CTX_NADCREAM,
    'NAD+콜라겐크림 (NAD크림 단품)': _CTX_NADCREAM,
    'NAD+콜라겐크림 (NAD크림 단품-옵션2)': _CTX_NADCREAM,
    // 시트 제품명이 영문 토큰으로 변경됨 (2026-07)
    'EyeCream': _CTX_EYECREAM,
    'GelMist': _CTX_COLLAGEN_MIST,
    'GelMistx2': _CTX_COLLAGEN_MIST,
    '3D-Refill': _CTX_TANCREAM,
    'NAD-Cream': _CTX_NADCREAM,
    'NAD-Cream-2': _CTX_NADCREAM,
};
function _cepContextFor(product, title) {
    const list = CEP_CONTEXT[product];
    if (!list || !title) return null;
    const found = list.find(entry => entry.kw.some(k => title.includes(k)));
    return found ? found.text : null;
}

// "CEP-9 오피스 건조 리프레시" -> { num: 9, no: 'CEP-9', title: '오피스 건조 리프레시' }
// 번호 없이 상황 문장만 있는 라벨("거울 속 눈가가 처지고...")은 전체를 title로 쓴다.
function _cepSplitLabel(label) {
    const m = label.match(/^CEP-?\s*(\d+)/i);
    if (!m) return { num: null, no: '', title: label.trim() };
    const num = parseInt(m[1], 10);
    const spaceIdx = label.indexOf(' ');
    const no = spaceIdx > 0 ? label.slice(0, spaceIdx) : label;
    const title = spaceIdx > 0 ? label.slice(spaceIdx + 1).trim() : '';
    return { num, no, title };
}

let _cepProducts = null;   // Map(brand__product -> {brand, product, ceps: Map(cepLabel -> {cepLabel, hypotheses:Set, creatives:[]})})
let _cepLoading = false;
let _cepSelectedKey = null;

function _cepEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _cepNum(v) {
    if (v == null) return 0;
    const n = parseFloat(String(v).replace(/[₩%,]/g, '').trim());
    return isNaN(n) ? 0 : n;
}

// 로딩/에러/빈 상태 공통 마크업 (대시보드 다른 탭의 빈 상태와 동일한 톤: 큰 아이콘 + 설명)
function _cepEmptyHtml(icon, text, opts) {
    const o = opts || {};
    const color = o.color || 'text-slate-300';
    const py = o.py || 'py-16';
    const spin = o.spin ? ' fa-spin' : '';
    return `<div class="text-center ${color} ${py}">
        <i class="fas ${icon}${spin} text-4xl mb-3 opacity-30"></i>
        <p class="text-sm">${_cepEsc(text)}</p>
    </div>`;
}

// 같은 CEP의 소재들은 보통 카피·적용 방법 구절을 동일하게 공유하고, 실제로 달라지는 건
// 모델(인플루언서)과 영상 구성(시연 방식, 클로즈업 등)이다. 모든 소재가 공통으로 가진 구절을
// 찾아내 제외하면, 진짜 차이를 만든 부분만 비교/원인 분석에 쓸 수 있다.
function _cepCommonDetailSegments(creatives) {
    const lists = creatives.filter(c => c.detail).map(c => c.detail.split('/').map(s => s.trim()).filter(Boolean));
    if (lists.length < 2) return new Set();
    const common = new Set(lists[0]);
    for (let i = 1; i < lists.length; i++) {
        const setI = new Set(lists[i]);
        [...common].forEach(seg => { if (!setI.has(seg)) common.delete(seg); });
    }
    return common;
}

// "카피(공통) / 인플루언서 / 공통 적용방법 / 영상 구성요소..." 중 인플루언서 이름만 추출
function _cepDetailName(detail, fallbackName) {
    const parts = (detail || '').split('/').map(s => s.trim()).filter(Boolean);
    return parts[1] || fallbackName || '';
}

// 영상 구성요소를 그대로 나열하지 않고, "강조" 표현이 있는 구절의 핵심만 뽑아낸다.
// "강조" 표현이 없으면 가장 구체적인(마지막) 구성요소 하나만 남긴다.
function _cepEmphasisText(detail, commonSegs) {
    if (!detail) return '';
    const parts = detail.split('/').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return '';
    const rest = parts.filter((p, idx) => idx !== 1 && !(commonSegs && commonSegs.has(p)));
    const emphasized = rest
        .filter(p => p.includes('강조'))
        .map(p => p
            .replace(/\s*강조.*$/u, '')
            .replace(/(이라는 점|라는 점|는 점)$/u, '')
            .replace(/[을를]$/u, '')
            .trim())
        .filter(Boolean);
    if (emphasized.length) return emphasized.join(', ');
    const last = rest[rest.length - 1] || '';
    return last.length > 40 ? last.slice(0, 40) + '…' : last;
}

function _cepUniqueDetail(detail, commonSegs) {
    if (!detail) return '';
    const name = _cepDetailName(detail);
    if (!name) return '';
    const emphasis = _cepEmphasisText(detail, commonSegs);
    return emphasis ? `${name}(${emphasis})` : name;
}

// 쿼트/임베드 줄바꿈을 지원하는 CSV 파서 (sheets.js parseCSV와 동일한 로직)
function _cepParseCSV(text) {
    const rows = [];
    let current = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (inQuotes) {
            if (ch === '"' && next === '"') { field += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { field += ch; }
        } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { current.push(field); field = ''; }
            else if (ch === '\n' || ch === '\r') {
                if (field !== '' || current.length > 0) {
                    current.push(field);
                    rows.push(current);
                    current = [];
                    field = '';
                }
                if (ch === '\r' && next === '\n') i++;
            } else { field += ch; }
        }
    }
    if (field !== '' || current.length > 0) { current.push(field); rows.push(current); }
    return rows;
}

function _cepBuildModel(rows) {
    // 헤더 행을 찾아 헤더명 기반으로 컬럼 위치 자동 결정 (컬럼 추가/이동에 견고)
    const headerIdx = rows.findIndex(r => (r || []).some(c => (c || '').trim() === '소재명'));
    const COL = headerIdx >= 0 ? _cepDetectCols(rows[headerIdx]) : CEP_COL;
    const dataRows = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;
    const products = new Map();

    dataRows.forEach(r => {
        if (!r || r.length < 3) return;
        const brand = (r[COL.brand] || '').trim();
        const product = _cepNormalizeProduct(r[COL.product]);
        if (!brand && !product) return;

        const cepLines = (r[COL.cep] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const hypoLines = (r[COL.detail] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        let mediaName = (r[COL.name] || '').trim();
        const mediaUrl = (r[COL.url] || '').trim();
        if (mediaName.toLowerCase() === 'ex') mediaName = ''; // 시트의 예시(템플릿) 행은 제외
        const hasResult = !!mediaName;

        const pKey = `${brand}__${product}`;
        if (!products.has(pKey)) products.set(pKey, { brand, product, ceps: new Map() });
        const pObj = products.get(pKey);

        const lineCount = Math.max(cepLines.length, hypoLines.length, 1);
        for (let i = 0; i < lineCount; i++) {
            const cepLabel = cepLines[i] || cepLines[0] || '(CEP 미지정)';
            const hypoText = hypoLines[i] || hypoLines[0] || '';
            if (!pObj.ceps.has(cepLabel)) {
                pObj.ceps.set(cepLabel, { cepLabel, hypotheses: new Set(), creatives: [] });
            }
            const cepObj = pObj.ceps.get(cepLabel);
            if (hypoText) cepObj.hypotheses.add(hypoText);
            // 결과가 있는 행은 첫 CEP 라인에만 귀속 (중복 합산 방지)
            if (hasResult && i === 0) {
                cepObj.creatives.push({
                    name: mediaName, url: mediaUrl, detail: hypoText,
                    imp: _cepNum(r[COL.imp]), click: _cepNum(r[COL.click]),
                    cost: _cepNum(r[COL.cost]), cv: _cepNum(r[COL.cv]),
                    revenue: _cepNum(r[COL.revenue]),
                    // 시트가 직접 계산한 값(플랫폼 리포트 기준) — 단순 매출/비용 재계산과 다를 수 있어 표시용으로 그대로 사용
                    ctrSheet: _cepNum(r[COL.ctr]), roasSheet: _cepNum(r[COL.roas]),
                });
            }
        }
    });
    return products;
}

function _cepAggregate(cepObj) {
    const sum = { imp: 0, click: 0, cost: 0, cv: 0, revenue: 0 };
    cepObj.creatives.forEach(c => {
        sum.imp += c.imp; sum.click += c.click; sum.cost += c.cost; sum.cv += c.cv; sum.revenue += c.revenue;
    });
    return {
        ...sum,
        ctr: sum.imp > 0 ? sum.click / sum.imp * 100 : 0,
        cvr: sum.click > 0 ? sum.cv / sum.click * 100 : 0,
        roas: sum.cost > 0 ? sum.revenue / sum.cost * 100 : 0,
    };
}

function _cepProductAvgRoas(pObj) {
    let cost = 0, revenue = 0;
    pObj.ceps.forEach(c => {
        if (c.creatives.length) { const a = _cepAggregate(c); cost += a.cost; revenue += a.revenue; }
    });
    return cost > 0 ? revenue / cost * 100 : null;
}

// 제품 내 검증 완료 CEP들의 집계값 모음 — 개별 CEP 원인 분석에서 "이 제품의 다른 CEP와 비교하면"
// 같은 상대적 코멘트를 만들 때 쓴다. CEP가 1개뿐이면 비교 대상이 없으므로 빈 배열을 반환한다.
function _cepProductBenchmark(pObj) {
    return [...pObj.ceps.values()]
        .filter(c => c.creatives.length > 0)
        .map(c => ({ label: c.cepLabel, agg: _cepAggregate(c) }))
        .filter(x => x.agg.imp > 0 || x.agg.cost > 0);
}

// 자기 자신을 제외한 나머지 CEP들의 평균값(절대 기준이 아니라 "이 제품 안에서의 상대 위치")
function _cepPeerAvg(benchmark, selfLabel, field) {
    const peers = benchmark.filter(x => x.label !== selfLabel);
    if (!peers.length) return null;
    return peers.reduce((s, x) => s + x.agg[field], 0) / peers.length;
}

// ROAS 기준 이 CEP의 제품 내 순위
function _cepRankInfo(benchmark, selfLabel) {
    if (benchmark.length < 2) return null;
    const sorted = [...benchmark].sort((a, b) => b.agg.roas - a.agg.roas);
    const idx = sorted.findIndex(x => x.label === selfLabel);
    if (idx < 0) return null;
    return { rank: idx + 1, total: sorted.length, top: sorted[0] };
}

function _cepVerdictTag(agg, hasResult) {
    if (!hasResult || !agg || agg.cost === 0) return 'pending';
    if (agg.cv === 0) return 'fail';
    if (agg.roas >= 200) return 'win';
    if (agg.roas >= 100) return 'mid';
    return 'weak';
}

// 원인 분석: 시장 컨텍스트 + 제품 내 순위/상대 비교 + CTR/CVR 진단 + 소재간 편차(앵글 비교)
// 각 원인에 type을 붙여 렌더링 시 아이콘·색으로 구분되게 한다(가독성 개선).
// CTR/CVR은 가능하면 고정 임계값이 아니라 "같은 제품의 다른 CEP 평균"과 비교해서 말한다 —
// 그래야 CEP마다 다른, 실제로 차이를 만든 지점이 드러난다.
function _cepAnalyze(cepObj, agg, tag, ctx, commonSegs, benchmark) {
    const causes = [];
    let best = null, worst = null;
    if (tag === 'pending') {
        causes.push({ type: 'neutral', text: '검증 소재가 아직 집행되지 않아 결과를 분석할 수 없습니다.' });
        return { causes, best, worst };
    }

    if (ctx) {
        if (tag === 'win' || tag === 'mid') causes.push({ type: 'context', text: `이 CEP는 "${ctx}" 같이 구체적이고 시급한 상황이라, 소재가 그 순간을 짚어주자 소비자가 빠르게 반응한 것으로 보입니다.` });
        else causes.push({ type: 'context', text: `이 CEP는 "${ctx}" 상황을 겨냥했지만, 이번 소재가 그 구체적인 순간·감정을 충분히 포착하지 못했을 가능성이 있습니다.` });
    }

    const bm = benchmark || [];
    const rank = _cepRankInfo(bm, cepObj.cepLabel);
    if (rank) {
        if (rank.rank === 1) {
            causes.push({ type: 'rank', text: `이 제품의 검증 완료 CEP ${rank.total}개 중 ROAS가 가장 높습니다(1위).` });
        } else {
            const topTitle = _cepSplitLabel(rank.top.label).title;
            causes.push({ type: 'rank', text: `이 제품의 검증 완료 CEP ${rank.total}개 중 ROAS 기준 ${rank.rank}위입니다 — 1위 "${topTitle}"(ROAS ${rank.top.agg.roas.toFixed(0)}%)와는 격차가 있습니다.` });
        }
    }

    const peerCtr = _cepPeerAvg(bm, cepObj.cepLabel, 'ctr');
    if (peerCtr != null && Math.abs(agg.ctr - peerCtr) >= 0.3) {
        causes.push(agg.ctr < peerCtr
            ? { type: 'ctr', text: `CTR ${agg.ctr.toFixed(2)}%로 이 제품의 다른 CEP 평균(${peerCtr.toFixed(2)}%)보다 낮습니다 — 소재의 1차 주목도(썸네일·카피)가 상대적으로 약했을 가능성이 있습니다.` }
            : { type: 'ctr', text: `CTR ${agg.ctr.toFixed(2)}%로 이 제품의 다른 CEP 평균(${peerCtr.toFixed(2)}%)보다 높습니다 — 소구포인트에 대한 1차 반응(클릭 유도)이 다른 CEP보다 잘 작동했습니다.` });
    } else if (peerCtr == null) {
        if (agg.ctr < 1.5) causes.push({ type: 'ctr', text: `CTR ${agg.ctr.toFixed(2)}%로 낮은 편이라 소재의 1차 주목도(썸네일·카피)가 약했을 가능성이 있습니다.` });
        else if (agg.ctr >= 3) causes.push({ type: 'ctr', text: `CTR ${agg.ctr.toFixed(2)}%로 양호해 소구포인트에 대한 1차 반응(클릭 유도)은 잘 작동했습니다.` });
    }

    if (agg.click > 0 && agg.cv === 0) {
        causes.push({ type: 'cv', text: `클릭 ${Math.round(agg.click).toLocaleString()}건 대비 전환이 0건으로, 클릭 이후 구매 결정 단계(가격·상세페이지·오퍼)에서 이탈했을 가능성이 큽니다.` });
    } else if (agg.cv > 0) {
        const peerCvr = _cepPeerAvg(bm, cepObj.cepLabel, 'cvr');
        if (peerCvr != null && Math.abs(agg.cvr - peerCvr) >= 0.3) {
            causes.push(agg.cvr < peerCvr
                ? { type: 'cv', text: `CVR ${agg.cvr.toFixed(2)}%로 이 제품의 다른 CEP 평균(${peerCvr.toFixed(2)}%)보다 낮습니다 — 클릭 이후 전환 단계에서 상대적으로 더 이탈합니다.` }
                : { type: 'cv', text: `CVR ${agg.cvr.toFixed(2)}%로 이 제품의 다른 CEP 평균(${peerCvr.toFixed(2)}%)보다 높습니다 — 클릭 이후 전환이 다른 CEP보다 잘 일어났습니다.` });
        } else if (peerCvr == null && agg.cvr < 1) {
            causes.push({ type: 'cv', text: `CVR ${agg.cvr.toFixed(2)}%로 낮아 클릭 이후 전환 단계에서 이탈이 큽니다.` });
        }
    }

    // 소재별 비교는 시트가 직접 계산한 ROAS(roasSheet)를 기준으로 한다 — COST/CV/Revenue가
    // 플랫폼 리포트 특성상 단순 나눗셈과 다를 수 있어, 재계산값이 아닌 원본 값을 신뢰한다.
    const spent = cepObj.creatives.filter(c => c.cost > 0);
    if (spent.length > 1) {
        const sorted = [...spent].sort((a, b) => b.roasSheet - a.roasSheet);
        best = sorted[0]; worst = sorted[sorted.length - 1];
        if (best.roasSheet - worst.roasSheet > 50) {
            const bestUniq = _cepUniqueDetail(best.detail, commonSegs);
            const worstUniq = _cepUniqueDetail(worst.detail, commonSegs);
            const copies = spent.map(c => (c.detail || '').split('/')[0]?.trim()).filter(Boolean);
            const sameCopy = copies.length > 1 && copies.every(c => c === copies[0]);
            const intro = sameCopy ? '동일한 카피·소구를 사용했음에도' : '같은 CEP를 겨냥했지만';
            const outro = sameCopy ? '카피보다 모델과 영상 구성(시연 방식·클로즈업 등)의 차이가 성과를 가른 것으로 보입니다.' : '모델·구성·카피 등 표현 방식 차이가 성과를 가른 것으로 보입니다.';
            causes.push({ type: 'compare', text: `${intro} 소재별 성과 편차가 큽니다 — "${bestUniq}" 소재는 ROAS ${best.roasSheet.toFixed(0)}%로 가장 높았고, "${worstUniq}" 소재는 ROAS ${worst.roasSheet.toFixed(0)}%로 낮았습니다. ${outro}` });
        }
    } else if (spent.length === 1) {
        best = spent[0];
    }

    if (!causes.length) {
        causes.push({ type: 'neutral', text: (tag === 'win' || tag === 'mid') ? '전반적으로 안정적인 성과를 보이고 있습니다.' : '뚜렷한 원인 신호 없이 전반적으로 반응이 약합니다. 노출/클릭 표본이 적어 판단이 어려울 수 있습니다.' });
    }
    return { causes, best, worst };
}

function _cepNextStepText(tag, agg, best, commonSegs) {
    const bestUniq = best ? _cepUniqueDetail(best.detail, commonSegs) : '';
    switch (tag) {
        case 'pending': return '가설에 맞는 검증 소재를 제작해 테스트를 시작하세요.';
        case 'fail': return '전환 0건으로 가설이 입증되지 않았습니다. 동일 CEP를 다른 앵글로 1회 더 검증하거나 다른 CEP로 예산을 재배분하세요.';
        case 'win': return `검증된 CEP입니다.${bestUniq ? ` "${bestUniq}" 같은 영상 구성을 중심으로` : ''} 소재를 추가 제작하고 예산 확대를 검토하세요.`;
        case 'mid': return `손익 경계선입니다.${bestUniq ? ` "${bestUniq}" 소재의 영상 구성을 변형해` : ''} 2-3개 추가 소재로 재검증하세요.`;
        default: return '전환은 있으나 효율이 낮습니다. 타겟 또는 랜딩 오퍼를 조정해 재검증하세요.';
    }
}

function _cepFmtKRW(v) { return '₩' + Math.round(v).toLocaleString(); }
function _cepFmtPct(v) { return v.toFixed(1) + '%'; }
function _cepFmtInt(v) { return Math.round(v).toLocaleString(); }

function _cepRenderCepBlock(cepObj, productName, isOpen, benchmark) {
    const hasResult = cepObj.creatives.length > 0;
    const agg = hasResult ? _cepAggregate(cepObj) : null;
    const tag = _cepVerdictTag(agg, hasResult);
    const meta = CEP_VERDICT_META[tag];
    const hypotheses = [...cepObj.hypotheses];
    const { no: cepNo, title: cepTitle } = _cepSplitLabel(cepObj.cepLabel);
    const ctx = _cepContextFor(productName, cepTitle);

    const ctxHtml = ctx ? `<div class="cep-ctx-note"><i class="fas fa-chart-pie"></i> ${_cepEsc(ctx)}</div>` : '';
    // 소재별 비교에 쓰는 공통 구절 집합 — hypoHtml(이름+강조 포인트만 표시)에도 같이 쓴다.
    const commonSegs = hasResult ? _cepCommonDetailSegments(cepObj.creatives) : null;
    // "검증 상세" 컬럼은 가설이 아니라 소재(영상)가 실제로 어떻게 구성되는지에 대한 설명이다.
    // 전체를 나열하면 읽기 어려우므로, 검증 완료 건은 이름 + "강조하는 부분"만 짧게 보여주고
    // (전체 흐름은 아래 소재 카드의 링크로 확인), 검증 대기 건은 아직 만들지 않은 기획 내용이므로
    // 별도로 표시한다.
    let hypoHtml = '';
    if (hasResult) {
        const items = cepObj.creatives.filter(c => c.detail);
        if (items.length) {
            hypoHtml = `<div class="cep-hypo"><div class="cep-hypo-label">소재별 강조 포인트</div><ul class="cep-hypo-list">${items.map(c => {
                const name = _cepDetailName(c.detail, c.name);
                const emphasis = _cepEmphasisText(c.detail, commonSegs);
                return `<li><b>${_cepEsc(name)}</b>${emphasis ? ` — ${_cepEsc(emphasis)} 강조` : ''}</li>`;
            }).join('')}</ul></div>`;
        }
    } else if (hypotheses.length) {
        hypoHtml = `<div class="cep-hypo"><div class="cep-hypo-label">기획 내용 (제작 예정 소재)</div><ul class="cep-hypo-list">${hypotheses.map(h => `<li>${_cepEsc(h)}</li>`).join('')}</ul></div>`;
    }
    // 헤더에 ROAS 미리보기 칩을 붙여, 접힌 상태에서도 핵심 수치가 보이게 한다
    // (CEP별 수치 비교 표·소재 카드와 똑같은 숫자를 본문에서 또 보여주지 않기 위해
    // CEP 종합 결과 strip은 제거하고 이 칩 하나로 대체했다).
    const headMetricHtml = hasResult
        ? `<span class="cep-head-metric">ROAS <b>${agg.roas.toFixed(0)}%</b></span>`
        : '';
    const headHtml = `
        <div class="cep-card-head">
            ${cepNo ? `<span class="cep-tag">${_cepEsc(cepNo)}</span>` : ''}
            <span class="cep-name">${_cepEsc(cepTitle)}</span>
            ${headMetricHtml}
            <span class="cep-status-badge ${hasResult ? 'done' : 'pending'}">${hasResult ? '검증 완료' : '검증 대기'}</span>
            <i class="fas fa-chevron-down cep-collapse-icon"></i>
        </div>`;

    if (!hasResult) {
        return `
        <div class="cep-block cep-block--pending ${isOpen ? '' : 'cep-block--collapsed'}">
            ${headHtml}
            <div class="cep-block-body">
                ${ctxHtml}
                ${hypoHtml}
                <div class="cep-pending-note"><i class="fas fa-circle-notch"></i> 검증 소재 제작 대기 중 — 결과·원인 분석은 집행 후 표시됩니다.</div>
                <div class="cep-nextstep">
                    <span class="cep-action-badge cep-action--pending">${meta.emoji} Next Step</span>
                    <p class="cep-action-text">${_cepEsc(_cepNextStepText('pending'))}</p>
                </div>
            </div>
        </div>`;
    }

    const { causes, best } = _cepAnalyze(cepObj, agg, tag, ctx, commonSegs, benchmark);
    const nextText = _cepNextStepText(tag, agg, best, commonSegs);
    const multi = cepObj.creatives.filter(c => c.cost > 0).length > 1;

    const creativeCardsHtml = `
        <div class="cep-creative-grid">
            ${cepObj.creatives.map(c => {
                const isBest = multi && best && c === best;
                const thumbHtml = typeof window.buildDriveImgHtml === 'function'
                    ? window.buildDriveImgHtml(c.url, {
                        className: 'cep-creative-img', alt: c.name,
                        finalFallbackHtml: '<div class="cep-creative-noimg"><i class="fas fa-image"></i></div>',
                    })
                    : `<img class="cep-creative-img" src="${_cepEsc(c.url)}" alt="${_cepEsc(c.name)}" loading="lazy" referrerpolicy="no-referrer">`;
                return `
                <div class="cep-creative-card ${isBest ? 'cep-creative-card--best' : ''}">
                    <a href="${_cepEsc(c.url)}" target="_blank" rel="noopener" class="cep-creative-thumb">
                        ${thumbHtml}
                        ${isBest ? '<span class="cep-best-tag cep-best-tag--thumb">★최고</span>' : ''}
                    </a>
                    <div class="cep-creative-body">
                        <div class="cep-creative-angle">${_cepEsc(_cepUniqueDetail(c.detail, commonSegs))}</div>
                        <div class="cep-creative-metrics">
                            <span><b>${_cepFmtInt(c.imp)}</b>IMP</span>
                            <span><b>${c.imp > 0 ? _cepFmtPct(c.ctrSheet) : '-'}</b>CTR</span>
                            <span><b>${_cepFmtInt(c.cv)}</b>CV</span>
                            <span class="cep-creative-roas"><b>${c.cost > 0 ? _cepFmtPct(c.roasSheet) : '-'}</b>ROAS</span>
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </div>`;

    return `
    <div class="cep-block cep-block--${tag} ${isOpen ? '' : 'cep-block--collapsed'}">
        ${headHtml}
        <div class="cep-block-body">
            ${ctxHtml}
            ${hypoHtml}
            <div class="cep-section-label">소재별 성과</div>
            ${creativeCardsHtml}
            <div class="cep-section-label">원인 분석</div>
            <ul class="cep-cause-list">${causes.map(c => `<li class="cep-cause cep-cause--${c.type}"><i class="fas ${CEP_CAUSE_ICON[c.type] || CEP_CAUSE_ICON.neutral}"></i><span>${_cepEsc(c.text)}</span></li>`).join('')}</ul>
            <div class="cep-nextstep">
                <span class="cep-action-badge cep-action--${tag}">${meta.emoji} Next Step</span>
                <p class="cep-action-text">${_cepEsc(nextText)}</p>
            </div>
        </div>
    </div>`;
}

function _cepRenderSummary(groups) {
    const el = document.getElementById('cep-summary-cards');
    if (!el) return;
    let total = 0, done = 0, cost = 0, revenue = 0;
    groups.forEach(p => {
        p.ceps.forEach(c => {
            total++;
            if (c.creatives.length > 0) {
                done++;
                const a = _cepAggregate(c);
                cost += a.cost; revenue += a.revenue;
            }
        });
    });
    const pending = total - done;
    const avgRoas = cost > 0 ? revenue / cost * 100 : null;
    const stats = [
        { label: '추적 CEP', val: String(total), icon: 'fa-flask', color: 'text-indigo-600' },
        { label: '검증 완료', val: String(done), icon: 'fa-circle-check', color: 'text-emerald-600' },
        { label: '검증 대기', val: String(pending), icon: 'fa-hourglass-half', color: 'text-amber-600' },
        { label: '평균 ROAS', val: avgRoas != null ? avgRoas.toFixed(0) + '%' : '-', icon: 'fa-chart-line', color: 'text-rose-600' },
    ];
    el.innerHTML = stats.map(s => `
        <div class="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center ${s.color}">
                <i class="fas ${s.icon}"></i>
            </div>
            <div>
                <div class="text-xs text-slate-500">${s.label}</div>
                <div class="text-base font-bold text-slate-900">${s.val}</div>
            </div>
        </div>`).join('');
}

function _cepPopulateBrandFilter(productsMap) {
    const brandSel = document.getElementById('cep-brand-filter');
    if (!brandSel) return;
    const brands = new Set();
    productsMap.forEach(p => { if (p.brand) brands.add(p.brand); });
    const cur = brandSel.value;
    brandSel.innerHTML = '<option value="">전체 브랜드</option>' + [...brands].sort().map(b => `<option value="${_cepEsc(b)}">${_cepEsc(b)}</option>`).join('');
    if ([...brands].includes(cur)) brandSel.value = cur;
}

// 제품 목록에서 클릭 없이도 성과를 가늠할 수 있도록, CEP 블록과 같은 등급(win/mid/weak/pending)을
// 좌측 색상 바로 표시한다.
function _cepRoasTier(avgRoas) {
    if (avgRoas == null) return 'pending';
    if (avgRoas >= 200) return 'win';
    if (avgRoas >= 100) return 'mid';
    return 'weak';
}

function _cepRenderProductList(productsMap) {
    const listEl = document.getElementById('cep-product-list');
    if (!listEl) return;
    const arr = [...productsMap.entries()];
    if (!arr.length) {
        listEl.innerHTML = _cepEmptyHtml('fa-flask', '조건에 맞는 제품이 없습니다.', { py: 'py-10' });
        return;
    }
    if (!_cepSelectedKey || !productsMap.has(_cepSelectedKey)) _cepSelectedKey = arr[0][0];

    listEl.innerHTML = arr.map(([key, p]) => {
        const ceps = [...p.ceps.values()];
        const done = ceps.filter(c => c.creatives.length > 0).length;
        const avgRoas = _cepProductAvgRoas(p);
        const tier = _cepRoasTier(avgRoas);
        return `
        <button class="cep-prod-item cep-prod-item--${tier} ${key === _cepSelectedKey ? 'active' : ''}" data-key="${_cepEsc(key)}">
            <div class="cep-prod-item-top">
                <span class="cep-brand-tag">${_cepEsc(p.brand)}</span>
                <span class="cep-prod-item-name">${_cepEsc(p.product)}</span>
            </div>
            <div class="cep-prod-item-stat">CEP ${ceps.length}개 · 완료 ${done}${avgRoas != null ? ` · <span class="cep-prod-item-roas">ROAS ${avgRoas.toFixed(0)}%</span>` : ''}</div>
        </button>`;
    }).join('');

    listEl.querySelectorAll('.cep-prod-item').forEach(btn => {
        btn.addEventListener('click', () => {
            _cepSelectedKey = btn.dataset.key;
            listEl.querySelectorAll('.cep-prod-item').forEach(b => b.classList.toggle('active', b === btn));
            _cepRenderDetailForSelected();
        });
    });
}

// 같은 제품 안에서 CEP끼리 비교 — 어떤 CEP가 왜 잘됐고, 왜 안됐는지
function _cepProductInsight(pObj) {
    const items = [...pObj.ceps.values()]
        .map(c => ({ cep: c, agg: _cepAggregate(c) }))
        .filter(x => x.cep.creatives.length > 0 && x.agg.cost > 0);
    if (items.length < 2) return '';

    const sorted = [...items].sort((a, b) => b.agg.roas - a.agg.roas);
    const top = sorted[0], bottom = sorted[sorted.length - 1];
    if (top === bottom || top.agg.roas - bottom.agg.roas < 20) return '';

    const topInfo = _cepSplitLabel(top.cep.cepLabel);
    const bottomInfo = _cepSplitLabel(bottom.cep.cepLabel);
    const topCtx = _cepContextFor(pObj.product, topInfo.title);
    const bottomCtx = _cepContextFor(pObj.product, bottomInfo.title);

    const topLine = `"${topInfo.title}"(ROAS ${top.agg.roas.toFixed(0)}%)가 가장 효율이 높았습니다${topCtx ? ` — "${topCtx}" 같이 구체적이고 시급한 상황일수록 소비자 반응이 빠르게 일어나는 것으로 보입니다.` : '.'}`;
    const bottomLine = `반대로 "${bottomInfo.title}"(ROAS ${bottom.agg.roas.toFixed(0)}%)는 효율이 낮았는데${bottomCtx ? `, "${bottomCtx}" 상황은 니즈가 막연하거나 시급성이 낮아 소구가 약하게 작동했을 가능성이 있습니다.` : ', 소구포인트가 막연했거나 시급성이 낮았을 가능성이 있습니다.'}`;

    return `${topLine} ${bottomLine} 다음 예산은 "${topInfo.title}" 류의 CEP에 더 비중을 두고, "${bottomInfo.title}"은 소구를 더 구체화하거나 우선순위를 낮추는 것을 검토하세요.`;
}

// 제품 내 CEP 전체를 한눈에 비교하는 표 — 완료된 CEP는 ROAS 높은 순으로, 대기 중인 CEP는 뒤에 모아 보여준다.
function _cepCompareTableHtml(pObj) {
    const rows = [...pObj.ceps.values()].map(c => {
        const { title } = _cepSplitLabel(c.cepLabel);
        const hasResult = c.creatives.length > 0;
        const agg = hasResult ? _cepAggregate(c) : null;
        const tag = _cepVerdictTag(agg, hasResult);
        return { title, hasResult, agg, tag };
    });
    if (rows.length < 2) return '';

    rows.sort((a, b) => {
        if (a.hasResult !== b.hasResult) return a.hasResult ? -1 : 1;
        if (a.hasResult && b.hasResult) return b.agg.roas - a.agg.roas;
        return 0;
    });

    return `
    <div class="cep-section-label">CEP별 수치 비교</div>
    <div class="cep-compare-wrap">
        <table class="cep-compare-table">
            <thead><tr><th>CEP</th><th>상태</th><th>IMP</th><th>CTR</th><th>CVR</th><th>COST</th><th>CV</th><th>ROAS</th></tr></thead>
            <tbody>
                ${rows.map(r => `
                <tr class="cep-compare-row--${r.tag}">
                    <td class="cep-compare-title">${_cepEsc(r.title)}</td>
                    <td><span class="cep-status-badge ${r.hasResult ? 'done' : 'pending'}">${r.hasResult ? '완료' : '대기'}</span></td>
                    <td>${r.hasResult ? _cepFmtInt(r.agg.imp) : '-'}</td>
                    <td>${r.hasResult ? _cepFmtPct(r.agg.ctr) : '-'}</td>
                    <td>${r.hasResult ? _cepFmtPct(r.agg.cvr) : '-'}</td>
                    <td>${r.hasResult ? _cepFmtKRW(r.agg.cost) : '-'}</td>
                    <td>${r.hasResult ? _cepFmtInt(r.agg.cv) : '-'}</td>
                    <td class="cep-compare-roas">${r.hasResult ? `<b>${r.agg.roas.toFixed(0)}%</b>` : '-'}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    </div>`;
}

// 순위 카드 하단: 이 CEP를 표현한 검증 소재 썸네일 스트립 (ROAS 높은 순, 클릭 시 원본)
const CEP_RANK_THUMB_MAX = 5;
function _cepRankThumbsHtml(cepObj) {
    const items = [...cepObj.creatives].sort((a, b) => (b.roasSheet || 0) - (a.roasSheet || 0));
    if (!items.length) return '';
    const shown = items.slice(0, CEP_RANK_THUMB_MAX);
    const rest = items.length - shown.length;
    const cells = shown.map((cr, i) => {
        const img = typeof window.buildDriveImgHtml === 'function'
            ? window.buildDriveImgHtml(cr.url, {
                className: 'cep-rank-thumb-img', alt: cr.name,
                finalFallbackHtml: '<div class="cep-rank-thumb-noimg"><i class="fas fa-image"></i></div>',
            })
            : `<img class="cep-rank-thumb-img" src="${_cepEsc(cr.url)}" alt="${_cepEsc(cr.name)}" loading="lazy" referrerpolicy="no-referrer">`;
        const roasTxt = cr.cost > 0 ? `${(cr.roasSheet || 0).toFixed(0)}%` : '-';
        const isBest = i === 0 && shown.length > 1;
        return `
        <a class="cep-rank-thumb${isBest ? ' cep-rank-thumb--best' : ''}" href="${_cepEsc(cr.url)}" target="_blank" rel="noopener"
           title="${_cepEsc(cr.name)} · ROAS ${roasTxt}${isBest ? ' (이 CEP에서 최고)' : ''}">
            ${img}
            <span class="cep-rank-thumb-roas">${isBest ? '★' : ''}${roasTxt}</span>
        </a>`;
    }).join('');
    const moreHtml = rest > 0
        ? `<span class="cep-rank-thumb-more" title="아래 CEP 상세의 '소재별 성과'에서 전체 확인">+${rest}</span>` : '';
    return `
    <div class="cep-rank-thumbs">
        <div class="cep-rank-thumbs-label">이 CEP를 표현한 소재 ${items.length}개 · 클릭하면 원본</div>
        <div class="cep-rank-thumb-row">${cells}${moreHtml}</div>
    </div>`;
}

function _cepRankingSectionHtml(pObj, benchmark) {
    const medals = ['🥇', '🥈', '🥉'];
    const allCeps = [...pObj.ceps.values()];
    const done = allCeps.filter(c => c.creatives.length > 0);
    const pending = allCeps.filter(c => c.creatives.length === 0);

    const rankedDone = done
        .map(c => ({ c, agg: _cepAggregate(c), info: _cepSplitLabel(c.cepLabel) }))
        .sort((a, b) => b.agg.roas - a.agg.roas);

    if (!rankedDone.length && !pending.length) return '';

    const modClass = i => i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : '';
    const cardHtml = (entry, i) => {
        const { c, agg, info } = entry;
        const tag = _cepVerdictTag(agg, true);
        const meta = CEP_VERDICT_META[tag];
        const ctx = _cepContextFor(pObj.product, info.title);
        return `
        <div class="cep-rank-card${modClass(i) ? ` cep-rank-card--${modClass(i)}` : ''}">
            <span class="cep-verdict-chip cep-verdict-chip--${tag}">${meta.emoji} ${meta.label}</span>
            <div class="cep-rank-medal">${medals[i] || '📌'}</div>
            <div class="cep-rank-body">
                <div class="cep-rank-name">${_cepEsc(info.title || c.cepLabel)}</div>
                <div class="cep-rank-metrics">
                    <span class="cep-rank-roas">${agg.roas.toFixed(0)}%</span>
                    <span class="cep-rank-sep">|</span>
                    <span class="cep-rank-cv">CV ${_cepFmtInt(agg.cv)}건</span>
                    <span class="cep-rank-cost">${_cepFmtKRW(agg.cost)}</span>
                </div>
                ${ctx ? `<div class="cep-rank-ctx"><i class="fas fa-quote-left"></i><span>${_cepEsc(ctx)}</span></div>` : ''}
                ${_cepRankThumbsHtml(c)}
            </div>
        </div>`;
    };

    const pendingCardsHtml = pending.map(c => {
        const info = _cepSplitLabel(c.cepLabel);
        return `
        <div class="cep-rank-card cep-rank-card--pending">
            <div class="cep-rank-medal">⏳</div>
            <div class="cep-rank-body">
                <div class="cep-rank-pending-label">검증 대기</div>
                <div class="cep-rank-name">${_cepEsc(info.title || c.cepLabel)}</div>
            </div>
        </div>`;
    }).join('');

    return `
    <div class="cep-ranking-section">
        <div class="cep-ranking-header">
            <span class="cep-ranking-title">CEP 성과 순위</span>
            <span class="cep-ranking-sub">ROAS 기준 · 검증 완료 ${rankedDone.length}개</span>
        </div>
        <div class="cep-rank-cards">
            ${rankedDone.map((entry, i) => cardHtml(entry, i)).join('')}
            ${pendingCardsHtml}
        </div>
    </div>`;
}

// ── 다각도 프레임 × 실측 성과 자동 인사이트 ─────────────────────────────────
// 하나의 프레임을 모든 제품에 강요하지 않는다. 여러 관점(긴급도/니즈 유형/상황
// 구체성/사용 맥락)으로 CEP를 각각 분류해 실측 ROAS와 교차하고, 그 제품에서
// 실제로 성과 차이를 가장 잘 설명하는 프레임을 자동 선택해 가설을 만든다.
// 어떤 프레임도 설명력이 없으면 억지 결론 대신 "소재 실행 차이" 진단을 낸다.
const CEP_FRAMES = [
    { id: 'urgency', name: '긴급도', formula: '구매 전환 = 지금 불편하거나 · 지금 창피하거나 · 지금 급할 때',
      buckets: [
        { key: 'now',     emoji: '☀️', label: '지금 당장 — 가장 급함',
          kw: ['지금', '당장', '즉시', '오후에', '수정 전', '직전', '틈새', '바쁜', '들뜨', '외출', '응급', '에어컨', '갈라져'],
          verdict: '지금 겪는 불편(①지금 불편 ②매일 반복 ③해결책 명확)을 짚을 때 구매로 이어집니다' },
        { key: 'today',   emoji: '😴', label: '오늘 안에 — 그나마 급함',
          kw: ['전날', '다음 날', '내일', '아침', '오늘', '자는 동안', '취침', '밤', '수면', '잠', '출근', '통근', '세안 직후', 'D-'],
          verdict: '하루 안에 해결하고 싶은 니즈가 가장 크게 반응합니다' },
        { key: 'someday', emoji: '🪞', label: '언젠가는 — 급하지 않음', kw: [],
          verdict: "'언젠가의 고민'이 오히려 반응합니다 — 고민의 무게 자체가 큰 카테고리로 보입니다" },
      ] },
    { id: 'need', name: '니즈 유형', formula: '불편을 없애려는 구매인가, 되고 싶은 모습을 사는 구매인가',
      buckets: [
        { key: 'problem', emoji: '🚨', label: '문제 해소형',
          kw: ['건조', '처짐', '들뜨', '갈라', '칙칙', '푸석', '다크서클', '당길', '무너', '실패', '겁', '걱정', '불편', '고민', '주름', '못 잔'],
          verdict: '불편을 없애주는 해결책 포지션이 워킹합니다 — 증상을 첫 장면에 보여주세요' },
        { key: 'aspire', emoji: '✨', label: '열망 실현형',
          kw: ['싶은 밤', '깨어나고 싶', '예쁘', '완성', '연출', '자신', '빛나', '아름', '단장'],
          verdict: '되고 싶은 모습을 보여주는 열망 소구가 워킹합니다 — 결과 이미지를 앞세우세요' },
      ] },
    { id: 'scene', name: '상황 구체성', formula: '장면이 그려지는 CEP인가, 막연한 상태 서술인가',
      buckets: [
        { key: 'vivid', emoji: '🎬', label: '구체적 장면형',
          kw: ['아침', '오후', '밤', '전날', '출근', '통근', '세안', '거울', '에어컨', '외출', '회의', '자리', '여행', '마스크', '수정', '화장'],
          verdict: '시간·장소가 박혀 장면이 그려지는 CEP가 워킹합니다 — 소비자가 자기 얘기로 받아들입니다' },
        { key: 'vague', emoji: '💭', label: '막연한 상태형', kw: [],
          verdict: '구체 장면보다 상태·고민 자체를 정면으로 말하는 CEP가 워킹합니다' },
      ] },
    { id: 'occasion', name: '사용 맥락', formula: '매일의 루틴에 끼우는가, 특별한 날을 대비하는가',
      buckets: [
        { key: 'event', emoji: '🎉', label: '이벤트 대비형',
          kw: ['중요한', '앞둔', '결혼', '촬영', '자리', '미팅', 'D-', '데이트'],
          verdict: '특별한 날을 앞둔 데드라인 소구가 워킹합니다 — 시한이 구매를 만듭니다' },
        { key: 'routine', emoji: '🔁', label: '일상 루틴형',
          kw: ['매일', '아침', '밤', '자는 동안', '출근', '통근', '루틴', '세안', '하루', '오후'],
          verdict: '매일 반복되는 순간에 끼워 넣는 소구가 워킹합니다 — 반복 사용 이유를 주세요' },
      ] },
];

function _cepClassify(frame, title) {
    return frame.buckets.find(b => b.kw.length ? b.kw.some(k => title.includes(k)) : true) || null;
}

// 프레임 하나를 이 제품의 실측 데이터로 평가: 버킷별 평균 ROAS와 설명력(버킷 간 격차)
function _cepFrameEval(frame, items) {
    const byBucket = new Map();
    items.forEach(x => {
        const b = _cepClassify(frame, x.info.title);
        if (!b) return;
        if (!byBucket.has(b.key)) byBucket.set(b.key, { bucket: b, items: [] });
        byBucket.get(b.key).items.push(x);
    });
    const groups = [...byBucket.values()].map(g => ({ ...g, avg: g.items.reduce((s, x) => s + x.agg.roas, 0) / g.items.length }));
    if (groups.length < 2) return null;   // 전부 한 버킷이면 이 관점으론 구분 불가
    groups.sort((a, b) => b.avg - a.avg);
    return { frame, groups, spread: groups[0].avg - groups[groups.length - 1].avg,
             covered: groups.reduce((s, g) => s + g.items.length, 0) };
}

// 제품별 핵심 효능 메타 — 최고 성과 CEP가 "메인 효능 축"인지 "부가 니즈 축"인지 판별.
// 부가 니즈로 팔린 경우 포지셔닝 갈림길(A/B)을 명시적으로 제시한다.
const CEP_PRODUCT_META = {
    'EyeCream':    { core: '처짐·탄력', coreKw: ['처짐', '탄력', '주름', '나이'], alt: '보습·즉각 케어' },
    'NAD-Cream':   { core: '안티에이징(NAD 성분)', coreKw: ['노화', '안티에이징', '성분', '나이'], alt: '컨디션 회복·나이트 케어' },
    'NAD-Cream-2': { core: '안티에이징(NAD 성분)', coreKw: ['노화', '안티에이징', '성분', '나이'], alt: '컨디션 회복·나이트 케어' },
    'GelMist':     { core: '수분 보습', coreKw: ['수분', '보습', '촉촉', '건조', '당길'], alt: '메이크업 픽스·프렙' },
    'GelMistx2':   { core: '수분 보습', coreKw: ['수분', '보습', '촉촉', '건조', '당길'], alt: '메이크업 픽스·프렙' },
    'Asachuru':    { core: '모닝 리프팅·탄력', coreKw: ['탄력', '리프팅', '처짐'], alt: '이벤트 전 피부 프렙' },
    '3D-Refill':   { core: '리프팅·탄력', coreKw: ['리프팅', '탄력', '처짐'], alt: '보습 케어' },
};

function _cepAutoInsightHtml(pObj) {
    const items = [...pObj.ceps.values()]
        .map(c => ({ c, agg: _cepAggregate(c), info: _cepSplitLabel(c.cepLabel) }))
        .filter(x => x.c.creatives.length > 0 && x.agg.cost > 0);
    if (items.length < 2) return '';

    const sorted = [...items].sort((a, b) => b.agg.roas - a.agg.roas);
    const top = sorted[0], bottom = sorted[sorted.length - 1];
    const gap = top.agg.roas - bottom.agg.roas;
    const meta = CEP_PRODUCT_META[pObj.product] || null;

    // 모든 프레임을 실측 데이터로 평가해 설명력(버킷 간 ROAS 격차) 순으로 정렬
    const evals = CEP_FRAMES.map(f => _cepFrameEval(f, items)).filter(Boolean)
        .sort((a, b) => b.spread - a.spread);
    // 프레임 채택 기준: 버킷 간 평균 ROAS 격차 30%p 이상 + 전체 성과 편차도 유의미할 것
    const best = (gap >= 20 && evals.length && evals[0].spread >= 30) ? evals[0] : null;
    const second = (best && evals.length > 1 && evals[1].spread >= 30) ? evals[1] : null;

    // CEP × 성과 표 — 채택된 프레임의 버킷으로 라벨링 (미채택 시 순수 순위표)
    const rowsHtml = sorted.map((x, i) => {
        const b = best ? _cepClassify(best.frame, x.info.title) : null;
        return `
        <div class="cep-urgency-row${i === 0 ? ' cep-urgency-row--top' : ''}${i === sorted.length - 1 ? ' cep-urgency-row--bottom' : ''}">
            <span class="cep-urgency-emoji">${b ? b.emoji : '📌'}</span>
            <span class="cep-urgency-title">${_cepEsc(x.info.title)}</span>
            ${b ? `<span class="cep-urgency-desc">${_cepEsc(b.label)}</span>` : ''}
            <span class="cep-urgency-roas">ROAS ${x.agg.roas.toFixed(0)}%</span>
        </div>`;
    }).join('');

    // 워킹 요인 결론 — 채택된 프레임이 말하는 방향 + 하위 CEP 깔때기 진단
    const hypoLines = [];
    if (gap < 20) {
        hypoLines.push(`CEP 간 성과 편차가 작아(최대 ROAS 차 ${gap.toFixed(0)}%p) 아직 워킹 요인을 단정하기 어렵습니다 — 표본(노출·기간)을 늘려 재검증이 필요합니다.`);
    } else if (best) {
        const tg = best.groups[0], bg = best.groups[best.groups.length - 1];
        hypoLines.push(`[${best.frame.name} 관점] "${tg.bucket.label}" 유형(평균 ROAS ${tg.avg.toFixed(0)}%, ${tg.items.length}개)이 "${bg.bucket.label}" 유형(${bg.avg.toFixed(0)}%, ${bg.items.length}개)을 크게 앞섭니다 — ${tg.bucket.verdict}.`);
        if (second) {
            const sg = second.groups[0];
            hypoLines.push(`[보조 관점 · ${second.frame.name}] "${sg.bucket.label}" 유형의 우위도 함께 관찰됩니다 (평균 ROAS ${sg.avg.toFixed(0)}%) — 두 관점을 모두 만족하는 CEP가 가장 안전한 확장 후보입니다.`);
        }
    } else {
        hypoLines.push(`긴급도·니즈 유형·상황 구체성·사용 맥락 어느 관점으로도 뚜렷한 패턴이 없습니다 — 성과 차이는 CEP 선택보다 소재 실행(모델·영상 구성·카피)에서 났을 가능성이 큽니다.`);
    }
    // 하위 CEP 깔때기 진단 — CTR은 유지되는데 CVR이 낮으면 "클릭은 해도 구매까지는 안 간다"
    if (gap >= 20) {
        const clickNotBuy = bottom.agg.ctr >= top.agg.ctr * 0.7 && bottom.agg.cvr < top.agg.cvr;
        hypoLines.push(`최하위 "${bottom.info.title}"(ROAS ${bottom.agg.roas.toFixed(0)}%)는 ${clickNotBuy ? '클릭(CTR)은 나오지만 구매까지 이어지지 않습니다 — 관심은 있어도 지금 살 이유가 없는 소구일 가능성' : '1차 반응(CTR)부터 약합니다 — 상황 공감 실패로 소구 재설계가 필요'}합니다.`);
    }

    // 핵심 효능 축 점검 — 1위 CEP가 메인 효능이 아니라 부가 니즈로 팔렸는지
    const topIsCore = meta ? meta.coreKw.some(k => top.info.title.includes(k)) : true;
    let coreLine = '', optA = '', optB = '';
    if (meta && !topIsCore) {
        coreLine = `단, 메인 효능(${meta.core})으로 팔린 게 아니라 ${meta.alt} 니즈로 팔렸을 가능성이 높습니다 — 포지셔닝 판단이 필요합니다.`;
        optA = `${meta.alt} 포지션으로 계속 밀기 — "${top.info.title}"처럼 검증된 니즈를 공략하는 CEP를 추가 발굴`;
        optB = `${meta.core}이라는 핵심 효능 밀기 — '지금 당장 급한' 상황을 새로 찾아 결합 (예: 결혼식 D-30, 중요한 촬영·미팅 전)`;
    } else if (best) {
        const tg = best.groups[0], bg = best.groups[best.groups.length - 1];
        optA = `"${top.info.title}" (${tg.bucket.label}) 축 유지 — 같은 유형의 상황을 다른 모델·영상 구성으로 소재 증량`;
        optB = `${bg.bucket.label} 소구를 ${tg.bucket.label} 요소와 결합해 재구성 후 1회 재검증 — 실패 시 예산 회수`;
    } else {
        optA = `1위 "${top.info.title}"의 소재 구성을 유지한 채 CEP만 바꿔 검증 — CEP 효과 분리 측정`;
        optB = `최하위 CEP에 1위 소재의 모델·구성을 적용해 재검증 — 소재 실행 효과 분리 측정`;
    }

    const nextText = gap < 20
        ? `현재 데이터로는 방향 결정이 이릅니다 — 상위 2개 CEP에 소재를 1개씩 추가해 편차를 벌린 뒤 판단하세요.`
        : best
            ? `"${best.groups[0].bucket.label}" 유형이 이 제품의 워킹 프레임입니다 — 차기 소재는 이 유형의 상황이 첫 장면에 드러나는 구성으로 제작하세요.${coreLine ? ' ' + coreLine : ''}`
            : `CEP보다 소재 실행이 변수로 보입니다 — 1위 소재의 모델·구성 요소를 다른 CEP에 이식해 보세요.${coreLine ? ' ' + coreLine : ''}`;

    return `
    <div class="cep-insight-section">
        <div class="cep-insight-header"><i class="fas fa-brain"></i> 검증 인사이트
            <span class="cep-insight-sub">4개 관점 교차 분석 · 이 제품의 워킹 프레임 자동 선택</span>
            ${best ? `<span class="cep-frame-chip">워킹 프레임: ${_cepEsc(best.frame.name)}</span>` : '<span class="cep-frame-chip cep-frame-chip--none">뚜렷한 프레임 없음</span>'}
        </div>
        <div class="cep-insight-label">워킹 요인 (가설)</div>
        ${best ? `<p class="cep-insight-formula">${_cepEsc(best.frame.formula)}</p>` : ''}
        <div class="cep-urgency-list">${rowsHtml}</div>
        ${hypoLines.map(l => `<p class="cep-insight-note">${_cepEsc(l)}</p>`).join('')}
        <div class="cep-insight-label">Next Action</div>
        <p class="cep-insight-note cep-insight-note--action">${_cepEsc(nextText)}</p>
        <div class="cep-insight-label">A/B Test</div>
        <div class="cep-ab-grid">
            <div class="cep-ab-card cep-ab-card--a"><div class="cep-ab-tag">Option A</div><p>${_cepEsc(optA)}</p></div>
            <div class="cep-ab-card cep-ab-card--b"><div class="cep-ab-tag">Option B</div><p>${_cepEsc(optB)}</p></div>
        </div>
    </div>`;
}

function _cepNoteKey(pKey, field) {
    return `cep_note_${pKey}_${field}`;
}

function _cepNoteEditorHtml(pKey) {
    const get = f => _cepEsc(localStorage.getItem(_cepNoteKey(pKey, f)) || '');
    const safeKey = _cepEsc(pKey);
    return `
    <div class="cep-note-section">
        <div class="cep-note-header">
            <span class="cep-ranking-title">팀 노트</span>
            <span class="cep-note-hint"><i class="fas fa-floppy-disk"></i> 자동 저장</span>
        </div>
        <div class="cep-note-fields">
            <div>
                <div class="cep-note-field-label">워킹 요인 (가설)</div>
                <textarea class="cep-note-textarea" rows="3" placeholder="왜 이 CEP가 잘 됐거나 안 됐는지 — 소비자 심리, 시즌, 소재 구성 등 팀 의견을 적어주세요" oninput="cepSaveNote('${safeKey}','hypo',this.value)">${get('hypo')}</textarea>
            </div>
            <div class="cep-note-grid">
                <div>
                    <div class="cep-note-field-label">Next Action</div>
                    <textarea class="cep-note-textarea" rows="4" placeholder="예) 동일 CEP 앵글 변경 소재 2개 추가 제작&#10;예) 타겟 연령대 확대 테스트" oninput="cepSaveNote('${safeKey}','action',this.value)">${get('action')}</textarea>
                </div>
                <div>
                    <div class="cep-note-field-label">A/B Test 아이디어</div>
                    <textarea class="cep-note-textarea" rows="4" placeholder="예) 썸네일: 인물 클로즈업 vs 제품 클로즈업&#10;예) 카피: 시급성 강조 vs 성분 강조" oninput="cepSaveNote('${safeKey}','abtest',this.value)">${get('abtest')}</textarea>
                </div>
            </div>
        </div>
    </div>`;
}

function cepSaveNote(pKey, field, value) {
    localStorage.setItem(_cepNoteKey(pKey, field), value);
}
window.cepSaveNote = cepSaveNote;

function _cepRenderDetailForSelected() {
    const detailEl = document.getElementById('cep-detail');
    if (!detailEl || !_cepProducts) return;
    const pObj = _cepProducts.get(_cepSelectedKey);
    if (!pObj) { detailEl.innerHTML = _cepEmptyHtml('fa-hand-pointer', '좌측에서 제품을 선택하세요.'); return; }

    const statusSel = document.getElementById('cep-status-filter')?.value || '';
    let ceps = [...pObj.ceps.values()];
    if (statusSel === 'done') ceps = ceps.filter(c => c.creatives.length > 0);
    if (statusSel === 'pending') ceps = ceps.filter(c => c.creatives.length === 0);

    const allCeps = [...pObj.ceps.values()];
    const done = allCeps.filter(c => c.creatives.length > 0).length;
    const avgRoas = _cepProductAvgRoas(pObj);
    const benchmark = _cepProductBenchmark(pObj);
    const compareTable = _cepCompareTableHtml(pObj);

    detailEl.innerHTML = `
        <div class="cep-detail-header">
            <span class="cep-brand-tag">${_cepEsc(pObj.brand)}</span>
            <span class="cep-detail-title">${_cepEsc(pObj.product)}</span>
            <span class="cep-product-stat">CEP ${allCeps.length}개 · 완료 ${done} · 대기 ${allCeps.length - done}${avgRoas != null ? ` · 평균 ROAS ${avgRoas.toFixed(0)}%` : ''}</span>
        </div>
        ${_cepRankingSectionHtml(pObj, benchmark)}
        ${_cepAutoInsightHtml(pObj)}
        ${_cepNoteEditorHtml(_cepSelectedKey)}
        ${compareTable ? `<div class="cep-section-detail-label"><i class="fas fa-table"></i> 수치 상세</div>${compareTable}` : ''}
        <div class="cep-section-detail-label"><i class="fas fa-flask"></i> CEP별 소재 상세</div>
        <div class="cep-blocks">
            ${ceps.length ? ceps.map(c => _cepRenderCepBlock(c, pObj.product, false, benchmark)).join('') : _cepEmptyHtml('fa-flask', '조건에 맞는 CEP가 없습니다.', { py: 'py-10' })}
        </div>`;
}

// 상단 글로벌 브랜드 탭(BOH/WM/CG)과 동기화 — 선택된 브랜드의 제품만 표시
let _cepBrand = '';
function _cepActiveBrand() {
    if (_cepBrand) return _cepBrand;
    return (typeof currentBrand !== 'undefined' && currentBrand && currentBrand !== 'ALL') ? currentBrand : '';
}
window.cepSetBrand = function(brand) {
    _cepBrand = (brand && brand !== 'ALL') ? brand : '';
    if (_cepProducts) _cepApplyFilters();
};

function _cepApplyFilters() {
    if (!_cepProducts) return;
    const brandSel = _cepActiveBrand();
    const filtered = new Map([..._cepProducts.entries()].filter(([, p]) => !brandSel || p.brand === brandSel));

    _cepRenderSummary([...filtered.values()]);
    _cepRenderProductList(filtered);
    _cepRenderDetailForSelected();
}
window.cepApplyFilters = _cepApplyFilters;

async function renderCepVerification(forceReload) {
    const listEl = document.getElementById('cep-product-list');
    if (!listEl) return;
    if (_cepLoading) return;
    if (_cepProducts && !forceReload) { _cepApplyFilters(); return; }

    _cepLoading = true;
    listEl.innerHTML = _cepEmptyHtml('fa-spinner', '검증 로그 불러오는 중...', { py: 'py-10', spin: true });
    const detailEl = document.getElementById('cep-detail');
    if (detailEl) detailEl.innerHTML = '';
    try {
        const res = await fetch(CEP_SHEET_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (text.includes('<HTML>') || text.includes('<!DOCTYPE')) {
            throw new Error('시트가 웹에 게시되지 않았거나 게시 링크가 잘못되었습니다.');
        }
        const rows = _cepParseCSV(text);
        _cepProducts = _cepBuildModel(rows);
        _cepSelectedKey = null;
        _cepPopulateBrandFilter(_cepProducts);
        _cepApplyFilters();
    } catch (e) {
        listEl.innerHTML = _cepEmptyHtml('fa-triangle-exclamation', '로드 실패: ' + e.message, { py: 'py-10', color: 'text-rose-400' });
    } finally {
        _cepLoading = false;
    }
}
window.renderCepVerification = renderCepVerification;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('cep-brand-filter')?.addEventListener('change', _cepApplyFilters);
    document.getElementById('cep-status-filter')?.addEventListener('change', _cepRenderDetailForSelected);
    document.getElementById('cep-refresh-btn')?.addEventListener('click', () => renderCepVerification(true));
    // CEP 블록 헤더 클릭 시 접기/펼치기 (이벤트 위임 — innerHTML이 새로 그려져도 유지됨)
    document.getElementById('cep-detail')?.addEventListener('click', (e) => {
        const head = e.target.closest('.cep-card-head');
        if (head) head.closest('.cep-block')?.classList.toggle('cep-block--collapsed');
    });
});
