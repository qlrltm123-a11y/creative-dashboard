// ============================
// AI 인사이트 (소구포인트 / 후킹 / 감정 기반)
// ============================

let insightCharts = {};

// ★ AI 인사이트 차트별 선택 지표
const chartMetrics = {
    appeal:  'roas',   // 소구포인트 차트
    hook:    'roas',   // 후킹 방식 차트
    emotion: 'roas',   // 감정 차트
};
// (바인딩 여부는 sel.dataset.bound 로 각 select 마다 추적)

const INSIGHT_METRIC_CFG = {
    roas: {
        key: 'roas', label: 'ROAS', unitLabel: '(%)', lowerBetter: false,
        hue: 265, sat: '75%', minPad: 30,
        fmtVal:  v => Math.round(v * 100),
        fmtTick: v => v + '%',
        fmtMean: v => Math.round(v) + '%',
        fmtDev:  dev => (dev >= 0 ? '+' : '') + Math.round(dev) + '%p',
    },
    ctr: {
        key: 'ctr', label: 'CTR', unitLabel: '(%)', lowerBetter: false,
        hue: 195, sat: '78%', minPad: 0.3,
        fmtVal:  v => Number((v * 100).toFixed(2)),
        fmtTick: v => v + '%',
        fmtMean: v => Number(v).toFixed(2) + '%',
        fmtDev:  dev => (dev >= 0 ? '+' : '') + Number(dev).toFixed(2) + '%p',
    },
    cvr: {
        key: 'cvr', label: 'CVR', unitLabel: '(%)', lowerBetter: false,
        hue: 350, sat: '75%', minPad: 0.3,
        fmtVal:  v => Number((v * 100).toFixed(2)),
        fmtTick: v => v + '%',
        fmtMean: v => Number(v).toFixed(2) + '%',
        fmtDev:  dev => (dev >= 0 ? '+' : '') + Number(dev).toFixed(2) + '%p',
    },
    cpa: {
        key: 'cpa', label: 'CPA', unitLabel: '(₩)', lowerBetter: true,
        hue: 35, sat: '85%', minPad: 1000,
        fmtVal:  v => Math.round(v),
        fmtTick: v => '₩' + Math.round(v).toLocaleString(),
        fmtMean: v => '₩' + Math.round(v).toLocaleString(),
        fmtDev:  dev => (dev >= 0 ? '+' : '-') + '₩' + Math.round(Math.abs(dev)).toLocaleString(),
    },
    atc_rate: {
        key: 'atc_rate', label: 'ATC율', unitLabel: '(%)', lowerBetter: false,
        hue: 145, sat: '65%', minPad: 0.3,
        fmtVal:  v => Number((v * 100).toFixed(2)),
        fmtTick: v => v + '%',
        fmtMean: v => Number(v).toFixed(2) + '%',
        fmtDev:  dev => (dev >= 0 ? '+' : '') + Number(dev).toFixed(2) + '%p',
    },
};

// 키워드별 대표 소재 (ROAS 상위 N개) 캐시
let keywordCreativeMap = {
    appeal_points: new Map(),
    hook_type: new Map(),
    target_emotion: new Map()
};

// 키워드 → 대표 소재 매핑 빌드 (ROAS 상위 3개씩)
// ★ 중앙값(median spend) 이상 광고비가 집행된 소재만 대표 후보로 사용
function buildKeywordCreativeMap(creatives, opts) {
    keywordCreativeMap = {
        appeal_points: new Map(),
        hook_type: new Map(),
        target_emotion: new Map()
    };
    // ★ opts.threshold가 명시되면 그 값을 사용 (0 가능)
    //   - 이미 필터된 pool을 그대로 사용하고 싶을 땐 0을 넘기면 됨
    //   - opts가 없으면 기존 동작 유지 (currentInsightThreshold)
    const hasExplicit = opts && typeof opts.threshold === 'number';
    const threshold = hasExplicit ? opts.threshold : (currentInsightThreshold || INSIGHT_MIN_SPEND);
    ['appeal_points', 'hook_type', 'target_emotion'].forEach(field => {
        const tmp = new Map();
        creatives.forEach(c => {
            const spend = Number(c.spend) || 0;
            if (spend < threshold) return; // ★ 중앙값 이상만 (threshold=0이면 전부 통과)
            const keywords = normalizeKeywords(c[field]);
            keywords.forEach(k => {
                if (!k || k.startsWith('❌')) return;
                if (!tmp.has(k)) tmp.set(k, []);
                tmp.get(k).push(c);
            });
        });
        // 각 키워드별 ROAS 상위 3개 선별
        tmp.forEach((arr, k) => {
            const top = arr
                .sort((a, b) => (b.roas || 0) - (a.roas || 0))
                .slice(0, 3);
            keywordCreativeMap[field].set(k, top);
        });
    });
}

// hover preview 카드 생성 (floating)
function getPreviewEl() {
    let el = document.getElementById('insight-hover-preview');
    if (!el) {
        el = document.createElement('div');
        el.id = 'insight-hover-preview';
        el.className = 'insight-hover-preview';
        document.body.appendChild(el);
    }
    return el;
}

