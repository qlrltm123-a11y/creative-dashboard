// ============================================================
//  통합 데이터 AI 챗봇 (Unified Data AI Assistant)
//  GMV + 소재(Creative) + 퍼널(Funnel) 통합 데이터를 컨텍스트로
//  Gemini에 질의 → 추이 분석/진단/질의응답
//  기존 Google AI 키(localStorage 'google_ai_api_key') 재사용
// ============================================================

const _AC_KEY   = 'google_ai_api_key';
const _AC_MODEL = 'gemini-2.5-flash';
let _acHistory = [];   // {role:'user'|'model', text}
let _acOpen = false;

/* ── 소재 1건 요약 (토큰 절약용 key subset) ── */
function _acCreativeSummary(c, full = false) {
    const base = {
        소재명: c.ad_name || c.creative_name || '',
        브랜드: c.brand || '',
        제품: c.product || '',
        광고비: Math.round(c.spend || 0),
        매출: Math.round(c.revenue || 0),
        ROAS: c.roas != null ? +(c.roas * 100).toFixed(0) + '%' : null,
        CTR: c.ctr  != null ? +(c.ctr  * 100).toFixed(2) + '%' : null,
        CVR: c.cvr  != null ? +(c.cvr  * 100).toFixed(2) + '%' : null,
        CPA: c.cpa  != null ? Math.round(c.cpa) : null,
        소구포인트: Array.isArray(c.appeal_points) ? c.appeal_points.slice(0, 3)
                  : typeof c.appeal_points === 'string' ? c.appeal_points.split(/[,，、]/).map(v=>v.trim()).filter(Boolean).slice(0,3)
                  : [],
    };
    if (!full) return base;
    return {
        ...base,
        후킹유형: c.hook_type || '',
        타겟감정: c.target_emotion || '',
        키메시지: c.key_message_kr || c.key_message_jp || '',
        시작일: (c.start_date || '').slice(0, 10),
        매체: c.platform || '',
        캠페인: c.campaign || '',
        이벤트: c.event || '',
    };
}

