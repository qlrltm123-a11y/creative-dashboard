// ============================================================
//  통합 데이터 AI 챗봇 (Unified Data AI Assistant)
//  GMV + 소재(Creative) + 퍼널(Funnel) 통합 데이터를 컨텍스트로
//  Gemini에 질의 → 추이 분석/진단/질의응답
//  기존 Google AI 키(localStorage 'google_ai_api_key') 재사용
// ============================================================

const _AC_KEY   = 'google_ai_api_key';
const _AC_MODEL = 'gemini-2.0-flash-exp';
let _acHistory = [];   // {role:'user'|'model', text}
let _acOpen = false;

/* ── 통합 데이터 컨텍스트 빌더 ── */
function _acBuildContext() {
    const ctx = { 생성시각: new Date().toISOString(), 데이터: {} };

    // ── 1) 소재(Creative): 브랜드×날짜 일별 집계 + 제품 TOP ──
    const creatives = window.allCreatives || [];
    if (creatives.length) {
        const byBrandDate = {}; // brand -> date -> agg
        const byBrandProd = {}; // brand -> product -> agg
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
            ROAS: o.spend>0 ? +(o.revenue/o.spend).toFixed(2) : 0,
            CTR: o.impr>0 ? +(o.clicks/o.impr*100).toFixed(2) : 0,
            전환: Math.round(o.conv),
        });
        const dailySeries = {};
        Object.entries(byBrandDate).forEach(([b, dates]) => {
            dailySeries[b] = Object.keys(dates).sort().map(dt => ({ 날짜: dt, ...fin(dates[dt]) }));
        });
        const prodTop = {};
        Object.entries(byBrandProd).forEach(([b, prods]) => {
            prodTop[b] = Object.entries(prods)
                .map(([name, o]) => ({ 제품: name, ...fin(o) }))
                .sort((a,b2) => b2.ROAS - a.ROAS).slice(0, 8);
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
        Object.keys(targets).forEach(brand => {
            gmv[brand] = Object.keys(targets[brand]).sort().map(dt => {
                const tgt = targets[brand][dt] || 0;
                const act = (actualsByDate[dt]?.[brand]) || 0;
                return { 날짜: dt, 목표: tgt, 실적: act, 달성률: tgt>0 ? +(act/tgt*100).toFixed(0) : null };
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

    return ctx;
}

/* ── Gemini 호출 (서버 프록시 /api/ai-chat — 키는 서버 env에서 관리) ── */
async function _acAsk(question) {
    const ctx = _acBuildContext();
    const hasData = ctx.데이터 && Object.keys(ctx.데이터).length;
    if (!hasData) {
        return { error: '통합 데이터가 아직 없습니다. 시트를 불러오고, 퍼널/GMV 탭을 한번 방문해주세요.' };
    }

    const sys = `당신은 일본 이커머스(라쿠텐 메가와리 등)에서 한국 뷰티 브랜드(BOH/WM/CG)의 퍼포먼스 마케팅을 분석하는 데이터 애널리스트입니다.
아래 JSON은 대시보드의 통합 실데이터입니다: 소재 성과(ROAS/CTR/전환), GMV 목표대비 실적, 퍼널 전환율(유입→장바구니→구매).
규칙:
- 반드시 제공된 데이터 안의 숫자만 근거로 답하세요. 데이터에 없으면 "데이터에 없음"이라고 명시.
- 한국어로 간결하게. 핵심 수치를 인용하고, 추세는 방향(상승/하락/%변화)으로 설명.
- 추이 분석 요청 시 날짜순 변화를 짚고, 원인 가설은 데이터 근거와 함께 제시.
- 액션 제안은 데이터로 뒷받침될 때만.

[통합 데이터]
${JSON.stringify(ctx, null, 1)}`;

    // 대화 히스토리 + 현재 질문
    const contents = [];
    contents.push({ role: 'user', parts: [{ text: sys }] });
    contents.push({ role: 'model', parts: [{ text: '네, 통합 데이터를 확인했습니다. 질문해 주세요.' }] });
    _acHistory.forEach(h => contents.push({ role: h.role, parts: [{ text: h.text }] }));
    contents.push({ role: 'user', parts: [{ text: question }] });

    try {
        const res = await fetch('/api/ai-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents,
                generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
            }),
        });
        const data = await res.json();
        if (!res.ok) return { error: data.error || `서버 오류 (${res.status})` };
        if (!data.text) return { error: '응답이 비어 있습니다. 다시 시도해주세요.' };
        return { text: data.text };
    } catch (e) {
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
    // 간단 마크다운: **bold**, 줄바꿈, - 리스트
    return _acEsc(s)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/^- (.+)$/gm, '• $1')
        .replace(/\n/g, '<br>');
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