function buildPreviewHtml(keyword, field) {
    const items = (keywordCreativeMap[field] && keywordCreativeMap[field].get(keyword)) || [];
    if (!items.length) {
        return `
            <div class="preview-header">
                <i class="fas fa-search"></i>
                <span class="preview-keyword">"${keyword}"</span>
            </div>
            <div class="preview-empty">관련 예시 소재가 없습니다</div>
        `;
    }
    const fieldLabel = field === 'appeal_points' ? '소구포인트'
                     : field === 'hook_type' ? '후킹' : '감정';
    const cards = items.map((c, i) => {
        const rawThumb = c.thumbnail_url || c.media_url || '';
        const isVideo = c.media_type === 'video';
        const fallbackHtml = `<div class="preview-thumb preview-thumb-fallback"><i class="fas fa-${isVideo ? 'video' : 'image'}"></i></div>`;
        let thumbHtml;
        if (!rawThumb) {
            thumbHtml = fallbackHtml;
        } else if (typeof window.isDriveUrl === 'function' && window.isDriveUrl(rawThumb) && typeof window.buildDriveImgHtml === 'function') {
            thumbHtml = window.buildDriveImgHtml(rawThumb, {
                className: 'preview-thumb',
                alt: '',
                finalFallbackHtml: fallbackHtml,
            });
        } else {
            thumbHtml = `<img src="${rawThumb}" alt="" class="preview-thumb" loading="eager" decoding="async" referrerpolicy="no-referrer" onerror="this.outerHTML='${fallbackHtml.replace(/'/g, "\\'")}'">`;
        }
        const medal = ['🥇','🥈','🥉'][i] || (i+1);
        const msg = c.key_message_kr || c.key_message_jp || '';

        // ★ 소구포인트 칩 (첨부 디자인 동일) — 최대 5개
        //    현재 hover한 키워드가 첫 번째로 오도록 정렬
        const appeals = normalizeKeywords(c.appeal_points)
            .filter(a => a && !a.startsWith('❌'));
        const sortedAppeals = [
            ...appeals.filter(a => a === keyword),
            ...appeals.filter(a => a !== keyword)
        ].slice(0, 5);
        const appealChipsHtml = sortedAppeals.length
            ? `<div class="preview-appeal-section">
                    <div class="preview-appeal-label"><i class="far fa-comment-dots"></i> 소구포인트</div>
                    <div class="preview-appeal-chips">
                        ${sortedAppeals.map(a => {
                            const active = a === keyword ? ' active' : '';
                            return `<span class="preview-appeal-chip${active}">${a}</span>`;
                        }).join('')}
                    </div>
               </div>`
            : '';

        return `
            <div class="preview-item" data-creative-id="${c.id || c.ad_name || ''}">
                <div class="preview-medal">${medal}</div>
                <div class="preview-thumb-wrap">
                    ${thumbHtml}
                    ${isVideo ? '<span class="preview-vbadge">▶</span>' : ''}
                </div>
                <div class="preview-info">
                    ${msg ? `<div class="preview-msg">"${msg.length > 38 ? msg.slice(0,38)+'…' : msg}"</div>` : ''}
                    ${appealChipsHtml}
                    <div class="preview-stats">
                        <span><b>ROAS</b> ${Math.round((c.roas||0)*100)}%</span>
                        <span><b>CTR</b> ${((c.ctr||0)*100).toFixed(2)}%</span>
                        ${c.product ? `<span class="preview-prod">${c.product}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    return `
        <div class="preview-header">
            <i class="fas fa-magic-wand-sparkles"></i>
            <span class="preview-field-label">${fieldLabel}</span>
            <span class="preview-keyword">"${keyword}"</span>
            <span class="preview-count">대표 소재 ${items.length}개</span>
        </div>
        <div class="preview-body">${cards}</div>
        <div class="preview-footer"><i class="fas fa-mouse-pointer"></i> 클릭하여 상세 보기</div>
    `;
}

// 현재 표시 중인 키워드+필드 (재트리거 방지)
let currentPreviewKey = null;
// 닫기 지연 타이머 (트리거→카드 이동 시간 확보)
let hidePreviewTimer = null;
// ★ 카드 위에 마우스가 올라가 있는 동안 true — 절대 자동 닫힘 차단
let previewPinned = false;
// 닫기 지연 시간 (ms) — 트리거 → 카드로 마우스 이동 여유
const HIDE_DELAY_MS = 400;

function positionPreviewAtEvent(el, evt) {
    const pad = 14;
    const w = el.offsetWidth || 340;
    const h = el.offsetHeight || 280;
    let x = (evt.clientX || 0) + pad;
    let y = (evt.clientY || 0) + pad;
    if (x + w > window.innerWidth - 10) x = (evt.clientX || 0) - w - pad;
    if (x < 10) x = 10;
    if (y + h > window.innerHeight - 10) y = window.innerHeight - h - 10;
    if (y < 10) y = 10;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
}

function showPreview(keyword, field, evt) {
    if (!keyword) return;
    const key = field + '::' + keyword;

    // 같은 키워드라면 닫기 예약만 취소하고 아무것도 다시 그리지 않음
    if (currentPreviewKey === key) {
        clearTimeout(hidePreviewTimer);
        hidePreviewTimer = null;
        return;
    }
    clearTimeout(hidePreviewTimer);
    hidePreviewTimer = null;

    const el = getPreviewEl();
    el.innerHTML = buildPreviewHtml(keyword, field);

    // 카드 자체에 hover/leave 핸들러 (카드 위에 있으면 유지)
    // ★ pinned 플래그로 자동 닫힘을 완전 차단 — 카드 위에서는 절대 사라지지 않음
    el.onmouseenter = () => {
        clearTimeout(hidePreviewTimer);
        hidePreviewTimer = null;
        previewPinned = true;
    };
    el.onmouseleave = () => {
        previewPinned = false;
        hidePreview();
    };
    // ★ 카드 내부 스크롤/이동 중에도 pinned 유지 보강
    el.onmousemove = () => {
        if (!previewPinned) {
            previewPinned = true;
            clearTimeout(hidePreviewTimer);
            hidePreviewTimer = null;
        }
    };

    // 클릭 시 해당 소재 모달 열기
    // ★ preview-body(스크롤 영역) 클릭은 무시 — 스크롤바 드래그/클릭이 모달을 여는 문제 방지
    //   .preview-item 클릭 시 해당 소재 ID, footer 클릭 시 첫 번째 소재 열기
    const items = (keywordCreativeMap[field] && keywordCreativeMap[field].get(keyword)) || [];
    if (items.length && typeof window.openModal === 'function') {
        el.onclick = (e) => {
            const target = e.target;
            const inItem = target.closest && target.closest('.preview-item');
            const inFooter = target.closest && target.closest('.preview-footer');
            const inBodyOnly = target.classList && target.classList.contains('preview-body');
            if (inBodyOnly && !inItem && !inFooter) return; // 빈 body 영역 클릭은 무시

            // ★ 클릭된 .preview-item의 data-creative-id 우선 사용, 없으면 첫 번째 소재
            let targetId = items[0].id;
            if (inItem) {
                const cid = inItem.getAttribute('data-creative-id');
                if (cid) {
                    const matched = items.find(c => (c.id || c.ad_name || '') == cid);
                    if (matched) targetId = matched.id || matched.ad_name;
                }
            }
            window.openModal(targetId);
            forceHidePreview();
        };
    } else {
        el.onclick = null;
    }

    // ★ preview-body 스크롤 처리 — passive:false 로 preventDefault 보장
    const bodyEl = el.querySelector('.preview-body');
    if (bodyEl) {
        bodyEl._wheelHandler && bodyEl.removeEventListener('wheel', bodyEl._wheelHandler);
        bodyEl._wheelHandler = (e) => {
            e.stopPropagation();
            e.preventDefault();
            bodyEl.scrollTop += e.deltaY;
            previewPinned = true;
            clearTimeout(hidePreviewTimer);
            hidePreviewTimer = null;
        };
        bodyEl.addEventListener('wheel', bodyEl._wheelHandler, { passive: false });
    }
    el._wheelHandler && el.removeEventListener('wheel', el._wheelHandler);
    el._wheelHandler = (e) => {
        e.stopPropagation();
        e.preventDefault();
        previewPinned = true;
        clearTimeout(hidePreviewTimer);
        hidePreviewTimer = null;
    };
    el.addEventListener('wheel', el._wheelHandler, { passive: false });

    // ★ 첫 진입 시점 좌표로 고정 — 이후 mousemove 추적 없음
    el.classList.add('visible');
    // 다음 프레임에 정확한 사이즈로 위치 보정 (안전)
    requestAnimationFrame(() => positionPreviewAtEvent(el, evt));

    currentPreviewKey = key;
}

function hidePreview() {
    // ★ pinned(카드 위 마우스) 상태면 닫기 예약 자체를 무시
    if (previewPinned) return;
    // 400ms 지연 → 트리거 요소 → 카드 위로 마우스 옮길 시간 확보
    clearTimeout(hidePreviewTimer);
    hidePreviewTimer = setTimeout(() => {
        // 타이머 만료 시점에 다시 한 번 pinned 체크 (그 사이 카드 진입했을 수 있음)
        if (previewPinned) return;
        forceHidePreview();
    }, HIDE_DELAY_MS);
}

function forceHidePreview() {
    clearTimeout(hidePreviewTimer);
    hidePreviewTimer = null;
    previewPinned = false;
    const el = document.getElementById('insight-hover-preview');
    if (el) el.classList.remove('visible');
    currentPreviewKey = null;
}

// 요소에 hover 이벤트 바인딩 (재사용 헬퍼)
// ★ mousemove 제거 — 첫 진입 시점에만 위치 고정
function bindHoverPreview(elements, getKeyword, field) {
    elements.forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('mouseenter', e => {
            const kw = getKeyword(el);
            if (kw) showPreview(kw, field, e);
        });
        el.addEventListener('mouseleave', hidePreview);
    });
}