/* ── 쿼리와 관련 있는 소재를 찾아 반환 ── */
function _acSearchCreatives(query) {
    const raw = window.allCreatives || [];
    if (!raw.length) return [];
    const agg = typeof aggregateByAdName === 'function' ? aggregateByAdName(raw) : raw;
    const q = query.toLowerCase();
    // 토큰화: 2자 이상 단어만
    const terms = q.split(/[\s,、，\.\/\-_]+/).filter(t => t.length >= 2);
    if (!terms.length) return [];

    const scored = agg.map(c => {
        const toStr = v => Array.isArray(v) ? v.join(' ') : (v || '');
        const fields = [c.ad_name, c.creative_name, c.product, c.brand,
            ...(Array.isArray(c.appeal_points) ? c.appeal_points
                : typeof c.appeal_points === 'string' ? c.appeal_points.split(/[,，、]/) : []),
            toStr(c.hook_type), c.key_message_kr, c.key_message_jp].map(v => toStr(v).toLowerCase());
        let score = 0;
        terms.forEach(t => { if (fields.some(f => f.includes(t))) score++; });
        return { c, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || (b.c.spend||0) - (a.c.spend||0));

    return scored.slice(0, 20).map(x => _acCreativeSummary(x.c, true));
}

/* ── 통합 데이터 컨텍스트 빌더 ── */
function _acBuildContext() {
    const ctx = { 생성시각: new Date().toISOString(), 데이터: {} };

    // ── 1) 소재(Creative): 전체 소재 목록(소재명 포함) + 브랜드×날짜 추이 + 제품TOP ──
    const creatives = window.allCreatives || [];
    if (creatives.length) {
        // 1-a) 개별 소재 전체 목록 (aggregateByAdName 적용, ROAS 순)
        const agg = typeof aggregateByAdName === 'function' ? aggregateByAdName(creatives) : creatives;
        ctx.데이터.소재_전체목록 = agg
            .slice()
            .sort((a, b) => (b.spend || 0) - (a.spend || 0))
            .slice(0, 50)
            .map(c => ({
                소재명: c.ad_name || c.creative_name || '',
                브랜드: c.brand || '',
                제품: c.product || '',
                ROAS: c.roas != null ? +(c.roas*100).toFixed(0)+'%' : null,
                CTR: c.ctr != null ? +(c.ctr*100).toFixed(2)+'%' : null,
                광고비: Math.round(c.spend||0),
                소구: Array.isArray(c.appeal_points) ? c.appeal_points.slice(0,2).join(',')
                      : typeof c.appeal_points==='string' ? c.appeal_points.split(/[,，、]/).map(v=>v.trim()).slice(0,2).join(',') : '',
            }));

        // 1-b) 브랜드×날짜 일별 집계
        const byBrandDate = {};
        const byBrandProd = {};
        creatives.forEach(c => {
            const brand = c.brand || '기타';
            const date  = (c.start_date || '').slice(0,10);
            const prod  = c.product || '기타';
            const acc = (o,k) => { if(!o[k]) o[k]={spend:0,revenue:0,impr:0,clicks:0,conv:0}; return o[k]; };
            if (date) {
                if (!byBrandDate[brand]) byBrandDate[brand] = {};
                const d = acc(byBrandDate[brand], date);
                d.spend+=c.spend||0; d.revenue+=c.revenue||0; d.impr+=c.impressions||0; d.clicks+=c.clicks||0; d.conv+=c.conversions||0;
            }
            if (!byBrandProd[brand]) byBrandProd[brand] = {};
            const p = acc(byBrandProd[brand], prod);
            p.spend+=c.spend||0; p.revenue+=c.revenue||0; p.impr+=c.impressions||0; p.clicks+=c.clicks||0; p.conv+=c.conversions||0;
        });
        const fin = o => ({
            광고비: Math.round(o.spend), 매출: Math.round(o.revenue),
            ROAS: o.spend>0 ? +(o.revenue/o.spend*100).toFixed(0)+'%' : '0%',
            CTR: o.impr>0 ? +(o.clicks/o.impr*100).toFixed(2)+'%' : '0%',
            전환: Math.round(o.conv),
        });
        const dailySeries = {};
        Object.entries(byBrandDate).forEach(([b, dates]) => {
            const sorted = Object.keys(dates).sort();
            // 최근 14일만
            dailySeries[b] = sorted.slice(-14).map(dt => ({ 날짜: dt, ...fin(dates[dt]) }));
        });
        const prodTop = {};
        Object.entries(byBrandProd).forEach(([b, prods]) => {
            prodTop[b] = Object.entries(prods)
                .map(([name, o]) => ({ 제품: name, ...fin(o) }))
                .sort((a,b2) => parseFloat(b2.ROAS) - parseFloat(a.ROAS)).slice(0, 5);
        });
        ctx.데이터.소재_일별추이 = dailySeries;
        ctx.데이터.소재_제품별 = prodTop;
    }

    // ── 2) GMV: 목표 vs 실적 (브랜드×날짜) ──
    const targets = window.GMV_TARGETS || {};
    let actualsByDate = {};
    try { actualsByDate = (JSON.parse(localStorage.getItem('smDash2')||'{}').actualsByDate) || {}; } catch(e) {}
    if (Object.keys(targets).length) {
        const gmv = {};
        let _fx = 9.5;
        try { const v = parseFloat(localStorage.getItem('jpy_to_krw_rate')); if (!isNaN(v) && v > 0) _fx = v; } catch(e) {}
        Object.keys(targets).forEach(brand => {
            gmv[brand] = Object.keys(targets[brand]).sort().map(dt => {
                const tgt = (targets[brand][dt] || 0) * _fx;          // 원화 환산
                const act = ((actualsByDate[dt]?.[brand]) || 0) * _fx;
                return { 날짜: dt, 목표_원화: Math.round(tgt), 실적_원화: Math.round(act), 달성률: tgt>0 ? +(act/tgt*100).toFixed(0) : null };
            });
        });
        ctx.데이터.GMV_목표대비실적 = gmv;
    }

    // ── 3) 퍼널: iframe best-effort (262Q vs 261Q) ──
    try {
        const fr = document.getElementById('funnel-frame');
        const w = fr && fr.contentWindow;
        if (w && w.brandData) {
            const funnel = {};
            ['BOH','WM','CG'].forEach(brand => {
                const bd = w.brandData[brand];
                if (!bd) return;
                const summ = (q) => {
                    const data = bd[q]; if (!data) return null;
                    const prods = {};
                    Object.entries(data).forEach(([prod, rows]) => {
                        if (!rows || !rows.length) return;
                        const inflow = rows.reduce((s,r)=>s+(r.inflow||0),0);
                        const cart   = rows.reduce((s,r)=>s+(r.cart||0),0);
                        const buy    = rows.reduce((s,r)=>s+(r.buy||0),0);
                        prods[prod] = {
                            유입: inflow, 장바구니율: inflow>0?+(cart/inflow*100).toFixed(2):null,
                            구매율: cart>0?+(buy/cart*100).toFixed(2):null,
                        };
                    });
                    return prods;
                };
                funnel[brand] = { '262Q': summ('262Q'), '261Q': summ('261Q') };
            });
            if (Object.keys(funnel).length) ctx.데이터.퍼널_전환율 = funnel;
        }
    } catch(e) {}

    // ── 시장조사 데이터 주입 (핵심 요약만 — 토큰 절약) ──
    if (window.MARKET_RESEARCH) {
        const mr = window.MARKET_RESEARCH;
        const compactCEPs = (arr) => (arr || []).map(c => c.type + ': ' + c.트리거).join(' / ');
        const compactUGC = (arr) => (arr || []).map(u => u.테마 + '→' + (u.핵심메시지 || u.소비자심리 || '').slice(0, 30)).join(' / ');
        ctx.시장조사 = {
            탄탄크림: {
                전략: mr.탄탄크림?.전략핵심,
                화이트스페이스: mr.탄탄크림?.화이트스페이스,
                검색상위키워드: Object.entries(mr.탄탄크림?.검색키워드 || {}).map(([k, v]) => k + (v.월검색량 ? `(${v.월검색량})` : '') + ': ' + v.인사이트).slice(0, 3).join(' / '),
                카피후보: (mr.탄탄크림?.광고카피후보 || []).map(c => `[${c.유형}] ${c.kr}`).join(' / '),
                워딩금지: (mr.탄탄크림?.워딩금지 || []).join(', '),
                CEP: compactCEPs(mr.탄탄크림?.CEP요약),
                UGC방향: compactUGC(mr.탄탄크림?.UGC방향성),
            },
            겔미스트: {
                검색인사이트: mr.겔미스트?.검색인사이트,
                CEP: compactCEPs(mr.겔미스트?.CEP요약),
                UGC방향: compactUGC(mr.겔미스트?.UGC방향성),
                카피예시: (mr.겔미스트?.UGC카피예시 || []).slice(0, 3).join(' / '),
            },
            NAD크림: {
                검색인사이트: mr.NAD크림?.검색인사이트,
                CEP: compactCEPs(mr.NAD크림?.CEP요약),
                UGC방향: compactUGC(mr.NAD크림?.UGC방향성),
                카피예시: (mr.NAD크림?.UGC카피예시 || []).slice(0, 3).join(' / '),
            },
            컬러그램_립틴트: {
                전략: mr.컬러그램?.전략핵심,
                반등포인트: mr.컬러그램?.반등포인트,
                검색키워드: Object.entries(mr.컬러그램?.검색키워드 || {}).map(([k, v]) => k + (v.월검색량 ? `(${v.월검색량})` : '') + ': ' + v.인사이트).join(' / '),
                CEP: compactCEPs(mr.컬러그램?.CEP),
                UGC방향: compactUGC(mr.컬러그램?.UGC방향),
            },
            웨이크메이크_베이스: {
                전략: mr.웨이크메이크?.전략핵심,
                반등포인트: mr.웨이크메이크?.반등포인트,
                검색키워드: Object.entries(mr.웨이크메이크?.검색키워드 || {}).map(([k, v]) => k + (v.월검색량 ? `(${v.월검색량})` : '') + ': ' + v.인사이트).join(' / '),
                CEP: compactCEPs(mr.웨이크메이크?.CEP),
                UGC방향: compactUGC(mr.웨이크메이크?.UGC방향),
            },
            공통: {
                소비자특성: (mr.공통전략?.일본소비자특성 || []).join(' / '),
                고효율앵글: (mr.공통전략?.고효율소재앵글 || []).join(' / '),
                약기법주의: (mr.공통전략?.약기법주의 || []).join(' / '),
            },
        };
    }

    return ctx;
}

/* ── Gemini 호출 (서버 프록시 /api/ai-chat) ── */
async function _acAsk(question) {
    const ctx = _acBuildContext();
    const hasData = ctx.데이터 && Object.keys(ctx.데이터).length;
    if (!hasData) {
        return { error: '통합 데이터가 아직 없습니다. 시트를 불러오고, 퍼널/GMV 탭을 한번 방문해주세요.' };
    }

    // ── 쿼리 키워드로 관련 소재 추가 주입 (소재명 검색 핵심 기능) ──
    const matched = _acSearchCreatives(question);
    if (matched.length) {
        ctx.데이터.소재_검색결과 = {
            _설명: `질문 키워드와 일치하는 소재 ${matched.length}개 (소재명·제품명·소구포인트 매칭, 전체 상세 정보 포함)`,
            목록: matched,
        };
    }

    const totalCreatives = (window.allCreatives || []).length;
    const listedCount = (ctx.데이터.소재_전체목록 || []).length;

    const sys = `당신은 일본 이커머스(라쿠텐 메가와리 등)에서 한국 뷰티 브랜드(BOH/WM/CG)의 퍼포먼스 마케팅을 책임지는 시니어 광고 전략가입니다.
아래 JSON은 대시보드의 통합 실데이터입니다.

[데이터 구조 안내]
- 소재_전체목록: 전체 ${totalCreatives}개 소재 중 광고비 상위 ${listedCount}개 (소재명·ROAS·CTR·소구포인트 포함)
- 소재_검색결과: 질문과 관련된 소재를 소재명/제품명/소구포인트 기준으로 매칭한 결과 (상세 정보 포함). **소재 관련 질문은 반드시 여기서 먼저 찾으세요.**
- 소재_일별추이: 브랜드×날짜 집계 추이
- 소재_제품별: 브랜드×제품 집계
- GMV_목표대비실적: 일별 목표 vs 실적
- 퍼널_전환율: 유입→장바구니→구매 전환율
- 시장조사: 리스닝마인드 기반 제품별 CEP(소비자 진입 시점)/UGC 방향성/검색키워드/광고카피후보/공통전략 인사이트

[언어 — 매우 중요]
- 반드시 **모든 문장을 한국어로** 작성하세요. 영어 문장 절대 금지.
- 영어는 고유명사(소재명·지표명 ROAS/CTR)에만 허용. 그 외 설명·분석·제안은 100% 한국어.

[분석 원칙]
- 소재명이 언급된 질문 → 소재_검색결과에서 해당 소재를 찾아 실제 수치(ROAS/CTR/광고비 등)를 인용해 답변.
- 소재_검색결과에 없으면 소재_전체목록을 추가 탐색 후, 그래도 없으면 "해당 소재는 데이터에 없습니다"라고 명시.
- 제공된 데이터의 **실제 숫자를 반드시 인용** (예: "ROAS 1,926% · CTR 3.51%"). 두루뭉술한 표현 금지.
- 데이터에 없는 내용은 지어내지 말고 "데이터에 없음"이라고 명시.

[광고 소재·UGC 기획 요청 시 — 시장조사 데이터 활용 필수]
- 시장조사.탄탄크림/겔미스트/NAD크림의 CEP요약·UGC방향성·광고카피후보·검색키워드를 반드시 활용
- 시장조사.공통전략.고효율소재앵글 → 실제 구현 가능한 영상/이미지 연출 방향으로 변환
- 시장조사.공통전략.약기법주의 → 제안 카피에 위반 소지 있으면 반드시 경고
- 소재 성과 데이터(소재_전체목록/소재_검색결과)와 교차 분석: "이 CEP로 만든 소재 중 ROAS 상위는?" 형태로 연결
- 일본 소비자 특성(翌朝 체감, 구체적 상황 공감, 텍스처 클로즈업 선호)을 반영한 소재 방향 제시
- 추이 분석은 날짜순 변화(상승/하락/%)와 원인 가설을 데이터 근거와 함께.

[소재 기획안 요청 시 — 아래 구조로 답변]
### 1. 워킹 패턴 분석
- 고효율 소재의 공통 소구포인트·후킹·메시지 요소를 실제 수치와 함께 2~3개 짚기
### 2. 신규 소재 기획안 (3개)
각 안마다:
- **컨셉**: 한 줄 요약
- **핵심 소구포인트**: (데이터상 고효율 근거 명시)
- **후킹 (첫 3초/헤드라인)**: 구체적 카피 문장 예시
- **비주얼 디렉션**: 화면 구성·톤
- **추천 매체/타겟**: 데이터 근거
### 3. 기대 효과 & 검증 포인트
- 어떤 지표로 성공을 판단할지

문장은 간결하게, 핵심만. 표 대신 위 제목/불릿 구조 사용.

[약기법(薬機法) 컴플라이언스 — 카피·소재 제안 시 필수]
- 일본 화장품 광고는 약기법 규제 대상. 다음은 **금지/위험**이니 제안 카피에 절대 쓰지 말 것:
  · 의약품적 효능(치료/완치/재생/세포/안티에이징/주름제거/미백효과/디톡스, 治る·効く·シミが消える 등)
  · 절대·과장·즉효 표현(완벽/100%/영구/즉효/단번에, 完璧·必ず·即効·劇的·No.1 등 — 근거 없으면 금지)
- 카피는 화장품 허용 효능 범위로: 「수분 공급」「피부결 정돈」「촉촉함 유지」 수준.
- 데이터상 고ROAS라도 위 표현이 보이면 "⚠️ 약기법 주의: ○○ 표현은 규제 소지" 라고 반드시 함께 안내.

[통합 데이터]
${(() => { const s = JSON.stringify(ctx); return s.length > 40000 ? s.slice(0, 40000) + '...(이하 생략)' : s; })()}`;

    // 대화 히스토리 + 현재 질문
    const contents = [];
    contents.push({ role: 'user', parts: [{ text: sys }] });
    contents.push({ role: 'model', parts: [{ text: '네, 통합 데이터와 시장조사 데이터를 모두 확인했습니다. 소재 성과(ROAS/CTR/광고비) + 리스닝마인드 기반 CEP·UGC 방향성을 교차 분석해 광고 소재 및 UGC 앵글 기획까지 답변드립니다.' }] });
    _acHistory.forEach(h => contents.push({ role: h.role, parts: [{ text: h.text }] }));
    contents.push({ role: 'user', parts: [{ text: question + '\n\n(반드시 한국어로, 실제 데이터 수치를 인용해서 답변. 소재_검색결과가 있으면 거기서 먼저 찾기)' }] });

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 40000);
        let res;
        try {
            res = await fetch('/api/ai-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents,
                    generationConfig: { temperature: 0.35, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
                }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
        const data = await res.json();
        if (!res.ok) return { error: data.error || `서버 오류 (${res.status})` };
        if (!data.text) return { error: '응답이 비어 있습니다. 다시 시도해주세요.' };
        return { text: data.text };
    } catch (e) {
        if (e.name === 'AbortError') return { error: '응답 시간이 초과되었습니다 (40초). 질문을 더 짧게 해주세요.' };
        return { error: `네트워크 오류: ${e.message}` };
    }
}

/* ── UI ── */
function _acRenderMessages() {
    const box = document.getElementById('ac-messages');
    if (!box) return;
    box.innerHTML = _acHistory.map(h => `
        <div class="ac-msg ac-${h.role}">
            <div class="ac-bubble">${h.role==='model' ? _acFormat(h.text) : _acEsc(h.text)}</div>
        </div>`).join('');
    box.scrollTop = box.scrollHeight;
}
function _acEsc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _acFormat(s) {
    // 간단 마크다운: 제목(#/##/###), **bold**, 리스트(-, *, 1.), 줄바꿈
    let t = _acEsc(s);
    t = t
        .replace(/^#{1,6}\s*(.+)$/gm, '<div class="ac-h">$1</div>')   // 제목 → 강조 라인
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')                        // 볼드
        .replace(/^\s*[-*]\s+(.+)$/gm, '<div class="ac-li">$1</div>')  // 불릿
        .replace(/^\s*(\d+)\.\s+(.+)$/gm, '<div class="ac-li"><span class="ac-num">$1.</span> $2</div>'); // 번호
    return t.replace(/\n/g, '<br>');
}

window.toggleAiChat = function() {
    _acOpen = !_acOpen;
    const panel = document.getElementById('ac-panel');
    const fab = document.getElementById('ac-fab');
    if (panel) panel.classList.toggle('ac-show', _acOpen);
    if (fab) fab.classList.toggle('ac-fab-active', _acOpen);
    if (_acOpen) {
        if (!_acHistory.length) _acRenderMessages();
        setTimeout(() => document.getElementById('ac-input')?.focus(), 100);
    }
};

window.acSend = async function() {
    const input = document.getElementById('ac-input');
    const q = (input?.value || '').trim();
    if (!q) return;
    input.value = '';
    input.style.height = 'auto';
    _acHistory.push({ role: 'user', text: q });
    _acRenderMessages();

    // 로딩 표시
    const box = document.getElementById('ac-messages');
    const loadId = 'ac-load-' + Date.now();
    box.insertAdjacentHTML('beforeend', `<div class="ac-msg ac-model" id="${loadId}"><div class="ac-bubble ac-loading"><span></span><span></span><span></span></div></div>`);
    box.scrollTop = box.scrollHeight;

    const result = await _acAsk(q);
    document.getElementById(loadId)?.remove();

    if (result.error) {
        _acHistory.push({ role: 'model', text: '⚠️ ' + result.error });
    } else {
        _acHistory.push({ role: 'model', text: result.text });
    }
    _acRenderMessages();
};

window.acKeydown = function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.acSend(); }
    // 자동 높이
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
};

window.acQuick = function(q) {
    const input = document.getElementById('ac-input');
    if (input) input.value = q;
    window.acSend();
};

window.acClear = function() {
    _acHistory = [];
    _acRenderMessages();
};

window.acAnalyzeVideo = async function(videoUrl, creativeName, extraQ) {
    if (!_acOpen) window.toggleAiChat();
    _acHistory.push({ role: 'user', text: `🎬 "${creativeName}" 영상 전체 분석 요청${extraQ ? ': ' + extraQ : ''}` });
    _acRenderMessages();
    const box = document.getElementById('ac-messages');
    const loadId = 'ac-load-' + Date.now();
    box.insertAdjacentHTML('beforeend', `<div class="ac-msg ac-model" id="${loadId}"><div class="ac-bubble ac-loading"><span></span><span></span><span></span></div><div style="font-size:11px;color:#94a3b8;margin-top:4px;padding-left:8px">영상 업로드 &amp; 분석 중... (30초 내외 소요)</div></div>`);
    box.scrollTop = box.scrollHeight;
    try {
        // 캐시 우선 — 이미 일괄 분석한 영상이면 즉시
        const cache = _vidLoadCache();
        let data;
        if (cache[videoUrl]?.text && !extraQ) {
            data = { text: cache[videoUrl].text };
        } else {
            const res = await fetch('/api/analyze-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoUrl, creativeName, question: extraQ || '' }),
            });
            data = await res.json();
            if (res.ok && data.text && !extraQ) {
                cache[videoUrl] = { text: data.text, name: creativeName, analyzedAt: Date.now() };
                _vidSaveCache(cache);
            }
            if (!res.ok) data.error = data.error || `서버 오류 (${res.status})`;
        }
        document.getElementById(loadId)?.remove();
        _acHistory.push({ role: 'model', text: data.error
            ? '⚠️ 영상 분석 실패: ' + data.error
            : `🎬 **${creativeName} 영상 분석 결과**\n\n${data.text}` });
    } catch (e) {
        document.getElementById(loadId)?.remove();
        _acHistory.push({ role: 'model', text: '⚠️ 네트워크 오류: ' + e.message });
    }
    _acRenderMessages();
};

