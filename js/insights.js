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
        key: 'roas', label: '광고효율(ROAS)', unitLabel: '(%)', lowerBetter: false,
        hue: 265, sat: '75%', minPad: 30,
        fmtVal:  v => Math.round(v * 100),
        fmtTick: v => v + '%',
        fmtMean: v => Math.round(v) + '%',
        fmtDev:  dev => (dev >= 0 ? '+' : '') + Math.round(dev) + '%p',
    },
    ctr: {
        key: 'ctr', label: '클릭률(CTR)', unitLabel: '(%)', lowerBetter: false,
        hue: 195, sat: '78%', minPad: 0.3,
        fmtVal:  v => Number((v * 100).toFixed(2)),
        fmtTick: v => v + '%',
        fmtMean: v => Number(v).toFixed(2) + '%',
        fmtDev:  dev => (dev >= 0 ? '+' : '') + Number(dev).toFixed(2) + '%p',
    },
    cvr: {
        key: 'cvr', label: '구매전환율(CVR)', unitLabel: '(%)', lowerBetter: false,
        hue: 350, sat: '75%', minPad: 0.3,
        fmtVal:  v => Number((v * 100).toFixed(2)),
        fmtTick: v => v + '%',
        fmtMean: v => Number(v).toFixed(2) + '%',
        fmtDev:  dev => (dev >= 0 ? '+' : '') + Number(dev).toFixed(2) + '%p',
    },
    cpa: {
        key: 'cpa', label: 'CPA(전환당 비용)', unitLabel: '(₩)', lowerBetter: true,
        hue: 35, sat: '85%', minPad: 1000,
        fmtVal:  v => Math.round(v),
        fmtTick: v => '₩' + Math.round(v).toLocaleString(),
        fmtMean: v => '₩' + Math.round(v).toLocaleString(),
        fmtDev:  dev => (dev >= 0 ? '+' : '-') + '₩' + Math.round(Math.abs(dev)).toLocaleString(),
    },
    atc_rate: {
        key: 'atc_rate', label: '장바구니 담기율', unitLabel: '(%)', lowerBetter: false,
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

// 키워드(또는 클러스터 멤버들) 기준 대표 소재 조회
// - 클러스터로 묶인 워드맵 항목은 대표 keyword 자체가 keywordCreativeMap에 없을 수 있어
//   members(원본 키워드 목록)을 합쳐서 ROAS 상위 3개를 다시 산출
function getKeywordCreatives(field, keyword, members) {
    const map = keywordCreativeMap[field];
    if (!map) return [];
    let items = map.get(keyword) || [];
    if (!items.length && Array.isArray(members) && members.length) {
        const seen = new Set();
        const merged = [];
        members.forEach(m => {
            (map.get(m) || []).forEach(c => {
                const id = c.id || c.ad_name || '';
                if (seen.has(id)) return;
                seen.add(id);
                merged.push(c);
            });
        });
        items = merged.sort((a, b) => (b.roas || 0) - (a.roas || 0)).slice(0, 3);
    }
    return items;
}

function buildPreviewHtml(keyword, field, members) {
    const items = getKeywordCreatives(field, keyword, members);
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

function showPreview(keyword, field, evt, members) {
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
    el.innerHTML = buildPreviewHtml(keyword, field, members);

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
    const items = getKeywordCreatives(field, keyword, members);
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
function bindHoverPreview(elements, getKeyword, field, getMembers) {
    elements.forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('mouseenter', e => {
            const kw = getKeyword(el);
            const members = typeof getMembers === 'function' ? getMembers(el) : null;
            if (kw) showPreview(kw, field, e, members);
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

// 소구포인트 키워드 유사도 기반 중복 제거
// - 정규화: 공백·조사·접미사(형·적인·형의·맞춤) 제거 → 핵심 토큰 추출
// - Jaccard 유사도 ≥ 0.65 → 같은 클러스터로 묶어 ROAS 높은 대표만 남김
function deduplicateKeywordItems(items, similarityThreshold) {
    if (!items || !items.length) return items;
    const thresh = similarityThreshold || 0.65;

    // ★ 성능: dedup 전에 ROAS 상위 50개만 처리 (O(n²) 입력 제한)
    const DEDUP_LIMIT = 50;
    const sorted = [...items].sort((a, b) => (b.roas || 0) - (a.roas || 0));
    const limited = sorted.slice(0, DEDUP_LIMIT);
    const rest    = sorted.slice(DEDUP_LIMIT); // 나머지는 dedup 없이 그대로

    const STOP = new Set(['의','에','을','를','이','가','은','는','과','와','및','등','로','으로',
        '맞춤','맞춤형','맞춤의','형','형의','적인','를위한','위한','솔루션','제공','해결','개선',
        '효과','기능','케어','관리','피부','스킨','뷰티','선택','구성','증정','혜택']);

    // ★ 성능: 토큰 사전 계산 (반복 tokenize 제거)
    const tokenize = (kw) => {
        const s = kw.replace(/\s+/g, '').replace(/[,·、·・]/g, '');
        const chunks = new Set();
        for (let i = 0; i < s.length - 1; i++) {
            const bi = s.slice(i, i + 2);
            if (bi.length === 2) chunks.add(bi);
        }
        kw.split(/\s+/).forEach(w => {
            const c = w.replace(/[형의적인맞춤]/g, '').trim();
            if (c.length >= 2 && !STOP.has(c)) chunks.add(c);
        });
        return chunks;
    };
    const jaccard = (a, b) => {
        if (!a.size || !b.size) return 0;
        let inter = 0;
        a.forEach(t => { if (b.has(t)) inter++; });
        const denom = a.size + b.size - inter;
        return denom > 0 ? inter / denom : 0;
    };

    // 토큰 캐시 (중복 계산 방지)
    const tokenCache = new Map();
    const getTokens = (kw) => {
        if (!tokenCache.has(kw)) tokenCache.set(kw, tokenize(kw));
        return tokenCache.get(kw);
    };

    const representatives = [];
    const absorbed = new Set();
    limited.forEach((item, i) => {
        if (absorbed.has(i)) return;
        const tokA = getTokens(item.keyword);
        representatives.push(item);
        limited.forEach((other, j) => {
            if (j <= i || absorbed.has(j)) return;
            if (jaccard(tokA, getTokens(other.keyword)) >= thresh) absorbed.add(j);
        });
    });
    return [...representatives, ...rest];
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
    const computed = Array.from(map.values()).map(item => ({
        ...item,
        roas:     item.spend > 0       ? (item.revenue / item.spend) : 0,
        ctr:      item.impressions > 0 ? (item.clicks / item.impressions) : 0,
        cvr:      item.clicks > 0      ? (item.conversions / item.clicks) : 0,
        cpa:      item.conversions > 0 ? Math.round(item.spend / item.conversions) : 0,
        atc_rate: item.clicks > 0      ? (item.add_to_cart / item.clicks) : 0,
    }));

    // ★ dedup은 _renderAppealTop에서만 명시적으로 호출
    //   여기서 자동 적용하면 차트·테이블 렌더마다 O(n²) 실행되어 UI 블로킹 발생
    return computed;
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

function aggregateByKeywordPair(list, field1, field2, opts) {
    const threshold = (opts && typeof opts.threshold === 'number')
        ? opts.threshold : (currentInsightThreshold || INSIGHT_MIN_SPEND);

    const map = new Map(); // "appeal||hook" -> { spend, revenue, clicks, impressions, conversions, count }
    const rows = new Set(); // field1 값들
    const cols = new Set(); // field2 값들

    list.forEach(c => {
        if ((Number(c.spend) || 0) < threshold) return;
        const vals1 = Array.isArray(c[field1]) ? c[field1] : String(c[field1] || '').split(/[,、，·・]/).map(s => s.trim()).filter(Boolean);
        const vals2 = Array.isArray(c[field2]) ? c[field2] : String(c[field2] || '').split(/[,、，·・]/).map(s => s.trim()).filter(Boolean);
        if (!vals1.length || !vals2.length) return;

        vals1.forEach(v1 => {
            vals2.forEach(v2 => {
                if (!v1 || !v2) return;
                rows.add(v1); cols.add(v2);
                const key = v1 + '||' + v2;
                if (!map.has(key)) map.set(key, { spend: 0, revenue: 0, clicks: 0, impressions: 0, conversions: 0, count: 0 });
                const agg = map.get(key);
                agg.spend       += Number(c.spend)       || 0;
                agg.revenue     += Number(c.revenue)      || 0;
                agg.clicks      += Number(c.clicks)       || 0;
                agg.impressions += Number(c.impressions)  || 0;
                agg.conversions += Number(c.conversions)  || 0;
                agg.count++;
            });
        });
    });

    return { map, rows: [...rows], cols: [...cols] };
}

function renderAppealHookHeatmap(list) {
    const container = document.getElementById('appealHookHeatmap');
    if (!container) return;

    const threshold = currentInsightThreshold || INSIGHT_MIN_SPEND;
    const { map, rows, cols } = aggregateByKeywordPair(list, 'appeal_points', 'hook_type', { threshold });

    if (!map.size || rows.length < 2 || cols.length < 2) {
        container.innerHTML = '<p class="text-slate-400 text-sm text-center py-8">데이터 부족 — 소구포인트와 후킹 방식이 각각 2개 이상 필요합니다</p>';
        return;
    }

    // 지표 선택 (기본 ROAS)
    const metric = container.dataset.metric || 'roas';

    // 셀 값 계산
    function cellVal(agg) {
        if (!agg) return null;
        if (metric === 'roas')  return agg.spend > 0 ? Math.round(agg.revenue / agg.spend * 100) : null;
        if (metric === 'ctr')   return agg.impressions > 0 ? (agg.clicks / agg.impressions * 100) : null;
        if (metric === 'cvr')   return agg.clicks > 0 ? (agg.conversions / agg.clicks * 100) : null;
        return null;
    }

    // 전체 값 범위 계산 (색상 정규화용)
    const allVals = [];
    rows.forEach(r => cols.forEach(c => {
        const v = cellVal(map.get(r + '||' + c));
        if (v !== null) allVals.push(v);
    }));
    const maxVal = Math.max(...allVals, 1);
    const minVal = Math.min(...allVals, 0);
    const range = maxVal - minVal || 1;

    // 색상 함수 (낮음=연회색, 높음=진한 인디고/에메랄드)
    function heatColor(val) {
        if (val === null) return '#f1f5f9';
        const t = (val - minVal) / range; // 0~1
        return `rgb(${Math.round(99 + t*56)},${Math.round(102 + t*83)},${Math.round(241 - t*100)})`;
    }

    // 소재 수 적은 셀 낮은 투명도
    function cellOpacity(agg) {
        if (!agg) return 0;
        return agg.count < 2 ? 0.4 : 1;
    }

    const metricLabel = { roas: 'ROAS (%)', ctr: 'CTR (%)', cvr: 'CVR (%)' }[metric] || metric;
    const fmt = v => v === null ? '-' : metric === 'roas' ? Math.round(v) + '%' : v.toFixed(2) + '%';

    // BEST 조합 TOP3 (count>=2인 것만)
    const ranked = [];
    rows.forEach(r => cols.forEach(c => {
        const agg = map.get(r + '||' + c);
        if (!agg || agg.count < 2) return;
        const v = cellVal(agg);
        if (v !== null) ranked.push({ r, c, v, count: agg.count });
    }));
    ranked.sort((a, b) => b.v - a.v);
    const top3 = ranked.slice(0, 3);

    // 행 정렬: 해당 행의 최대 셀값 기준 내림차순
    const sortedRows = [...rows].sort((a, b) => {
        const maxA = Math.max(...cols.map(c => cellVal(map.get(a+'||'+c)) ?? -1));
        const maxB = Math.max(...cols.map(c => cellVal(map.get(b+'||'+c)) ?? -1));
        return maxB - maxA;
    }).slice(0, 12); // 최대 12행

    const sortedCols = [...cols].slice(0, 8); // 최대 8열

    // HTML 렌더
    container.innerHTML = `
    <div class="overflow-x-auto">
        ${top3.length ? `
        <div class="flex gap-2 mb-3 flex-wrap">
            <span class="text-xs font-semibold text-slate-500">🏆 BEST 조합:</span>
            ${top3.map((t, i) => `
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                    ${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                    <b>${t.r}</b> × <b>${t.c}</b> — ${fmt(t.v)} (n=${t.count})
                </span>
            `).join('')}
        </div>` : ''}
        <table class="w-full text-xs border-separate" style="border-spacing:2px">
            <thead>
                <tr>
                    <th class="text-left p-1 text-slate-400 font-medium min-w-[100px]">소구포인트 \\ 후킹</th>
                    ${sortedCols.map(c => `<th class="p-1 text-center text-slate-500 font-medium max-w-[90px] truncate" title="${c}">${c.length > 8 ? c.slice(0,8)+'…' : c}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${sortedRows.map(r => `
                    <tr>
                        <td class="p-1 text-slate-600 font-medium whitespace-nowrap max-w-[120px] truncate" title="${r}">${r.length > 10 ? r.slice(0,10)+'…' : r}</td>
                        ${sortedCols.map(c => {
                            const agg = map.get(r + '||' + c);
                            const v = cellVal(agg);
                            const op = cellOpacity(agg);
                            const bg = heatColor(v);
                            const isTop = top3.some(t => t.r === r && t.c === c);
                            return `<td class="text-center rounded" style="background:${bg};opacity:${op || 0.15};padding:6px 4px;${isTop ? 'outline:2px solid #6366f1;outline-offset:-2px;' : ''}">
                                <span class="font-bold text-white drop-shadow-sm">${fmt(v)}</span>
                                ${agg && agg.count < 2 ? '<br><span style="font-size:8px;color:rgba(255,255,255,0.8)">n=1</span>' : ''}
                                ${agg && agg.count >= 2 ? `<br><span style="font-size:8px;color:rgba(255,255,255,0.7)">n=${agg.count}</span>` : ''}
                            </td>`;
                        }).join('')}
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <p class="text-xs text-slate-400 mt-2">색이 진할수록 ${metricLabel} 높음 · 반투명 셀 = 소재 1개(신뢰도 낮음) · 최대 12×8 표시</p>
    </div>`;
}

// 메인 렌더 함수
/* ── 워킹 소구포인트 TOP 5 ──────────────────────────────────────
   ROAS 높은 순, CV 건수 중앙값·평균값 기반 신뢰도 판정            */
function _renderAppealTop(list) {
    try {
    const wrap = document.getElementById('appealTopList');
    const card = document.getElementById('appealTopCard');
    if (!wrap) return;

    // 전체 소재 기준 집계 + 유사 중복 제거
    const raw = deduplicateKeywordItems(
        aggregateByKeyword(list || [], 'appeal_points', { threshold: 0 }), 0.65);
    const all = (raw || []).filter(i => i.roas > 0);
    if (!all.length) { if (card) card.style.display = 'none'; return; }

    // ── CV(전환) 건수 기반 통계 기준치 산출 ──────────────────────
    const cvArr = all.map(i => i.conversions || 0).sort((a, b) => a - b);
    const cvMedian = cvArr.length % 2 === 0
        ? (cvArr[cvArr.length/2 - 1] + cvArr[cvArr.length/2]) / 2
        : cvArr[Math.floor(cvArr.length/2)];
    const cvAvg = cvArr.reduce((s,v)=>s+v,0) / Math.max(cvArr.length,1);
    // 보수적 기준: 중앙값과 평균의 낮은 쪽 (더 많이 요구)
    const cvThresh = Math.max(Math.min(cvMedian, cvAvg), 1);

    // 신뢰도: CV 건수가 기준치 대비 얼마나 충족했는지
    const credib = (cv) => {
        if (cv >= cvThresh * 2) return { lv:3, icon:'★★★', txt:'높음',  tip:`전환 ${Math.round(cv)}건 (기준 ${Math.round(cvThresh)}건의 2배+)` };
        if (cv >= cvThresh)     return { lv:2, icon:'★★☆', txt:'보통',  tip:`전환 ${Math.round(cv)}건 (기준치 충족)` };
        if (cv > 0)             return { lv:1, icon:'★☆☆', txt:'낮음',  tip:`전환 ${Math.round(cv)}건 (기준 ${Math.round(cvThresh)}건 미달)` };
        return                         { lv:0, icon:'☆☆☆', txt:'참고용', tip:'전환 데이터 없음' };
    };

    // ROAS 내림차순 TOP 5
    const items = all.sort((a, b) => b.roas - a.roas).slice(0, 5);
    if (card) card.style.display = '';

    const maxRoas = Math.max(...items.map(i => i.roas), 0.01);
    const roasLabel = r => Math.round(r * 100) + '%';

    // ROAS 티어: 전체 CV 가중 평균 대비
    const poolAvgRoas = all.reduce((s,i)=>s+i.roas*(i.conversions||1),0) /
                        Math.max(all.reduce((s,i)=>s+(i.conversions||1),0),1);
    const tierColor = (r, cv) => {
        if (cv <= 0) return { bar:'#cbd5e1', bg:'#f8fafc', txt:'#94a3b8' };
        if (r >= poolAvgRoas*1.25) return { bar:'#22c55e', bg:'#f0fdf4', txt:'#15803d' };
        if (r >= poolAvgRoas*0.85) return { bar:'#6366f1', bg:'#eef2ff', txt:'#4338ca' };
        return                            { bar:'#f59e0b', bg:'#fffbeb', txt:'#b45309' };
    };

    const statNote = `신뢰 기준: CV 중앙값 <b>${Math.round(cvMedian)}건</b> · 평균 <b>${Math.round(cvAvg)}건</b> → 낮은 쪽 ${Math.round(cvThresh)}건 이상 = 신뢰 보통+`;
    const rankBgs = ['#f59e0b','#94a3b8','#c87941','#e2e8f0','#e2e8f0'];

    wrap.innerHTML = `<div class="atop-stat-note">${statNote}</div>` +
    items.map((item, i) => {
        const cr = credib(item.conversions || 0);
        const tc = tierColor(item.roas, item.conversions || 0);
        const barW = Math.round(item.roas / maxRoas * 100);
        const diffVsAvg = poolAvgRoas > 0 ? Math.round((item.roas/poolAvgRoas-1)*100) : 0;
        const diffStr = diffVsAvg >= 0 ? `+${diffVsAvg}%` : `${diffVsAvg}%`;
        const diffCol = diffVsAvg >= 0 ? '#059669' : '#dc2626';
        return `
        <div class="atop-row" style="background:${tc.bg};border-color:${tc.bar}30">
            <div class="atop-rank" style="background:${rankBgs[i]||'#e2e8f0'};color:${i<=2?'#fff':'#64748b'}">${i+1}</div>
            <div class="atop-main">
                <div class="atop-name">${item.keyword}</div>
                <div class="atop-bar-wrap">
                    <div class="atop-bar" style="width:${barW}%;background:${tc.bar}"></div>
                </div>
            </div>
            <div class="atop-meta">
                <div class="atop-roas" style="color:${tc.txt}">${roasLabel(item.roas)}
                    <span style="font-size:10px;font-weight:600;color:${diffCol};margin-left:3px">(${diffStr})</span>
                </div>
                <div class="atop-count" title="${cr.tip}">${cr.icon} CV ${Math.round(item.conversions||0)}건</div>
                <span class="atop-badge" style="background:${tc.bar}20;color:${tc.txt}">신뢰 ${cr.txt}</span>
            </div>
        </div>`;
    }).join('');

    } catch(e) {
        console.warn('[appealTop] 렌더 오류:', e);
        const wrap = document.getElementById('appealTopList');
        if (wrap) wrap.innerHTML = '';
        const card = document.getElementById('appealTopCard');
        if (card) card.style.display = 'none';
    }
}

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

    // 1차 배치: 즉시 — 화면 최상단 카드만 (첫 paint 최우선)
    renderSuccessPatterns(list);
    renderInsightThresholdBadge();
    renderKeywordSearch(list);
    bindKeywordSearch();

    // 2차 배치: 첫 paint 직후 — 주요 차트 + hover맵
    setTimeout(() => {
        // hover preview용 키워드 맵 (1차 이후로 미룸)
        buildKeywordCreativeMap(list);
        renderAppealRoasChart(list);
        renderAppealWordCloud(list);
        bindWordCloudMetricSelect();
    }, 50);

    // 3차 배치: 나머지 차트
    setTimeout(() => {
        renderHookCtrChart(list);
        renderEmotionChart(list);
        renderTopMessages(list);
        // 브랜드 교차 인사이트 (스크롤 아래 위치 → 늦게 렌더해도 무방)
        const crossEl = document.getElementById('brandCrossInsight');
        if (crossEl) crossEl.style.display = (typeof currentBrand !== 'undefined' && currentBrand && currentBrand !== 'ALL') ? 'none' : '';
        renderBrandCrossInsight(window.allCreatives || list);
    }, 200);

    // 4차 배치: 무거운 히트맵 + 시장조사 연계 (idle 시점에 실행)
    const batch4 = () => {
        renderAppealFunnelChart(list);
        renderAppealHookHeatmap(list);
        bindInsightChartSelects();
        attachInsightHoverEvents();
        renderMarketResearchLinks(list);
    };
    if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(batch4, { timeout: 1500 });
    } else {
        setTimeout(batch4, 500);
    }
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

    // 히트맵 지표 셀렉트 바인딩
    const heatmapMetricSel = document.getElementById('heatmap-metric-select');
    if (heatmapMetricSel && heatmapMetricSel.dataset.bound !== '1') {
        heatmapMetricSel.dataset.bound = '1';
        heatmapMetricSel.addEventListener('change', () => {
            const container = document.getElementById('appealHookHeatmap');
            if (container) container.dataset.metric = heatmapMetricSel.value;
            if (typeof renderAppealHookHeatmap === 'function' && window.allCreatives) {
                renderAppealHookHeatmap(window.allCreatives);
            }
        });
    }
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
            <span>광고비 상위 50% 이상 소재만 분석 <span class="info-tip" tabindex="0" style="font-size:9px" data-tip="너무 적은 광고비 소재는 우연일 수 있어 제외합니다. 기준 광고비: ₩${formatNum(thr)} 이상.">ⓘ</span></span>
            <span class="ai-threshold-divider">·</span>
            <span class="ai-threshold-sub">기준 광고비 <b>₩${formatNum(thr)}</b></span>
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
    // ★ textContent에는 클러스터 배지(×N)/지표값이 섞여 있어 data-keyword 사용
    const wordItems = document.querySelectorAll('#appealWordCloud .word-item');
    bindHoverPreview(
        Array.from(wordItems),
        el => el.dataset.keyword || el.textContent.trim(),
        'appeal_points',
        el => { try { return JSON.parse(el.dataset.members || '[]'); } catch (e) { return null; } }
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

// ============================
// 브랜드 교차 인사이트 — 브랜드별 소구포인트 ROAS 비교 테이블
// ============================
function renderBrandCrossInsight(list) {
    const container = document.getElementById('brandCrossInsight');
    if (!container) return;

    // BRAND_COLORS는 main.js 전역에 있으므로 직접 정의
    const BRANDS = ['BOH', 'WM', 'CG'];
    const COLORS = { BOH: '#f43f5e', WM: '#10b981', CG: '#f59e0b' };
    const threshold = currentInsightThreshold || INSIGHT_MIN_SPEND;

    // 브랜드별 소구포인트 TOP5 집계
    const brandData = {};
    BRANDS.forEach(brand => {
        const sub = list.filter(c => c.brand === brand);
        if (!sub.length) return;
        const agg = aggregateByKeyword(sub, 'appeal_points', { threshold });
        brandData[brand] = agg.slice(0, 5); // ROAS 상위 5개
    });

    const activeBrands = BRANDS.filter(b => brandData[b] && brandData[b].length);
    if (activeBrands.length < 2) {
        container.innerHTML = '<p class="text-slate-400 text-sm text-center py-4">브랜드 2개 이상 데이터 필요</p>';
        return;
    }

    // 공통 소구포인트 키워드 수집 (각 브랜드 TOP5 합집합)
    const allKeywords = [...new Set(activeBrands.flatMap(b => brandData[b].map(d => d.keyword)))];
    // 전체 평균 ROAS 기준 정렬
    allKeywords.sort((a, b) => {
        const avgA = activeBrands.reduce((s, brand) => {
            const d = brandData[brand]?.find(x => x.keyword === a);
            return s + (d ? d.roas * 100 : 0);
        }, 0) / activeBrands.length;
        const avgB = activeBrands.reduce((s, brand) => {
            const d = brandData[brand]?.find(x => x.keyword === b);
            return s + (d ? d.roas * 100 : 0);
        }, 0) / activeBrands.length;
        return avgB - avgA;
    });
    const keywords = allKeywords.slice(0, 8);

    // HTML 테이블로 렌더 (Chart.js 없이, 간단하게)
    const rows = keywords.map(kw => {
        const cells = activeBrands.map(brand => {
            const d = brandData[brand]?.find(x => x.keyword === kw);
            if (!d) return `<td class="text-center text-slate-300 text-xs py-2 px-3">-</td>`;
            const roas = Math.round(d.roas * 100);
            const intensity = Math.min(1, roas / 500);
            const color = COLORS[brand];
            const bg = color + Math.round(intensity * 40 + 15).toString(16).padStart(2,'0');
            return `<td class="text-center py-2 px-3 rounded" style="background:${bg}">
                <span class="text-xs font-bold" style="color:${color}">${roas}%</span>
                <span class="text-[9px] text-slate-400 block">n=${d.count}</span>
            </td>`;
        }).join('');
        return `<tr class="border-b border-slate-100">
            <td class="text-xs text-slate-600 py-2 px-3 font-medium whitespace-nowrap">${kw.length > 10 ? kw.slice(0,10)+'…' : kw}</td>
            ${cells}
        </tr>`;
    }).join('');

    container.innerHTML = `
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead>
                    <tr class="border-b border-slate-200">
                        <th class="text-left text-xs text-slate-400 font-medium py-2 px-3">소구포인트</th>
                        ${activeBrands.map(b => `<th class="text-center text-xs font-bold py-2 px-3" style="color:${COLORS[b]}">${b} ROAS</th>`).join('')}
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <p class="text-[10px] text-slate-400 mt-2 px-1">각 브랜드 소재 중 spend 중앙값 이상 소재 기준 · 최대 8개 소구포인트 표시</p>
        </div>`;
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
    const validFilter = d => (d[key] || 0) > 0;

    // ★ 전환수 우선 정렬: CV 중앙값 이상이면 "신뢰 그룹", 그 안에서 선택 지표 정렬
    //   같은 신뢰 그룹 내에서는 ROAS(또는 선택 지표) 내림차순
    const _cvSort = (all) => {
        const cvs = all.map(d => d.conversions || 0).sort((a,b)=>a-b);
        const cvMed = cvs.length ? (cvs.length%2===0
            ? (cvs[cvs.length/2-1]+cvs[cvs.length/2])/2
            : cvs[Math.floor(cvs.length/2)]) : 0;
        return [...all].sort((a, b) => {
            const aHigh = (a.conversions||0) >= cvMed;
            const bHigh = (b.conversions||0) >= cvMed;
            // 신뢰 그룹 차이: 신뢰높음 먼저
            if (aHigh !== bHigh) return aHigh ? -1 : 1;
            // 같은 그룹 내: 선택 지표 정렬
            return cfg.lowerBetter
                ? (a[key]||0) - (b[key]||0)
                : (b[key]||0) - (a[key]||0);
        });
    };

    const _threshold = currentInsightThreshold || INSIGHT_MIN_SPEND;
    let data = _cvSort(aggregateByKeyword(list, fieldName, { threshold: _threshold })
        .filter(a => a.count >= 3 && validFilter(a))).slice(0, maxItems);
    if (data.length < 5) {
        data = _cvSort(aggregateByKeyword(list, fieldName, { threshold: _threshold })
            .filter(a => a.count >= 2 && validFilter(a))).slice(0, maxItems);
    }
    if (data.length < 5) {
        data = _cvSort(aggregateByKeyword(list, fieldName, { threshold: _threshold })
            .filter(a => a.count >= 1 && validFilter(a))).slice(0, maxItems);
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

    // 3) 전환수 우선 → 선택 지표 정렬 → 상위 20개
    const _wcArr = clusterAppealKeywords(rawData).filter(d => (d[metric]||0) > 0 && d.count >= 3);
    const _cvs = _wcArr.map(d=>d.conversions||0).sort((a,b)=>a-b);
    const _cvMed = _cvs.length ? (_cvs.length%2===0 ? (_cvs[_cvs.length/2-1]+_cvs[_cvs.length/2])/2 : _cvs[Math.floor(_cvs.length/2)]) : 0;
    const clustered = _wcArr.sort((a,b)=>{
        const ah=(a.conversions||0)>=_cvMed, bh=(b.conversions||0)>=_cvMed;
        if(ah!==bh) return ah?-1:1;
        return (b[metric]||0)-(a[metric]||0);
    }).slice(0, 20);

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

        const membersJson = JSON.stringify(d.members || [d.keyword]).replace(/"/g, '&quot;');
        return `<span class="word-item" data-cluster="${d.isCluster ? '1' : '0'}" data-keyword="${d.keyword.replace(/"/g, '&quot;')}" data-members="${membersJson}" style="font-size:${size}px;font-weight:${weight};color:${color}" title="${title.replace(/"/g, '&quot;')}">${d.keyword}${badge}${metricValSpan}</span>`;
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

function renderAppealFunnelChart(list) {
    destroyInsightChart('appealFunnel');
    const ctx = document.getElementById('appealFunnelChart');
    if (!ctx) return;

    const threshold = currentInsightThreshold || INSIGHT_MIN_SPEND;
    let data = aggregateByKeyword(list, 'appeal_points', { threshold })
        .filter(d => d.ctr > 0 && d.cvr > 0 && d.count >= 2)
        .slice(0, 15);

    if (!data.length) { ctx.parentElement.innerHTML = '<p class="text-slate-400 text-sm text-center py-8">데이터 부족 (소재 2개 이상 + CTR/CVR 필요)</p>'; return; }

    const avgCtr = data.reduce((s,d) => s + d.ctr, 0) / data.length;
    const avgCvr = data.reduce((s,d) => s + d.cvr, 0) / data.length;
    const maxCount = Math.max(...data.map(d => d.count), 1);

    const colors = data.map(d => {
        const hc = d.ctr >= avgCtr, hv = d.cvr >= avgCvr;
        if (hc && hv)  return 'rgba(16,185,129,0.75)';
        if (!hc && hv) return 'rgba(99,102,241,0.70)';
        if (hc && !hv) return 'rgba(251,191,36,0.75)';
        return 'rgba(148,163,184,0.60)';
    });

    insightCharts['appealFunnel'] = new Chart(ctx, {
        type: 'bubble',
        data: {
            datasets: [{
                label: '소구포인트',
                data: data.map((d, i) => ({
                    x: Number((d.ctr * 100).toFixed(2)),
                    y: Number((d.cvr * 100).toFixed(2)),
                    r: 6 + Math.round((d.count / maxCount) * 18),
                    _d: d
                })),
                backgroundColor: colors,
                borderColor: colors.map(c => c.replace(/[\d.]+\)$/, '1)')),
                borderWidth: 1,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: t => { const d = t.raw._d; return [`"${d.keyword}"`, `CTR ${(d.ctr*100).toFixed(2)}%  CVR ${(d.cvr*100).toFixed(2)}%`, `ROAS ${Math.round(d.roas*100)}%  소재 ${d.count}개`]; } } }
            },
            scales: {
                x: { title: { display: true, text: '클릭률 (%)' }, ticks: { callback: v => v + '%' } },
                y: { title: { display: true, text: '구매전환율 (%)' }, ticks: { callback: v => v + '%' } }
            }
        },
        plugins: [{
            id: 'funnelQuadrant',
            afterDraw(chart) {
                const { ctx: c, chartArea: { top, bottom, left, right }, scales } = chart;
                const xMid = scales.x.getPixelForValue(avgCtr * 100);
                const yMid = scales.y.getPixelForValue(avgCvr * 100);
                c.save(); c.strokeStyle = 'rgba(100,116,139,0.35)'; c.lineWidth = 1; c.setLineDash([5,4]);
                c.beginPath(); c.moveTo(xMid, top); c.lineTo(xMid, bottom); c.stroke();
                c.beginPath(); c.moveTo(left, yMid); c.lineTo(right, yMid); c.stroke();
                c.setLineDash([]); c.font = '10px sans-serif'; c.fillStyle = 'rgba(100,116,139,0.7)';
                c.fillText('클릭·구매전환 모두 우수 ★', xMid + 6, top + 14);
                c.fillText('클릭↑ 전환↓', xMid + 6, bottom - 8);
                c.textAlign = 'right';
                c.fillText('전환↑ 클릭↓', xMid - 6, top + 14);
                c.restore();
            }
        }, {
            id: 'bubbleLabels',
            afterDatasetsDraw(chart) {
                const { ctx: c } = chart;
                const meta = chart.getDatasetMeta(0);
                c.save(); c.font = 'bold 9px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#1e293b';
                meta.data.forEach((el, i) => {
                    const kw = data[i].keyword;
                    c.fillText(kw.length > 6 ? kw.slice(0,6)+'…' : kw, el.x, el.y);
                });
                c.restore();
            }
        }]
    });
}

// ============================
// 키워드 검색 — 고효율 소재 찾기
// ============================
let _keywordSearchQuery = '';
let _keywordSearchList = []; // 마지막 렌더에 사용된 list 캐시 (입력 시 재사용)

function bindKeywordSearch() {
    const input = document.getElementById('keyword-search-input');
    const clearBtn = document.getElementById('keyword-search-clear');
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';

    const debounced = debounce(() => {
        _keywordSearchQuery = input.value || '';
        renderKeywordSearch(_keywordSearchList);
    }, 200);

    input.addEventListener('input', debounced);
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            input.value = '';
            _keywordSearchQuery = '';
            renderKeywordSearch(_keywordSearchList);
            input.focus();
        });
    }
}

// 소재 썸네일 HTML (Drive URL 다중 fallback 체인 지원)
function _kwSearchThumbHtml(c) {
    const rawThumb = c.thumbnail_url || c.media_url || '';
    const isVideo = c.media_type === 'video';
    const fallback = `<div class="kw-search-thumb kw-search-thumb-fallback"><i class="fas fa-${isVideo ? 'video' : 'image'}"></i></div>`;
    if (!rawThumb) return fallback;
    if (typeof window.isDriveUrl === 'function' && window.isDriveUrl(rawThumb) && typeof window.buildDriveImgHtml === 'function') {
        return window.buildDriveImgHtml(rawThumb, { className: 'kw-search-thumb', alt: '', finalFallbackHtml: fallback });
    }
    return `<img src="${rawThumb}" alt="" class="kw-search-thumb" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.outerHTML='${fallback.replace(/'/g, "\\'")}'">`;
}

function renderKeywordSearch(list) {
    if (Array.isArray(list)) _keywordSearchList = list;
    const results = document.getElementById('keyword-search-results');
    const empty = document.getElementById('keyword-search-empty');
    const countEl = document.getElementById('keyword-search-count');
    const clearBtn = document.getElementById('keyword-search-clear');
    if (!results || !empty) return;

    const q = (_keywordSearchQuery || '').trim().toLowerCase();
    if (clearBtn) clearBtn.classList.toggle('hidden', !q);

    if (!q) {
        results.innerHTML = '';
        results.classList.add('hidden');
        empty.classList.remove('hidden');
        empty.textContent = '검색어를 입력하면 일치하는 강조 포인트·소재명·메시지의 소재를 효율(ROAS) 순으로 보여줘요';
        if (countEl) countEl.textContent = '';
        return;
    }

    const base = typeof aggregateByAdName === 'function'
        ? aggregateByAdName([...(_keywordSearchList || [])])
        : (_keywordSearchList || []);

    const matched = base.filter(c => {
        const fields = [
            c.ad_name, c.creative_name, c.product,
            ...normalizeKeywords(c.appeal_points),
            ...normalizeKeywords(c.hook_type),
            ...normalizeKeywords(c.target_emotion),
            c.key_message_kr, c.key_message_jp
        ];
        return fields.some(v => (v || '').toString().toLowerCase().includes(q));
    });

    // 광고비 중앙값 이상 + ROAS 높은 순으로 고효율 소재만 노출
    const threshold = currentInsightThreshold || INSIGHT_MIN_SPEND;
    let ranked = matched
        .filter(c => (c.spend || 0) >= threshold && (c.roas || 0) > 0)
        .sort((a, b) => (b.roas || 0) - (a.roas || 0));

    // 기준 충족 소재가 없으면 기준을 낮춰 전체 일치 소재를 ROAS 순으로 표시
    if (!ranked.length && matched.length) {
        ranked = matched.slice().sort((a, b) => (b.roas || 0) - (a.roas || 0));
    }
    ranked = ranked.slice(0, 12);

    if (countEl) {
        countEl.textContent = matched.length
            ? `"${_keywordSearchQuery}" 일치 ${matched.length}개 · 효율 상위 ${ranked.length}개 표시`
            : '';
    }

    if (!ranked.length) {
        results.innerHTML = '';
        results.classList.add('hidden');
        empty.classList.remove('hidden');
        empty.textContent = `"${_keywordSearchQuery}"와 일치하는 소재가 없습니다`;
        return;
    }

    results.classList.remove('hidden');
    empty.classList.add('hidden');

    results.innerHTML = ranked.map((c, i) => {
        const thumbHtml = _kwSearchThumbHtml(c);
        const isVideo = c.media_type === 'video';
        const roasPct = Math.round((c.roas || 0) * 100);
        const ctrPct = ((c.ctr || 0) * 100).toFixed(2);
        const roasColor = roasPct >= 300 ? 'text-emerald-600' : roasPct >= 150 ? 'text-amber-600' : 'text-rose-500';
        const name = c.ad_name || c.creative_name || '';
        const appeals = normalizeKeywords(c.appeal_points).filter(a => a && !a.startsWith('❌')).slice(0, 3);
        const id = c.id || c.ad_name || '';
        return `
            <div class="kw-search-card" data-creative-id="${id}" title="${name.replace(/"/g, '&quot;')}">
                <div class="kw-search-thumb-wrap">
                    ${thumbHtml}
                    ${isVideo ? '<span class="kw-search-vbadge">▶</span>' : ''}
                    <span class="kw-search-rank">${i + 1}</span>
                </div>
                <div class="kw-search-name">${name}</div>
                <div class="kw-search-stats">
                    <span class="font-bold ${roasColor}">ROAS ${roasPct}%</span>
                    <span class="text-slate-400">CTR ${ctrPct}%</span>
                </div>
                ${appeals.length ? `<div class="kw-search-appeals">${appeals.map(a => `<span class="kw-search-chip">${a}</span>`).join('')}</div>` : ''}
                ${isVideo && c.media_url ? `<button class="kw-video-btn" data-video-url="${(c.media_url||'').replace(/"/g,'&quot;')}" data-name="${name.replace(/"/g,'&quot;')}">🎬 영상 분석</button>` : ''}
            </div>
        `;
    }).join('');

    results.querySelectorAll('.kw-search-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.kw-video-btn')) return;
            const cid = card.getAttribute('data-creative-id');
            if (cid && typeof window.openModal === 'function') window.openModal(cid);
        });
        const vBtn = card.querySelector('.kw-video-btn');
        if (vBtn) {
            vBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.acAnalyzeVideo(vBtn.dataset.videoUrl, vBtn.dataset.name);
            });
        }
    });
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

// ── 시장조사 연계 인사이트 카드 ───────────────────────────────
function _mrMatchProduct(keyword) {
    const mr = window.MARKET_RESEARCH;
    if (!mr) return null;
    const k = (keyword || '').toLowerCase();
    // 제품 키워드 매핑
    const maps = [
        { key: '탄탄크림', terms: ['탄력', '리프팅', '처짐', '탄탄', '탄크림', '하안부', '翌朝', '夜タン', '탄탄', '탄크', 'liftin', 'tightening', '눈가', '마리오네트', '페이스라인'] },
        { key: '겔미스트', terms: ['보습', '수분', '건조', '미스트', '젤리', '겔', '촉촉', '메이크업', '들뜸', '육아'] },
        { key: 'NAD크림', terms: ['nad', '안티에이징', '노화', '칙칙', '피로', '윤기', '나이트', '에너지'] },
        { key: '컬러그램', terms: ['립틴트', '틴트', '립', '발색', '착색', '묻어남', '컬러그램', 'colorgram', 'lip', 'tint'] },
        { key: '웨이크메이크', terms: ['베이스', '파운데이션', '피부표현', '철벽', '심리스', '밀착', '웨이크', 'wakemake', 'base', 'foundation', '커버'] },
    ];
    for (const m of maps) {
        if (m.terms.some(t => k.includes(t))) return { productKey: m.key, data: mr[m.key] };
    }
    return null;
}

// CSV product 컬럼 값 → 시장조사 제품키 직접 매핑 (제품 필터 연동용)
function _csvProductToMRKey(productName) {
    const n = (productName || '').toLowerCase().replace(/[-_\s]/g, '');
    if (/gelmist|겔미스트/.test(n)) return '겔미스트';
    if (/nadcream|nad크림/.test(n) || /\bnad\b/.test((productName||'').toLowerCase())) return 'NAD크림';
    if (/collagencream|탄탄크림|asachuru|tankream/.test(n)) return '탄탄크림';
    if (/colorgram|컬러그램|liptint/.test(n)) return '컬러그램';
    if (/wakemake|웨이크메이크/.test(n)) return '웨이크메이크';
    return null;
}

function _mrGetRelevantCEPs(productData, keyword) {
    const cepList = productData?.CEP요약 || productData?.CEP;
    if (!cepList) return [];
    const k = (keyword || '').toLowerCase();
    const scored = cepList.map(cep => {
        const text = ((cep.type || '') + ' ' + (cep.트리거 || '')).toLowerCase();
        const score = k.split(/\s+/).filter(w => w.length >= 2).reduce((s, w) => s + (text.includes(w) ? 2 : 0), 0);
        return { ...cep, _score: score };
    });
    scored.sort((a, b) => b._score - a._score);
    return scored.slice(0, 3);
}

function renderMarketResearchLinks(list) {
    const mr = window.MARKET_RESEARCH;
    const container = document.getElementById('mr-links-section');
    if (!container) return;
    if (!mr) { container.style.display = 'none'; return; }

    // 매출 중위값 계산
    const validList = (list || []).filter(c => (c.spend || 0) >= currentInsightThreshold && (c.revenue || 0) > 0);
    const sortedRevs = validList.map(c => c.revenue).sort((a, b) => a - b);
    const medianRev = sortedRevs.length ? sortedRevs[Math.floor(sortedRevs.length / 2)] : 0;

    // 매출 중위 이상 소재만 집계 — 소구포인트별 ROAS 목록 수집
    const aggMap = new Map();
    validList.forEach(c => {
        if ((c.revenue || 0) < medianRev) return;
        normalizeKeywords(c.appeal_points).forEach(kw => {
            if (!kw || kw.startsWith('❌')) return;
            const e = aggMap.get(kw) || { kw, roasList: [], creatives: [], totalSpend: 0 };
            e.roasList.push(c.roas || 0);
            e.creatives.push({ name: (c.ad_name || c.creative_id || '').slice(0, 30), roas: Math.round((c.roas || 0) * 100) });
            e.totalSpend += c.spend || 0;
            aggMap.set(kw, e);
        });
    });

    // 소구포인트별 시장조사 매핑 후 제품 단위로 통합 (중복 소재 제거)
    const productGroups = new Map();
    [...aggMap.values()].forEach(e => {
        const match = _mrMatchProduct(e.kw);
        if (!match) return;
        const pk = match.productKey;
        if (!productGroups.has(pk)) {
            productGroups.set(pk, { productKey: pk, match, keywords: [], creativeMap: new Map() });
        }
        const g = productGroups.get(pk);
        const kwAvg = e.roasList.reduce((s, r) => s + r, 0) / e.roasList.length;
        g.keywords.push({ kw: e.kw, avgRoas: Math.round(kwAvg * 100), count: e.roasList.length });
        e.creatives.forEach(c => {
            if (!g.creativeMap.has(c.name)) g.creativeMap.set(c.name, c);
        });
    });

    // 브랜드 필터 기반 허용 MR키 (브랜드탭 우선 적용)
    const BRAND_MR_KEYS = {
        BOH: ['탄탄크림', '겔미스트', 'NAD크림'],
        WM:  ['웨이크메이크'],
        CG:  ['컬러그램'],
    };
    const activeBrand = (typeof currentBrand !== 'undefined' && currentBrand && currentBrand !== 'ALL')
        ? currentBrand.toUpperCase() : null;
    const allowedMRKeys = new Set();
    if (activeBrand && BRAND_MR_KEYS[activeBrand]) {
        BRAND_MR_KEYS[activeBrand].forEach(k => allowedMRKeys.add(k));
    }

    // 제품 필터까지 활성이면 추가 좁히기 (CSV product명 → MR키 직접 매핑)
    const activeAiProducts = (typeof aiProducts !== 'undefined' && Array.isArray(aiProducts)) ? aiProducts : [];
    if (activeAiProducts.length) {
        const listProds = [...new Set(validList.map(c => (c.product || '').trim()).filter(Boolean))];
        const prodKeys = new Set(listProds.map(p => _csvProductToMRKey(p)).filter(Boolean));
        if (prodKeys.size === 0) { container.style.display = 'none'; return; }
        // 브랜드 허용 키와 교집합
        if (allowedMRKeys.size) {
            [...allowedMRKeys].forEach(k => { if (!prodKeys.has(k)) allowedMRKeys.delete(k); });
        } else {
            prodKeys.forEach(k => allowedMRKeys.add(k));
        }
        if (allowedMRKeys.size === 0) { container.style.display = 'none'; return; }
    }

    // 제품별 집계 통계
    const productCards = [...productGroups.values()].map(g => {
        const creatives = [...g.creativeMap.values()].sort((a, b) => b.roas - a.roas);
        const roasList = creatives.map(c => c.roas);
        if (!roasList.length) return null;
        const avgRoas = Math.round(roasList.reduce((s, r) => s + r, 0) / roasList.length);
        const minRoas = Math.min(...roasList);
        const maxRoas = Math.max(...roasList);
        const topKws = g.keywords.sort((a, b) => b.avgRoas - a.avgRoas).slice(0, 5);
        return { productKey: g.productKey, match: g.match, creatives: creatives.slice(0, 8), avgRoas, minRoas, maxRoas, topKws };
    }).filter(Boolean)
      .filter(g => !allowedMRKeys.size || allowedMRKeys.has(g.productKey))
      .sort((a, b) => b.avgRoas - a.avgRoas).slice(0, 5);

    if (!productCards.length) { container.style.display = 'none'; return; }
    container.style.display = '';

    const tierOf = (avgRoas) => avgRoas >= 200
        ? { label: '고효율', color: '#16a34a', bg: '#f0fdf4' }
        : avgRoas >= 100
        ? { label: '중효율', color: '#d97706', bg: '#fffbeb' }
        : { label: '성장가능', color: '#6366f1', bg: '#eef2ff' };

    const cards = productCards.map(({ productKey, match, creatives, avgRoas, minRoas, maxRoas, topKws }) => {
        const tier = tierOf(avgRoas);
        const ugcDirs = match.data?.UGC방향성 || match.data?.UGC방향 || [];
        const ugcMatch = ugcDirs[0];
        const tipData = encodeURIComponent(JSON.stringify(creatives));
        const chatQ = `${productKey} 제품의 고효율 소재 패턴 (소구포인트: ${topKws.map(k=>k.kw).join(', ')}) + 시장 데이터 CEP 기반으로 신규 광고 소재/UGC 앵글 3개 기획해줘 (실제 ROAS 데이터 인용)`;

        return `
        <div class="mr-link-card" style="border-top: 3px solid ${tier.color}">
            <div class="mr-link-top">
                <span class="mr-link-kw">${productKey}</span>
                <span class="mr-link-tier" style="background:${tier.bg};color:${tier.color}">${tier.label}</span>
            </div>
            <div class="mr-link-roas-row"
                 onmouseenter="window._mrShowUGCTip(this,'${tipData}')"
                 onmouseleave="window._mrHideUGCTip()">
                <span class="mr-link-roas-avg" style="color:${tier.color}">평균 ${avgRoas}%</span>
                <span class="mr-link-roas-range">범위 ${minRoas}~${maxRoas}%</span>
                <span class="mr-link-cnt">${creatives.length}개 소재 — hover로 확인</span>
            </div>
            <div class="mr-link-product">${productKey} 시장조사 연계</div>
            <div class="mr-link-ceps">${topKws.map(k => `<span class="mr-link-cep-chip" title="ROAS ${k.avgRoas}%">${k.kw}</span>`).join('')}</div>
            ${ugcMatch ? `<div class="mr-link-ugc"><b>UGC 앵글</b> — ${ugcMatch.테마}: ${(ugcMatch.핵심메시지 || '').slice(0, 40)}</div>` : ''}
            <button class="mr-link-btn" onclick="window.acAnalyzeAppeal && window.acAnalyzeAppeal(decodeURIComponent('${encodeURIComponent(chatQ)}'))">
                ✨ AI에게 소재 기획 요청
            </button>
        </div>`;
    }).join('');

    container.innerHTML = `
        <div class="mr-links-header">
            <i class="fas fa-chart-network mr-1 text-violet-500"></i>
            성과 데이터 × 시장조사 연계
            <span class="mr-links-sub">매출 중위 이상 소재 기준 · ROAS 패턴별 소구포인트 → 리스닝마인드 CEP·UGC 매핑</span>
        </div>
        <div class="mr-links-grid">${cards}</div>
    `;
}

// AI 챗봇에 소재 기획 요청 (시장조사 연계)
window.acAnalyzeAppeal = function(query) {
    if (typeof window.toggleAiChat === 'function' && !window._acOpen) window.toggleAiChat();
    const input = document.getElementById('ac-input');
    if (input) { input.value = query; input.style.height = 'auto'; }
    if (typeof window.acSend === 'function') window.acSend();
};

// UGC Tip hover 시스템 — mr-link-roas-row onmouseenter/onmouseleave 에서 호출
(function() {
    let _ugcTipEl = null;
    let _ugcHideTimer = null;

    function getUgcTipEl() {
        if (!_ugcTipEl) {
            _ugcTipEl = document.createElement('div');
            _ugcTipEl.id = 'mr-ugc-tip';
            _ugcTipEl.style.cssText = [
                'position:fixed;z-index:9999;background:#1e1b4b;color:#e0e7ff',
                'border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.5',
                'box-shadow:0 8px 32px rgba(0,0,0,0.35);max-width:320px;pointer-events:none',
                'opacity:0;transition:opacity 0.15s;max-height:280px;overflow-y:auto'
            ].join(';');
            document.body.appendChild(_ugcTipEl);
        }
        return _ugcTipEl;
    }

    window._mrShowUGCTip = function(triggerEl, encodedData) {
        clearTimeout(_ugcHideTimer);
        _ugcHideTimer = null;
        let creatives = [];
        try { creatives = JSON.parse(decodeURIComponent(encodedData)); } catch(e) { return; }
        if (!creatives.length) return;

        const tip = getUgcTipEl();
        const rows = creatives.slice(0, 8).map(c => {
            const name = c.creative_name || c.ad_name || '(이름 없음)';
            const roas = c.roas != null ? `ROAS ${Math.round(c.roas * 100)}%` : '';
            return `<div style="border-bottom:1px solid rgba(255,255,255,0.08);padding:4px 0;display:flex;justify-content:space-between;gap:8px">
                <span style="opacity:0.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${name}</span>
                ${roas ? `<span style="opacity:0.6;white-space:nowrap;flex-shrink:0">${roas}</span>` : ''}
            </div>`;
        }).join('');
        tip.innerHTML = `<div style="font-weight:700;margin-bottom:6px;color:#a5b4fc">소재 목록 (${creatives.length}개)</div>${rows}`;

        const rect = triggerEl.getBoundingClientRect();
        const tipW = 300;
        let left = rect.left + window.scrollX;
        if (left + tipW > window.innerWidth - 16) left = window.innerWidth - tipW - 16;
        tip.style.left = left + 'px';
        tip.style.top = (rect.bottom + window.scrollY + 6) + 'px';
        tip.style.opacity = '1';
    };

    window._mrHideUGCTip = function() {
        _ugcHideTimer = setTimeout(function() {
            const tip = document.getElementById('mr-ugc-tip');
            if (tip) tip.style.opacity = '0';
        }, 200);
    };
})();

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