function destroyInsightChart(key) {
    if (insightCharts[key]) {
        insightCharts[key].destroy();
        delete insightCharts[key];
    }
}

// 배열/문자열을 정규화하여 키워드 배열로 변환
function normalizeKeywords(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value.flatMap(v => String(v).split(/[,、，·・]/).map(s => s.trim()).filter(Boolean));
    }
    return String(value).split(/[,、，·・]/).map(s => s.trim()).filter(Boolean);
}

// 키워드별 성과 집계
// ★ 통일된 선정 기준: 광고비 중앙값(median spend) 이상 소재만 집계 대상
//    (구버전 INSIGHT_MIN_SPEND=1000 고정값 → 중앙값으로 변경)
const INSIGHT_MIN_SPEND = 1000; // 호환용 (다른 곳에서 폴백으로 사용)

// 현재 인사이트 렌더링에 사용 중인 임계값 (renderAIInsights 시작 시 갱신)
let currentInsightThreshold = INSIGHT_MIN_SPEND;
let currentInsightMedian = 0;

function computeInsightThreshold(list) {
    if (typeof window.filterByMedianSpend === 'function') {
        const { medianSpend, threshold } = window.filterByMedianSpend(list, { minRequired: 10 });
        currentInsightMedian = medianSpend;
        currentInsightThreshold = threshold || INSIGHT_MIN_SPEND;
    } else {
        currentInsightMedian = 0;
        currentInsightThreshold = INSIGHT_MIN_SPEND;
    }
    return currentInsightThreshold;
}

function aggregateByKeyword(creatives, fieldName, opts) {
    const map = new Map();
    const threshold = (opts && typeof opts.threshold === 'number')
        ? opts.threshold
        : (currentInsightThreshold || INSIGHT_MIN_SPEND);
    creatives.forEach(c => {
        const spendCheck = Number(c.spend) || 0;
        if (spendCheck < threshold) return; // ★ 중앙값 이상 소재만
        const keywords = normalizeKeywords(c[fieldName]);
        const spend = spendCheck;
        const revenue = Number(c.revenue) || 0;
        const impressions = Number(c.impressions) || 0;
        const clicks = Number(c.clicks) || 0;
        const conversions = Number(c.conversions) || 0;

        const add_to_cart = Number(c.add_to_cart) || 0;
        keywords.forEach(k => {
            if (!k || k.startsWith('❌')) return;
            if (!map.has(k)) {
                map.set(k, {
                    keyword: k,
                    count: 0,
                    spend: 0,
                    revenue: 0,
                    impressions: 0,
                    clicks: 0,
                    conversions: 0,
                    add_to_cart: 0,
                });
            }
            const item = map.get(k);
            item.count++;
            item.spend += spend;
            item.revenue += revenue;
            item.impressions += impressions;
            item.clicks += clicks;
            item.conversions += conversions;
            item.add_to_cart += add_to_cart;
        });
    });

    // 파생 지표 계산 — ROAS/CTR/CVR은 "비율" 단위 (표시 시 ×100)
    return Array.from(map.values()).map(item => ({
        ...item,
        roas:     item.spend > 0       ? (item.revenue / item.spend) : 0,
        ctr:      item.impressions > 0 ? (item.clicks / item.impressions) : 0,
        cvr:      item.clicks > 0      ? (item.conversions / item.clicks) : 0,
        cpa:      item.conversions > 0 ? Math.round(item.spend / item.conversions) : 0,
        atc_rate: item.clicks > 0      ? (item.add_to_cart / item.clicks) : 0,
    }));
}

// AI 분석 데이터가 있는지 확인
function hasAiData(creatives) {
    return creatives.some(c =>
        (c.appeal_points && (Array.isArray(c.appeal_points) ? c.appeal_points.length : c.appeal_points)) ||
        (c.hook_type && (Array.isArray(c.hook_type) ? c.hook_type.length : c.hook_type)) ||
        (c.target_emotion && (Array.isArray(c.target_emotion) ? c.target_emotion.length : c.target_emotion))
    );
}

// AI 인사이트 탭 - 제품 드롭다운 채우기
function populateAIInsightsProductOptions() {
    const sel = document.getElementById('ai-insights-product-select');
    if (!sel) return;
    const baseList = (typeof getBrandCreatives === 'function')
        ? getBrandCreatives()
        : (window.allCreatives || []);
    const products = Array.from(new Set(
        baseList.map(c => (c.product || '').trim()).filter(Boolean)
    )).sort();
    const currentValue = sel.value;
    sel.innerHTML = '<option value="__all__">전체 제품</option>' +
        products.map(p => `<option value="${p}">${p}</option>`).join('');
    if (currentValue && (currentValue === '__all__' || products.includes(currentValue))) {
        sel.value = currentValue;
    } else {
        sel.value = '__all__';
    }
}
window.populateAIInsightsProductOptions = populateAIInsightsProductOptions;

// 현재 선택된 제품/캠페인 기준으로 인사이트 대상 리스트 필터링
// ★ AI 인사이트 섹션 통합 필터 (ai scope) — 제품/캠페인 자동 반영
// ★ 광고명(ad_name) 단위로 합산 — 캠페인이 달라도 같은 소재는 하나로
//   소구포인트/훅/감정도 자주 반복되는 포인트로 종합됨 (aggregateByAdName 내부)
function getAIInsightsList() {
    let baseList = (typeof getBrandCreatives === 'function')
        ? getBrandCreatives('ai')                    // ★ ai scope: 섹션 제품+캠페인 필터 자동 적용
        : (window.allCreatives || []);
    // ★ 광고명 단위 합산 (캠페인이 달라도 같은 소재면 통합)
    if (typeof window.aggregateByAdName === 'function') {
        baseList = window.aggregateByAdName(baseList);
    }
    return baseList;
}