// ============================================================
//  영상 소재 일괄 자동 분석 + 흐름 종합 인사이트
//  - 영상 URL만으로 Gemini Files API가 전체 영상을 분석 (썸네일 X)
//  - 결과 localStorage 캐싱 → 재방문 시 즉시 표시
//  - 분석 결과들을 종합 → 흐름 패턴/제작 템플릿 도출
// ============================================================
const _VIDEO_CACHE_KEY = 'video_analysis_cache_v1';
const _VIDEO_SYNTH_KEY = 'video_synth_cache_v1';

function _vidLoadCache() { try { return JSON.parse(localStorage.getItem(_VIDEO_CACHE_KEY) || '{}'); } catch { return {}; } }
function _vidSaveCache(c) { try { localStorage.setItem(_VIDEO_CACHE_KEY, JSON.stringify(c)); } catch (e) {} }

// 영상 일괄 분석 상한 (비용/시간 보호) — 광고비 상위 N개만
const _VIDEO_BATCH_MAX = 40;

// 현재 AI 인사이트 대상 영상 소재 추출 (중복 URL 제거, 광고비 상위순)
function _vidCollectVideos() {
    const list = (typeof getAIInsightsList === 'function') ? getAIInsightsList()
               : (window.allCreatives || []);
    const out = []; const seen = new Set();
    (list || []).forEach(c => {
        const url = (c.media_url || '').trim();
        if (c.media_type !== 'video' || !url || seen.has(url)) return;
        seen.add(url);
        out.push({
            url, name: c.creative_name || c.ad_name || '(이름없음)',
            roas: c.roas || 0, spend: c.spend || 0,
            brand: c.brand || '', product: c.product || '',
        });
    });
    // 광고비 큰 순 (의미있는 소재 우선) → 상한 적용
    out.sort((a, b) => (b.spend || 0) - (a.spend || 0));
    return out;
}

