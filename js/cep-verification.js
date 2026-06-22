// ============================================================
//  CEP 검증 로그 (가설 → 검증 소재 → 결과 → Next Action)
//  creative_template 시트의 "검증 로그" 탭(CSV 게시본)을 읽어
//  제품 × CEP 단위로 가설/검증/결과/액션을 정리해 보여준다.
// ============================================================

const CEP_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTVqotU6K1y0u9atjKrRpaFgDamwAdUmxldvBbYepguKNm6MzzRDm5uUMmEGFFw_R3EOxmu1_ihWfKE/pub?gid=1751932102&single=true&output=csv';

// 컬럼 인덱스: 소재명,브랜드,제품,소구포인트(CEP),검증 상세,검증 소재 media urls,IMP,Click,CTR,CPC,COST,CV,CVR,CPA,Revenue,ROAS
const CEP_COL = { name: 0, brand: 1, product: 2, cep: 3, detail: 4, url: 5, imp: 6, click: 7, cost: 10, cv: 11, revenue: 14 };

let _cepProducts = null;   // Map(brand__product -> {brand, product, ceps: Map(cepLabel -> {cepLabel, hypotheses:Set, creatives:[]})})
let _cepLoading = false;

function _cepEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _cepNum(v) {
    if (v == null) return 0;
    const n = parseFloat(String(v).replace(/[₩%,]/g, '').trim());
    return isNaN(n) ? 0 : n;
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

function _cepNextAction(agg, hasResult) {
    if (!hasResult || !agg || agg.cost === 0) {
        return { tag: 'pending', emoji: '📝', label: '소재 제작 대기', text: '검증 소재가 아직 집행되지 않았습니다. 가설에 맞는 소재 제작 후 테스트가 필요합니다.' };
    }
    if (agg.cv === 0) {
        return { tag: 'fail', emoji: '❌', label: '가설 미입증', text: `전환 0건 (클릭 ${Math.round(agg.click).toLocaleString()}건, CTR ${agg.ctr.toFixed(2)}%). 소구포인트 재검토 또는 다른 CEP로 전환을 검토하세요.` };
    }
    if (agg.roas >= 200) {
        return { tag: 'win', emoji: '✅', label: '검증 성공 · 스케일업', text: `ROAS ${agg.roas.toFixed(0)}%로 가설이 입증되었습니다. 동일 CEP로 소재를 추가 제작하고 예산 확대를 검토하세요.` };
    }
    if (agg.roas >= 100) {
        return { tag: 'mid', emoji: '🟡', label: '부분 검증', text: `ROAS ${agg.roas.toFixed(0)}%, 손익 경계선입니다. 카피/소재 변형으로 추가 검증이 필요합니다.` };
    }
    return { tag: 'weak', emoji: '🟠', label: '반응 약함', text: `전환은 발생했으나 ROAS ${agg.roas.toFixed(0)}%로 낮습니다. 소구포인트 조정 또는 타겟 재설정을 권장합니다.` };
}

function _cepFmtKRW(v) { return '₩' + Math.round(v).toLocaleString(); }
function _cepFmtPct(v) { return v.toFixed(1) + '%'; }
function _cepFmtInt(v) { return Math.round(v).toLocaleString(); }

function _cepRenderCard(cepObj) {
    const hasResult = cepObj.creatives.length > 0;
    const agg = hasResult ? _cepAggregate(cepObj) : null;
    const action = _cepNextAction(agg, hasResult);
    const hypotheses = [...cepObj.hypotheses];
    const spaceIdx = cepObj.cepLabel.indexOf(' ');
    const cepNo = spaceIdx > 0 ? cepObj.cepLabel.slice(0, spaceIdx) : cepObj.cepLabel;
    const cepTitle = spaceIdx > 0 ? cepObj.cepLabel.slice(spaceIdx + 1) : '';

    const hypoHtml = hypotheses.length
        ? `<div class="cep-hypo"><div class="cep-hypo-label">가설</div><ul class="cep-hypo-list">${hypotheses.map(h => `<li>${_cepEsc(h)}</li>`).join('')}</ul></div>`
        : '';

    const bodyHtml = hasResult ? `
        <div class="cep-creative-table-wrap">
            <table class="cep-creative-table">
                <thead><tr><th>검증 소재</th><th>IMP</th><th>CTR</th><th>CV</th><th>ROAS</th></tr></thead>
                <tbody>
                    ${cepObj.creatives.map(c => `
                        <tr>
                            <td>${c.url ? `<a href="${_cepEsc(c.url)}" target="_blank" rel="noopener">${_cepEsc(c.name)} <i class="fas fa-arrow-up-right-from-square"></i></a>` : _cepEsc(c.name)}</td>
                            <td>${_cepFmtInt(c.imp)}</td>
                            <td>${c.imp > 0 ? _cepFmtPct(c.click / c.imp * 100) : '-'}</td>
                            <td>${_cepFmtInt(c.cv)}</td>
                            <td>${c.cost > 0 ? _cepFmtPct(c.revenue / c.cost * 100) : '-'}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>
        <div class="cep-footer">
            <div class="cep-footer-metrics">
                <span class="cep-metric">IMP <b>${_cepFmtInt(agg.imp)}</b></span>
                <span class="cep-metric">CTR <b>${_cepFmtPct(agg.ctr)}</b></span>
                <span class="cep-metric">CVR <b>${_cepFmtPct(agg.cvr)}</b></span>
                <span class="cep-metric">COST <b>${_cepFmtKRW(agg.cost)}</b></span>
                <span class="cep-metric cep-metric--roas">ROAS <b>${agg.roas.toFixed(0)}%</b></span>
            </div>
        </div>` : `<div class="cep-pending-note"><i class="fas fa-circle-notch"></i> 검증 소재 제작 대기 중</div>`;

    return `
    <div class="cep-card cep-card--${action.tag}">
        <div class="cep-card-head">
            <span class="cep-tag">${_cepEsc(cepNo)}</span>
            <span class="cep-name">${_cepEsc(cepTitle)}</span>
            <span class="cep-status-badge ${hasResult ? 'done' : 'pending'}">${hasResult ? '검증 완료' : '검증 대기'}</span>
        </div>
        ${hypoHtml}
        ${bodyHtml}
        <div class="cep-action-row">
            <span class="cep-action-badge cep-action--${action.tag}">${action.emoji} ${action.label}</span>
            <p class="cep-action-text">${_cepEsc(action.text)}</p>
        </div>
    </div>`;
}

function _cepRenderProductGroup(pObj) {
    const cepEntries = [...pObj.ceps.values()];
    const completed = cepEntries.filter(c => c.creatives.length > 0);
    let cost = 0, revenue = 0;
    completed.forEach(c => { const a = _cepAggregate(c); cost += a.cost; revenue += a.revenue; });
    const avgRoas = cost > 0 ? revenue / cost * 100 : null;

    return `
    <div class="cep-product-group">
        <div class="cep-product-head">
            <span class="cep-brand-tag">${_cepEsc(pObj.brand)}</span>
            <span class="cep-product-name">${_cepEsc(pObj.product)}</span>
            <span class="cep-product-stat">CEP ${cepEntries.length}개 · 완료 ${completed.length} · 대기 ${cepEntries.length - completed.length}${avgRoas != null ? ` · 평균 ROAS ${avgRoas.toFixed(0)}%` : ''}</span>
        </div>
        <div class="cep-cards">
            ${cepEntries.map(c => _cepRenderCard(c)).join('')}
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

function _cepPopulateFilters(productsMap) {
    const brandSel = document.getElementById('cep-brand-filter');
    const productSel = document.getElementById('cep-product-filter');
    if (!brandSel || !productSel) return;
    const brands = new Set(), prods = new Set();
    productsMap.forEach(p => { if (p.brand) brands.add(p.brand); if (p.product) prods.add(p.product); });

    const curBrand = brandSel.value, curProduct = productSel.value;
    brandSel.innerHTML = '<option value="">전체 브랜드</option>' + [...brands].sort().map(b => `<option value="${_cepEsc(b)}">${_cepEsc(b)}</option>`).join('');
    productSel.innerHTML = '<option value="">전체 제품</option>' + [...prods].sort().map(p => `<option value="${_cepEsc(p)}">${_cepEsc(p)}</option>`).join('');
    if ([...brands].includes(curBrand)) brandSel.value = curBrand;
    if ([...prods].includes(curProduct)) productSel.value = curProduct;
}

function _cepApplyFilters() {
    if (!_cepProducts) return;
    const brandSel = document.getElementById('cep-brand-filter')?.value || '';
    const productSel = document.getElementById('cep-product-filter')?.value || '';
    const statusSel = document.getElementById('cep-status-filter')?.value || '';
    const container = document.getElementById('cep-groups');
    if (!container) return;

    const groups = [...(_cepProducts.values())].filter(p => {
        if (brandSel && p.brand !== brandSel) return false;
        if (productSel && p.product !== productSel) return false;
        return true;
    });

    _cepRenderSummary(groups);

    const html = groups.map(p => {
        let entries = [...p.ceps.values()];
        if (statusSel === 'done') entries = entries.filter(c => c.creatives.length > 0);
        if (statusSel === 'pending') entries = entries.filter(c => c.creatives.length === 0);
        if (!entries.length) return '';
        return _cepRenderProductGroup({ brand: p.brand, product: p.product, ceps: new Map(entries.map(e => [e.cepLabel, e])) });
    }).filter(Boolean).join('');

    container.innerHTML = html || '<div class="text-center text-slate-300 text-sm py-16">조건에 맞는 검증 로그가 없습니다.</div>';
}
window.cepApplyFilters = _cepApplyFilters;

async function renderCepVerification(forceReload) {
    const container = document.getElementById('cep-groups');
    if (!container) return;
    if (_cepLoading) return;
    if (_cepProducts && !forceReload) { _cepApplyFilters(); return; }

    _cepLoading = true;
    container.innerHTML = '<div class="text-center text-slate-300 text-sm py-16"><i class="fas fa-spinner fa-spin mr-2"></i>검증 로그 불러오는 중...</div>';
    try {
        const res = await fetch(CEP_SHEET_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (text.includes('<HTML>') || text.includes('<!DOCTYPE')) {
            throw new Error('시트가 웹에 게시되지 않았거나 게시 링크가 잘못되었습니다.');
        }
        const rows = _cepParseCSV(text);
        _cepProducts = _cepBuildModel(rows);
        _cepPopulateFilters(_cepProducts);
        _cepApplyFilters();
    } catch (e) {
        container.innerHTML = `<div class="text-center text-rose-400 text-sm py-16"><i class="fas fa-triangle-exclamation mr-2"></i>검증 로그를 불러오지 못했습니다: ${_cepEsc(e.message)}</div>`;
    } finally {
        _cepLoading = false;
    }
}
window.renderCepVerification = renderCepVerification;

document.addEventListener('DOMContentLoaded', () => {
    ['cep-brand-filter', 'cep-product-filter', 'cep-status-filter'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', _cepApplyFilters);
    });
    document.getElementById('cep-refresh-btn')?.addEventListener('click', () => renderCepVerification(true));
});