// 메인 렌더 함수
function renderAIInsights() {
    const section = document.getElementById('ai-insights-section');
    if (!section) return;

    // 제품 드롭다운 옵션 채우기 (브랜드 변경 시에도 갱신됨)
    populateAIInsightsProductOptions();

    const list = getAIInsightsList();

    // 빈 상태 placeholder를 위한 컨테이너 헬퍼
    const clearChildren = (id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    };

    if (!hasAiData(list)) {
        // 드롭다운/헤더는 유지하고 내부 컨테이너만 비움 + 안내 카드 표시
        // ★ 섹션 통합 필터 상태(window.aiProduct/aiCampaign) 기준으로 안내 메시지 결정
        const aiProdSel = document.getElementById('ai-product-select');
        const aiCampSel = document.getElementById('ai-campaign-select');
        const isFiltered = !!((aiProdSel && aiProdSel.value) || (aiCampSel && aiCampSel.value));
        const successEl = document.getElementById('success-patterns');
        if (successEl) {
            successEl.innerHTML = `
                <div class="col-span-3 bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200 rounded-xl p-8 text-center">
                    <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white shadow-sm mb-3">
                        <i class="fas fa-magic-wand-sparkles text-3xl text-purple-500"></i>
                    </div>
                    <h3 class="text-lg font-bold text-slate-900 mb-2">
                        ${isFiltered ? '선택한 필터 조건의 AI 인사이트 데이터가 없습니다' : 'AI 인사이트 데이터가 없습니다'}
                    </h3>
                    <p class="text-sm text-slate-600 mb-4">
                        ${isFiltered
                            ? '제품·캠페인 필터를 조정하거나 초기화 버튼을 눌러주세요.'
                            : 'Google Sheets에 <code class="bg-white px-2 py-0.5 rounded">appeal_points</code>, <code class="bg-white px-2 py-0.5 rounded">hook_type</code>, <code class="bg-white px-2 py-0.5 rounded">target_emotion</code> 컬럼을 추가하고<br>Apps Script로 AI 분석을 실행해주세요.'}
                    </p>
                </div>
            `;
        }
        // 차트/메시지 영역 비우기
        ['appealWordCloud', 'top-messages'].forEach(clearChildren);
        ['appealRoas', 'hookCtr', 'emotion'].forEach(k => destroyInsightChart && destroyInsightChart(k));
        return;
    }

    // ★ 모든 인사이트 차트/카드의 선정 기준을 "중앙값 광고비 이상"으로 통일
    const _insightThreshold = computeInsightThreshold(list);

    // ★ 키워드 → 소재 매핑 빌드 (hover preview용) — 중앙값 기준 대표 소재 선정
    buildKeywordCreativeMap(list);

    renderSuccessPatterns(list);
    renderAppealRoasChart(list);
    renderAppealWordCloud(list);
    bindWordCloudMetricSelect();
    renderHookCtrChart(list);
    renderEmotionChart(list);
    renderTopMessages(list);

    // 선정 기준 안내 배지 갱신
    renderInsightThresholdBadge();

    // ★ 차트별 지표 셀렉트 바인딩 (최초 1회)
    bindInsightChartSelects();

    // ★ hover preview 이벤트 바인딩
    attachInsightHoverEvents();
}

// ★ 차트별 지표 셀렉트 바인딩
function bindInsightChartSelects() {
    [
        { selId: 'appeal-metric-select',  lblId: 'appeal-metric-lbl',  chartKey: 'appeal'  },
        { selId: 'hook-metric-select',    lblId: 'hook-metric-lbl',    chartKey: 'hook'    },
        { selId: 'emotion-metric-select', lblId: 'emotion-metric-lbl', chartKey: 'emotion' },
    ].forEach(({ selId, lblId, chartKey }) => {
        const sel = document.getElementById(selId);
        if (!sel || sel.dataset.bound === '1') return;
        sel.dataset.bound = '1';

        sel.addEventListener('change', () => {
            chartMetrics[chartKey] = sel.value || 'roas';
            // 차트 제목 업데이트
            const lbl = document.getElementById(lblId);
            if (lbl) lbl.textContent = (INSIGHT_METRIC_CFG[chartMetrics[chartKey]] || INSIGHT_METRIC_CFG.roas).label;
            // 해당 차트만 재렌더
            const list = getAIInsightsList();
            if (chartKey === 'appeal')       renderAppealRoasChart(list);
            else if (chartKey === 'hook')    renderHookCtrChart(list);
            else                             renderEmotionChart(list);
            renderSuccessPatterns(list);
            attachInsightHoverEvents();
        });

        // 초기 값 동기화
        sel.value = chartMetrics[chartKey] || 'roas';
        const lbl = document.getElementById(lblId);
        if (lbl) lbl.textContent = (INSIGHT_METRIC_CFG[chartMetrics[chartKey]] || INSIGHT_METRIC_CFG.roas).label;
    });
}