// 누적 캐시 전체를 배열로 (종합 인사이트용) — 최신 메타로 ROAS 갱신
function _vidGetAllAnalyzed() {
    const cache = _vidLoadCache();
    // 현재 데이터에서 url→최신 메타 매핑 (ROAS/광고비는 시간이 지나며 바뀌므로 최신값 우선)
    const live = {};
    _vidCollectVideos().forEach(v => { live[v.url] = v; });
    return Object.entries(cache)
        .filter(([, e]) => e && e.text)
        .map(([url, e]) => {
            const m = live[url] || {};
            return {
                url, text: e.text,
                name: m.name || e.name || '(이름없음)',
                roas: (m.roas != null ? m.roas : e.roas) || 0,
                spend: (m.spend != null ? m.spend : e.spend) || 0,
                brand: m.brand || e.brand || '',
                product: m.product || e.product || '',
                analyzedAt: e.analyzedAt || 0,
            };
        });
}

// 영상 1건 분석 (캐시 우선)
async function _vidAnalyzeOne(v) {
    const cache = _vidLoadCache();
    if (cache[v.url]?.text) return { text: cache[v.url].text, name: v.name, cached: true };
    try {
        const res = await fetch('/api/analyze-video', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl: v.url, creativeName: v.name, question: '' }),
        });
        const raw = await res.text();
        let data = null;
        try { data = JSON.parse(raw); } catch (_) {}
        if (res.ok && data?.text) {
            // 메타(ROAS/광고비/브랜드/제품) 함께 저장 → 누적 종합 시 활용
            const entry = {
                text: data.text, name: v.name, analyzedAt: Date.now(),
                roas: v.roas || 0, spend: v.spend || 0,
                brand: v.brand || '', product: v.product || '',
            };
            const c2 = _vidLoadCache(); c2[v.url] = entry; _vidSaveCache(c2);
            return entry;
        }
        // 비JSON(HTML) 응답 = API 라우트 미작동(로컬 정적 서버 등)
        const isHtml = !data && /<!doctype|<html|cannot (get|post)/i.test(raw);
        const errMsg = data?.error
            || (isHtml ? 'API 라우트 응답 아님(HTML) — 배포 환경 필요' : '')
            || `HTTP ${res.status}`;
        return { error: errMsg, name: v.name };
    } catch (e) {
        return { error: e.message, name: v.name };
    }
}

