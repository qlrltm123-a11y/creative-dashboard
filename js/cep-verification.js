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

// 핵심 카피/앵글 추출 ("카피문구 / 인플루언서 / 활용방식 ..." -> "카피문구 · 인플루언서")
// 소재 간 차이가 보통 두 번째 구절(인물·소구 변형)에 있으므로, 코어 문구를 줄여서라도 항상 포함시킨다.
function _cepShortDetail(detail) {
    if (!detail) return '';
    const parts = detail.split('/').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return '';
    const core = parts[0];
    const tag = parts[1] || '';
    const coreMax = tag ? 20 : 30;
    const shortCore = core.length > coreMax ? core.slice(0, coreMax) + '…' : core;
    return tag ? `${shortCore} · ${tag}` : shortCore;
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
        const product = (r[CEP_COL.product] || '').trim();
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

function _cepVerdictTag(agg, hasResult) {
    if (!hasResult || !agg || agg.cost === 0) return 'pending';
    if (agg.cv === 0) return 'fail';
    if (agg.roas >= 200) return 'win';
    if (agg.roas >= 100) return 'mid';
    return 'weak';
}

// 원인 분석: CTR/CVR 진단 + 소재간 편차(앵글 비교)
function _cepAnalyze(cepObj, agg, tag) {
    const causes = [];
    let best = null, worst = null;
    if (tag === 'pending') {
        causes.push('검증 소재가 아직 집행되지 않아 결과를 분석할 수 없습니다.');
        return { causes, best, worst };
    }

    if (agg.ctr < 1.5) causes.push(`CTR ${agg.ctr.toFixed(2)}%로 평균 대비 낮아 소재의 1차 주목도(썸네일·카피)가 약했을 가능성이 있습니다.`);
    else if (agg.ctr >= 3) causes.push(`CTR ${agg.ctr.toFixed(2)}%로 양호해 소구포인트에 대한 1차 반응(클릭 유도)은 잘 작동했습니다.`);

    if (agg.click > 0 && agg.cv === 0) causes.push(`클릭 ${Math.round(agg.click).toLocaleString()}건 대비 전환이 0건으로, 클릭 이후 구매 결정 단계(가격·상세페이지·오퍼)에서 이탈했을 가능성이 큽니다.`);
    else if (agg.cv > 0 && agg.cvr < 1) causes.push(`CVR ${agg.cvr.toFixed(2)}%로 낮아 클릭 이후 전환 단계에서 이탈이 큽니다.`);

    // 소재별 비교는 시트가 직접 계산한 ROAS(roasSheet)를 기준으로 한다 — COST/CV/Revenue가
    // 플랫폼 리포트 특성상 단순 나눗셈과 다를 수 있어, 재계산값이 아닌 원본 값을 신뢰한다.
    const spent = cepObj.creatives.filter(c => c.cost > 0);
    if (spent.length > 1) {
        const sorted = [...spent].sort((a, b) => b.roasSheet - a.roasSheet);
        best = sorted[0]; worst = sorted[sorted.length - 1];
        if (best.roasSheet - worst.roasSheet > 50) {
            causes.push(`같은 CEP 안에서도 소재별 성과 편차가 큽니다 — "${_cepShortDetail(best.detail)}" 소재는 ROAS ${best.roasSheet.toFixed(0)}%로 가장 높았고, "${_cepShortDetail(worst.detail)}" 소재는 ROAS ${worst.roasSheet.toFixed(0)}%로 낮았습니다. 가설 자체보다 표현 방식(앵글) 차이가 성과를 가른 것으로 보입니다.`);
        }
    } else if (spent.length === 1) {
        best = spent[0];
    }

    if (!causes.length) {
        causes.push((tag === 'win' || tag === 'mid') ? '전반적으로 안정적인 성과를 보이고 있습니다.' : '뚜렷한 원인 신호 없이 전반적으로 반응이 약합니다. 노출/클릭 표본이 적어 판단이 어려울 수 있습니다.');
    }
    return { causes, best, worst };
}

function _cepNextStepText(tag, agg, best) {
    switch (tag) {
        case 'pending': return '가설에 맞는 검증 소재를 제작해 테스트를 시작하세요.';
        case 'fail': return '전환 0건으로 가설이 입증되지 않았습니다. 동일 CEP를 다른 앵글로 1회 더 검증하거나 다른 CEP로 예산을 재배분하세요.';
        case 'win': return `검증된 CEP입니다.${best ? ` "${_cepShortDetail(best.detail)}" 앵글을 중심으로` : ''} 소재를 추가 제작하고 예산 확대를 검토하세요.`;
        case 'mid': return `손익 경계선입니다.${best ? ` "${_cepShortDetail(best.detail)}" 소재 앵글을 변형해` : ''} 2-3개 추가 소재로 재검증하세요.`;
        default: return '전환은 있으나 효율이 낮습니다. 타겟 또는 랜딩 오퍼를 조정해 재검증하세요.';
    }
}

function _cepFmtKRW(v) { return '₩' + Math.round(v).toLocaleString(); }
function _cepFmtPct(v) { return v.toFixed(1) + '%'; }
function _cepFmtInt(v) { return Math.round(v).toLocaleString(); }

function _cepRenderCepBlock(cepObj) {
    const hasResult = cepObj.creatives.length > 0;
    const agg = hasResult ? _cepAggregate(cepObj) : null;
    const tag = _cepVerdictTag(agg, hasResult);
    const meta = CEP_VERDICT_META[tag];
    const hypotheses = [...cepObj.hypotheses];
    const spaceIdx = cepObj.cepLabel.indexOf(' ');
    const cepNo = spaceIdx > 0 ? cepObj.cepLabel.slice(0, spaceIdx) : cepObj.cepLabel;
    const cepTitle = spaceIdx > 0 ? cepObj.cepLabel.slice(spaceIdx + 1) : '';

    const hypoHtml = hypotheses.length
        ? `<div class="cep-hypo"><div class="cep-hypo-label">가설</div><ul class="cep-hypo-list">${hypotheses.map(h => `<li>${_cepEsc(h)}</li>`).join('')}</ul></div>`
        : '';
    const headHtml = `
        <div class="cep-card-head">
            <span class="cep-tag">${_cepEsc(cepNo)}</span>
            <span class="cep-name">${_cepEsc(cepTitle)}</span>
            <span class="cep-status-badge ${hasResult ? 'done' : 'pending'}">${hasResult ? '검증 완료' : '검증 대기'}</span>
        </div>`;

    if (!hasResult) {
        return `
        <div class="cep-block cep-block--pending">
            ${headHtml}
            ${hypoHtml}
            <div class="cep-pending-note"><i class="fas fa-circle-notch"></i> 검증 소재 제작 대기 중 — 결과·원인 분석은 집행 후 표시됩니다.</div>
            <div class="cep-nextstep">
                <span class="cep-action-badge cep-action--pending">${meta.emoji} Next Step</span>
                <p class="cep-action-text">${_cepEsc(_cepNextStepText('pending'))}</p>
            </div>
        </div>`;
    }

    const { causes, best } = _cepAnalyze(cepObj, agg, tag);
    const nextText = _cepNextStepText(tag, agg, best);
    const multi = cepObj.creatives.filter(c => c.cost > 0).length > 1;

    const resultHtml = `
        <div class="cep-result-strip">
            <span class="cep-result-chip"><b>${_cepFmtInt(agg.imp)}</b>IMP</span>
            <span class="cep-result-chip"><b>${_cepFmtPct(agg.ctr)}</b>CTR</span>
            <span class="cep-result-chip"><b>${_cepFmtPct(agg.cvr)}</b>CVR</span>
            <span class="cep-result-chip"><b>${_cepFmtKRW(agg.cost)}</b>COST</span>
            <span class="cep-result-chip"><b>${_cepFmtInt(agg.cv)}</b>CV</span>
            <span class="cep-result-chip cep-result-chip--roas"><b>${agg.roas.toFixed(0)}%</b>ROAS</span>
        </div>`;

    const tableHtml = `
        <div class="cep-creative-table-wrap">
            <table class="cep-creative-table">
                <thead><tr><th>검증 소재</th><th>앵글</th><th>IMP</th><th>CTR</th><th>CV</th><th>ROAS</th></tr></thead>
                <tbody>
                    ${cepObj.creatives.map(c => {
                        const isBest = multi && best && c === best;
                        return `
                        <tr class="${isBest ? 'cep-row-best' : ''}">
                            <td>${c.url ? `<a href="${_cepEsc(c.url)}" target="_blank" rel="noopener">${_cepEsc(c.name)} <i class="fas fa-arrow-up-right-from-square"></i></a>` : _cepEsc(c.name)}${isBest ? ' <span class="cep-best-tag">★최고</span>' : ''}</td>
                            <td class="cep-angle-cell">${_cepEsc(_cepShortDetail(c.detail))}</td>
                            <td>${_cepFmtInt(c.imp)}</td>
                            <td>${c.imp > 0 ? _cepFmtPct(c.ctrSheet) : '-'}</td>
                            <td>${_cepFmtInt(c.cv)}</td>
                            <td>${c.cost > 0 ? _cepFmtPct(c.roasSheet) : '-'}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;

    return `
    <div class="cep-block cep-block--${tag}">
        ${headHtml}
        ${hypoHtml}
        <div class="cep-section-label">CEP 종합 결과</div>
        ${resultHtml}
        <div class="cep-section-label">소재별 성과</div>
        ${tableHtml}
        <div class="cep-section-label">원인 분석</div>
        <ul class="cep-cause-list">${causes.map(c => `<li>${_cepEsc(c)}</li>`).join('')}</ul>
        <div class="cep-nextstep">
            <span class="cep-action-badge cep-action--${tag}">${meta.emoji} Next Step</span>
            <p class="cep-action-text">${_cepEsc(nextText)}</p>
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

function _cepRenderProductList(productsMap) {
    const listEl = document.getElementById('cep-product-list');
    if (!listEl) return;
    const arr = [...productsMap.entries()];
    if (!arr.length) {
        listEl.innerHTML = '<div class="text-center text-slate-300 text-xs py-10">조건에 맞는 제품이 없습니다.</div>';
        return;
    }
    if (!_cepSelectedKey || !productsMap.has(_cepSelectedKey)) _cepSelectedKey = arr[0][0];

    listEl.innerHTML = arr.map(([key, p]) => {
        const ceps = [...p.ceps.values()];
        const done = ceps.filter(c => c.creatives.length > 0).length;
        const avgRoas = _cepProductAvgRoas(p);
        return `
        <button class="cep-prod-item ${key === _cepSelectedKey ? 'active' : ''}" data-key="${_cepEsc(key)}">
            <div class="cep-prod-item-top">
                <span class="cep-brand-tag">${_cepEsc(p.brand)}</span>
                <span class="cep-prod-item-name">${_cepEsc(p.product)}</span>
            </div>
            <div class="cep-prod-item-stat">CEP ${ceps.length}개 · 완료 ${done}${avgRoas != null ? ` · ROAS ${avgRoas.toFixed(0)}%` : ''}</div>
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

function _cepRenderDetailForSelected() {
    const detailEl = document.getElementById('cep-detail');
    if (!detailEl || !_cepProducts) return;
    const pObj = _cepProducts.get(_cepSelectedKey);
    if (!pObj) { detailEl.innerHTML = '<div class="text-center text-slate-300 text-sm py-16">좌측에서 제품을 선택하세요.</div>'; return; }

    const statusSel = document.getElementById('cep-status-filter')?.value || '';
    let ceps = [...pObj.ceps.values()];
    if (statusSel === 'done') ceps = ceps.filter(c => c.creatives.length > 0);
    if (statusSel === 'pending') ceps = ceps.filter(c => c.creatives.length === 0);

    const allCeps = [...pObj.ceps.values()];
    const done = allCeps.filter(c => c.creatives.length > 0).length;
    const avgRoas = _cepProductAvgRoas(pObj);

    detailEl.innerHTML = `
        <div class="cep-detail-header">
            <span class="cep-brand-tag">${_cepEsc(pObj.brand)}</span>
            <span class="cep-detail-title">${_cepEsc(pObj.product)}</span>
            <span class="cep-product-stat">CEP ${allCeps.length}개 · 완료 ${done} · 대기 ${allCeps.length - done}${avgRoas != null ? ` · 평균 ROAS ${avgRoas.toFixed(0)}%` : ''}</span>
        </div>
        <div class="cep-blocks">
            ${ceps.length ? ceps.map(c => _cepRenderCepBlock(c)).join('') : '<div class="text-center text-slate-300 text-sm py-10">조건에 맞는 CEP가 없습니다.</div>'}
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
    listEl.innerHTML = '<div class="text-center text-slate-300 text-xs py-10"><i class="fas fa-spinner fa-spin mr-2"></i>로딩 중...</div>';
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
        listEl.innerHTML = `<div class="text-center text-rose-400 text-xs py-10"><i class="fas fa-triangle-exclamation mr-2"></i>로드 실패: ${_cepEsc(e.message)}</div>`;
    } finally {
        _cepLoading = false;
    }
}
window.renderCepVerification = renderCepVerification;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('cep-brand-filter')?.addEventListener('change', _cepApplyFilters);
    document.getElementById('cep-status-filter')?.addEventListener('change', _cepRenderDetailForSelected);
    document.getElementById('cep-refresh-btn')?.addEventListener('click', () => renderCepVerification(true));
});