// 선정 기준 안내 (헤더 옆에 칩으로 표시)
function renderInsightThresholdBadge() {
    let badge = document.getElementById('ai-insight-threshold-badge');
    const header = document.querySelector('#ai-insights-section .flex.items-center.justify-between');
    if (!header) return;
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'ai-insight-threshold-badge';
        badge.className = 'ai-threshold-badge';
        header.parentNode.insertBefore(badge, header.nextSibling);
    }
    const med = Math.round(currentInsightMedian || 0);
    const thr = Math.round(currentInsightThreshold || 0);
    if (thr > 0) {
        const formatNum = (typeof window.formatNumber === 'function') ? window.formatNumber : (n => n.toLocaleString());
        badge.innerHTML = `
            <i class="fas fa-filter"></i>
            <span>선정 기준: 광고비 중앙값 <b>₩${formatNum(med)}</b> 이상 소재만 분석</span>
            <span class="ai-threshold-divider">·</span>
            <span class="ai-threshold-sub">적용 임계값 <b>₩${formatNum(thr)}</b></span>
        `;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

// ============================
// 인사이트 요소에 hover preview 이벤트 부착
// ============================
function attachInsightHoverEvents() {
    // 1) 성공 패턴 카드 3종
    const successCards = document.querySelectorAll('#success-patterns .pattern-card');
    successCards.forEach(card => {
        const fieldMap = {
            'pattern-purple': 'appeal_points',
            'pattern-cyan':   'hook_type',
            'pattern-rose':   'target_emotion'
        };
        const field = Object.keys(fieldMap).find(cls => card.classList.contains(cls));
        if (!field) return;
        const valueEl = card.querySelector('.pattern-value');
        const keyword = valueEl ? valueEl.textContent.trim() : '';
        if (!keyword || keyword === '-') return;
        card.style.cursor = 'pointer';
        card.addEventListener('mouseenter', e => showPreview(keyword, fieldMap[field], e));
        card.addEventListener('mouseleave', hidePreview);
    });

    // 2) 워드클라우드 (소구포인트)
    const wordItems = document.querySelectorAll('#appealWordCloud .word-item');
    bindHoverPreview(
        Array.from(wordItems),
        el => el.textContent.trim(),
        'appeal_points'
    );

    // 3) TOP 메시지 행 (소구포인트 칩에 hover)
    const messageRows = document.querySelectorAll('#top-messages .message-row');
    messageRows.forEach(row => {
        const chips = row.querySelectorAll('.appeal-chip');
        chips.forEach(chip => {
            chip.style.cursor = 'pointer';
            const kw = chip.textContent.trim();
            chip.addEventListener('mouseenter', e => showPreview(kw, 'appeal_points', e));
            chip.addEventListener('mouseleave', hidePreview);
        });
    });

    // 4) 차트 hover는 Chart.js onHover 콜백으로 처리 (각 render 함수에서 설정됨)
    //    + canvas에서 마우스가 완전히 벗어날 때 preview 닫기
    ['appealRoasChart', 'hookCtrChart', 'emotionChart'].forEach(id => {
        const cv = document.getElementById(id);
        if (cv) {
            cv.addEventListener('mouseleave', hidePreview);
            // 차트 클릭 시 첫 번째 대표 소재 모달 열기
            cv.addEventListener('click', e => {
                const chartKey = id === 'appealRoasChart' ? 'appealRoas'
                               : id === 'hookCtrChart' ? 'hookCtr' : 'emotion';
                const fieldKey = id === 'appealRoasChart' ? 'appeal_points'
                               : id === 'hookCtrChart' ? 'hook_type' : 'target_emotion';
                const chart = insightCharts[chartKey];
                if (!chart) return;
                const els = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
                if (!els.length) return;
                const label = chart.data.labels[els[0].index];
                const items = keywordCreativeMap[fieldKey].get(label);
                if (items && items.length && typeof window.openModal === 'function') {
                    window.openModal(items[0].id);
                }
            });
        }
    });
}

// 성공 패턴 카드 (3개)
// ★ canvas를 유지하면서 no-data 메시지 표시/숨김 헬퍼
function _showChartNoData(ctx, message) {
    const parent = ctx.parentElement;
    let msg = parent.querySelector('.chart-no-data-msg');
    if (!msg) {
        msg = document.createElement('div');
        msg.className = 'chart-no-data-msg text-center text-slate-400 text-sm py-12';
        parent.appendChild(msg);
    }
    msg.textContent = message;
    msg.style.display = '';
    ctx.style.display = 'none';
}
function _hideChartNoData(ctx) {
    const parent = ctx.parentElement;
    const msg = parent.querySelector('.chart-no-data-msg');
    if (msg) msg.style.display = 'none';
    ctx.style.display = '';
}

// ★ AI 인사이트 공용 바 차트 렌더러 — metric 파라미터로 차트별 지표 지정
function _renderInsightBarChart(chartKey, canvasId, list, fieldName, maxItems, metric) {
    destroyInsightChart(chartKey);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const cfg = INSIGHT_METRIC_CFG[metric] || INSIGHT_METRIC_CFG.roas;
    const key = cfg.key;
    const sortFn = cfg.lowerBetter
        ? (a, b) => (a[key] || 0) - (b[key] || 0)
        : (a, b) => (b[key] || 0) - (a[key] || 0);
    const validFilter = d => (d[key] || 0) > 0;

    const _threshold = currentInsightThreshold || INSIGHT_MIN_SPEND;
    let data = aggregateByKeyword(list, fieldName, { threshold: _threshold })
        .filter(a => a.count >= 3 && validFilter(a)).sort(sortFn).slice(0, maxItems);
    if (data.length < 5) {
        data = aggregateByKeyword(list, fieldName, { threshold: _threshold })
            .filter(a => a.count >= 2 && validFilter(a)).sort(sortFn).slice(0, maxItems);
    }
    if (data.length < 5) {
        data = aggregateByKeyword(list, fieldName, { threshold: _threshold })
            .filter(a => a.count >= 1 && validFilter(a)).sort(sortFn).slice(0, maxItems);
    }

    if (!data.length) {
        // ✅ canvas 파괴 방지 — 메시지를 별도 div로 표시
        _showChartNoData(ctx, `${cfg.label} 데이터 없음`);
        return;
    }
    _hideChartNoData(ctx);

    const vals = data.map(d => cfg.fmtVal(d[key] || 0));
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const domain = computeCompressedDomain(vals, { paddingRatio: 0.18, minPadding: cfg.minPad });

    const goodColor = `hsla(${cfg.hue}, ${cfg.sat}, 55%, 0.92)`;
    const weakColor = 'hsla(220, 18%, 65%, 0.78)';
    const midColor  = `hsla(${cfg.hue}, ${cfg.sat}, 65%, 0.80)`;
    const THRESHOLD = 0.05;

    const colors = vals.map(v => {
        if (mean === 0) return midColor;
        const dev = (v - mean) / mean;
        if (cfg.lowerBetter) {
            if (dev <= -THRESHOLD) return goodColor;
            if (dev >= THRESHOLD) return weakColor;
        } else {
            if (dev >= THRESHOLD) return goodColor;
            if (dev <= -THRESHOLD) return weakColor;
        }
        return midColor;
    });

    insightCharts[chartKey] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => d.keyword),
            datasets: [{
                label: `평균 ${cfg.label} ${cfg.unitLabel}`,
                data: vals,
                backgroundColor: colors,
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { right: 56 } },
            animation: { duration: 400 },
            onHover: (evt, els) => {
                if (els && els.length) {
                    showPreview(data[els[0].index].keyword, fieldName, evt.native || evt);
                    evt.native.target.style.cursor = 'pointer';
                } else {
                    hidePreview();
                    if (evt.native) evt.native.target.style.cursor = 'default';
                }
            },
            plugins: {
                legend: { display: false },
                meanLine: {
                    value: Number(mean.toFixed(2)),
                    axis: 'x',
                    label: `평균 ${cfg.fmtMean(mean)}`,
                    color: 'rgba(100, 116, 139, 0.85)'
                },
                tooltip: {
                    callbacks: {
                        afterLabel: (tCtx) => {
                            const d = data[tCtx.dataIndex];
                            const dev = vals[tCtx.dataIndex] - mean;
                            return [
                                `평균 대비: ${cfg.fmtDev(dev)}`,
                                `사용 소재: ${d.count}개`,
                                `광고비: ₩${formatNumber(d.spend)}`,
                                `매출: ₩${formatNumber(d.revenue)}`,
                            ];
                        }
                    }
                },
                datalabels: false,
            },
            scales: {
                x: {
                    min: domain.min,
                    max: domain.max,
                    ticks: { callback: v => cfg.fmtTick(v), font: { size: 10 } },
                    grid: { color: 'rgba(226, 232, 240, 0.6)' }
                },
                y: { ticks: { font: { size: 11 } }, grid: { display: false } }
            }
        },
        plugins: [{
            id: 'barEndLabels',
            afterDatasetsDraw(chart) {
                const { ctx: c } = chart;
                const meta = chart.getDatasetMeta(0);
                c.save();
                c.font = '600 11px Pretendard, sans-serif';
                c.textBaseline = 'middle';
                c.textAlign = 'left';
                meta.data.forEach((bar, i) => {
                    const v = vals[i];
                    const dev = v - mean;
                    const isBetter = cfg.lowerBetter ? dev < 0 : dev > 0;
                    c.fillStyle = isBetter ? `hsl(${cfg.hue}, 60%, 38%)` : '#64748b';
                    c.fillText(`${cfg.fmtTick(v)}  (${cfg.fmtDev(dev)})`, bar.x + 6, bar.y);
                });
                c.restore();
            }
        }]
    });
}