function _vidSetProgress(html) {
    const el = document.getElementById('video-flow-progress');
    if (el) { el.classList.remove('hidden'); el.innerHTML = html; }
}
function _vidSetResult(html) {
    const el = document.getElementById('video-flow-result');
    if (el) el.innerHTML = html;
}

// 일괄 분석 (window 노출) — 버튼에서 호출
window.acBatchAnalyzeVideos = async function() {
    const btn = document.getElementById('video-batch-btn');
    const allVideos = _vidCollectVideos();
    if (!allVideos.length) {
        _vidSetResult('<span style="color:#94a3b8">현재 필터 조건에 영상 소재가 없습니다.</span>');
        return;
    }
    // 상한 적용 (광고비 상위 N개) + 미분석분만 카운트
    const cache = _vidLoadCache();
    const videos = allVideos.slice(0, _VIDEO_BATCH_MAX);
    const fresh = videos.filter(v => !cache[v.url]?.text).length;
    const capped = allVideos.length > _VIDEO_BATCH_MAX;
    const estMin = Math.ceil(fresh * 30 / 2 / 60); // 동시성 2, 영상당 30초

    const msg = fresh === 0
        ? `이미 분석된 영상 ${videos.length}개로 흐름 종합만 다시 실행합니다. 계속할까요?`
        : `영상 ${videos.length}개를 분석합니다` +
          (capped ? ` (전체 ${allVideos.length}개 중 광고비 상위 ${_VIDEO_BATCH_MAX}개)` : '') +
          `.\n신규 분석 ${fresh}개 · 예상 ${estMin}분 내외 소요 · Gemini API 비용 발생.\n\n계속할까요?`;
    if (!window.confirm(msg)) return;

    if (btn) { btn.disabled = true; btn.dataset.orig = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>분석 중...'; }

    const total = videos.length;
    let done = 0, ok = 0, fail = 0, firstError = '';
    const analyzed = [];
    const update = () => _vidSetProgress(
        `<div class="vid-prog-bar"><div class="vid-prog-fill" style="width:${Math.round(done / total * 100)}%"></div></div>
         <div class="vid-prog-txt">${done}/${total} 처리 · 성공 ${ok}${fail ? ` · 실패 ${fail}` : ''}</div>`);
    update();

    // 동시성 2 (서버 부하/rate limit 보호)
    const queue = videos.slice();
    async function worker() {
        while (queue.length) {
            const v = queue.shift();
            const r = await _vidAnalyzeOne(v);
            done++;
            if (r.error) { fail++; if (!firstError) firstError = r.error; }
            else { ok++; analyzed.push({ name: v.name, text: r.text, roas: v.roas, spend: v.spend }); }
            update();
        }
    }
    await Promise.all([worker(), worker()]);

    if (!analyzed.length) {
        _vidSetProgress('');
        const isApiHtml = /<!doctype|<html|api 라우트|cannot (get|post)|404|405/i.test(firstError);
        const isKeyErr = /GEMINI_API_KEY|환경변수/i.test(firstError);
        const isDownErr = /다운로드|HTTP 4|HTTP 5|공유|뷰어/i.test(firstError);
        let guide;
        if (isApiHtml) {
            guide = '서버 API(/api/analyze-video)가 응답하지 않습니다. <b>로컬 미리보기가 아닌 Vercel 배포 주소</b>에서 실행해야 합니다 (서버리스 함수 필요).';
        } else if (isKeyErr) {
            guide = 'Vercel 프로젝트 → Settings → Environment Variables에 <b>GEMINI_API_KEY</b>를 등록한 뒤 재배포해주세요.';
        } else if (isDownErr) {
            guide = 'Drive 영상 다운로드 실패. 파일을 "링크 있는 모든 사용자 — 뷰어"로 공유하고, 큰 영상은 <b>GOOGLE_API_KEY</b> 환경변수 설정을 권장합니다.';
        } else {
            guide = '잠시 후 다시 시도해주세요. 문제가 계속되면 Vercel 함수 로그를 확인해주세요.';
        }
        _vidSetResult(
            `<div style="color:#e11d48;line-height:1.6">
                <b>영상 분석 실패 (${fail}건)</b><br>
                <span style="font-family:monospace;font-size:12px;color:#b91c1c">원인: ${(firstError || '알 수 없는 오류').slice(0, 200)}</span><br>
                <span style="color:#64748b;font-size:12px">👉 ${guide}</span>
            </div>`);
        if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.orig || '🎬 영상 전체 자동분석'; }
        return;
    }

    // ★ 누적 종합: 이번 배치만이 아니라 그동안 분석한 전체 캐시를 기반으로
    const allAnalyzed = _vidGetAllAnalyzed();
    _vidSetProgress(`<div class="vid-prog-txt"><i class="fas fa-wand-magic-sparkles mr-1"></i>이번 ${ok}개 포함 누적 ${allAnalyzed.length}개 영상으로 흐름 종합 중...</div>`);
    const synth = await _vidSynthesize(allAnalyzed);
    _vidSetProgress(`<div class="vid-prog-txt" style="color:#059669">✅ 누적 ${allAnalyzed.length}개 영상 흐름 종합 완료 (이번 신규 ${ok}개${fail ? `, 실패 ${fail}개` : ''})</div>`);
    _vidSetResult(synth);
    if (typeof window.acRenderCachedVideoSynth === 'function') window.acRenderCachedVideoSynth();
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.orig || '🎬 영상 전체 자동분석'; }
};

