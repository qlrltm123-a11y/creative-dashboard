// ============================================================
//  CEP 검증 로그
//  creative_template 시트의 "검증 로그" 탭(CSV 게시본)을 읽어
//  제품(좌측 목록) → 선택 시 CEP별 [종합 결과 → 소재별 성과 →
//  원인 분석 → Next Step] 상세를 우측에 보여준다.
// ============================================================

const CEP_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTVqotU6K1y0u9atjKrRpaFgDamwAdUmxldvBbYepguKNm6MzzRDm5uUMmEGFFw_R3EOxmu1_ihWfKE/pub?gid=1751932102&single=true&output=csv';

// 컬럼 인덱스: 소재명,브랜드,제품,소구포인트(CEP),검증 상세,검증 소재 media urls,IMP,Click,CTR,CPC,COST,CV,CVR,CPA,Revenue,ROAS
const CEP_COL = { name: 0, brand: 1, product: 2, cep: 3, detail: 4, url: 5, imp: 6, click: 7, ctr: 8, cost: 10, cv: 11, revenue: 14, roas: 15 };

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
};
function _cepContextFor(product, title) {
    const list = CEP_CONTEXT[product];
    if (!list || !title) return null;
    const found = list.find(entry => entry.kw.some(k => title.includes(k)));
    return found ? found.text : null;
}

// "CEP-9 오피스 건조 리프레시" -> { num: 9, no: 'CEP-9', title: '오피스 건조 리프레시' }
function _cepSplitLabel(label) {
    const m = label.match(/CEP-?\s*(\d+)/i);
    const num = m ? parseInt(m[1], 10) : null;
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
    const headerIdx = rows.findIndex(r => (r[CEP_COL.name] || '').trim() === '소재명');
    const dataRows = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;
    const products = new Map();

    dataRows.forEach(r => {
        if (!r || r.length < 3) return;
        const brand = (r[CEP_COL.brand] || '').trim();
        const product = _cepNormalizeProduct(r[CEP_COL.product]);
        if (!brand && !product) return;

        const cepLines = (r[CEP_COL.cep] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const hypoLines = (r[CEP_COL.detail] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        let mediaName = (r[CEP_COL.name] || '').trim();
        const mediaUrl = (r[CEP_COL.url] || '').trim();
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
                    imp: _cepNum(r[CEP_COL.imp]), click: _cepNum(r[CEP_COL.click]),
                    cost: _cepNum(r[CEP_COL.cost]), cv: _cepNum(r[CEP_COL.cv]),
                    revenue: _cepNum(r[CEP_COL.revenue]),
                    // 시트가 직접 계산한 값(플랫폼 리포트 기준) — 단순 매출/비용 재계산과 다를 수 있어 표시용으로 그대로 사용
                    ctrSheet: _cepNum(r[CEP_COL.ctr]), roasSheet: _cepNum(r[CEP_COL.roas]),
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
            <span class="cep-tag">${_cepEsc(cepNo)}</span>
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
    const productInsight = _cepProductInsight(pObj);
    const compareTable = _cepCompareTableHtml(pObj);
    const benchmark = _cepProductBenchmark(pObj);

    detailEl.innerHTML = `
        <div class="cep-detail-header">
            <span class="cep-brand-tag">${_cepEsc(pObj.brand)}</span>
            <span class="cep-detail-title">${_cepEsc(pObj.product)}</span>
            <span class="cep-product-stat">CEP ${allCeps.length}개 · 완료 ${done} · 대기 ${allCeps.length - done}${avgRoas != null ? ` · 평균 ROAS ${avgRoas.toFixed(0)}%` : ''}</span>
        </div>
        ${productInsight ? `
        <div class="cep-product-insight">
            <div class="cep-section-label">제품 전체 CEP 비교 인사이트</div>
            <p>${_cepEsc(productInsight)}</p>
            ${compareTable}
        </div>` : compareTable}
        <div class="cep-blocks">
            ${ceps.length ? ceps.map((c, i) => _cepRenderCepBlock(c, pObj.product, i === 0, benchmark)).join('') : _cepEmptyHtml('fa-flask', '조건에 맞는 CEP가 없습니다.', { py: 'py-10' })}
        </div>`;
}

function _cepApplyFilters() {
    if (!_cepProducts) return;
    const brandSel = document.getElementById('cep-brand-filter')?.value || '';
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