function renderSuccessPatterns(list) {
    const container = document.getElementById('success-patterns');
    if (!container) return;

    // 각 카드는 해당 차트의 현재 지표를 기준으로 TOP 키워드 표시
    const getTop = (field, metricKey) => {
        const cfg = INSIGHT_METRIC_CFG[metricKey] || INSIGHT_METRIC_CFG.roas;
        const k = cfg.key;
        const sortFn = cfg.lowerBetter
            ? (a, b) => (a[k] || 0) - (b[k] || 0)
            : (a, b) => (b[k] || 0) - (a[k] || 0);
        const _threshold = currentInsightThreshold || INSIGHT_MIN_SPEND;
        const item = aggregateByKeyword(list, field, { threshold: _threshold })
            .filter(a => a.count >= 1 && (a[k] || 0) > 0)
            .sort(sortFn)[0];
        return { item, cfg };
    };

    const { item: topAppeal,  cfg: cfgA } = getTop('appeal_points', chartMetrics.appeal);
    const { item: topHook,    cfg: cfgH } = getTop('hook_type',     chartMetrics.hook);
    const { item: topEmotion, cfg: cfgE } = getTop('target_emotion', chartMetrics.emotion);

    const statLine = (item, cfg) => item
        ? `${cfg.label} <b>${cfg.fmtMean(cfg.fmtVal(item[cfg.key] || 0))}</b> · ${item.count}개 소재`
        : '데이터 없음';

    container.innerHTML = `
        <div class="pattern-card pattern-purple">
            <div class="pattern-icon"><i class="fas fa-trophy"></i></div>
            <div class="pattern-label">최고 효율 소구포인트 <span class="pattern-metric-badge">${cfgA.label} 기준</span></div>
            <div class="pattern-value">${topAppeal ? topAppeal.keyword : '-'}</div>
            <div class="pattern-stats">${statLine(topAppeal, cfgA)}</div>
            <div class="pattern-recommend">
                <i class="fas fa-lightbulb mr-1"></i>
                ${topAppeal ? `"${topAppeal.keyword}" 소구포인트의 신규 소재 제작을 추천합니다` : ''}
            </div>
        </div>
        <div class="pattern-card pattern-cyan">
            <div class="pattern-icon"><i class="fas fa-fish"></i></div>
            <div class="pattern-label">최고 효율 후킹 방식 <span class="pattern-metric-badge">${cfgH.label} 기준</span></div>
            <div class="pattern-value">${topHook ? topHook.keyword : '-'}</div>
            <div class="pattern-stats">${statLine(topHook, cfgH)}</div>
            <div class="pattern-recommend">
                <i class="fas fa-lightbulb mr-1"></i>
                ${topHook ? `"${topHook.keyword}" 방식을 다른 소구포인트에도 적용해보세요` : ''}
            </div>
        </div>
        <div class="pattern-card pattern-rose">
            <div class="pattern-icon"><i class="fas fa-heart"></i></div>
            <div class="pattern-label">최고 효율 감정 코드 <span class="pattern-metric-badge">${cfgE.label} 기준</span></div>
            <div class="pattern-value">${topEmotion ? topEmotion.keyword : '-'}</div>
            <div class="pattern-stats">${statLine(topEmotion, cfgE)}</div>
            <div class="pattern-recommend">
                <i class="fas fa-lightbulb mr-1"></i>
                ${topEmotion ? `"${topEmotion.keyword}" 감정 자극 카피를 강화해보세요` : ''}
            </div>
        </div>
    `;
}

// ★ 평균선 플러그인 (Chart.js) — 평균 대비 차이를 시각적으로 확인
const meanLinePlugin = {
    id: 'meanLine',
    afterDraw(chart, args, opts) {
        if (!opts || opts.value == null) return;
        const { ctx, chartArea: { top, bottom, left, right }, scales } = chart;
        const isHorizontal = opts.axis === 'x';
        const scale = isHorizontal ? scales.x : scales.y;
        if (!scale) return;
        const pos = scale.getPixelForValue(opts.value);
        ctx.save();
        ctx.strokeStyle = opts.color || 'rgba(100, 116, 139, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        if (isHorizontal) {
            ctx.moveTo(pos, top);
            ctx.lineTo(pos, bottom);
        } else {
            ctx.moveTo(left, pos);
            ctx.lineTo(right, pos);
        }
        ctx.stroke();
        // 라벨
        ctx.setLineDash([]);
        ctx.fillStyle = opts.color || 'rgba(71, 85, 105, 0.95)';
        ctx.font = '11px Pretendard, sans-serif';
        const label = opts.label || `평균 ${opts.value}`;
        if (isHorizontal) {
            ctx.textAlign = 'left';
            ctx.fillText(label, pos + 4, top + 12);
        } else {
            ctx.textAlign = 'right';
            ctx.fillText(label, right - 6, pos - 4);
        }
        ctx.restore();
    }
};
if (typeof Chart !== 'undefined' && Chart.register) {
    try { Chart.register(meanLinePlugin); } catch(e){}
}

// ★ 도메인 압축 헬퍼: 값 분포의 min~max로 축 범위 산정 (차이 강조)
function computeCompressedDomain(values, opts = {}) {
    const { paddingRatio = 0.15, minPadding = 2, forceZero = false } = opts;
    if (!values.length) return { min: 0, max: 100 };
    const vMin = Math.min(...values);
    const vMax = Math.max(...values);
    const range = Math.max(1, vMax - vMin);
    const pad = Math.max(minPadding, range * paddingRatio);
    let min = forceZero ? 0 : Math.max(0, vMin - pad);
    let max = vMax + pad;
    // 최소 차이가 있도록
    if (max - min < range * 2) max = min + range * 2.2;
    return { min: Math.floor(min), max: Math.ceil(max) };
}

// 소구포인트별 지표 차트 (차트별 독립 지표 — chartMetrics.appeal)
function renderAppealRoasChart(list) {
    _renderInsightBarChart('appealRoas', 'appealRoasChart', list, 'appeal_points', 10, chartMetrics.appeal);
}

// 소구포인트 워드클라우드 (HTML 기반) — 키워드 군집화 적용
// ★ 비슷한 키워드는 공통 핵심 토큰으로 군집화하여 대표 키워드 1개로 표현
//   예: "탄력 있는 피부", "끈적임 없는 탄력 피부", "피부 탄력 증진" → "탄력" 클러스터로 통합
const APPEAL_STOP_WORDS = new Set([
    '개선', '향상', '효과', '증진', '강화', '있는', '없는', '및',
    '같은', '하는', '되는', '느낌', '관리', '케어', '느낌의',
    '동시', '동시에', '높은', '낮은', '제공', '연출', '주는', '주며',
    '위한', '통한', '으로', '에서', '에게', '에도', '에는', '으로의',
    '그리고', '또는', '대한', '대해', '같이', '함께', '모두', '여러',
    '많은', '적은', '강한', '약한', '좋은', '나쁜', '쉬운', '어려운',
    '빠른', '느린', '풍부', '풍부한', '다양', '다양한', '특별', '특별한'
]);