// 누적 영상 분석 결과 종합 → AI 인사이트 (전체 캐시 기반)
async function _vidSynthesize(analyzed) {
    const sorted = analyzed.slice().sort((a, b) => (b.roas || 0) - (a.roas || 0));
    // 토큰 보호: 고효율 상위 18개 + 저효율 하위 4개(대조군) 샘플링
    let cap;
    if (sorted.length <= 22) cap = sorted;
    else cap = [...sorted.slice(0, 18), ...sorted.slice(-4)];
    const total = analyzed.length;
    const corpus = cap.map((a, i) => {
        const tag = [a.brand, a.product].filter(Boolean).join('/');
        return `### 영상 ${i + 1}: ${a.name}${tag ? ` [${tag}]` : ''} (ROAS ${Math.round((a.roas || 0) * 100)}%, 광고비 ${Math.round(a.spend || 0).toLocaleString()}원)\n${a.text}`;
    }).join('\n\n');
    const prompt = `당신은 일본 라쿠텐 메가와리 퍼포먼스 마케팅 전문가입니다.
지금까지 누적 분석한 광고 영상 총 ${total}개 중 대표 ${cap.length}개(고효율 상위 + 저효율 대조군)의 "전체 흐름 분석" 결과입니다.
이를 종합해 다음을 한국어로 작성해주세요:

### 1. 고효율 영상 공통 후킹 패턴
- ROAS 높은 영상들의 첫 3초 공통점

### 2. 잘 먹힌 흐름 구조
- 시작→중간→마무리 전개의 공통 성공 패턴

### 3. 공통 소구포인트·감정
- 반복 등장하는 강조점/감정 코드

### 4. 저효율 영상과의 차이
- ROAS 낮은 영상이 놓친 요소

### 5. 다음 영상 제작 흐름 템플릿 3개
- 바로 쓸 수 있는 초반/중반/후반 구성안

데이터가 누적될수록 패턴 신뢰도가 높아집니다. 반드시 실제 영상 분석 내용을 인용하고 소재명을 언급하세요.

[영상별 분석]
${corpus}`;
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    try {
        const res = await fetch('/api/ai-chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents, generationConfig: { temperature: 0.4, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } } }),
        });
        const data = await res.json();
        if (res.ok && data.text) {
            try { localStorage.setItem(_VIDEO_SYNTH_KEY, JSON.stringify({ text: data.text, at: Date.now(), n: total })); } catch (e) {}
            return _acFormat(data.text);
        }
        return `<span style="color:#e11d48">종합 분석 실패: ${data.error || res.status}</span>`;
    } catch (e) {
        return `<span style="color:#e11d48">종합 분석 오류: ${e.message}</span>`;
    }
}

