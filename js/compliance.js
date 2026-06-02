// ============================================================
//  약기법(薬機法) 컴플라이언스 감수 — 미용 감시관
//  화장품 광고 표현 규제: 의약품적 효능 클레임(차단) + 과장/절대표현(경고)
//  소구포인트·캐치카피·키워드·AI 브리프에 적용
// ============================================================

// 차단(block): 의약품적 효능·치료·세포/유전자 등 → 약기법 위반 소지 높음
const _CMPL_BLOCK = [
    // 한국어
    '치료','완치','치유','재생','세포','줄기세포','유전자','염증','흉터','상처',
    '안티에이징','노화방지','주름제거','주름이 사라','주름개선','미백효과','기미제거','기미가 사라',
    '여드름치료','발모','탈모치료','독소배출','디톡스',
    // 일본어
    '治療','治る','治す','完治','効く','医学','薬用級','細胞','遺伝子','再生',
    'アンチエイジング','シミが消える','シミが取れる','シワがなくなる','シワが消える',
    '美白効果','ニキビが治る','毛穴が消える','若返り','デトックス',
];

// 경고(warn): 과장·절대·즉효 표현 → 근거 없으면 경표법/誇大広告 리스크
const _CMPL_WARN = [
    // 한국어
    '완벽','완전','영구','즉효','즉시','단번에','무조건','100%','최고','1위','세계최초','업계최초','급속','드라마틱','폭발적',
    // 일본어
    '完璧','完全','永久','即効','即効性','たった1回','たった一回','今すぐ','必ず','劇的','速攻','世界一','最高','No.1','業界初','世界初','100%',
];

// 안전(허용 범위 안내용) — 화장품 56 효능 범위 예시 (참고)
const _CMPL_SAFE_HINT = '허용 표현 예: 「피부에 수분 공급」「피부결 정돈」「촉촉함 유지」 (효능은 화장품 허용 56범위 내로)';

/**
 * 텍스트 컴플라이언스 검사
 * @returns {{level:'ok'|'warn'|'block', hits:[{term,level}]}}
 */
function checkCompliance(text) {
    if (!text) return { level: 'ok', hits: [] };
    const s = String(text);
    const hits = [];
    _CMPL_BLOCK.forEach(t => { if (s.includes(t)) hits.push({ term: t, level: 'block' }); });
    _CMPL_WARN.forEach(t  => { if (s.includes(t)) hits.push({ term: t, level: 'warn'  }); });
    const level = hits.some(h => h.level === 'block') ? 'block'
                : hits.some(h => h.level === 'warn') ? 'warn' : 'ok';
    return { level, hits };
}

/** 여러 텍스트 일괄 검사 → 위반 요약 */
function summarizeCompliance(texts) {
    const all = [];
    (texts || []).forEach(t => { checkCompliance(t).hits.forEach(h => all.push(h)); });
    const blockTerms = [...new Set(all.filter(h => h.level==='block').map(h => h.term))];
    const warnTerms  = [...new Set(all.filter(h => h.level==='warn').map(h => h.term))];
    return { blockTerms, warnTerms, count: blockTerms.length + warnTerms.length };
}

/** 인라인 배지 HTML (한 텍스트에 대한) */
function complianceBadge(text) {
    const r = checkCompliance(text);
    if (r.level === 'ok') return '';
    const terms = [...new Set(r.hits.map(h => h.term))].join(', ');
    if (r.level === 'block')
        return `<span class="cmpl-badge cmpl-block" title="약기법 위반 소지(의약품적 효능): ${terms} · 사용 금지 권고">⚠ 약기법</span>`;
    return `<span class="cmpl-badge cmpl-warn" title="과장·절대 표현(근거 필요): ${terms}">⚠ 과장표현</span>`;
}

window.checkCompliance = checkCompliance;
window.summarizeCompliance = summarizeCompliance;
window.complianceBadge = complianceBadge;
window.COMPLIANCE_SAFE_HINT = _CMPL_SAFE_HINT;