function extractAppealTokens(keyword) {
    if (!keyword) return [];
    return String(keyword)
        .split(/[\s,·・、，/\\\-()\[\]]+/)
        .map(s => s.trim())
        .filter(s => s.length >= 2 && !APPEAL_STOP_WORDS.has(s));
}

// 키워드 리스트를 핵심 토큰 기반으로 군집화
function clusterAppealKeywords(items) {
    // 1) 각 아이템에 토큰 부착
    const withTokens = items.map(item => ({
        ...item,
        _tokens: extractAppealTokens(item.keyword)
    }));

    // 2) 토큰별 출현 빈도 — 가장 흔한 토큰이 클러스터 후보
    const tokenFreq = new Map();
    withTokens.forEach(item => {
        const seen = new Set();
        item._tokens.forEach(t => {
            if (seen.has(t)) return;
            seen.add(t);
            tokenFreq.set(t, (tokenFreq.get(t) || 0) + item.count);
        });
    });

    // 3) 각 아이템을 "자신의 토큰 중 가장 빈도 높은 토큰"으로 배정
    const clusterMap = new Map();
    withTokens.forEach(item => {
        let bestToken = null;
        let bestScore = -1;
        item._tokens.forEach(t => {
            const score = tokenFreq.get(t) || 0;
            if (score > bestScore) {
                bestScore = score;
                bestToken = t;
            }
        });
        // 토큰이 전혀 없거나 빈도가 1뿐이면 자기 자신을 클러스터로
        const clusterKey = bestToken && bestScore > item.count ? bestToken : item.keyword;
        if (!clusterMap.has(clusterKey)) {
            clusterMap.set(clusterKey, {
                clusterKey,
                members: [],
                count: 0,
                spend: 0,
                revenue: 0,
                impressions: 0,
                clicks: 0,
                conversions: 0
            });
        }
        const cluster = clusterMap.get(clusterKey);
        cluster.members.push(item);
        cluster.count += item.count;
        cluster.spend += item.spend;
        cluster.revenue += item.revenue;
        cluster.impressions += item.impressions;
        cluster.clicks += item.clicks;
        cluster.conversions += item.conversions;
    });

    // 4) 각 클러스터에서 대표 키워드 선정 (count 최다 → 가장 짧은 표현)
    return Array.from(clusterMap.values()).map(cluster => {
        const sortedMembers = [...cluster.members].sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return a.keyword.length - b.keyword.length;
        });
        const rep = sortedMembers[0];
        // 멤버가 1개뿐이면 원본 키워드 사용, 여러 개면 클러스터 토큰 우선
        const isMerged = cluster.members.length > 1;
        const displayKeyword = isMerged ? cluster.clusterKey : rep.keyword;
        return {
            keyword: displayKeyword,
            isCluster: isMerged,
            clusterSize: cluster.members.length,
            members: sortedMembers.map(m => m.keyword),
            count: cluster.count,
            spend: cluster.spend,
            revenue: cluster.revenue,
            impressions: cluster.impressions,
            clicks: cluster.clicks,
            conversions: cluster.conversions,
            roas: cluster.spend > 0 ? (cluster.revenue / cluster.spend) : 0,
            ctr: cluster.impressions > 0 ? (cluster.clicks / cluster.impressions) : 0,
            cvr: cluster.clicks > 0 ? (cluster.conversions / cluster.clicks) : 0,
            cpa: cluster.conversions > 0 ? Math.round(cluster.spend / cluster.conversions) : 0
        };
    });
}

// ★ 워드맵 지표 선택 상태 (revenue/conversions/clicks/impressions/count)
let _wordcloudMetric = 'revenue';
let _wordcloudLastList = null; // 지표 변경 시 재렌더용 캐시

const METRIC_LABEL_MAP = {
    revenue: { label: '매출', short: '매출', format: v => '₩' + formatNumber(v || 0) },
    conversions: { label: '전환수', short: '전환', format: v => formatNumber(v || 0) + '회' },
    clicks: { label: '클릭수', short: '클릭', format: v => formatNumber(v || 0) + '회' },
    impressions: { label: '노출수', short: '노출', format: v => formatNumber(v || 0) },
    count: { label: '사용 빈도', short: '빈도', format: v => (v || 0) + '회' },
};

function renderAppealWordCloud(list) {
    const container = document.getElementById('appealWordCloud');
    if (!container) return;
    _wordcloudLastList = list; // 캐시

    // 1) 원본 키워드별 집계 — ★ 최소 3개 이상 소재 검증
    const _wcThreshold = currentInsightThreshold || INSIGHT_MIN_SPEND;
    let rawData = aggregateByKeyword(list, 'appeal_points', { threshold: _wcThreshold })
        .filter(a => a.count >= 3);
    if (rawData.length < 5) {
        // fallback 1단계: ≥2
        rawData = aggregateByKeyword(list, 'appeal_points', { threshold: _wcThreshold })
            .filter(a => a.count >= 2);
    }
    if (rawData.length < 5) {
        // fallback 2단계: ≥1
        rawData = aggregateByKeyword(list, 'appeal_points', { threshold: _wcThreshold })
            .filter(a => a.count >= 1);
    }

    if (!rawData.length) {
        container.innerHTML = '<div class="text-center text-slate-400 text-sm py-12">데이터 없음 (최소 3개 이상 소재 필요)</div>';
        return;
    }

    // 2) 군집화
    const metric = _wordcloudMetric;
    const metricCfg = METRIC_LABEL_MAP[metric] || METRIC_LABEL_MAP.revenue;

    // 3) 선택 지표 기준 정렬 → 상위 20개 (군집은 멤버 누적이라 ≥3 자동 충족)
    const clustered = clusterAppealKeywords(rawData)
        .filter(d => (d[metric] || 0) > 0 && d.count >= 3)
        .sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
        .slice(0, 20);

    if (!clustered.length) {
        container.innerHTML = `<div class="text-center text-slate-400 text-sm py-12">${metricCfg.label} 데이터 없음</div>`;
        return;
    }

    // 4) 선택 지표의 max/min으로 폰트 크기 비례
    const maxVal = clustered[0][metric] || 1;
    const minVal = clustered[clustered.length - 1][metric] || 0;
    const range = Math.max(1, maxVal - minVal);

    // 5) ROAS 기준 색상 차등 (효율 좋은 키워드는 진한 초록, 낮은 키워드는 회색)
    container.innerHTML = clustered.map((d, i) => {
        const ratio = (d[metric] - minVal) / range; // 0~1
        // 폰트 크기: sqrt로 부드럽게 (한 키워드 압도 방지)
        const size = 14 + Math.sqrt(ratio) * 26; // 14px ~ 40px
        const weight = 400 + Math.round(ratio * 4) * 100;

        const roasPct = Math.round((d.roas || 0) * 100);
        // ROAS 기준 색상 (성과 효율을 색으로, 모수는 크기로)
        const color = d.roas >= 4
            ? `hsl(${145 + i * 3}, 65%, 42%)`     // 진한 초록
            : d.roas >= 2.5
                ? `hsl(${35 + i * 3}, 78%, 48%)`  // 노랑/오렌지
                : d.roas >= 1
                    ? `hsl(${215 + i * 3}, 55%, 55%)` // 푸른빛
                    : `hsl(${0 + i * 3}, 55%, 55%)`;  // 빨강 (ROAS<1)

        // 클러스터 표시 배지
        const badge = d.isCluster
            ? `<sup class="word-cluster-badge" style="font-size:${Math.max(9, size * 0.38)}px;color:${color};opacity:0.7;font-weight:600;margin-left:2px;">×${d.clusterSize}</sup>`
            : '';
        // 선택 지표값을 작은 글씨로 같이 노출
        const metricValSpan = `<sub class="word-metric-val" style="font-size:${Math.max(9, size * 0.32)}px;color:${color};opacity:0.7;font-weight:500;margin-left:3px;">${metricCfg.format(d[metric])}</sub>`;

        const memberList = d.isCluster
            ? `\n[묶인 키워드]\n${d.members.slice(0, 6).join(', ')}${d.members.length > 6 ? ' 외' : ''}`
            : '';
        const title = `${d.keyword}${d.isCluster ? ` (${d.clusterSize}개 묶음)` : ''}`
            + `\n${metricCfg.label}: ${metricCfg.format(d[metric])}`
            + `\nROAS ${roasPct}% · 사용 ${d.count}회`
            + memberList;

        return `<span class="word-item" data-cluster="${d.isCluster ? '1' : '0'}" style="font-size:${size}px;font-weight:${weight};color:${color}" title="${title.replace(/"/g, '&quot;')}">${d.keyword}${badge}${metricValSpan}</span>`;
    }).join('');
}