// AI 인사이트 진입 시 — 캐시된 종합 결과/진행 현황 표시
window.acRenderCachedVideoSynth = function() {
    const result = document.getElementById('video-flow-result');
    const hint = document.getElementById('video-flow-hint');
    if (!result) return;
    const allVideos = _vidCollectVideos();
    const targets = allVideos.slice(0, _VIDEO_BATCH_MAX);
    const cache = _vidLoadCache();
    const totalAccum = Object.values(cache).filter(e => e && e.text).length; // 누적 전체
    const analyzedCount = targets.filter(v => cache[v.url]?.text).length;
    if (hint) {
        const parts = [];
        if (!allVideos.length) parts.push('현재 필터에 영상 없음');
        else if (allVideos.length > _VIDEO_BATCH_MAX)
            parts.push(`영상 ${allVideos.length}개 (상위 ${_VIDEO_BATCH_MAX}개 대상, ${analyzedCount}개 분석됨)`);
        else parts.push(`영상 ${allVideos.length}개 중 ${analyzedCount}개 분석됨`);
        if (totalAccum) parts.push(`💾 누적 ${totalAccum}개 저장`);
        hint.textContent = parts.join(' · ');
    }
    let synth = null;
    try { synth = JSON.parse(localStorage.getItem(_VIDEO_SYNTH_KEY) || 'null'); } catch (e) {}
    if (synth?.text) {
        const when = synth.at ? new Date(synth.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const meta = `<div style="font-size:11px;color:#94a3b8;margin-bottom:8px">📊 누적 ${synth.n || '?'}개 영상 기반 · ${when} 종합</div>`;
        result.innerHTML = meta + _acFormat(synth.text);
    } else {
        result.innerHTML = '<span style="color:#94a3b8">영상 소재의 전체 흐름(시작→중간→마무리)을 AI가 자동 분석해 공통 패턴과 제작 템플릿을 뽑아드립니다. 우측 버튼을 눌러 시작하세요. 분석 결과는 자동 저장되어 계속 누적됩니다.</span>';
    }
};

// 분석 데이터 내보내기 (백업 — 기기 이동/캐시 삭제 대비)
window.acExportVideoData = function() {
    const cache = _vidLoadCache();
    const n = Object.keys(cache).length;
    if (!n) { alert('내보낼 분석 데이터가 없습니다.'); return; }
    const blob = new Blob([JSON.stringify(cache, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `video-analysis-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// 분석 데이터 가져오기 (누적 병합)
window.acImportVideoData = function(input) {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (!imported || typeof imported !== 'object') throw new Error('형식 오류');
            const cache = _vidLoadCache();
            let added = 0, updated = 0;
            Object.entries(imported).forEach(([url, entry]) => {
                if (!entry || !entry.text) return;
                if (cache[url]) updated++; else added++;
                cache[url] = entry;
            });
            _vidSaveCache(cache);
            alert(`가져오기 완료 — 신규 ${added}개, 갱신 ${updated}개. 총 누적 ${Object.keys(cache).length}개.`);
            window.acRenderCachedVideoSynth();
        } catch (err) {
            alert('가져오기 실패: ' + err.message);
        }
        input.value = '';
    };
    reader.readAsText(file);
};