// 워드맵 지표 셀렉트 이벤트 바인딩 (1회만)
function bindWordCloudMetricSelect() {
    const sel = document.getElementById('wordcloud-metric-select');
    if (!sel || sel.dataset.bound === '1') return;
    sel.dataset.bound = '1';
    sel.addEventListener('change', () => {
        _wordcloudMetric = sel.value || 'revenue';
        if (_wordcloudLastList) renderAppealWordCloud(_wordcloudLastList);
    });
}

// 후킹 방식별 지표 차트 (차트별 독립 지표 — chartMetrics.hook)
function renderHookCtrChart(list) {
    _renderInsightBarChart('hookCtr', 'hookCtrChart', list, 'hook_type', 10, chartMetrics.hook);
}

// 감정별 지표 차트 (차트별 독립 지표 — chartMetrics.emotion)
function renderEmotionChart(list) {
    _renderInsightBarChart('emotion', 'emotionChart', list, 'target_emotion', 8, chartMetrics.emotion);
}

// TOP 성과 카피 메시지
function renderTopMessages(list) {
    const container = document.getElementById('top-messages');
    if (!container) return;

    // ★ 중앙값(median spend) 이상 광고비 집행된 소재만 후보로
    const threshold = currentInsightThreshold || INSIGHT_MIN_SPEND;
    let pool = list.filter(c => (Number(c.spend) || 0) >= threshold);
    // 후보가 5개 미만이면 전체 리스트로 폴백 (메시지 비는 것 방지)
    if (pool.length < 5) pool = list;

    // ROAS 기준 정렬된 후보군
    const candidates = pool
        .filter(c => c.key_message_kr || c.key_message_jp)
        .sort((a, b) => (b.roas || 0) - (a.roas || 0));

    // ★ ad_name + key_message 기준 중복 제거 (같은 소재의 동일 카피가 여러 번 나오는 것 방지)
    const seenAdNames = new Set();
    const seenMessages = new Set();
    const top = [];
    for (const c of candidates) {
        const adKey = (c.ad_name || c.creative_name || '').trim().toLowerCase();
        const msgKey = ((c.key_message_kr || c.key_message_jp || '') + '')
            .trim().toLowerCase().slice(0, 60);
        // 동일 ad_name 이미 있으면 스킵
        if (adKey && seenAdNames.has(adKey)) continue;
        // 동일 메시지(앞 60자)도 스킵 — 카피 표현이 거의 같은 경우
        if (msgKey && seenMessages.has(msgKey)) continue;
        if (adKey) seenAdNames.add(adKey);
        if (msgKey) seenMessages.add(msgKey);
        top.push(c);
        if (top.length >= 5) break;
    }
    // 다양성 필터로 5개를 못 채우면 ad_name 기준만으로 fallback
    if (top.length < 5) {
        const seenAd = new Set(top.map(c => (c.ad_name || c.creative_name || '').trim().toLowerCase()));
        for (const c of candidates) {
            if (top.length >= 5) break;
            const adKey = (c.ad_name || c.creative_name || '').trim().toLowerCase();
            if (adKey && seenAd.has(adKey)) continue;
            if (adKey) seenAd.add(adKey);
            top.push(c);
        }
    }

    if (!top.length) {
        container.innerHTML = '<div class="text-center text-slate-400 text-sm py-6">카피 메시지 데이터가 없습니다</div>';
        return;
    }

    container.innerHTML = top.map((c, i) => {
        const rank = i + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
        const appeals = normalizeKeywords(c.appeal_points).slice(0, 3).map(a =>
            `<span class="appeal-chip">${a}</span>`).join('');
        return `
            <div class="message-row">
                <div class="message-rank">${medal}</div>
                <div class="message-body">
                    <div class="message-kr">"${c.key_message_kr || c.key_message_jp || '-'}"</div>
                    ${c.key_message_jp && c.key_message_kr ? `<div class="message-jp">🇯🇵 ${c.key_message_jp}</div>` : ''}
                    <div class="message-appeals">${appeals}</div>
                </div>
                <div class="message-stats">
                    <div class="stat-pill"><span>ROAS</span><b>${Math.round((c.roas || 0) * 100)}%</b></div>
                    <div class="stat-pill"><span>CTR</span><b>${((c.ctr || 0) * 100).toFixed(2)}%</b></div>
                    <div class="brand-badge ${c.brand}" style="position:static;">${c.brand}</div>
                </div>
            </div>
        `;
    }).join('');
}

// formatNumber 폴백
if (typeof window.formatNumber !== 'function') {
    window.formatNumber = function(num) {
        if (num == null) return '0';
        if (num >= 100000000) return (num / 100000000).toFixed(1) + '억';
        if (num >= 10000) return (num / 10000).toFixed(1) + '만';
        return Number(num).toLocaleString('ko-KR');
    };
}

// 전역 노출
window.renderAIInsights = renderAIInsights;
// hover preview 시스템 — 다른 컨텐츠(제품별 소구포인트 인사이트 등)에서 재사용
window.showInsightPreview = showPreview;
window.hideInsightPreview = hidePreview;
window.forceHideInsightPreview = forceHidePreview;
window.buildKeywordCreativeMap = buildKeywordCreativeMap;
// keywordCreativeMap은 클로저 변수이므로 getter로 노출
window.getKeywordCreativeMap = () => keywordCreativeMap;
window.computeInsightThreshold = computeInsightThreshold;
