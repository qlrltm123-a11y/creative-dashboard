// ============================
// State Management
// ============================
let allCreatives = [];
let currentBrand = 'ALL';
let currentCampaign = ''; // ★ 전역 캠페인 필터 ('' = 전체) — UI 제거됐지만 호환용 유지
let currentPlatform = ''; // ★ 전역 매체(Platform) 필터 ('' = 전체) — 브랜드별로 동적 구성
let currentRetail = '';   // ★ 전역 Retail 채널 필터 ('' = 전체, 'Qoo10'/'RKT' 등)
let currentEvent  = '';   // ★ 전역 Event 필터 ('' = 전체, 시트 AA열)
// ★ 섹션 단위 필터 (성과 분석 / AI 인사이트)
let performanceProduct = '';   // 성과 분석 섹션 - 제품 필터
let performanceCampaign = '';  // 성과 분석 섹션 - 캠페인 필터
let aiProduct = '';            // AI 인사이트 섹션 - 제품 필터
let aiCampaign = '';           // AI 인사이트 섹션 - 캠페인 필터
let winningProduct = '';       // ★ 위닝 요소 인사이트 - 제품 필터 (개요 탭)
let appealRightMetric = 'ctr'; // 소구포인트 우측 컬럼 지표: 'ctr' | 'atc_rate'
let charts = {};

function debounce(fn, delay = 250) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}
const debouncedUpdateDashboard = debounce(() => updateDashboard(), 250);

const BRAND_COLORS = {
    BOH: '#f43f5e',
    WM: '#10b981',
    CG: '#f59e0b',
};

const PLATFORM_COLORS = {
    Meta: '#1877f2',
    Google: '#ea4335',
    TikTok: '#000000',
    Naver: '#03c75a',
    Kakao: '#fae100'
};

// ============================
// Init
// ============================
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    bindEvents();
    updateDashboard();
    document.getElementById('last-updated').textContent = new Date().toLocaleString('ko-KR');
    setStickyHeaderOffset();
});

// 스티키 필터바 top 오프셋 = 헤더 실제 높이 (반응형 대응)
function setStickyHeaderOffset() {
    const header = document.querySelector('header');
    const apply = () => {
        if (header) document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
    };
    apply();
    window.addEventListener('resize', apply);
}

async function loadData() {
    // 1순위: Google Sheets 연동 데이터
    if (typeof window.tryLoadSavedSheet === 'function') {
        const sheetData = await window.tryLoadSavedSheet();
        if (sheetData && sheetData.length) {
            allCreatives = sheetData;
            window.allCreatives = allCreatives;
            return;
        }
    }
    // 2순위: 기본 테이블 API (샘플 데이터)
    try {
        const res = await fetch('tables/creatives?limit=100');
        const json = await res.json();
        allCreatives = json.data || [];
        window.allCreatives = allCreatives;
        if (typeof window.updateDataSourceLabel === 'function') window.updateDataSourceLabel(false);
    } catch (e) {
        console.error('데이터 로드 실패', e);
        allCreatives = [];
    }
}

// 시트 연동 후 전역 갱신을 위해 노출
window.updateDashboard = function() {
    allCreatives = window.allCreatives || allCreatives;
    invalidatePerformancePoolCache();
    if (typeof window._invalidateMwCache === 'function') window._invalidateMwCache();
    if (typeof window._invalidateWrCache === 'function') window._invalidateWrCache();

    // 통합 iframe(퍼널/GMV)에 전역 브랜드 변경 전파 (이미 로드된 경우만)
    const _brand = (typeof currentBrand !== 'undefined') ? currentBrand : 'ALL';
    ['funnel-frame', 'gmv-frame'].forEach(id => {
        const fr = document.getElementById(id);
        if (fr && fr.src && fr.contentWindow) {
            try { fr.contentWindow.postMessage({ type: 'setBrand', brand: _brand }, '*'); } catch(e) {}
        }
    });

    // ① 피로도 감지는 백그라운드로 (메인 스레드 비차단)
    setTimeout(() => { window._creativeFatigue = detectCreativeFatigue(allCreatives); }, 0);

    // ② 현재 탭 외 섹션은 stale 마킹 → 다음 진입 시 재렌더
    Object.keys(_renderedSections).forEach(k => {
        if (k !== 'overview' && k !== _currentSection) _renderedSections[k] = false;
    });

    // ③ 필터 옵션 갱신 (select DOM 재구성 — 빠름)
    populatePlatformOptions();
    populateRetailOptions();
    populateEventOptions();
    populateCampaignOptions();
    populatePerformanceFilterOptions();
    populateAiFilterOptions();
    populateWinningProductOptions();
    populateProductOptions();
    populateAppealInsightProductOptions();
    populatePlatformMatrixProductOptions();

    updateActiveFilterChip(); // 현재 필터 칩 갱신

    // ④ 개요 탭은 항상 즉시 갱신 (KPI + 차트 + 위닝 요소)
    updateKPIs();
    updateCharts(); // renderWinningElements 포함

    // ⑤ 현재 활성 섹션만 렌더 (비활성 섹션은 절대 렌더하지 않음)
    if (_currentSection === 'unified') {
        if (typeof window.renderUnifiedBriefing === 'function') window.renderUnifiedBriefing();
    } else if (_currentSection === 'performance') {
        renderPerformanceCriteriaBadge();
        renderScatterChart();
        renderSpendScatterChart();
        renderSaturationChart();
        renderCartLeakRanking();
        renderProductPerformance();
    } else if (_currentSection === 'ai') {
        if (typeof window.renderAIInsights === 'function') window.renderAIInsights();
    } else if (_currentSection === 'megawari') {
        if (typeof window.renderMegawariPanel === 'function') window.renderMegawariPanel();
    } else if (_currentSection === 'weekly') {
        if (typeof window.renderWeeklyReport === 'function') window.renderWeeklyReport();
    }
    // overview: updateKPIs + updateCharts 만으로 충분 (renderProductPerformance 불필요)

    document.getElementById('last-updated').textContent = new Date().toLocaleString('ko-KR');
};

// ============================
// Events
// ============================
function bindEvents() {
    document.querySelectorAll('.brand-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.brand-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentBrand = tab.dataset.brand;
            // 브랜드 변경 시 전역 캠페인 필터 리셋 (브랜드마다 캠페인 목록이 다름)
            currentCampaign = '';
            const campSel = document.getElementById('campaign-select');
            if (campSel) campSel.value = '';
            // ★ 브랜드 변경 시 매체(Platform) + Retail 필터도 리셋
            currentPlatform = '';
            const platSel = document.getElementById('platform-select');
            if (platSel) platSel.value = '';
            currentRetail = '';
            const retSel = document.getElementById('retail-select');
            if (retSel) retSel.value = '';
            currentEvent = '';
            const evSel = document.getElementById('event-select');
            if (evSel) evSel.value = '';
            // ★ 섹션 단위 필터도 리셋 (브랜드 바뀌면 제품/캠페인 풀이 달라짐)
            performanceProduct = '';
            performanceCampaign = '';
            aiProduct = '';
            aiCampaign = '';
            invalidatePerformancePoolCache();  // ★ 공통 풀 캐시 무효화
            updateDashboard();
        });
    });

    // ★ 매체(Platform) 전역 필터 이벤트 바인딩
    const platformSel = document.getElementById('platform-select');
    if (platformSel) {
        platformSel.addEventListener('change', () => {
            currentPlatform = platformSel.value || '';
            // 매체 바뀌면 Retail/Event 옵션 재구성
            populateRetailOptions();
            populateEventOptions();
            // 섹션별 제품/캠페인 리셋
            currentCampaign = '';
            const campSel = document.getElementById('campaign-select');
            if (campSel) campSel.value = '';
            performanceProduct = '';
            performanceCampaign = '';
            aiProduct = '';
            aiCampaign = '';

            invalidatePerformancePoolCache();
            debouncedUpdateDashboard();
        });
    }
    const platformResetBtn = document.getElementById('platform-filter-reset');
    if (platformResetBtn) {
        platformResetBtn.addEventListener('click', () => {
            if (!currentPlatform) return;
            currentPlatform = '';
            if (platformSel) platformSel.value = '';
            populateRetailOptions();
            invalidatePerformancePoolCache();
            updateDashboard();
        });
    }

    // ★ Retail 채널 전역 필터 이벤트 바인딩
    const retailSel = document.getElementById('retail-select');
    if (retailSel) {
        retailSel.addEventListener('change', () => {
            currentRetail = retailSel.value || '';
            // Retail 바뀌면 매체/Event 옵션 재구성
            populatePlatformOptions();
            populateEventOptions();
            // 섹션별 제품/캠페인 리셋
            performanceProduct = '';
            performanceCampaign = '';
            aiProduct = '';
            aiCampaign = '';
            invalidatePerformancePoolCache();
            debouncedUpdateDashboard();
        });
    }
    const retailResetBtn = document.getElementById('retail-filter-reset');
    if (retailResetBtn) {
        retailResetBtn.addEventListener('click', () => {
            if (!currentRetail) return;
            currentRetail = '';
            if (retailSel) retailSel.value = '';
            populatePlatformOptions();
            invalidatePerformancePoolCache();
            updateDashboard();
        });
    }

    // ★ Event 전역 필터 이벤트 바인딩
    const eventSel = document.getElementById('event-select');
    if (eventSel) {
        eventSel.addEventListener('change', () => {
            currentEvent = eventSel.value || '';
            performanceProduct = '';
            performanceCampaign = '';
            aiProduct = '';
            aiCampaign = '';
            invalidatePerformancePoolCache();
            debouncedUpdateDashboard();
        });
    }
    const eventResetBtn = document.getElementById('event-filter-reset');
    if (eventResetBtn) {
        eventResetBtn.addEventListener('click', () => {
            if (!currentEvent) return;
            currentEvent = '';
            if (eventSel) eventSel.value = '';
            invalidatePerformancePoolCache();
            updateDashboard();
        });
    }

    // ★ 캠페인 전역 필터는 제거됨 (hidden 셀렉트만 유지) — 이벤트 바인딩 불필요

    // ★ 위닝 요소 인사이트 - 제품 필터
    const winningProdSel = document.getElementById('winning-product-select');
    if (winningProdSel) {
        winningProdSel.addEventListener('change', () => {
            winningProduct = winningProdSel.value || '';
            if (typeof renderWinningElements === 'function') renderWinningElements();
        });
    }

    // Section Tabs (Overview / Performance / AI Insights)
    document.querySelectorAll('.section-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const section = tab.dataset.section;
            switchSection(section);
        });
    });

    // 제품 선택 & 정렬 기준 변경 시 BEST/WORST 갱신
    const productSelect = document.getElementById('product-select');
    const productSortMetric = document.getElementById('product-sort-metric');
    if (productSelect) {
        productSelect.addEventListener('change', renderProductPerformance);
    }
    if (productSortMetric) {
        productSortMetric.addEventListener('change', renderProductPerformance);
    }

    // 갤러리 소구포인트 / 성과구간 필터
    const galleryAppealSel = document.getElementById('gallery-appeal-select');
    const galleryPerfTierSel = document.getElementById('gallery-perf-tier-select');
    if (galleryAppealSel) {
        galleryAppealSel.addEventListener('change', renderProductPerformance);
    }
    if (galleryPerfTierSel) {
        galleryPerfTierSel.addEventListener('change', renderProductPerformance);
    }

    // (기존 개별 제품 셀렉트는 hidden으로 유지 — 섹션 통합 필터가 동기화)

    // 매체 × 소재 조합 - 지표 변경
    const platformMatrixSel = document.getElementById('platform-matrix-metric');
    if (platformMatrixSel) {
        platformMatrixSel.addEventListener('change', renderPlatformCreativeMatrix);
    }

    // 광고비 × 성과 분포도 지표 변경
    const spendScatterSel = document.getElementById('spend-scatter-metric');
    if (spendScatterSel) {
        spendScatterSel.addEventListener('change', renderSpendScatterChart);
    }

    // ★ 디바운스된 섹션 갱신 함수 (빠른 연속 클릭/변경 시 마지막 호출만)
    const debouncedRefreshPerf = debounce(refreshPerformanceSection, 120);
    const debouncedRefreshAi = debounce(refreshAiSection, 120);

    // ★ 성과 분석 섹션 통합 필터
    const perfProdSel = document.getElementById('performance-product-select');
    if (perfProdSel) {
        perfProdSel.addEventListener('change', () => {
            performanceProduct = perfProdSel.value || '';
            invalidatePerformancePoolCache();  // ★ 공통 풀 캐시 무효화
            syncHiddenPerformanceSelects();
            debouncedRefreshPerf();
        });
    }
    const perfCampSel = document.getElementById('performance-campaign-select');
    if (perfCampSel) {
        perfCampSel.addEventListener('change', () => {
            performanceCampaign = perfCampSel.value || '';
            invalidatePerformancePoolCache();  // ★ 공통 풀 캐시 무효화
            debouncedRefreshPerf();
        });
    }
    const perfResetBtn = document.getElementById('performance-filter-reset');
    if (perfResetBtn) {
        perfResetBtn.addEventListener('click', () => {
            performanceProduct = '';
            performanceCampaign = '';
            if (perfProdSel) perfProdSel.value = '';
            if (perfCampSel) perfCampSel.value = '';
            invalidatePerformancePoolCache();  // ★ 공통 풀 캐시 무효화
            syncHiddenPerformanceSelects();
            debouncedRefreshPerf();
        });
    }

    // ★ AI 인사이트 섹션 통합 필터
    const aiProdSel = document.getElementById('ai-product-select');
    if (aiProdSel) {
        aiProdSel.addEventListener('change', () => {
            aiProduct = aiProdSel.value || '';
            syncHiddenAiSelect();
            debouncedRefreshAi();
        });
    }
    const aiCampSel = document.getElementById('ai-campaign-select');
    if (aiCampSel) {
        aiCampSel.addEventListener('change', () => {
            aiCampaign = aiCampSel.value || '';
            debouncedRefreshAi();
        });
    }
    const aiResetBtn = document.getElementById('ai-filter-reset');
    if (aiResetBtn) {
        aiResetBtn.addEventListener('click', () => {
            aiProduct = '';
            aiCampaign = '';
            if (aiProdSel) aiProdSel.value = '';
            if (aiCampSel) aiCampSel.value = '';
            syncHiddenAiSelect();
            debouncedRefreshAi();
        });
    }

    document.getElementById('detail-modal').addEventListener('click', (e) => {
        if (e.target.id === 'detail-modal') closeModal();
    });

    // 💱 환율 설정
    const fxInput = document.getElementById('fx-rate-input');
    const fxBtn = document.getElementById('btn-apply-fx');
    if (fxInput && typeof window.getFxRate === 'function') {
        // 초기값 표시
        fxInput.value = window.getFxRate();
    }
    if (fxBtn && fxInput) {
        fxBtn.addEventListener('click', async () => {
            const newRate = parseFloat(fxInput.value);
            if (isNaN(newRate) || newRate <= 0) {
                alert('올바른 환율을 입력해주세요. (예: 9.5)');
                return;
            }
            if (typeof window.setFxRate === 'function') {
                window.setFxRate(newRate);
            }
            // 시트 데이터 재로드 (환율 변경 후 다시 환산)
            fxBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            fxBtn.disabled = true;
            try {
                if (typeof window.tryLoadSavedSheet === 'function') {
                    const sheetData = await window.tryLoadSavedSheet();
                    if (sheetData && sheetData.length) {
                        allCreatives = sheetData;
                        window.allCreatives = allCreatives;
                    }
                }
                updateDashboard();
                document.getElementById('last-updated').textContent = new Date().toLocaleString('ko-KR');
            } catch (e) {
                console.error('환율 적용 실패', e);
            } finally {
                fxBtn.innerHTML = '<i class="fas fa-check"></i>';
                fxBtn.disabled = false;
            }
        });
        // Enter 키로 적용
        fxInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') fxBtn.click();
        });
    }
}

// ============================
// Section Switching (Lazy Render)
// ============================
// ★ 속도 개선: 섹션 진입 시점에만 해당 섹션을 렌더 (탭이 비활성일 때는 스킵)
let _renderedSections = { overview: true, unified: false, performance: false, ai: false, megawari: false, weekly: false, funnel: false, gmv: false };
let _currentSection = 'overview';

function switchSection(sectionName) {
    _currentSection = sectionName;
    document.querySelectorAll('.section-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.section === sectionName);
    });
    document.querySelectorAll('.section-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.panel === sectionName);
    });

    // ★ stale(_renderedSections=false) 이거나 첫 진입이면 렌더
    //   updateDashboard에서 브랜드 변경 시 비활성 섹션을 false로 마킹해두므로
    //   탭 전환 시 자동으로 최신 데이터로 재렌더됨
    if (!_renderedSections[sectionName]) {
        _renderedSections[sectionName] = true;
        const panel = document.querySelector(`.section-panel[data-panel="${sectionName}"]`);
        if (panel) panel.classList.add('section-loading');
        requestAnimationFrame(() => {
            if (sectionName === 'overview') {
                // 브랜드 바뀐 뒤 개요로 돌아오면 위닝 요소 재렌더
                if (typeof renderWinningElements === 'function') renderWinningElements();
            } else if (sectionName === 'unified') {
                if (typeof window.renderUnifiedBriefing === 'function') window.renderUnifiedBriefing();
            } else if (sectionName === 'performance') {
                renderPerformanceCriteriaBadge();
                renderScatterChart();
                renderSpendScatterChart();
                renderSaturationChart();
                renderCartLeakRanking();
                renderAppealInsight();
                renderProductPerformance();
                renderPlatformCreativeMatrix();
            } else if (sectionName === 'ai') {
                if (typeof window.renderAIInsights === 'function') window.renderAIInsights();
            } else if (sectionName === 'megawari') {
                if (typeof window.renderMegawariPanel === 'function') window.renderMegawariPanel();
            } else if (sectionName === 'weekly') {
                if (typeof window.renderWeeklyReport === 'function') window.renderWeeklyReport();
            } else if (sectionName === 'funnel' || sectionName === 'gmv') {
                // iframe 통합 탭: 첫 진입 시에만 src 주입 (레이지 로드) + 전역 브랜드 전달
                const frame = document.getElementById(sectionName + '-frame');
                if (frame && !frame.src && frame.dataset.src) {
                    const b = (typeof currentBrand !== 'undefined') ? currentBrand : 'ALL';
                    // iframe은 로드 완료(onload) 시점에 로딩 표시 해제 (빈 화면 방지)
                    frame.addEventListener('load', () => { if (panel) panel.classList.remove('section-loading'); }, { once: true });
                    frame.src = frame.dataset.src + '?brand=' + encodeURIComponent(b);
                    return; // 로딩 해제를 onload에 위임 (아래 즉시 해제 스킵)
                }
            }
            if (panel) panel.classList.remove('section-loading');
        });
    }

    // 차트 리사이즈 (display:none → block 전환 시 Chart.js가 캔버스 크기를 못 잡는 문제 방지)
    setTimeout(() => {
        const activePanel = document.querySelector('.section-panel:not([style*="display: none"]):not([style*="display:none"])');
        Object.values(charts).forEach(c => {
            if (!c || typeof c.resize !== 'function') return;
            const canvas = c.canvas;
            if (canvas && activePanel && activePanel.contains(canvas)) {
                c.resize();
            }
        });
    }, 50);
    // 스크롤 위치 위로
    window.scrollTo({ top: document.querySelector('main').offsetTop - 20, behavior: 'smooth' });
}
window.switchSection = switchSection;

// ★ 주간 업무 등 외부 JS에서 브랜드 상태를 읽을 수 있도록 getter 노출
window.getCurrentBrand = () => currentBrand;

// ★ 현재 적용 필터 요약 칩 갱신 (헤더에 상시 표시)
function updateActiveFilterChip() {
    const el = document.getElementById('active-filter-chip');
    if (!el) return;
    const parts = [];
    parts.push(currentBrand && currentBrand !== 'ALL' ? currentBrand : '전체 브랜드');
    if (currentPlatform) parts.push(currentPlatform);
    if (currentRetail)   parts.push(currentRetail);
    if (currentEvent)    parts.push(currentEvent);
    el.textContent = '🔎 ' + parts.join(' · ');
}
window.updateActiveFilterChip = updateActiveFilterChip;

// ============================
// Filtering
// ============================
function getBrandCreatives(scope) {
    let list = (currentBrand === 'ALL')
        ? allCreatives
        : allCreatives.filter(c => c.brand === currentBrand);
    // ★ 전역 매체(Platform) 필터 적용 (선택 시)
    if (currentPlatform) {
        list = list.filter(c => (c.platform || '').toString().trim() === currentPlatform);
    }
    // ★ 전역 Retail 채널 필터 적용 (선택 시)
    if (currentRetail) {
        list = list.filter(c => (c.retail || '').toString().trim() === currentRetail);
    }
    // ★ 전역 Event 필터 적용 (선택 시)
    if (currentEvent) {
        list = list.filter(c => (c.event || '').toString().trim() === currentEvent);
    }
    // ★ 전역 캠페인 필터 적용 (선택 시)
    if (currentCampaign) {
        list = list.filter(c => matchCampaign(c, currentCampaign));
    }
    // ★ 섹션 단위 필터 (scope = 'performance' | 'ai')
    if (scope === 'performance') {
        if (performanceProduct) {
            list = list.filter(c => (c.product || '').trim() === performanceProduct);
        }
        if (performanceCampaign) {
            list = list.filter(c => matchCampaign(c, performanceCampaign));
        }
    } else if (scope === 'ai') {
        if (aiProduct) {
            list = list.filter(c => (c.product || '').trim() === aiProduct);
        }
        if (aiCampaign) {
            list = list.filter(c => matchCampaign(c, aiCampaign));
        }
    }
    return list;
}

// 캠페인 매칭 헬퍼 (단일 또는 합산 _campaigns 배열 모두 처리)
function matchCampaign(c, campaign) {
    const cn = (c.campaign_name || '').toString().trim();
    if (cn === campaign) return true;
    if (Array.isArray(c._campaigns) && c._campaigns.includes(campaign)) return true;
    return false;
}

// 현재 브랜드 기준 캠페인 목록 추출 (드롭다운 채우기용)
function getAvailableCampaigns() {
    let base = (currentBrand === 'ALL')
        ? allCreatives
        : allCreatives.filter(c => c.brand === currentBrand);
    if (currentPlatform) base = base.filter(c => (c.platform || '').toString().trim() === currentPlatform);
    if (currentRetail)   base = base.filter(c => (c.retail   || '').toString().trim() === currentRetail);
    const set = new Set();
    base.forEach(c => {
        const cn = (c.campaign_name || '').toString().trim();
        if (cn) {
            // "A 외 N건" 형태는 분해해서 원본 캠페인만 등록
            if (Array.isArray(c._campaigns) && c._campaigns.length) {
                c._campaigns.forEach(x => x && set.add(x));
            } else {
                set.add(cn);
            }
        }
    });
    return Array.from(set).sort();
}

// 캠페인 드롭다운 채우기
function populateCampaignOptions() {
    const sel = document.getElementById('campaign-select');
    const countEl = document.getElementById('campaign-count');
    if (!sel) return;
    const campaigns = getAvailableCampaigns();
    const current = sel.value;
    sel.innerHTML = '<option value="">전체 캠페인</option>' +
        campaigns.map(c => `<option value="${c.replace(/"/g, '&quot;')}">${c}</option>`).join('');
    // 현재 선택 값이 새 목록에 있으면 유지, 없으면 전체로 리셋
    if (current && campaigns.includes(current)) {
        sel.value = current;
        currentCampaign = current;
    } else {
        sel.value = '';
        currentCampaign = '';
    }
    if (countEl) countEl.textContent = `· ${campaigns.length}개`;
}

// ============================
// 매체(Platform) 필터 — 브랜드별 가용 매체 목록
// ============================
// 현재 브랜드+Retail 기준 매체 목록 추출
function getAvailablePlatforms() {
    let base = (currentBrand === 'ALL') ? allCreatives : allCreatives.filter(c => c.brand === currentBrand);
    if (currentRetail) base = base.filter(c => (c.retail || '').toString().trim() === currentRetail);
    const map = new Map();
    base.forEach(c => {
        const p = (c.platform || '').toString().trim();
        if (p) map.set(p, (map.get(p) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

// 매체 드롭다운 채우기 (브랜드 변경 시 재구성)
function populatePlatformOptions() {
    const sel = document.getElementById('platform-select');
    const countEl = document.getElementById('platform-count');
    if (!sel) return;
    const platforms = getAvailablePlatforms();
    const current = sel.value;
    const totalCount = platforms.reduce((s, p) => s + p.count, 0);

    sel.innerHTML = `<option value="">전체 매체 (${totalCount}건)</option>` +
        platforms.map(p =>
            `<option value="${p.name.replace(/"/g, '&quot;')}">${p.name} (${p.count}건)</option>`
        ).join('');

    // 현재 선택 값이 새 목록에 있으면 유지, 없으면 전체로 리셋
    const platformNames = platforms.map(p => p.name);
    if (current && platformNames.includes(current)) {
        sel.value = current;
        currentPlatform = current;
    } else {
        sel.value = '';
        currentPlatform = '';
    }
    if (countEl) {
        countEl.textContent = platforms.length ? `${platforms.length}개 매체` : '';
    }

    // 매체가 1개 이하면 필터 자체를 숨김 (선택지가 없으면 의미 없음)
    const wrap = document.getElementById('platform-filter-wrap');
    if (wrap) {
        wrap.style.display = platforms.length >= 2 ? '' : 'none';
    }
}

// ============================
// Retail 채널 필터 — 전역 (브랜드·매체 필터 이후 적용)
// ============================
// 현재 브랜드+매체 기준 Retail 채널 목록 추출
function getAvailableRetailChannels() {
    let base = (currentBrand === 'ALL') ? allCreatives : allCreatives.filter(c => c.brand === currentBrand);
    if (currentPlatform) base = base.filter(c => (c.platform || '').toString().trim() === currentPlatform);
    const map = new Map();
    base.forEach(c => {
        const r = (c.retail || '').toString().trim();
        if (r) map.set(r, (map.get(r) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function populateRetailOptions() {
    const sel = document.getElementById('retail-select');
    const countEl = document.getElementById('retail-count');
    const wrap = document.getElementById('retail-filter-wrap');
    if (!sel || !wrap) return;

    const channels = getAvailableRetailChannels();

    // retail 컬럼 데이터가 없으면 필터 자체 숨김
    if (channels.length < 1) {
        wrap.classList.add('hidden');
        return;
    }
    wrap.classList.remove('hidden');

    const totalCount = channels.reduce((s, c) => s + c.count, 0);
    const current = sel.value;
    sel.innerHTML = `<option value="">전체 (${totalCount}건)</option>` +
        channels.map(c =>
            `<option value="${c.name.replace(/"/g, '&quot;')}">${c.name} (${c.count}건)</option>`
        ).join('');

    const names = channels.map(c => c.name);
    if (current && names.includes(current)) {
        sel.value = current;
        currentRetail = current;
    } else {
        sel.value = '';
        currentRetail = '';
    }
    if (countEl) countEl.textContent = channels.length ? `${channels.length}개 채널` : '';
}

// ============================
// Event 필터 — 전역 (브랜드·매체·Retail 이후 적용)
// ============================
function getAvailableEvents() {
    let base = (currentBrand === 'ALL') ? allCreatives : allCreatives.filter(c => c.brand === currentBrand);
    if (currentPlatform) base = base.filter(c => (c.platform || '').toString().trim() === currentPlatform);
    if (currentRetail)   base = base.filter(c => (c.retail   || '').toString().trim() === currentRetail);
    const map = new Map();
    base.forEach(c => {
        const ev = (c.event || '').toString().trim();
        if (ev) map.set(ev, (map.get(ev) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function populateEventOptions() {
    const sel   = document.getElementById('event-select');
    const countEl = document.getElementById('event-count');
    const wrap  = document.getElementById('event-filter-wrap');
    if (!sel || !wrap) return;

    const events = getAvailableEvents();
    if (events.length < 1) {
        wrap.classList.add('hidden');
        currentEvent = '';
        return;
    }
    wrap.classList.remove('hidden');

    const totalCount = events.reduce((s, e) => s + e.count, 0);
    const current = sel.value;
    sel.innerHTML = `<option value="">전체 이벤트 (${totalCount}건)</option>` +
        events.map(e => `<option value="${e.name.replace(/"/g,'&quot;')}">${e.name} (${e.count}건)</option>`).join('');

    const names = events.map(e => e.name);
    if (current && names.includes(current)) {
        sel.value = current;
        currentEvent = current;
    } else {
        sel.value = '';
        currentEvent = '';
    }
    if (countEl) countEl.textContent = events.length ? `${events.length}개 이벤트` : '';
}

// ============================
// ★ 섹션 단위 필터 (성과 분석 / AI 인사이트) — 제품+캠페인
// ============================
// 섹션별 제품 옵션 목록 (현재 브랜드+전역 캠페인 기준)
function getSectionProductList() {
    // scope 없이 전역 필터까지만 적용한 결과로 옵션 산출
    const base = getBrandCreatives();
    return Array.from(new Set(
        base.map(c => (c.product || '').trim()).filter(Boolean)
    )).sort();
}

// 섹션별 캠페인 옵션 목록 (현재 브랜드 기준 — 섹션 제품 선택 영향 X)
function getSectionCampaignList() {
    // 전역 캠페인 필터는 무시하고 브랜드 기준 전체 캠페인 풀
    return getAvailableCampaigns();
}

// 성과 분석 섹션 필터 옵션 채우기
function populatePerformanceFilterOptions() {
    const prodSel = document.getElementById('performance-product-select');
    const campSel = document.getElementById('performance-campaign-select');
    const products = getSectionProductList();
    const campaigns = getSectionCampaignList();

    if (prodSel) {
        const cur = performanceProduct;
        prodSel.innerHTML = '<option value="">전체 제품</option>' +
            products.map(p => `<option value="${p.replace(/"/g, '&quot;')}">${p}</option>`).join('');
        if (cur && products.includes(cur)) {
            prodSel.value = cur;
        } else {
            prodSel.value = '';
            performanceProduct = '';
        }
    }
    if (campSel) {
        const cur = performanceCampaign;
        campSel.innerHTML = '<option value="">전체 캠페인</option>' +
            campaigns.map(c => `<option value="${c.replace(/"/g, '&quot;')}">${c}</option>`).join('');
        if (cur && campaigns.includes(cur)) {
            campSel.value = cur;
        } else {
            campSel.value = '';
            performanceCampaign = '';
        }
    }
    // 호환용 hidden 셀렉트 동기화
    syncHiddenPerformanceSelects();
}

// AI 인사이트 섹션 필터 옵션 채우기
function populateAiFilterOptions() {
    const prodSel = document.getElementById('ai-product-select');
    const campSel = document.getElementById('ai-campaign-select');
    const products = getSectionProductList();
    const campaigns = getSectionCampaignList();

    if (prodSel) {
        const cur = aiProduct;
        prodSel.innerHTML = '<option value="">전체 제품</option>' +
            products.map(p => `<option value="${p.replace(/"/g, '&quot;')}">${p}</option>`).join('');
        if (cur && products.includes(cur)) {
            prodSel.value = cur;
        } else {
            prodSel.value = '';
            aiProduct = '';
        }
    }
    if (campSel) {
        const cur = aiCampaign;
        campSel.innerHTML = '<option value="">전체 캠페인</option>' +
            campaigns.map(c => `<option value="${c.replace(/"/g, '&quot;')}">${c}</option>`).join('');
        if (cur && campaigns.includes(cur)) {
            campSel.value = cur;
        } else {
            campSel.value = '';
            aiCampaign = '';
        }
    }
    // 호환용 hidden 셀렉트 동기화 (ai-insights-product-select)
    syncHiddenAiSelect();
}

// 기존 hidden 셀렉트 동기화 (구 코드 호환)
function syncHiddenPerformanceSelects() {
    const oldProd = document.getElementById('product-select');
    const oldAppeal = document.getElementById('appeal-insight-product-select');
    const oldMatrix = document.getElementById('platform-matrix-product-select');
    [oldProd, oldAppeal, oldMatrix].forEach(s => {
        if (s) s.value = performanceProduct || '';
    });
}
function syncHiddenAiSelect() {
    const oldAi = document.getElementById('ai-insights-product-select');
    if (oldAi) oldAi.value = aiProduct ? aiProduct : '__all__';
}



// 성과 분석 섹션 컨텐츠만 다시 그리기
function refreshPerformanceSection() {
    renderPerformanceCriteriaBadge();
    renderScatterChart();
    renderSpendScatterChart();
    renderSaturationChart();
    renderCartLeakRanking();
    renderAppealInsight();
    renderProductPerformance();
    renderPlatformCreativeMatrix();
}

// ★ 성과 분석 탭 공통 선정 기준 배지 렌더
function renderPerformanceCriteriaBadge() {
    const el = document.getElementById('performance-criteria-badge');
    if (!el) return;
    const pool = getPerformancePool();
    if (!pool || pool.qualifiedCount === 0) {
        el.innerHTML = '';
        return;
    }
    el.innerHTML = buildPerformanceCriteriaBadge();
}

// AI 인사이트 섹션 컨텐츠만 다시 그리기
function refreshAiSection() {
    if (typeof window.renderAIInsights === 'function') window.renderAIInsights();
}

// ============================
// Dashboard Update
// ============================
function updateDashboard() {
    populateCampaignOptions(); // ★ 전역 캠페인 옵션 먼저 (필터 기준 갱신)
    populatePerformanceFilterOptions(); // ★ 성과 분석 섹션 필터
    populateAiFilterOptions();           // ★ AI 인사이트 섹션 필터
    populateWinningProductOptions();     // ★ 위닝 요소 인사이트 제품 필터
    populateGalleryAppealOptions();      // ★ 갤러리 소구포인트 필터
    updateKPIs();
    updateCharts();
    // renderProductKPIs(); // 제거됨 (제품별 성과 요약 섹션 제거)
    populateProductOptions();
    populateAppealInsightProductOptions();
    populatePlatformMatrixProductOptions();
    // ★ 속도 개선: 활성 섹션만 렌더 (비활성 섹션은 진입 시 lazy render)
    if (_renderedSections.performance) {
        renderPerformanceCriteriaBadge();
        renderScatterChart();
        renderSpendScatterChart();
        renderSaturationChart();
        renderCartLeakRanking();
        renderProductPerformance();
    }
    if (_renderedSections.ai && typeof window.renderAIInsights === 'function') {
        window.renderAIInsights();
    }
    if (_renderedSections.megawari && typeof window.renderMegawariPanel === 'function') {
        window._mwSelectedDate = null; // 브랜드 바뀌면 날짜 초기화
        window.renderMegawariPanel();
    }
}

// ★ ROAS outlier 필터: 광고비가 너무 적은 행은 비교에서 제외 (환율 환산 후 원화 기준)
// 엔화 ¥1 × 9.5원/¥ = 약 ₩10이므로, 원화 ₩10,000 미만(=대략 ¥1,000 미만)은 제외
const MIN_SPEND_FOR_ROAS = 10000; // 광고비 ₩10,000 미만은 ROAS 차트/비교에서 제외

function filterValidRoas(list) {
    return list.filter(c => (c.spend || 0) >= MIN_SPEND_FOR_ROAS && (c.roas || 0) > 0);
}

// ============================
// ★ 공통 중앙값(median) 광고비 필터
// ============================
// 모든 랭킹/추천/인사이트 컨텐츠의 선정 기준을 통일:
//   1) 양수 광고비를 가진 소재의 중앙값(median spend) 산출
//   2) 중앙값 이상 광고비가 집행된 소재만 후보로 사용
//   3) MIN_SPEND_FOR_ROAS 하한선도 함께 적용 (원래 ₩10,000 미만 제외)
//   4) 후보가 minRequired 미만이면 광고비 상위로 보충 (랭킹 비는 것 방지)
function getSpendMedian(list) {
    const spends = list
        .map(c => Number(c.spend) || 0)
        .filter(s => s > 0);
    if (!spends.length) return 0;
    const sorted = spends.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

function filterByMedianSpend(list, opts) {
    if (!Array.isArray(list) || !list.length) return { qualified: [], medianSpend: 0, threshold: 0 };
    const minRequired = (opts && opts.minRequired) || 5;
    const enforceMinFloor = !(opts && opts.skipFloor); // 기본은 ₩10,000 하한선 적용
    const med = getSpendMedian(list);
    const threshold = enforceMinFloor ? Math.max(med, MIN_SPEND_FOR_ROAS) : med;

    let qualified = list.filter(c => (Number(c.spend) || 0) >= threshold);

    // 후보 수가 너무 적으면 광고비 상위로 보충 (list.length 조건 제거 — 소규모 플랫폼/X/Meta 포함)
    if (qualified.length < minRequired) {
        const sortedBySpend = [...list].sort((a, b) => (Number(b.spend) || 0) - (Number(a.spend) || 0));
        qualified = sortedBySpend.slice(0, Math.max(Math.min(minRequired, list.length), qualified.length));
    }
    return { qualified, medianSpend: med, threshold };
}

// 전역 노출 (insights.js 등에서 사용)
window.getSpendMedian = getSpendMedian;
window.filterByMedianSpend = filterByMedianSpend;
window.MIN_SPEND_FOR_ROAS = MIN_SPEND_FOR_ROAS;
// ★ aggregateByAdName도 노출 (insights.js에서 사용)
// (hoisting되므로 함수 선언 전에 노출해도 OK)
window.aggregateByAdName = aggregateByAdName;

// ============================
// ★★★ 성과 분석 탭 공통 선정 기준 (단일 표준)
// ============================
// 성과 분석 탭의 모든 컨텐츠(BEST/WORST TOP 5, 매체×소재 조합 TOP,
// 제품별 소구포인트 인사이트)가 "동일한 기준의 동일한 풀"을 사용하도록 통일.
//
// [선정 기준 — 단일 표준]
//   1) 현재 브랜드 + 성과 분석 섹션 필터(제품/캠페인) 반영
//   2) ad_name 단위로 일별 breakdown 합산 (aggregateByAdName)
//   3) 광고비 > 0 (전환 미측정 X/Meta/TikTok 포함 — ROAS 필터 제거)
//   4) 광고비 중앙값(median spend) 이상 + ₩10,000 하한선 (filterByMedianSpend)
//   5) minRequired=5 (후보 부족 시 광고비 상위로 보충)
//   ★ ROAS 기반 분석(scatter/appeal insight)은 각 렌더 함수에서 roas>0 필터 적용
// ============================
const PERFORMANCE_MIN_REQUIRED = 5; // 모든 컨텐츠 공통 minRequired

// 전환 미측정 플랫폼 — CV/CVR/ROAS 측정 불가, CTR 기준으로 자동 전환
const NO_CONV_PLATFORMS = ['x', 'meta', 'tiktok'];
function isNoConvPlatform(platform) {
    if (!platform) return false;
    const lc = platform.toLowerCase();
    // "single one ..." 계열은 전환 추적 있음 → noConv 아님
    if (lc.includes('single')) return false;
    return NO_CONV_PLATFORMS.some(p => lc === p || lc.includes(p));
}

// BEST/WORST 선정용: 트래킹 안 되는 브로드 매체 행 제외 필터
// "Meta(broad)", "TikTok(broad)" 등 isNoConvPlatform=true 행은 제외
// "Single One Meta", "Single One TikTok" 등 tracked 계열은 유지
// ★ 캐시: 동일 입력 배열 참조에 대해 재계산 방지 (WeakMap 활용)
const _trackedOnlyCache = new WeakMap();
function filterTrackedOnly(rows) {
    if (_trackedOnlyCache.has(rows)) return _trackedOnlyCache.get(rows);
    const tracked = rows.filter(c => !isNoConvPlatform(c.platform));
    const result = tracked.length > 0 ? tracked : rows;
    try { _trackedOnlyCache.set(rows, result); } catch (_) {}
    return result;
}

// ★ 장바구니 최적화 모드 감지
// 현재 필터 기준 데이터에 add_to_cart 값이 있으면 장바구니 캠페인으로 판단
function isCartMode(dataPool) {
    if (!Array.isArray(dataPool) || !dataPool.length) return false;
    return dataPool.some(c => (c.add_to_cart || 0) > 0);
}

// 캐시 (currentBrand/currentPlatform/currentRetail/performanceProduct/performanceCampaign 동일하면 재사용)
let _performancePoolCache = null;
function invalidatePerformancePoolCache() { _performancePoolCache = null; }
window.invalidatePerformancePoolCache = invalidatePerformancePoolCache;

function getPerformancePool() {
    // 캐시 키 (platform/retail 포함 — 매체 필터 변경 시 재계산 필요)
    const cacheKey = `${currentBrand}|${currentPlatform}|${currentRetail}|${currentEvent}|${performanceProduct}|${performanceCampaign}`;
    if (_performancePoolCache && _performancePoolCache.key === cacheKey) {
        return _performancePoolCache.value;
    }

    // 1) 브랜드 + 섹션 필터 적용
    let base = getBrandCreatives('performance');

    // 2) ad_name 단위 집계
    if (typeof aggregateByAdName === 'function') {
        base = aggregateByAdName(base);
    }

    // 3) 노출/클릭/광고비 중 하나라도 있으면 포함 (X/Meta/TikTok 인지도 캠페인 등 spend=0 케이스 포함)
    const filtered = base.filter(c => (c.impressions || 0) > 0 || (c.clicks || 0) > 0 || (c.spend || 0) > 0);
    // 모두 걸러지면 원본 유지 (컬럼명 불인식 등으로 숫자가 전부 0인 경우 대비)
    base = filtered.length > 0 ? filtered : base;

    // 4) 중앙값 광고비 + ₩10,000 하한선
    const { qualified, medianSpend, threshold } = filterByMedianSpend(base, { minRequired: PERFORMANCE_MIN_REQUIRED });

    const result = {
        key: cacheKey,
        value: {
            base,              // ad_name 집계 + spend>0 통과한 전체 (광고비 미달 포함)
            qualified,         // ★ 최종 선정 풀 (모든 컨텐츠가 이걸 사용)
            medianSpend,       // 광고비 중앙값
            threshold,         // 적용된 임계값 (max(median, ₩10,000))
            totalCount: base.length,
            qualifiedCount: qualified.length,
            scopeProduct: performanceProduct,
            scopeCampaign: performanceCampaign,
            scopeBrand: currentBrand,
        }
    };
    _performancePoolCache = result;
    return result.value;
}
window.getPerformancePool = getPerformancePool;

// 공통 선정 기준 안내 배지 HTML
function buildPerformanceCriteriaBadge() {
    const pool = getPerformancePool();
    const scopeBits = [];
    if (pool.scopeBrand && pool.scopeBrand !== 'ALL') scopeBits.push(`<b>${pool.scopeBrand}</b>`);
    else scopeBits.push('<b>전체 브랜드</b>');
    if (pool.scopeProduct) scopeBits.push(`<b>${pool.scopeProduct}</b>`);
    if (pool.scopeCampaign) scopeBits.push(`<b>${pool.scopeCampaign}</b>`);

    return `
        <div class="perf-criteria-badge">
            <div class="perf-criteria-main">
                <i class="fas fa-filter"></i>
                <span>${scopeBits.join(' · ')}</span>
                <span class="perf-criteria-divider">·</span>
                <span>중앙값 광고비 <b>₩${formatNumber(Math.round(pool.medianSpend))}</b> 이상 <b>${pool.qualifiedCount}개</b> 소재</span>
            </div>
            <div class="perf-criteria-sub">
                <i class="fas fa-info-circle"></i>
                <span>아래 모든 컨텐츠는 동일한 기준으로 선정됩니다 · ad_name 단위 매체 종합 합산 · 광고비 중앙값/₩10,000 이상 · 브로드 Meta·TikTok 제외(전환 미측정) · Single One 계열 포함</span>
            </div>
        </div>
    `;
}
window.buildPerformanceCriteriaBadge = buildPerformanceCriteriaBadge;

// ============================
// KPI 증감 배지 헬퍼 — 최근 7일 vs 직전 7일 비교
// start_date 없거나 날짜 범위 미충족 시 fallback 처리
// ============================
function calcKpiTrend(rawList) {
    // start_date 필드가 있는 소재만 추출
    const dated = rawList.filter(c => {
        if (!c.start_date) return false;
        const d = new Date(c.start_date);
        return !isNaN(d.getTime());
    });
    if (dated.length < 2) return null; // 날짜 데이터 부족 → fallback

    // 날짜 정렬
    dated.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    const allDates = dated.map(c => new Date(c.start_date));
    const minDate = allDates[0];
    const maxDate = allDates[allDates.length - 1];
    const spanMs = maxDate - minDate;

    // 전체 기간이 너무 짧으면 반반 나눔, 충분하면 후반부 vs 전반부
    const midDate = new Date(minDate.getTime() + spanMs / 2);

    function sumPeriod(list, from, to) {
        const inRange = list.filter(c => {
            const d = new Date(c.start_date);
            return d >= from && d <= to;
        });
        if (!inRange.length) return null;
        return {
            impressions: inRange.reduce((s, c) => s + (Number(c.impressions) || 0), 0),
            clicks:      inRange.reduce((s, c) => s + (Number(c.clicks)      || 0), 0),
            spend:       inRange.reduce((s, c) => s + (Number(c.spend)       || 0), 0),
            conversions: inRange.reduce((s, c) => s + (Number(c.conversions) || 0), 0),
            revenue:     inRange.reduce((s, c) => s + (Number(c.revenue)     || 0), 0),
        };
    }

    const cur  = sumPeriod(dated, midDate, maxDate);
    const prev = sumPeriod(dated, minDate, new Date(midDate.getTime() - 1));
    if (!cur || !prev) return null;

    const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;

    function pctDiff(a, b) {
        if (!b || b === 0) return null;
        return ((a - b) / b) * 100;
    }

    const curCtr  = cur.impressions  > 0 ? cur.clicks / cur.impressions : 0;
    const prevCtr = prev.impressions > 0 ? prev.clicks / prev.impressions : 0;
    const curRoas  = cur.spend  > 0 ? cur.revenue / cur.spend : 0;
    const prevRoas = prev.spend > 0 ? prev.revenue / prev.spend : 0;

    return {
        impressions: pctDiff(cur.impressions, prev.impressions),
        clicks:      pctDiff(cur.clicks, prev.clicks),
        spend:       pctDiff(cur.spend, prev.spend),
        conversions: pctDiff(cur.conversions, prev.conversions),
        ctr:         prevCtr > 0 ? ((curCtr - prevCtr) / prevCtr * 100) : null,
        roas:        prevRoas > 0 ? ((curRoas - prevRoas) / prevRoas * 100) : null,
        periodLabel: `${fmt(midDate)}~${fmt(maxDate)} vs ${fmt(minDate)}~${fmt(new Date(midDate.getTime()-1))}`,
    };
}

// ============================
// 소재 피로도 감지 (allCreatives 기반)
// 동일 ad_name의 날짜별 다중 행이 있을 경우 전반부/후반부 CTR 비교
// ============================
function detectCreativeFatigue(allList) {
    // ad_name별로 날짜 행 그룹핑
    const byName = new Map();
    allList.forEach(c => {
        if (!c.start_date || !c.ad_name) return;
        const key = (c.brand || '') + '||' + (c.ad_name || '');
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(c);
    });

    const fatigued = new Set(); // 피로도 경고 소재의 ad_name 키
    byName.forEach((rows, key) => {
        if (rows.length < 3) return; // 최소 3개 행(날짜)이 있어야 의미 있음
        rows.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
        const half = Math.floor(rows.length / 2);
        const early = rows.slice(0, half);
        const late  = rows.slice(half);
        const avgCtr = arr => {
            const valid = arr.filter(c => Number(c.impressions) > 0);
            if (!valid.length) return 0;
            return valid.reduce((s, c) => s + (Number(c.clicks) / Number(c.impressions)), 0) / valid.length;
        };
        const earlyCtr = avgCtr(early);
        const lateCtr  = avgCtr(late);
        if (earlyCtr > 0 && lateCtr < earlyCtr * 0.8) { // 20% 이상 하락
            fatigued.add(key);
        }
    });
    return fatigued;
}

function renderKpiTrendBadge(elId, pct, opts = {}) {
    const el = document.getElementById(elId);
    if (!el) return;
    // pct === null → fallback 텍스트
    if (pct === null || pct === undefined) {
        el.innerHTML = opts.fallback || '';
        el.className = 'kpi-trend text-slate-400';
        return;
    }
    const abs   = Math.abs(pct).toFixed(1);
    const up    = pct >= 0;
    const icon  = up ? 'fa-arrow-up' : 'fa-arrow-down';
    const color = up ? (opts.invertGood ? 'text-rose-500' : 'text-emerald-600')
                     : (opts.invertGood ? 'text-emerald-600' : 'text-rose-500');
    const sign  = up ? '+' : '-';
    el.innerHTML = `<i class="fas ${icon}"></i> ${sign}${abs}%`;
    el.className = `kpi-trend ${color}`;
    el.title     = opts.title || `직전 7일 대비 ${sign}${abs}%`;
}

function updateKPIs() {
    // ★ aggregateByAdName 적용 — 성과 분석 섹션과 동일한 소재 단위 집계
    //   raw 일별 데이터를 직접 합산하면 숫자가 맞지만
    //   성과 분석 섹션도 같은 집계 기준을 쓰므로 일관성 보장
    const rawList  = getBrandCreatives();
    const list = (typeof aggregateByAdName === 'function') ? aggregateByAdName(rawList) : rawList;

    const impressions = list.reduce((s, c) => s + (Number(c.impressions) || 0), 0);
    const clicks      = list.reduce((s, c) => s + (Number(c.clicks)      || 0), 0);
    const spend       = list.reduce((s, c) => s + (Number(c.spend)       || 0), 0);
    const conversions = list.reduce((s, c) => s + (Number(c.conversions) || 0), 0);
    const revenue     = list.reduce((s, c) => s + (Number(c.revenue)     || 0), 0);
    const spendJpy    = list.reduce((s, c) => s + (Number(c.spend_jpy)   || 0), 0);

    // ★ 진단 로그 — raw vs 집계 차이 확인
    const rawSpend = rawList.reduce((s, c) => s + (Number(c.spend) || 0), 0);
    if (Math.abs(rawSpend - spend) > 1) {
        console.warn(`[KPI] raw vs 집계 광고비 차이: raw=₩${Math.round(rawSpend).toLocaleString()} / 집계=₩${Math.round(spend).toLocaleString()} (rawRows=${rawList.length}, aggRows=${list.length})`);
    }

    // CTR/CVR/ROAS는 비율(ratio) 기준 → 표시 시 ×100
    // ★ 가중평균 CTR = 전체 clicks / 전체 impressions (단순 평균보다 정확)
    const avgCtrRatio = impressions > 0 ? (clicks / impressions) : 0;
    const roasRatio   = spend > 0 ? (revenue / spend) : 0;

    // 노출/클릭/전환 — 풀 콤마 + 보조 한국어 단위
    document.getElementById('kpi-impressions').innerHTML = formatKpiCount(impressions);
    document.getElementById('kpi-clicks').innerHTML = formatKpiCount(clicks);
    document.getElementById('kpi-conversions').innerHTML = formatKpiCount(conversions);

    // CTR/ROAS — 비율 (그대로)
    document.getElementById('kpi-ctr').textContent = (avgCtrRatio * 100).toFixed(2) + '%';
    document.getElementById('kpi-roas').textContent = Math.round(roasRatio * 100) + '%';

    // 광고비 — ₩ 심볼 분리 + 풀 자릿수 콤마 + 보조 한국어 단위
    const spendEl = document.getElementById('kpi-spend');
    spendEl.innerHTML = formatKpiCurrency(spend);
    if (spendJpy > 0) {
        spendEl.title = `원본: ¥${formatNumber(spendJpy)} (환율 ¥1 = ₩${(typeof window.getFxRate === 'function' ? window.getFxRate() : 9.5)})`;
    }

    // ★ KPI 증감 배지 — 최근 7일 vs 직전 7일 (start_date 없으면 정적 텍스트 fallback)
    const trend = calcKpiTrend(rawList);
    const fallbackStatic = (label) => `<span class="kpi-trend text-slate-400" style="font-size:10px">${label}</span>`;
    if (trend) {
        const label = `최근 7일 (${trend.periodLabel}) 직전 7일 대비`;
        renderKpiTrendBadge('kpi-trend-impressions', trend.impressions, { title: label });
        renderKpiTrendBadge('kpi-trend-clicks',      trend.clicks,      { title: label });
        renderKpiTrendBadge('kpi-trend-ctr',         trend.ctr,         { title: label });
        renderKpiTrendBadge('kpi-trend-spend',       trend.spend,       { title: label, invertGood: true });
        renderKpiTrendBadge('kpi-trend-conversions', trend.conversions, { title: label });
        renderKpiTrendBadge('kpi-trend-roas',        trend.roas,        { title: label });
    } else {
        // start_date 없거나 기간 데이터 부족 → 기존 정적 텍스트 유지
        const setFallback = (id, html, cls) => {
            const el = document.getElementById(id);
            if (el) { el.innerHTML = html; el.className = `kpi-trend ${cls}`; }
        };
        setFallback('kpi-trend-impressions', '<i class="fas fa-arrow-up"></i> 실시간', 'text-emerald-600');
        setFallback('kpi-trend-clicks',      '<i class="fas fa-arrow-up"></i> 실시간', 'text-emerald-600');
        setFallback('kpi-trend-ctr',         '소재 평균', 'text-slate-500');
        setFallback('kpi-trend-spend',       '누적 집행', 'text-slate-500');
        setFallback('kpi-trend-conversions', '<i class="fas fa-arrow-up"></i> 실시간', 'text-emerald-600');
        setFallback('kpi-trend-roas',        '매출 효율', 'text-white/80');
    }
}

// ============================
// Charts
// ============================
function updateCharts() {
    // 브랜드/플랫폼 차트는 개요에 항상 필요
    renderBrandChart();
    renderPlatformChart();
    // ★ 위닝 요소는 개요 탭이 활성일 때만 렌더 (매 브랜드 전환마다 실행되던 버그 수정)
    if (_currentSection === 'overview') {
        if (typeof renderWinningElements === 'function') renderWinningElements();
    }
    // 성과 분석 섹션은 진입했을 때만 렌더
    if (_renderedSections.performance) {
        renderAppealInsight();
        renderPlatformCreativeMatrix();
    }
}

function destroyChart(key) {
    if (charts[key]) {
        charts[key].destroy();
        delete charts[key];
    }
}

function renderBrandChart() {
    const brands = ['BOH', 'WM', 'CG'];
    const data = brands.map(b => {
        const list = allCreatives.filter(c => c.brand === b);
        const spend = list.reduce((s, c) => s + (c.spend || 0), 0);
        const revenue = list.reduce((s, c) => s + (c.revenue || 0), 0);
        return { brand: b, spend, revenue, roas: spend ? (revenue / spend) : 0 };
    });

    if (charts.brand) {
        charts.brand.data.datasets[0].data = data.map(d => d.spend);
        charts.brand.data.datasets[1].data = data.map(d => d.revenue);
        charts.brand.update('none');
        return;
    }

    const ctx = document.getElementById('brandChart');
    charts.brand = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: brands,
            datasets: [
                {
                    label: '광고비',
                    data: data.map(d => d.spend),
                    backgroundColor: brands.map(b => BRAND_COLORS[b] + '60'),
                    borderColor: brands.map(b => BRAND_COLORS[b]),
                    borderWidth: 2,
                    borderRadius: 6,
                    yAxisID: 'y'
                },
                {
                    label: '매출',
                    data: data.map(d => d.revenue),
                    backgroundColor: brands.map(b => BRAND_COLORS[b]),
                    borderRadius: 6,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.dataset.label + ': ₩' + formatNumber(ctx.parsed.y)
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => '₩' + formatNumber(v), font: { size: 10 } }
                },
                x: { ticks: { font: { size: 11, weight: 'bold' } } }
            }
        }
    });
}

function renderPlatformChart() {
    const list = getBrandCreatives();
    const platformMap = {};
    list.forEach(c => {
        platformMap[c.platform] = (platformMap[c.platform] || 0) + (c.spend || 0);
    });
    const labels = Object.keys(platformMap);
    const values = Object.values(platformMap);

    if (charts.platform) {
        charts.platform.data.labels = labels;
        charts.platform.data.datasets[0].data = values;
        charts.platform.data.datasets[0].backgroundColor = labels.map(l => PLATFORM_COLORS[l] || '#94a3b8');
        charts.platform.update('none');
        return;
    }

    const ctx = document.getElementById('platformChart');
    charts.platform = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: labels.map(l => PLATFORM_COLORS[l] || '#94a3b8'),
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const total = values.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.parsed / total) * 100).toFixed(1);
                            return ctx.label + ': ₩' + formatNumber(ctx.parsed) + ' (' + pct + '%)';
                        }
                    }
                }
            }
        }
    });
}

// 스캐터 차트 — 버블 클릭/hover 시 사용할 소재 매핑 (brand → index → creative)
let scatterCreativeMap = {};
const SCATTER_TOP_N = 30; // 브랜드별 광고비 상위 N개만 표시 (보조 캡)
let scatterMedianInfo = { medianSpend: 0, threshold: 0, qualifiedCount: 0 };

function renderScatterChart() {
    destroyChart('scatter');
    const noConv = isNoConvPlatform(currentPlatform);

    const baseList = (typeof aggregateByAdName === 'function')
        ? aggregateByAdName(getBrandCreatives('performance'))
        : getBrandCreatives('performance');

    let chartPool;
    if (noConv) {
        // X/Meta/TikTok: CTR > 0 또는 impressions > 0인 소재 전체 사용
        chartPool = baseList.filter(c => (c.ctr || 0) > 0 || (c.impressions || 0) > 0);
    } else {
        const roasValid = baseList.filter(c => (c.roas || 0) > 0);
        const { qualified, medianSpend, threshold } = filterByMedianSpend(roasValid, { minRequired: 10 });
        scatterMedianInfo = { medianSpend, threshold, qualifiedCount: qualified.length };
        chartPool = qualified;
    }

    // 차트 제목 동적 변경
    const titleEl = document.querySelector('#scatterChart')?.closest('section')?.querySelector('.chart-title');
    if (titleEl) {
        titleEl.innerHTML = noConv
            ? `<i class="fas fa-chart-scatter mr-2 text-indigo-500"></i>소재별 CTR × 노출수 분포`
            : `<i class="fas fa-chart-scatter mr-2 text-indigo-500"></i>소재별 CTR × ROAS 분포`;
    }

    scatterCreativeMap = {};
    let totalCount = 0;
    const maxImpr = noConv ? Math.max(...chartPool.map(c => c.impressions || 0), 1) : 1;

    const datasets = ['BOH', 'WM', 'CG'].map(brand => {
        const brandList = chartPool
            .filter(c => c.brand === brand)
            .sort((a, b) => noConv ? (b.impressions || 0) - (a.impressions || 0) : (b.spend || 0) - (a.spend || 0))
            .slice(0, SCATTER_TOP_N);
        totalCount += brandList.length;
        scatterCreativeMap[brand] = brandList;

        return {
            label: brand,
            data: brandList.map((c, idx) => ({
                x: (c.ctr || 0) * 100,
                y: noConv ? (c.impressions || 0) : (c.roas || 0) * 100,
                // ★ 버블 크기 로그 스케일 — 광고비 차이가 클 때 작은 버블이 뭉치는 현상 해소
                r: noConv
                    ? Math.max(5, Math.min(28, (Math.log10(Math.max((c.impressions || 1), 1)) / Math.log10(Math.max(maxImpr, 10))) * 28))
                    : Math.max(5, Math.min(28, Math.log10(Math.max((c.spend || 1), 1)) * 2.2)),
                name: c.creative_name || c.ad_name || '-',
                _idx: idx, _brand: brand, _id: c.id,
                spend: c.spend, revenue: c.revenue,
                spend_jpy: c.spend_jpy, revenue_jpy: c.revenue_jpy
            })),
            backgroundColor: BRAND_COLORS[brand] + 'aa',
            borderColor: BRAND_COLORS[brand],
            borderWidth: 1.5, hoverBorderWidth: 3, hoverBorderColor: '#0f172a'
        };
    });

    // 카운트 표시 갱신 (중앙값 기준)
    const countEl = document.getElementById('scatter-count-info');
    if (countEl) {
        const medText = scatterMedianInfo.threshold > 0
            ? `중앙값 ₩${formatNumber(Math.round(scatterMedianInfo.threshold))} 이상`
            : '중앙값 필터';
        countEl.textContent = `${medText} · 총 ${totalCount}개 표시`;
    }

    const ctx = document.getElementById('scatterChart');
    if (!ctx) return;
    // ★ 4사분면 가이드라인 플러그인 — 평균 CTR 수직선 + 평균 ROAS(또는 노출수) 수평선
    const quadrantPlugin = {
        id: 'scatterQuadrant',
        afterDraw(chart) {
            const { ctx: c, chartArea: { left, right, top, bottom }, scales: { x, y } } = chart;
            if (!x || !y) return;

            // 데이터 전체에서 평균값 계산
            let allX = [], allY = [];
            chart.data.datasets.forEach(ds => {
                ds.data.forEach(pt => {
                    if (pt.x != null) allX.push(pt.x);
                    if (pt.y != null) allY.push(pt.y);
                });
            });
            if (!allX.length || !allY.length) return;

            const avgX = allX.reduce((s, v) => s + v, 0) / allX.length;
            const avgY = allY.reduce((s, v) => s + v, 0) / allY.length;
            const xPx = x.getPixelForValue(avgX);
            const yPx = y.getPixelForValue(avgY);

            c.save();
            c.setLineDash([5, 4]);
            c.strokeStyle = 'rgba(100, 116, 139, 0.45)';
            c.lineWidth = 1.2;

            // 수직선 (평균 CTR)
            c.beginPath(); c.moveTo(xPx, top); c.lineTo(xPx, bottom); c.stroke();
            // 수평선 (평균 ROAS / 노출수)
            c.beginPath(); c.moveTo(left, yPx); c.lineTo(right, yPx); c.stroke();

            c.setLineDash([]);
            c.font = '9px sans-serif';
            c.fillStyle = 'rgba(100,116,139,0.75)';
            c.fillText(`평균 CTR ${avgX.toFixed(2)}%`, xPx + 4, top + 12);
            const yLabel = noConv ? `평균 노출 ${Math.round(avgY).toLocaleString()}` : `평균 ROAS ${Math.round(avgY)}%`;
            c.fillText(yLabel, left + 4, yPx - 4);
            c.restore();
        }
    };

    charts.scatter = new Chart(ctx, {
        type: 'bubble',
        data: { datasets },
        plugins: [quadrantPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 } } },
                tooltip: {
                    enabled: false // 커스텀 hover preview로 대체
                }
            },
            onHover: (evt, activeEls, chart) => {
                if (activeEls.length > 0) {
                    const el = activeEls[0];
                    const ds = chart.data.datasets[el.datasetIndex];
                    const point = ds.data[el.index];
                    const brand = point._brand;
                    const c = scatterCreativeMap[brand]?.[point._idx];
                    if (c) {
                        showScatterPreview(c, evt.native || evt);
                        chart.canvas.style.cursor = 'pointer';
                        return;
                    }
                }
                chart.canvas.style.cursor = 'default';
                hideScatterPreview();
            },
            onClick: (evt, activeEls, chart) => {
                if (!activeEls.length) return;
                const el = activeEls[0];
                const ds = chart.data.datasets[el.datasetIndex];
                const point = ds.data[el.index];
                if (point._id && typeof window.openModal === 'function') {
                    window.openModal(point._id);
                }
            },
            scales: {
                x: { title: { display: true, text: 'CTR (%)', font: { size: 11 } }, ticks: { font: { size: 10 } } },
                y: { title: { display: true, text: noConv ? '노출수' : 'ROAS (%)', font: { size: 11 } }, ticks: { font: { size: 10 } } }
            }
        }
    });

    // canvas mouseleave 시 preview 닫기
    if (ctx) {
        ctx.onmouseleave = () => hideScatterPreview();
    }
}

// ============================
// 광고비 × 성과(장바구니/주문/매출) 분포도
// ============================
let spendScatterMap = {}; // brand -> creatives[]
const _SPEND_METRICS = {
    revenue:     { label: '매출',          fmt: v => '₩' + formatNumber(Math.round(v)) },
    conversions: { label: '주문수',        fmt: v => formatNumber(Math.round(v)) + '건' },
    add_to_cart: { label: '장바구니 담기수', fmt: v => formatNumber(Math.round(v)) + '건' },
};

function renderSpendScatterChart() {
    destroyChart('spendScatter');
    const ctx = document.getElementById('spendScatterChart');
    if (!ctx) return;

    const metricKey = document.getElementById('spend-scatter-metric')?.value || 'revenue';
    const metric = _SPEND_METRICS[metricKey] || _SPEND_METRICS.revenue;

    // 제목/라벨 갱신
    const lblEl = document.getElementById('spend-scatter-metric-label');
    if (lblEl) lblEl.textContent = metric.label;

    // 성과 분석 풀과 동일 (ad_name 집계)
    const baseList = (typeof aggregateByAdName === 'function')
        ? aggregateByAdName(getBrandCreatives('performance'))
        : getBrandCreatives('performance');

    // 광고비 > 0 이고 선택 지표 > 0 인 소재만
    const pool = baseList.filter(c => (c.spend || 0) > 0 && (Number(c[metricKey]) || 0) > 0);

    spendScatterMap = {};
    let totalCount = 0;
    const maxRoas = Math.max(...pool.map(c => c.roas || 0), 0.01);

    const datasets = ['BOH', 'WM', 'CG'].map(brand => {
        const brandList = pool
            .filter(c => c.brand === brand)
            .sort((a, b) => (b.spend || 0) - (a.spend || 0))
            .slice(0, SCATTER_TOP_N);
        totalCount += brandList.length;
        spendScatterMap[brand] = brandList;

        return {
            label: brand,
            data: brandList.map((c, idx) => ({
                x: c.spend || 0,
                y: Number(c[metricKey]) || 0,
                // 버블 크기 = ROAS 상대값 (5~26px)
                r: Math.max(5, Math.min(26, ((c.roas || 0) / maxRoas) * 26)),
                name: c.creative_name || c.ad_name || '-',
                _idx: idx, _brand: brand, _id: c.id,
                roas: c.roas, ctr: c.ctr, spend: c.spend, metricVal: Number(c[metricKey]) || 0,
            })),
            backgroundColor: BRAND_COLORS[brand] + 'aa',
            borderColor: BRAND_COLORS[brand],
            borderWidth: 1.5, hoverBorderWidth: 3, hoverBorderColor: '#0f172a'
        };
    });

    const countEl = document.getElementById('spend-scatter-count-info');
    if (countEl) countEl.textContent = `총 ${totalCount}개 표시`;

    // ── 4사분면 가이드 플러그인 (평균 광고비 수직선 + 평균 지표 수평선 + 코너 라벨) ──
    const spendQuadrantPlugin = {
        id: 'spendQuadrant',
        afterDraw(chart) {
            const { ctx: c, chartArea: { left, right, top, bottom }, scales: { x, y } } = chart;
            if (!x || !y) return;
            let xs = [], ys = [];
            chart.data.datasets.forEach(ds => ds.data.forEach(p => { if (p.x != null) xs.push(p.x); if (p.y != null) ys.push(p.y); }));
            if (!xs.length || !ys.length) return;
            const avgX = xs.reduce((s,v)=>s+v,0)/xs.length;
            const avgY = ys.reduce((s,v)=>s+v,0)/ys.length;
            const xPx = x.getPixelForValue(avgX), yPx = y.getPixelForValue(avgY);

            c.save();
            // 십자선
            c.setLineDash([5,4]); c.strokeStyle = 'rgba(100,116,139,0.45)'; c.lineWidth = 1.2;
            c.beginPath(); c.moveTo(xPx, top); c.lineTo(xPx, bottom); c.stroke();
            c.beginPath(); c.moveTo(left, yPx); c.lineTo(right, yPx); c.stroke();
            c.setLineDash([]);

            // 사분면 배경 라벨 (코너)
            const ml = (metricKey === 'revenue') ? '매출' : (metricKey === 'conversions' ? '주문' : '담기');
            const labels = [
                { t:`⭐ 효율 우수 · 증액검토`, sub:'저광고비·고'+ml, x:left+8,  y:top+14,    align:'left',  col:'#059669' },
                { t:`🚀 주력 · 유지/확대`,    sub:'고광고비·고'+ml, x:right-8, y:top+14,    align:'right', col:'#2563eb' },
                { t:`🌱 소규모 테스트`,       sub:'저광고비·저'+ml, x:left+8,  y:bottom-20, align:'left',  col:'#94a3b8' },
                { t:`⚠️ 비효율 · 점검/감액`,  sub:'고광고비·저'+ml, x:right-8, y:bottom-20, align:'right', col:'#dc2626' },
            ];
            labels.forEach(L => {
                c.textAlign = L.align; c.textBaseline = 'top';
                c.font = '700 11px sans-serif'; c.fillStyle = L.col;
                c.fillText(L.t, L.x, L.y);
                c.font = '9px sans-serif'; c.fillStyle = 'rgba(100,116,139,0.7)';
                c.fillText(L.sub, L.x, L.y + 13);
            });

            // 평균선 값 라벨
            c.textAlign = 'left'; c.textBaseline = 'bottom';
            c.font = '9px sans-serif'; c.fillStyle = 'rgba(100,116,139,0.8)';
            c.fillText(`평균 광고비 ₩${formatNumber(Math.round(avgX))}`, xPx + 4, bottom - 2);
            c.restore();
        }
    };

    charts.spendScatter = new Chart(ctx, {
        type: 'bubble',
        data: { datasets },
        plugins: [spendQuadrantPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: (item) => {
                            const p = item.raw;
                            return [
                                p.name,
                                `광고비 ₩${formatNumber(Math.round(p.spend))}`,
                                `${metric.label} ${metric.fmt(p.metricVal)}`,
                                `ROAS ${Math.round((p.roas||0)*100)}% · CTR ${((p.ctr||0)*100).toFixed(2)}%`,
                            ];
                        }
                    }
                }
            },
            onClick: (evt, els, chart) => {
                if (!els.length) return;
                const p = chart.data.datasets[els[0].datasetIndex].data[els[0].index];
                if (p._id && typeof window.openModal === 'function') window.openModal(p._id);
            },
            onHover: (evt, els, chart) => { chart.canvas.style.cursor = els.length ? 'pointer' : 'default'; },
            scales: {
                x: { title: { display: true, text: '광고비 (₩)', font: { size: 11 } },
                     ticks: { font: { size: 10 }, callback: v => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? Math.round(v/1000)+'K' : v } },
                y: { title: { display: true, text: metric.label, font: { size: 11 } },
                     ticks: { font: { size: 10 }, callback: v => metricKey==='revenue' ? (v>=1000000?(v/1000000).toFixed(1)+'M':v>=1000?Math.round(v/1000)+'K':v) : formatNumber(v) },
                     beginAtZero: true }
            }
        }
    });
}
window.renderSpendScatterChart = renderSpendScatterChart;

// ============================
// 광고비 한계효율(포화) 곡선
// ============================
function renderSaturationChart() {
    destroyChart('saturation');
    const ctx = document.getElementById('saturationChart');
    if (!ctx) return;

    const base = (typeof aggregateByAdName === 'function')
        ? aggregateByAdName(getBrandCreatives('performance'))
        : getBrandCreatives('performance');
    // 광고비·매출 유효한 소재만, ROAS 높은 순(=효율 좋은 소재부터 예산 투입 가정)
    const pool = base.filter(c => (c.spend || 0) > 0 && (c.revenue || 0) > 0)
                     .sort((a, b) => (b.roas || 0) - (a.roas || 0));

    const infoEl = document.getElementById('saturation-info');
    const insightEl = document.getElementById('saturation-insight');

    if (pool.length < 3) {
        if (infoEl) infoEl.textContent = '데이터 부족';
        if (insightEl) insightEl.innerHTML = '';
        charts.saturation = new Chart(ctx, { type:'line', data:{datasets:[]}, options:{responsive:true,maintainAspectRatio:false} });
        return;
    }

    let cumSpend = 0, cumRev = 0;
    const marginalPts = [];   // {x: 누적광고비, y: 해당 소재 ROAS%}
    const cumPts = [];        // {x: 누적광고비, y: 누적 ROAS%}
    let ceilingSpend = null;  // 한계 ROAS가 100% 미만으로 처음 떨어지는 누적광고비
    pool.forEach(c => {
        cumSpend += c.spend || 0;
        cumRev   += c.revenue || 0;
        const mRoas = (c.roas || 0) * 100;
        const cRoas = cumSpend > 0 ? (cumRev / cumSpend) * 100 : 0;
        marginalPts.push({ x: cumSpend, y: Math.round(mRoas) });
        cumPts.push({ x: cumSpend, y: Math.round(cRoas) });
        if (ceilingSpend === null && mRoas < 100) ceilingSpend = cumSpend;
    });

    const totalSpend = cumSpend;
    const blendedRoas = cumRev / cumSpend * 100;

    // 손익분기(100%) 기준선
    const breakeven = [{ x: 0, y: 100 }, { x: totalSpend, y: 100 }];

    if (infoEl) infoEl.textContent = `소재 ${pool.length}개 · 누적 광고비 ₩${formatNumber(Math.round(totalSpend))}`;
    if (insightEl) {
        if (ceilingSpend !== null) {
            const pct = Math.round(ceilingSpend / totalSpend * 100);
            insightEl.innerHTML = `🚩 <b>예산 상한 신호</b>: 누적 광고비 <b>₩${formatNumber(Math.round(ceilingSpend))}</b> (전체의 ${pct}%) 지점부터 한계 ROAS가 100% 미만(손익분기 이하)으로 떨어집니다. 그 이후 소재는 매출보다 광고비가 큼 → 예산 재배분 검토. <span style="color:#94a3b8">(블렌디드 ROAS ${Math.round(blendedRoas)}%)</span>`;
        } else {
            insightEl.innerHTML = `✅ 모든 소재의 한계 ROAS가 손익분기(100%) 이상입니다. 현재 풀에 비효율 구간 없음. <span style="color:#94a3b8">(블렌디드 ROAS ${Math.round(blendedRoas)}%)</span>`;
        }
    }

    charts.saturation = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                { label: '누적 ROAS', data: cumPts, borderColor: '#6366f1', backgroundColor: '#6366f120',
                  borderWidth: 2.5, pointRadius: 0, tension: 0.25, fill: true, yAxisID: 'y' },
                { label: '한계 ROAS (다음 소재)', data: marginalPts, borderColor: '#f43f5e', backgroundColor: 'transparent',
                  borderWidth: 1.5, pointRadius: 2, tension: 0.15, yAxisID: 'y' },
                { label: '손익분기 100%', data: breakeven, borderColor: '#94a3b8', borderDash: [6,4],
                  borderWidth: 1.2, pointRadius: 0, yAxisID: 'y' },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } },
                tooltip: { callbacks: {
                    title: items => `누적 광고비 ₩${formatNumber(Math.round(items[0].parsed.x))}`,
                    label: item => `${item.dataset.label}: ${item.parsed.y}%`,
                } }
            },
            scales: {
                x: { type: 'linear', title: { display: true, text: '누적 광고비 (₩, 효율 높은 소재부터)', font: { size: 11 } },
                     ticks: { font: { size: 10 }, callback: v => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? Math.round(v/1000)+'K' : v } },
                y: { title: { display: true, text: 'ROAS (%)', font: { size: 11 } }, ticks: { font: { size: 10 } }, beginAtZero: true }
            }
        }
    });
}
window.renderSaturationChart = renderSaturationChart;

// ============================
// 장바구니 이탈 손실액 랭킹 (제품별)
// ============================
function renderCartLeakRanking() {
    const wrap = document.getElementById('leak-ranking');
    if (!wrap) return;
    const infoEl = document.getElementById('leak-info');

    const list = getBrandCreatives('performance');
    // 제품별 집계
    const m = {};
    list.forEach(c => {
        const prod = (c.product || '기타').trim();
        if (!m[prod]) m[prod] = { atc:0, conv:0, revenue:0 };
        m[prod].atc     += c.add_to_cart || 0;
        m[prod].conv    += c.conversions || 0;
        m[prod].revenue += c.revenue || 0;
    });
    const rows = Object.entries(m).map(([prod, d]) => {
        const aov = d.conv > 0 ? d.revenue / d.conv : 0;          // 객단가
        const lost = Math.max(0, (d.atc - d.conv)) * aov;         // 이탈 손실액
        const buyRate = d.atc > 0 ? d.conv / d.atc : 0;           // 장바구니→구매율
        return { prod, atc: d.atc, conv: d.conv, aov, lost, buyRate };
    }).filter(r => r.atc > 0 && r.lost > 0)
      .sort((a, b) => b.lost - a.lost)
      .slice(0, 10);

    if (!rows.length) {
        wrap.innerHTML = `<div class="text-center text-slate-400 text-sm py-8"><i class="fas fa-cart-shopping text-2xl mb-2"></i><br>장바구니 데이터 없음</div>`;
        if (infoEl) infoEl.textContent = '';
        return;
    }
    const totalLost = rows.reduce((s, r) => s + r.lost, 0);
    if (infoEl) infoEl.textContent = `총 추정 손실 ₩${formatNumber(Math.round(totalLost))}`;
    const max = rows[0].lost;

    wrap.innerHTML = rows.map((r, i) => {
        const w = Math.round(r.lost / max * 100);
        const brCls = r.buyRate >= 0.5 ? '#059669' : r.buyRate >= 0.3 ? '#d97706' : '#dc2626';
        return `
        <div class="leak-row">
            <div class="leak-rank">${i+1}</div>
            <div class="leak-main">
                <div class="leak-name">${r.prod}</div>
                <div class="leak-bar-track"><div class="leak-bar" style="width:${w}%"></div></div>
            </div>
            <div class="leak-stats">
                <div class="leak-lost">−₩${formatNumber(Math.round(r.lost))}</div>
                <div class="leak-meta">이탈 ${formatNumber(r.atc - r.conv)}건 · 구매율 <b style="color:${brCls}">${(r.buyRate*100).toFixed(0)}%</b> · 객단가 ₩${formatNumber(Math.round(r.aov))}</div>
            </div>
        </div>`;
    }).join('');
}
window.renderCartLeakRanking = renderCartLeakRanking;

// ============================
// 스캐터 차트 hover 미리보기 카드
// ============================
function getScatterPreviewEl() {
    let el = document.getElementById('scatter-hover-preview');
    if (!el) {
        el = document.createElement('div');
        el.id = 'scatter-hover-preview';
        el.className = 'scatter-hover-preview';
        document.body.appendChild(el);
    }
    return el;
}

let scatterPreviewKey = null;
let scatterHideTimer = null;

function showScatterPreview(c, evt) {
    if (!c) return;
    const key = c.id || c.ad_name || c.creative_name;
    const el = getScatterPreviewEl();

    if (scatterPreviewKey === key) {
        clearTimeout(scatterHideTimer);
        return;
    }
    scatterPreviewKey = key;
    clearTimeout(scatterHideTimer);

    // 썸네일
    const rawThumb = c.thumbnail_url || c.media_url || '';
    const isVideo = c.media_type === 'video';
    const fallbackHtml = `<div class="scatter-prev-thumb scatter-prev-fallback"><i class="fas fa-${isVideo ? 'video' : 'image'}"></i></div>`;
    let thumbHtml;
    if (!rawThumb) {
        thumbHtml = fallbackHtml;
    } else if (typeof window.isDriveUrl === 'function' && window.isDriveUrl(rawThumb) && typeof window.buildDriveImgHtml === 'function') {
        thumbHtml = window.buildDriveImgHtml(rawThumb, {
            className: 'scatter-prev-thumb',
            alt: '',
            finalFallbackHtml: fallbackHtml,
        });
    } else {
        thumbHtml = `<img class="scatter-prev-thumb" src="${rawThumb}" alt="" loading="eager" decoding="async" onerror="this.outerHTML='${fallbackHtml.replace(/'/g, '&#39;')}'">`;
    }

    const appeals = (typeof normalizeArrayField === 'function')
        ? normalizeArrayField(c.appeal_points).slice(0, 3) : [];
    const appealChips = appeals.length
        ? `<div class="scatter-prev-chips">${appeals.map(a => `<span class="scatter-prev-chip">${a}</span>`).join('')}</div>`
        : '';

    const brandColor = BRAND_COLORS[c.brand] || '#64748b';

    el.innerHTML = `
        <div class="scatter-prev-thumbwrap">
            ${thumbHtml}
            ${isVideo ? '<span class="scatter-prev-video">▶</span>' : ''}
            <span class="scatter-prev-brand" style="background:${brandColor}">${c.brand || '-'}</span>
        </div>
        <div class="scatter-prev-body">
            <div class="scatter-prev-name">${c.creative_name || c.ad_name || '-'}</div>
            ${c.product ? `<div class="scatter-prev-product"><i class="fas fa-cube"></i> ${c.product}</div>` : ''}
            ${appealChips}
            <div class="scatter-prev-metrics">
                <div class="scatter-prev-metric">
                    <span class="scatter-prev-mlabel">ROAS</span>
                    <span class="scatter-prev-mval">${Math.round((c.roas||0) * 100)}%</span>
                </div>
                <div class="scatter-prev-metric">
                    <span class="scatter-prev-mlabel">CTR</span>
                    <span class="scatter-prev-mval">${((c.ctr||0) * 100).toFixed(2)}%</span>
                </div>
                <div class="scatter-prev-metric">
                    <span class="scatter-prev-mlabel">광고비</span>
                    <span class="scatter-prev-mval">₩${formatNumber(c.spend || 0)}</span>
                </div>
            </div>
            <div class="scatter-prev-hint"><i class="fas fa-hand-pointer"></i> 클릭하면 상세보기</div>
        </div>
    `;

    // 위치는 한 번만 잡고 마우스 따라가지 않음
    positionScatterPreview(el, evt);
    el.classList.add('visible');
}

function positionScatterPreview(el, evt) {
    // ★ 카드는 마우스 커서가 아닌 "차트 컨테이너 바깥"에 고정 배치
    //   → 버블/차트 영역을 가리지 않도록 함
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = 280, ph = 360;
    const GAP = 12;

    // 차트 캔버스의 화면 좌표 기준 영역 가져오기
    const canvas = document.getElementById('scatterChart');
    const rect = canvas ? canvas.getBoundingClientRect() : null;

    let left, top;
    if (rect) {
        // 1순위: 차트 우측 바깥
        if (rect.right + GAP + pw <= vw - 8) {
            left = rect.right + GAP;
            top = rect.top;
        }
        // 2순위: 차트 좌측 바깥
        else if (rect.left - GAP - pw >= 8) {
            left = rect.left - pw - GAP;
            top = rect.top;
        }
        // 3순위: 차트 위쪽 바깥
        else if (rect.top - GAP - ph >= 8) {
            left = Math.max(8, Math.min(vw - pw - 8, rect.left + (rect.width - pw) / 2));
            top = rect.top - ph - GAP;
        }
        // 4순위: 차트 아래쪽 바깥
        else if (rect.bottom + GAP + ph <= vh - 8) {
            left = Math.max(8, Math.min(vw - pw - 8, rect.left + (rect.width - pw) / 2));
            top = rect.bottom + GAP;
        }
        // 최후 폴백: 우측 상단 고정
        else {
            left = vw - pw - 12;
            top = 80;
        }
    } else if (evt) {
        // canvas를 못 찾으면 기존 방식으로 폴백 (마우스 우측)
        const x = evt.clientX || (evt.pageX - window.scrollX);
        const y = evt.clientY || (evt.pageY - window.scrollY);
        left = x + 18;
        top = y + 18;
        if (left + pw > vw - 8) left = x - pw - 18;
        if (top + ph > vh - 8) top = vh - ph - 8;
    } else {
        left = 16;
        top = 80;
    }

    // viewport 경계 보정
    if (left + pw > vw - 8) left = vw - pw - 8;
    if (left < 8) left = 8;
    if (top + ph > vh - 8) top = vh - ph - 8;
    if (top < 8) top = 8;

    el.style.left = left + 'px';
    el.style.top = top + 'px';
}

function hideScatterPreview() {
    clearTimeout(scatterHideTimer);
    scatterHideTimer = setTimeout(() => {
        const el = document.getElementById('scatter-hover-preview');
        if (el) el.classList.remove('visible');
        scatterPreviewKey = null;
    }, 200);
}

// 제품별 소구포인트 인사이트의 제품 드롭다운 옵션 채우기
function populateAppealInsightProductOptions() {
    const sel = document.getElementById('appeal-insight-product-select');
    if (!sel) return;
    const list = getBrandCreatives();
    const products = Array.from(new Set(
        list.map(c => (c.product || '').trim()).filter(Boolean)
    )).sort();
    const currentValue = sel.value;
    sel.innerHTML = '<option value="">전체 제품</option>' +
        products.map(p => `<option value="${p}">${p}</option>`).join('');
    if (currentValue && products.includes(currentValue)) {
        sel.value = currentValue;
    }
}

// 매체 × 소재 조합 성과의 제품 드롭다운 옵션 채우기
function populatePlatformMatrixProductOptions() {
    const sel = document.getElementById('platform-matrix-product-select');
    if (!sel) return;
    const list = getBrandCreatives();
    const products = Array.from(new Set(
        list.map(c => (c.product || '').trim()).filter(Boolean)
    )).sort();
    const currentValue = sel.value;
    sel.innerHTML = '<option value="">전체 제품</option>' +
        products.map(p => `<option value="${p}">${p}</option>`).join('');
    if (currentValue && products.includes(currentValue)) {
        sel.value = currentValue;
    }
}

// 소구포인트를 라벨용 텍스트로 변환 (최대 2개 + …)
function appealLabelFromCreative(c) {
    const appeals = (typeof normalizeArrayField === 'function')
        ? normalizeArrayField(c.appeal_points)
        : [];
    if (!appeals.length) {
        const fallback = c.key_message_kr || c.key_message_jp || c.creative_name || '-';
        return fallback.length > 28 ? fallback.substring(0, 28) + '…' : fallback;
    }
    const top = appeals.slice(0, 2).join(' · ');
    const more = appeals.length > 2 ? ` +${appeals.length - 2}` : '';
    return (top.length > 30 ? top.substring(0, 30) + '…' : top) + more;
}

// ============================
// ★ 신규: 브랜드 & 제품별 위닝 요소 인사이트
// ============================
// 어떤 "소구포인트" / "디자인" 조합이 좋았는지
//   - 소구포인트: appeal_points (그대로)
//   - 디자인: target_emotion + media_type 조합으로 비주얼 스타일 군집
//   ※ 인물 vs 상품 카드는 제거됨 (사용자 요청)
// ============================

// 디자인 군집 라벨 생성
function buildDesignLabel(c) {
    const mediaType = (c.media_type || '').toLowerCase();
    const mediaPart = mediaType === 'video' ? '동영상' : (mediaType === 'image' ? '이미지' : '');
    const emotions = (typeof normalizeArrayField === 'function')
        ? normalizeArrayField(c.target_emotion)
        : [];
    const topEmotion = emotions[0] || '';
    if (!mediaPart && !topEmotion) return null;
    return [mediaPart, topEmotion].filter(Boolean).join(' · ');
}

// 갤러리 소구포인트 필터 옵션 채우기
function populateGalleryAppealOptions() {
    const sel = document.getElementById('gallery-appeal-select');
    if (!sel) return;
    const appeals = new Set();
    (window.allCreatives || []).forEach(c => {
        const pts = Array.isArray(c.appeal_points)
            ? c.appeal_points
            : String(c.appeal_points || '').split(/[,、，·・]/).map(s => s.trim());
        pts.forEach(p => { if (p) appeals.add(p); });
    });
    const current = sel.value;
    sel.innerHTML = '<option value="ALL">소구포인트 전체</option>' +
        [...appeals].sort().map(a => `<option value="${a}">${a}</option>`).join('');
    if ([...appeals].includes(current)) sel.value = current;
}

// 위닝 요소 인사이트 - 제품 드롭다운
function populateWinningProductOptions() {
    const sel = document.getElementById('winning-product-select');
    if (!sel) return;
    const base = (currentBrand === 'ALL')
        ? allCreatives
        : allCreatives.filter(c => c.brand === currentBrand);
    const products = Array.from(new Set(
        base.map(c => (c.product || '').trim()).filter(Boolean)
    )).sort();
    const cur = winningProduct;
    sel.innerHTML = '<option value="">전체 제품</option>' +
        products.map(p => `<option value="${p.replace(/"/g, '&quot;')}">${p}</option>`).join('');
    if (cur && products.includes(cur)) {
        sel.value = cur;
    } else {
        sel.value = '';
        winningProduct = '';
    }
}

// 키워드별 성과 집계 헬퍼 (광고비 가중 ROAS + 평균 CTR)
function aggregateByKey(items, keyExtractor) {
    const map = new Map();
    items.forEach(c => {
        const keys = keyExtractor(c);
        if (!keys || !keys.length) return;
        keys.forEach(k => {
            if (!k) return;
            if (!map.has(k)) {
                map.set(k, { key: k, count: 0, spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0, examples: [] });
            }
            const it = map.get(k);
            it.count++;
            it.spend += Number(c.spend) || 0;
            it.revenue += Number(c.revenue) || 0;
            it.impressions += Number(c.impressions) || 0;
            it.clicks += Number(c.clicks) || 0;
            it.conversions += Number(c.conversions) || 0;
            if (it.examples.length < 3) it.examples.push(c);
        });
    });
    return Array.from(map.values()).map(it => ({
        ...it,
        roas: it.spend > 0 ? it.revenue / it.spend : 0,
        ctr:  it.impressions > 0 ? it.clicks / it.impressions : 0,
        cvr:  it.clicks > 0 ? it.conversions / it.clicks : 0
    }));
}

// 메인 렌더 함수
function renderWinningElements() {
    const container = document.getElementById('winning-elements-content');
    if (!container) return;

    // 1) 현재 브랜드 + 제품(위닝 전용) 기준 데이터 수집
    let base = (currentBrand === 'ALL')
        ? allCreatives.slice()
        : allCreatives.filter(c => c.brand === currentBrand);
    if (winningProduct) {
        base = base.filter(c => (c.product || '').trim() === winningProduct);
    }
    base = base.filter(c => (c.roas || 0) > 0);

    // 2) ad_name 단위 집계
    if (typeof aggregateByAdName === 'function') {
        base = aggregateByAdName(base);
    }

    // 3) 중앙값 광고비 이상 소재만 분석 대상
    const { qualified: pool, medianSpend } = filterByMedianSpend(base, { minRequired: 5 });

    if (!pool.length) {
        container.innerHTML = `
            <div class="winning-empty">
                <i class="fas fa-folder-open text-3xl text-slate-300 mb-2"></i>
                <p class="text-sm text-slate-500">분석할 데이터가 부족합니다</p>
            </div>
        `;
        return;
    }

    const scopeLabel = winningProduct
        ? `<b>${winningProduct}</b>`
        : (currentBrand === 'ALL' ? '<b>전체 브랜드</b>' : `<b>${currentBrand}</b>`);

    // 4) 카테고리별 집계
    //    A) 소구포인트 — ★ 최소 3개 이상 소재로 검증된 키워드만 (단일/소수 소재 효율 노이즈 제거)
    let appealAgg = aggregateByKey(pool, c => normalizeArrayField(c.appeal_points))
        .filter(x => x.count >= 3)
        .sort((a, b) => b.roas - a.roas)
        .slice(0, 5);
    // 후보가 너무 적으면 fallback (≥2 → ≥1 순서로 완화)
    if (appealAgg.length < 3) {
        appealAgg = aggregateByKey(pool, c => normalizeArrayField(c.appeal_points))
            .filter(x => x.count >= 2)
            .sort((a, b) => b.roas - a.roas)
            .slice(0, 5);
    }
    if (appealAgg.length < 3) {
        appealAgg = aggregateByKey(pool, c => normalizeArrayField(c.appeal_points))
            .filter(x => x.count >= 1)
            .sort((a, b) => b.roas - a.roas)
            .slice(0, 5);
    }

    //    B) 디자인 (미디어타입 + 감정 조합) — ★ 최소 3개 이상 소재 기반
    let designAgg = aggregateByKey(pool, c => {
        const label = buildDesignLabel(c);
        return label ? [label] : [];
    })
        .filter(x => x.count >= 3)
        .sort((a, b) => b.roas - a.roas)
        .slice(0, 5);
    // fallback (≥2 → ≥1 순서로 완화)
    if (designAgg.length < 3) {
        designAgg = aggregateByKey(pool, c => {
            const label = buildDesignLabel(c);
            return label ? [label] : [];
        })
            .filter(x => x.count >= 2)
            .sort((a, b) => b.roas - a.roas)
            .slice(0, 5);
    }
    if (designAgg.length < 3) {
        designAgg = aggregateByKey(pool, c => {
            const label = buildDesignLabel(c);
            return label ? [label] : [];
        })
            .filter(x => x.count >= 1)
            .sort((a, b) => b.roas - a.roas)
            .slice(0, 5);
    }

    // 5) 카드 HTML 빌드 헬퍼
    function rankRows(items, emptyMsg) {
        if (!items.length) return `<div class="winning-empty-row">${emptyMsg}</div>`;
        return items.map((it, i) => {
            const medal = ['🥇', '🥈', '🥉', '4', '5'][i] || (i + 1);
            const roasPct = Math.round(it.roas * 100);
            const ctrPct = (it.ctr * 100).toFixed(2);
            // 대표 소재명
            const rep = (it.examples && it.examples[0]) || null;
            const repName = rep ? (rep.ad_name || rep.creative_name || '') : '';
            const shortName = repName.length > 24 ? repName.slice(0, 24) + '…' : repName;
            return `
                <div class="winning-rank-row">
                    <div class="winning-rank-medal">${medal}</div>
                    <div class="winning-rank-info">
                        <div class="winning-rank-key">${it.key}</div>
                        <div class="winning-rank-meta">${it.count}개 소재 · 광고비 ₩${formatNumber(Math.round(it.spend))}</div>
                        ${shortName ? `<div class="winning-rank-rep"><i class="fas fa-star"></i> ${shortName}</div>` : ''}
                    </div>
                    <div class="winning-rank-stats">
                        <div class="winning-rank-roas"><b>${roasPct}%</b><span>ROAS</span></div>
                        <div class="winning-rank-ctr">CTR ${ctrPct}%</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    container.innerHTML = `
        <div class="winning-threshold-badge">
            <i class="fas fa-filter"></i>
            <span>${scopeLabel} · 광고비 중앙값 <b>₩${formatNumber(Math.round(medianSpend))}</b> 이상 <b>${pool.length}개</b> 소재 분석</span>
        </div>
        <div class="winning-cards winning-cards-2col">
            <!-- 소구포인트 카드 -->
            <div class="winning-card winning-card-appeal">
                <div class="winning-card-header">
                    <span class="winning-card-icon"><i class="fas fa-lightbulb"></i></span>
                    <div>
                        <div class="winning-card-title">베스트 소구포인트</div>
                        <div class="winning-card-sub">메시지가 잘 통한 키워드</div>
                    </div>
                </div>
                <div class="winning-card-body">
                    ${rankRows(appealAgg, '소구포인트 데이터가 부족합니다')}
                </div>
            </div>

            <!-- 디자인 카드 -->
            <div class="winning-card winning-card-design">
                <div class="winning-card-header">
                    <span class="winning-card-icon"><i class="fas fa-palette"></i></span>
                    <div>
                        <div class="winning-card-title">베스트 디자인</div>
                        <div class="winning-card-sub">포맷 · 감정 코드 조합</div>
                    </div>
                </div>
                <div class="winning-card-body">
                    ${rankRows(designAgg, '디자인 분류 가능한 데이터가 없습니다')}
                </div>
            </div>
        </div>
    `;

    // 클릭 시 첫 대표 소재 모달 오픈
    const allItems = [...appealAgg, ...designAgg];
    container.querySelectorAll('.winning-rank-row').forEach((row, idx) => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => {
            const target = allItems[idx];
            const rep = target?.examples?.[0];
            if (rep && typeof openModal === 'function') {
                openModal(rep.id);
            }
        });
    });
}

// 전역 노출
window.renderWinningElements = renderWinningElements;
window.populateWinningProductOptions = populateWinningProductOptions;

// ============================
// 매체 × 소재 조합 분석
// 어느 매체에서 어떤 소구포인트가 잘 작동했는지
// ============================
function renderPlatformCreativeMatrix() {
    const matrixEl = document.getElementById('platform-creative-matrix');
    const topCombosEl = document.getElementById('platform-creative-top-combos');
    const thresholdEl = document.getElementById('platform-matrix-threshold');
    const metricSel = document.getElementById('platform-matrix-metric');
    const productSel = document.getElementById('platform-matrix-product-select');
    if (!matrixEl || !topCombosEl) return;

    const metric = metricSel?.value || 'ctr';
    // ★ 섹션 통합 필터 사용 — performance scope (제품/캠페인 자동 반영)
    const selectedProduct = performanceProduct || '';

    // AI 인사이트와 동일하게 raw 데이터 직접 사용 (spend 임계값 필터 없음)
    let pool;
    {
        let raw = getBrandCreatives('performance');
        if (typeof aggregateByAdName === 'function') raw = aggregateByAdName(raw);
        pool = raw;
    }

    // ★ 선정 기준 배지는 상단의 공통 배지로 통합 (개별 표시 제거)
    if (thresholdEl) thresholdEl.innerHTML = '';

    if (!pool.length) {
        topCombosEl.innerHTML = '<div class="col-span-3 text-center text-slate-400 text-sm py-8"><i class="fas fa-folder-open text-2xl mb-2"></i><br>분석 가능한 데이터가 없습니다</div>';
        matrixEl.innerHTML = '';
        return;
    }

    // 3) 매체×소구포인트 조합으로 집계
    // key = `${platform}::${appeal}` → 누적 spend/revenue/impressions/clicks/conversions + 대표 소재 후보
    const combos = new Map();
    const platformTotals = new Map(); // 매체별 총광고비 (정렬용)
    const appealTotals = new Map();   // 소구별 총광고비

    pool.forEach(c => {
        const platform = (c.platform || '').trim() || '미지정';
        const appeals = (typeof normalizeArrayField === 'function')
            ? normalizeArrayField(c.appeal_points)
            : [];
        if (!appeals.length) return; // 소구포인트 없는 소재는 매트릭스에서 제외

        platformTotals.set(platform, (platformTotals.get(platform) || 0) + (c.spend || 0));

        appeals.forEach(a => {
            if (!a || a.startsWith('❌')) return;
            appealTotals.set(a, (appealTotals.get(a) || 0) + (c.spend || 0));

            const key = `${platform}::${a}`;
            if (!combos.has(key)) {
                combos.set(key, {
                    platform, appeal: a,
                    count: 0,
                    spend: 0, revenue: 0,
                    impressions: 0, clicks: 0, conversions: 0,
                    add_to_cart: 0,
                    creatives: []
                });
            }
            const item = combos.get(key);
            item.count++;
            item.spend += c.spend || 0;
            item.revenue += c.revenue || 0;
            item.impressions += c.impressions || 0;
            item.clicks += c.clicks || 0;
            item.conversions += c.conversions || 0;
            item.add_to_cart += c.add_to_cart || 0;
            item.creatives.push(c);
        });
    });

    if (!combos.size) {
        topCombosEl.innerHTML = '<div class="col-span-3 text-center text-slate-400 text-sm py-8"><i class="fas fa-magic-wand-sparkles text-2xl mb-2"></i><br>소구포인트(appeal_points) 데이터가 부족합니다</div>';
        matrixEl.innerHTML = '';
        return;
    }

    // 파생 지표
    const enriched = Array.from(combos.values()).map(item => ({
        ...item,
        roas:         item.spend > 0 ? item.revenue / item.spend : 0,
        ctr:          item.impressions > 0 ? item.clicks / item.impressions : 0,
        cvr:          item.clicks > 0 ? item.conversions / item.clicks : 0,
        atc_rate:     item.clicks > 0 ? item.add_to_cart / item.clicks : 0,
        cost_per_atc: item.add_to_cart > 0 ? Math.round(item.spend / item.add_to_cart) : 0,
    }));

    // 4) TOP 3 조합 카드 — metric 기준 상위
    renderTopPlatformCombos(enriched, metric, topCombosEl);

    // 5) 매트릭스 히트맵
    renderPlatformMatrixHeatmap(enriched, platformTotals, appealTotals, metric, matrixEl);
}

// TOP 매체×소구 조합 카드 3개
function renderTopPlatformCombos(enriched, metric, container) {
    // count >= 1 + 지표 > 0 필터링 (cost_per_atc는 낮을수록 좋아 오름차순)
    const lowerIsBetter = metric === 'cost_per_atc';
    const candidates = enriched
        .filter(c => (c[metric] || 0) > 0)
        .sort((a, b) => lowerIsBetter
            ? (a[metric] || 0) - (b[metric] || 0)
            : (b[metric] || 0) - (a[metric] || 0));

    // ★ 다양성 보장: 같은 대표 소재(ad_name)가 여러 카드에 중복 등장하지 않도록
    //   "같은 소재를 여러 번 쓸 필요 없고 필요에 따라 취합" 원칙
    //   첨부 스크린샷: 3개 카드 모두 ROAS 459%·₩24.8만으로 동일했던 문제 해결
    const usedRepIds = new Set();
    const usedPlatformAppeal = new Set();
    const sorted = [];
    const skipped = [];

    for (const c of candidates) {
        if (sorted.length >= 3) break;
        // 대표 소재 = ROAS 최상위 (아래 렌더링과 동일한 기준)
        const rep = [...c.creatives].sort((a, b) => (b.roas || 0) - (a.roas || 0))[0];
        const repId = rep ? (rep.id || rep.ad_name || rep.creative_name) : null;
        const paKey = `${c.platform}::${c.appeal}`;

        if (repId && usedRepIds.has(repId)) {
            skipped.push(c);
            continue;
        }
        if (usedPlatformAppeal.has(paKey)) continue;

        sorted.push(c);
        if (repId) usedRepIds.add(repId);
        usedPlatformAppeal.add(paKey);
    }

    // 3개를 못 채웠다면 스킵한 후보로 폴백 보충
    if (sorted.length < 3 && skipped.length) {
        for (const s of skipped) {
            if (sorted.length >= 3) break;
            sorted.push(s);
        }
    }

    if (!sorted.length) {
        container.innerHTML = '<div class="col-span-3 text-center text-slate-400 text-sm py-6">표시할 조합이 없습니다</div>';
        return;
    }

    const metricCfg = {
        roas:         { label: 'ROAS',       format: v => Math.round((v || 0) * 100) + '%' },
        ctr:          { label: 'CTR',        format: v => ((v || 0) * 100).toFixed(2) + '%' },
        cvr:          { label: 'CVR',        format: v => ((v || 0) * 100).toFixed(2) + '%' },
        revenue:      { label: '매출',        format: v => '₩' + formatNumber(v || 0) },
        atc_rate:     { label: 'ATC율',       format: v => ((v || 0) * 100).toFixed(2) + '%' },
        cost_per_atc: { label: 'Cost/ATC',   format: v => '₩' + formatNumber(Math.round(v || 0)) },
    }[metric] || { label: metric, format: v => v };

    const medals = ['🥇', '🥈', '🥉'];

    container.innerHTML = sorted.map((c, i) => {
        // 대표 소재 1개 (ROAS 최상위) 썸네일
        const repCreative = [...c.creatives].sort((a, b) => (b.roas || 0) - (a.roas || 0))[0];
        const rawThumb = repCreative?.thumbnail_url || repCreative?.media_url || '';
        const isVideo = repCreative?.media_type === 'video';
        const fallbackHtml = `<div class="pmc-thumb pmc-thumb-fallback"><i class="fas fa-${isVideo ? 'video' : 'image'}"></i></div>`;
        let thumbHtml;
        if (!rawThumb) {
            thumbHtml = fallbackHtml;
        } else if (typeof window.isDriveUrl === 'function' && window.isDriveUrl(rawThumb) && typeof window.buildDriveImgHtml === 'function') {
            thumbHtml = window.buildDriveImgHtml(rawThumb, {
                className: 'pmc-thumb',
                alt: '',
                finalFallbackHtml: fallbackHtml,
            });
        } else {
            thumbHtml = `<img class="pmc-thumb" src="${rawThumb}" alt="" loading="eager" decoding="async" onerror="this.outerHTML='${fallbackHtml.replace(/'/g, '&#39;')}'">`;
        }

        return `
            <div class="pmc-combo-card" data-creative-id="${repCreative?.id || ''}">
                <div class="pmc-medal">${medals[i] || (i + 1)}</div>
                <div class="pmc-thumb-wrap">
                    ${thumbHtml}
                    ${isVideo ? '<span class="pmc-vbadge">▶</span>' : ''}
                </div>
                <div class="pmc-combo-body">
                    <div class="pmc-platform">
                        <i class="fas fa-broadcast-tower"></i> ${c.platform}
                    </div>
                    <div class="pmc-appeal">${c.appeal}</div>
                    <div class="pmc-stats">
                        <div class="pmc-stat pmc-stat-main">
                            <span class="pmc-stat-label">${metricCfg.label}</span>
                            <span class="pmc-stat-value">${metricCfg.format(c[metric])}</span>
                        </div>
                        <div class="pmc-stat-sub">
                            <span>소재 ${c.count}개</span>
                            <span class="pmc-dot">·</span>
                            <span>광고비 ₩${formatNumber(c.spend)}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // 카드 클릭 → 대표 소재 모달
    container.querySelectorAll('.pmc-combo-card').forEach(card => {
        const id = card.dataset.creativeId;
        if (!id) return;
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => {
            if (typeof window.openModal === 'function') window.openModal(id);
        });
    });
}

// 매체 × 소구포인트 히트맵
function renderPlatformMatrixHeatmap(enriched, platformTotals, appealTotals, metric, container) {
    // 매체 정렬: 총광고비 내림차순
    const platforms = Array.from(platformTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .map(x => x[0]);
    // 소구포인트 정렬: 총광고비 내림차순, 상위 10개만 (가독성)
    const appeals = Array.from(appealTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(x => x[0]);

    // metric 최대값 (색상 정규화용)
    const metricVals = enriched
        .filter(c => appeals.includes(c.appeal) && platforms.includes(c.platform))
        .map(c => c[metric] || 0);
    const maxVal = Math.max(...metricVals, 0.001);
    const minVal = Math.min(...metricVals.filter(v => v > 0), 0);

    // 키맵 (platform::appeal → combo)
    const map = new Map();
    enriched.forEach(c => map.set(`${c.platform}::${c.appeal}`, c));

    const metricCfg = {
        roas:         { label: 'ROAS',      format: v => Math.round((v||0)*100)+'%',           short: v => Math.round((v||0)*100)+'%',        lowerBetter: false },
        ctr:          { label: 'CTR',       format: v => ((v||0)*100).toFixed(2)+'%',          short: v => ((v||0)*100).toFixed(1)+'%',       lowerBetter: false },
        cvr:          { label: 'CVR',       format: v => ((v||0)*100).toFixed(2)+'%',          short: v => ((v||0)*100).toFixed(1)+'%',       lowerBetter: false },
        revenue:      { label: '매출',       format: v => '₩'+formatNumber(v||0),               short: v => '₩'+formatNumber(v||0),            lowerBetter: false },
        atc_rate:     { label: 'ATC율',      format: v => ((v||0)*100).toFixed(2)+'%',          short: v => ((v||0)*100).toFixed(1)+'%',       lowerBetter: false },
        cost_per_atc: { label: 'Cost/ATC',  format: v => '₩'+formatNumber(Math.round(v||0)),   short: v => '₩'+formatNumber(Math.round(v||0)), lowerBetter: true  },
    }[metric] || { label: metric, format: v => v, short: v => v, lowerBetter: false };

    // 색상 함수 — 값에 따라 인디고 그라데이션 (lowerBetter면 반전)
    const colorFor = (val) => {
        if (val <= 0) return { bg: '#f8fafc', color: '#cbd5e1', border: '#f1f5f9' };
        let ratio = Math.max(0, Math.min(1, (val - minVal) / (maxVal - minVal || 1)));
        if (metricCfg.lowerBetter) ratio = 1 - ratio; // 낮을수록 진하게
        // 0 ~ 1 → 연한 인디고 → 진한 인디고
        const r = Math.round(238 - (238 - 79) * ratio);
        const g = Math.round(242 - (242 - 70) * ratio);
        const b = Math.round(255 - (255 - 229) * ratio);
        const textColor = ratio > 0.55 ? '#ffffff' : '#1e293b';
        return { bg: `rgb(${r}, ${g}, ${b})`, color: textColor, border: `rgb(${r-15}, ${g-15}, ${b-15})` };
    };

    // HTML 빌드
    const platformHeaderCells = platforms.map(p => `
        <th class="pm-th pm-th-platform">
            <i class="fas fa-broadcast-tower"></i> ${p}
            <span class="pm-th-sub">₩${formatNumber(platformTotals.get(p))}</span>
        </th>
    `).join('');

    const rows = appeals.map(appeal => {
        const cells = platforms.map(platform => {
            const combo = map.get(`${platform}::${appeal}`);
            if (!combo) {
                return `<td class="pm-cell pm-cell-empty">-</td>`;
            }
            const val = combo[metric] || 0;
            const { bg, color, border } = colorFor(val);
            // ★ count < 2이면 신뢰 낮음 표시 — 반투명 + 경고 아이콘
            const lowConf = combo.count < 2;
            const lowConfAttr  = lowConf ? ' pm-cell-low-conf' : '';
            const lowConfBadge = lowConf
                ? `<div class="pm-cell-conf-badge" title="소재 1개 데이터 — 참고용"><i class="fas fa-circle-exclamation"></i> n=1</div>`
                : '';
            return `
                <td class="pm-cell${lowConfAttr}" style="background:${bg}; color:${color}; border-color:${border}; ${lowConf ? 'opacity:0.55;' : ''}"
                    data-creative-id="${combo.creatives[0]?.id || ''}"
                    title="${platform} × ${appeal}: ${metricCfg.label} ${metricCfg.format(val)} · 소재 ${combo.count}개 · 광고비 ₩${formatNumber(combo.spend)}${lowConf ? ' ⚠ 소재 1개 — 신뢰도 낮음' : ''}">
                    <div class="pm-cell-val">${metricCfg.short(val)}</div>
                    <div class="pm-cell-sub">${combo.count}개</div>
                    ${lowConfBadge}
                </td>
            `;
        }).join('');

        return `
            <tr>
                <th class="pm-th pm-th-appeal">${appeal}</th>
                ${cells}
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="pm-table-wrap">
            <table class="pm-table">
                <thead>
                    <tr>
                        <th class="pm-th pm-th-corner">소구 \\ 매체</th>
                        ${platformHeaderCells}
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <div class="pm-legend">
            <span class="pm-legend-label">${metricCfg.label}:</span>
            <span class="pm-legend-bar"><span class="pm-legend-low">낮음</span><span class="pm-legend-gradient"></span><span class="pm-legend-high">높음</span></span>
            <span class="pm-legend-hint"><i class="fas fa-hand-pointer"></i> 셀 클릭 시 대표 소재 보기</span>
        </div>
    `;

    // 셀 클릭 → 대표 소재 모달
    container.querySelectorAll('.pm-cell[data-creative-id]').forEach(cell => {
        const id = cell.dataset.creativeId;
        if (!id) return;
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => {
            if (typeof window.openModal === 'function') window.openModal(id);
        });
    });
}

// ============================
// 제품별 소구포인트 인사이트
// "이 소구는 좋았다 → 다음에 이렇게 만들자"
// ============================
function renderAppealInsight() {
    const container = document.getElementById('appeal-insight-content');
    if (!container) return;

    // ★ 성과 분석 섹션 통합 필터(performance scope) — 제품/캠페인 자동 반영
    const product = performanceProduct || '';

    // --- ROAS 풀 (Single one: 전환 추적 플랫폼) ---
    let roasPool = [];
    {
        let raw = Array.isArray(window.allCreatives) ? window.allCreatives
                : Array.isArray(allCreatives) ? allCreatives : [];
        if (currentBrand && currentBrand !== 'ALL') raw = raw.filter(c => c.brand === currentBrand);
        raw = raw.filter(c => !isNoConvPlatform((c.platform || '').toString().trim()));
        if (currentEvent)       raw = raw.filter(c => (c.event || '').toString().trim() === currentEvent);
        if (performanceProduct) raw = raw.filter(c => (c.product || '').trim() === performanceProduct);
        if (typeof aggregateByAdName === 'function') raw = aggregateByAdName(raw);
        roasPool = raw.filter(c => (c.roas || 0) > 0);
    }
    // --- 우측 지표 풀 (전체 플랫폼 — 지표 필터로 전환 가능: CTR / ATC율) ---
    let ctrPool = [];
    {
        let raw = Array.isArray(window.allCreatives) ? window.allCreatives
                : Array.isArray(allCreatives) ? allCreatives : [];
        if (currentBrand && currentBrand !== 'ALL') raw = raw.filter(c => c.brand === currentBrand);
        if (currentEvent)       raw = raw.filter(c => (c.event || '').toString().trim() === currentEvent);
        if (performanceProduct) raw = raw.filter(c => (c.product || '').trim() === performanceProduct);
        if (typeof aggregateByAdName === 'function') raw = aggregateByAdName(raw);
        // 선택 지표에 따라 풀 필터링
        if (appealRightMetric === 'atc_rate') {
            ctrPool = raw.filter(c => (c.add_to_cart || 0) > 0);
        } else {
            ctrPool = raw.filter(c => (c.ctr || 0) > 0 || (c.impressions || 0) > 0);
        }
    }

    if (!roasPool.length && !ctrPool.length) {
        container.innerHTML = `<div class="text-center text-slate-400 text-sm py-12"><i class="fas fa-folder-open text-2xl mb-2"></i><br>해당 조건의 데이터가 없습니다</div>`;
        return;
    }

    const MAX_CREATIVES = 5;
    function buildAppealAll(pool) {
        const aMap = new Map();
        pool.forEach(c => {
            const appeals = typeof normalizeArrayField === 'function' ? normalizeArrayField(c.appeal_points) : [];
            appeals.forEach(a => {
                if (!a || a.startsWith('❌')) return;
                if (!aMap.has(a)) aMap.set(a, { keyword: a, count: 0, creatives: [] });
                const item = aMap.get(a);
                item.count++;
                item.creatives.push(c);
            });
        });
        return Array.from(aMap.values()).map(item => {
            const picked = [...item.creatives].sort((a, b) => (b.spend || 0) - (a.spend || 0)).slice(0, MAX_CREATIVES);
            const avgOf = f => picked.length ? picked.map(c => Number(c[f]) || 0).reduce((s, v) => s + v, 0) / picked.length : 0;
            const sumOf = f => picked.reduce((s, c) => s + (Number(c[f]) || 0), 0);
            const sumAtc    = sumOf('add_to_cart');
            const sumClicks = sumOf('clicks');
            const sumSpend  = sumOf('spend');
            return { ...item, roas: avgOf('roas'), ctr: avgOf('ctr'), cvr: avgOf('cvr'),
                spend: sumSpend, revenue: sumOf('revenue'), impressions: sumOf('impressions'),
                clicks: sumClicks, conversions: sumOf('conversions'),
                add_to_cart:  sumAtc,
                atc_rate:     sumClicks > 0 ? sumAtc / sumClicks : 0,
                cost_per_atc: sumAtc > 0 ? Math.round(sumSpend / sumAtc) : 0,
                pickedCreatives: picked, pickedCount: picked.length, ownCount: item.count };
        });
    }

    const allRoas = buildAppealAll(roasPool);
    const allCtr  = buildAppealAll(ctrPool);

    if (!allRoas.length && !allCtr.length) {
        container.innerHTML = `<div class="text-center text-slate-400 text-sm py-12"><i class="fas fa-magic-wand-sparkles text-2xl mb-2"></i><br>소구포인트(appeal_points) 데이터가 없습니다.<br><span class="text-xs">Apps Script로 AI 분석을 실행해주세요.</span></div>`;
        return;
    }

    // 우측 컬럼 지표 — 전역 appealRightMetric 따름
    const ctrCartMode = (appealRightMetric === 'atc_rate');

    // 기준 지표 평균
    const totalSpend = allRoas.reduce((s, x) => s + x.spend, 0);
    const totalRev   = allRoas.reduce((s, x) => s + x.revenue, 0);
    const avgRoas    = totalSpend > 0 ? totalRev / totalSpend : 0;
    const avgCtr     = allCtr.length > 0 ? allCtr.reduce((s, x) => s + (x.ctr || 0), 0) / allCtr.length : 0;
    const avgAtcRate = allCtr.length > 0 ? allCtr.reduce((s, x) => s + (x.atc_rate || 0), 0) / allCtr.length : 0;

    function pickDiverse(sortedList, take = 5) {
        const usedRepIds = new Set();
        const picked = [], skipped = [];
        sortedList.forEach(item => {
            if (picked.length >= take) return;
            const picks = item.pickedCreatives || item.creatives || [];
            const rep = picks[0];
            const repId = rep ? (rep.id || rep.ad_name || rep.creative_name) : null;
            if (repId && usedRepIds.has(repId)) { skipped.push(item); return; }
            picked.push(item);
            if (repId) usedRepIds.add(repId);
        });
        if (picked.length < take && skipped.length) {
            for (const s of skipped) { if (picked.length >= take) break; picked.push(s); }
        }
        return picked;
    }

    const STOP_WORDS = new Set(['개선','향상','효과','증진','강화','있는','없는','및','같은','하는','되는','느낌','관리','케어','느낌의','동시','동시에','높은','낮은','제공','연출']);
    function extractTokens(keyword) {
        if (!keyword) return [];
        return String(keyword).split(/[\s,·・、，/\\-]+/).map(s => s.trim()).filter(s => s.length >= 2 && !STOP_WORDS.has(s));
    }
    allRoas.forEach(item => { item._tokens = extractTokens(item.keyword); });
    allCtr.forEach(item =>  { item._tokens = extractTokens(item.keyword); });

    function buildWinners(all, sortKey) {
        const minThree = all.filter(x => (x.pickedCount || 0) >= 3);
        const minTwo   = all.filter(x => (x.pickedCount || 0) >= 2);
        const candidates = minThree.length >= 3 ? minThree : minTwo.length >= 3 ? minTwo : all;
        return pickDiverse([...candidates].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0)), 5);
    }
    const roasWinners = buildWinners(allRoas, 'roas');
    const ctrSortKey  = ctrCartMode ? 'atc_rate' : 'ctr';
    const ctrWinners  = buildWinners(allCtr, ctrSortKey);
    const winners = roasWinners; // aiGuide는 ROAS 기준 사용

    // 4) "다음에 이렇게 만들자" 추천 조합 — winner 소구 + 같은 소재의 후킹/감정 추출
    const recommendedHooks = new Map();
    const recommendedEmotions = new Map();
    winners.forEach(w => {
        w.creatives.forEach(c => {
            const hooks = (typeof normalizeArrayField === 'function')
                ? normalizeArrayField(c.hook_type) : [];
            const emos = (typeof normalizeArrayField === 'function')
                ? normalizeArrayField(c.target_emotion) : [];
            hooks.forEach(h => {
                if (!h) return;
                recommendedHooks.set(h, (recommendedHooks.get(h) || 0) + 1);
            });
            emos.forEach(e => {
                if (!e) return;
                recommendedEmotions.set(e, (recommendedEmotions.get(e) || 0) + 1);
            });
        });
    });
    const topHooks = Array.from(recommendedHooks.entries())
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
    const topEmotions = Array.from(recommendedEmotions.entries())
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);

    // 5) HTML 렌더링
    const scopeText = product ? `<b>${product}</b>` : `<b>전체 제품</b>`;
    // 대표 소재 이름(픽업 중 가장 광고비 큰 1개)을 요약 표시
    function topCreativeLabel(item) {
        const list = item.pickedCreatives || item.creatives || [];
        const c = list.slice().sort((a, b) => (b.spend || 0) - (a.spend || 0))[0];
        if (!c) return '';
        const name = (c.ad_name || c.creative_name || '').trim();
        if (!name) return '';
        return name.length > 22 ? name.slice(0, 22) + '…' : name;
    }

    // 데이터 신뢰도 배지 — 픽업된 소재 수(3~5개) 기준
    // ★ ROAS는 픽업한 대표 소재들의 평균 ROAS로 계산됨
    function reliabilityBadge(item) {
        const pickedCount = item.pickedCount || (item.pickedCreatives || []).length || 0;
        const ownCount = item.ownCount || 0;

        if (pickedCount >= 5) {
            return `<span class="appeal-rank-reliab good"><i class="fas fa-check-circle"></i>${pickedCount}개 소재 평균</span>`;
        }
        if (pickedCount >= 3) {
            return `<span class="appeal-rank-reliab mid"><i class="fas fa-circle-info"></i>${pickedCount}개 소재 평균</span>`;
        }
        if (pickedCount >= 1) {
            return `<span class="appeal-rank-reliab low"><i class="fas fa-circle-exclamation"></i>${pickedCount}개 소재 평균 (참고용)</span>`;
        }
        return '';
    }

    // metric: 'roas' | 'ctr' | 'atc_rate'
    function buildWinnersHtml(list, metric, avgBase) {
        if (!list.length) return '<div class="appeal-empty">분석 가능한 소구포인트 데이터가 부족합니다</div>';
        return list.map((w, i) => {
            const medal = ['🥇','🥈','🥉','4','5'][i];
            let wVal, mainStatVal, mainStatLbl, subInfo;
            if (metric === 'atc_rate') {
                wVal       = w.atc_rate || 0;
                mainStatVal = `${(wVal * 100).toFixed(2)}%`;
                mainStatLbl = '평균 ATC율';
                subInfo     = `ATC ${formatNumber(w.add_to_cart)}건 · 노출 ${formatNumber(w.impressions)}`;
            } else if (metric === 'ctr') {
                wVal       = w.ctr || 0;
                mainStatVal = `${(wVal * 100).toFixed(2)}%`;
                mainStatLbl = '평균 CTR';
                subInfo     = `노출 ${formatNumber(w.impressions)}`;
            } else {
                // roas
                wVal       = w.roas || 0;
                mainStatVal = `${Math.round(wVal * 100)}%`;
                mainStatLbl = '평균 ROAS';
                subInfo     = `광고비 ₩${formatNumber(w.spend)}`;
            }
            const lift    = avgBase > 0 ? ((wVal / avgBase - 1) * 100) : 0;
            const liftTxt = lift > 0 ? `+${lift.toFixed(0)}%` : `${lift.toFixed(0)}%`;
            const topCreative = topCreativeLabel(w);
            const pickedCount = w.pickedCount || (w.pickedCreatives || []).length || 0;
            return `
                <div class="appeal-rank-row appeal-rank-winner">
                    <div class="appeal-rank-medal">${medal}</div>
                    <div class="appeal-rank-info">
                        <div class="appeal-rank-keyword">${w.keyword}</div>
                        <div class="appeal-rank-meta">${pickedCount}개 소재 평균 · ${subInfo} ${reliabilityBadge(w)}</div>
                        ${topCreative ? `<div class="appeal-rank-topcreative"><i class="fas fa-star"></i> 대표 소재: <b>${topCreative}</b></div>` : ''}
                    </div>
                    <div class="appeal-rank-stats">
                        <div class="appeal-rank-roas"><b>${mainStatVal}</b><span>${mainStatLbl}</span></div>
                        <div class="appeal-rank-lift positive">평균比 ${liftTxt}</div>
                    </div>
                </div>`;
        }).join('');
    }
    const roasWinnersHtml = buildWinnersHtml(roasWinners, 'roas', avgRoas);
    const ctrAvgBase      = ctrCartMode ? avgAtcRate : avgCtr;
    const ctrWinnersHtml  = buildWinnersHtml(ctrWinners, ctrSortKey, ctrAvgBase);

    const topWinner = winners[0];
    const recommendChips = (arr, cls) => arr.length
        ? arr.map(x => `<span class="appeal-suggest-chip ${cls}">${x}</span>`).join('')
        : `<span class="appeal-suggest-empty">데이터 부족</span>`;

    // ============================================================
    // 💡 "다음 소재는 이렇게" — 강화 콘텐츠 데이터 준비
    // ============================================================

    // (A) 캐치카피 예시 — winner 소재들의 실제 key_message 추출
    //     ad_name + 메시지 dedup, ROAS desc 정렬, 최대 4개
    const copySeen = new Set();
    const copyCandidates = [];
    winners.forEach(w => {
        (w.pickedCreatives || w.creatives || []).forEach(c => {
            const kr = (c.key_message_kr || '').trim();
            const jp = (c.key_message_jp || '').trim();
            if (!kr && !jp) return;
            const dedupKey = (c.ad_name || c.creative_name || '') + '|' + (kr || jp);
            if (copySeen.has(dedupKey)) return;
            copySeen.add(dedupKey);
            copyCandidates.push({
                kr, jp,
                appeal: w.keyword,
                roas: c.roas || 0,
                ad_name: c.ad_name || c.creative_name || '',
                hooks: (typeof normalizeArrayField === 'function' ? normalizeArrayField(c.hook_type) : []),
                emotions: (typeof normalizeArrayField === 'function' ? normalizeArrayField(c.target_emotion) : [])
            });
        });
    });
    const topCopies = copyCandidates
        .sort((a, b) => (b.roas || 0) - (a.roas || 0))
        .slice(0, 4);

    // (B) 레이아웃/디자인 추천 — media_type 비율 + 톤
    const mediaCount = new Map();   // image / video / etc.
    const toneCount = new Map();    // target_emotion (재사용)
    let winnerCreativeTotal = 0;
    winners.forEach(w => {
        (w.pickedCreatives || w.creatives || []).forEach(c => {
            winnerCreativeTotal += 1;
            const mt = (c.media_type || '').toString().toLowerCase().trim();
            let mtKey = '기타';
            if (mt.includes('video') || mt.includes('영상') || mt.includes('동영상') || mt === 'mp4') mtKey = '영상';
            else if (mt.includes('image') || mt.includes('이미지') || mt.includes('img') || mt.includes('jpg') || mt.includes('png') || mt.includes('static')) mtKey = '이미지';
            else if (mt.includes('carousel') || mt.includes('캐러셀') || mt.includes('슬라이드')) mtKey = '캐러셀';
            else if (mt) mtKey = mt;
            mediaCount.set(mtKey, (mediaCount.get(mtKey) || 0) + 1);

            const emos = (typeof normalizeArrayField === 'function') ? normalizeArrayField(c.target_emotion) : [];
            emos.forEach(e => { if (e) toneCount.set(e, (toneCount.get(e) || 0) + 1); });
        });
    });
    const mediaRanked = Array.from(mediaCount.entries())
        .sort((a, b) => b[1] - a[1]);
    const topMediaType = mediaRanked[0] || null;
    const mediaShare = topMediaType && winnerCreativeTotal > 0
        ? Math.round((topMediaType[1] / winnerCreativeTotal) * 100) : 0;
    const topTones = Array.from(toneCount.entries())
        .sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);

    // 레이아웃 추천 텍스트 — media_type 기반
    function buildLayoutTip(mt) {
        if (!mt) return '';
        if (mt === '영상') return '첫 1.5초 안에 제품·핵심 카피 노출 → 사용 장면 → 결과 비포어/애프터 순으로 구성';
        if (mt === '이미지') return '단일 비주얼 + 큰 헤드라인 카피 1줄 + 보조 카피·CTA 배치. 인물 시선은 카피 방향으로';
        if (mt === '캐러셀') return '1컷=문제 제기, 2~3컷=핵심 소구 강조, 마지막 컷=CTA·혜택 요약';
        return '핵심 카피와 시각 요소를 1:1 비율로 배치, 시선 동선을 자연스럽게 유도';
    }
    const layoutTip = buildLayoutTip(topMediaType?.[0]);

    // 캐치카피 카드 HTML 빌더
    const copyCardsHtml = topCopies.length ? topCopies.map((c, i) => {
        const _copyVal = c.roas || 0;
        const liftPct = avgRoas > 0 ? Math.round((_copyVal / avgRoas - 1) * 100) : 0;
        const liftBadge = liftPct > 0
            ? `<span class="appeal-copy-lift positive">평균比 +${liftPct}%</span>`
            : `<span class="appeal-copy-lift">ROAS ${Math.round(_copyVal * 100)}%</span>`;
        return `
            <div class="appeal-copy-card">
                <div class="appeal-copy-rank">#${i + 1}</div>
                <div class="appeal-copy-body">
                    ${c.kr ? `<div class="appeal-copy-kr">"${c.kr}"</div>` : ''}
                    ${c.jp ? `<div class="appeal-copy-jp">🇯🇵 ${c.jp}</div>` : ''}
                    <div class="appeal-copy-meta">
                        <span class="appeal-copy-tag"><i class="fas fa-tag"></i> ${c.appeal}</span>
                        ${liftBadge}
                    </div>
                </div>
            </div>
        `;
    }).join('') : `<div class="appeal-copy-empty">위너 소재의 카피 데이터가 부족합니다</div>`;

    // 미디어 분포 막대
    const mediaBarHtml = mediaRanked.length ? mediaRanked.slice(0, 3).map(([k, v]) => {
        const pct = winnerCreativeTotal > 0 ? Math.round((v / winnerCreativeTotal) * 100) : 0;
        return `
            <div class="appeal-media-bar-row">
                <span class="appeal-media-bar-label">${k}</span>
                <div class="appeal-media-bar-track">
                    <div class="appeal-media-bar-fill" style="width:${pct}%"></div>
                </div>
                <span class="appeal-media-bar-val">${pct}% <em>(${v})</em></span>
            </div>
        `;
    }).join('') : '<div class="appeal-suggest-empty">데이터 부족</div>';

    // 우측 컬럼 헤더 — 지표 토글 버튼
    const hasCartData = (() => {
        let raw = Array.isArray(window.allCreatives) ? window.allCreatives : Array.isArray(allCreatives) ? allCreatives : [];
        if (currentBrand && currentBrand !== 'ALL') raw = raw.filter(c => c.brand === currentBrand);
        if (currentEvent)       raw = raw.filter(c => (c.event||'').toString().trim() === currentEvent);
        if (performanceProduct) raw = raw.filter(c => (c.product||'').trim() === performanceProduct);
        return raw.some(c => (c.add_to_cart || 0) > 0);
    })();
    const rightMetricBtns = `
        <div class="appeal-metric-tabs">
            <button class="appeal-metric-tab${appealRightMetric === 'ctr' ? ' active' : ''}" data-metric="ctr">
                <i class="fas fa-chart-line"></i> CTR
            </button>
            ${hasCartData ? `<button class="appeal-metric-tab${appealRightMetric === 'atc_rate' ? ' active' : ''}" data-metric="atc_rate">
                <i class="fas fa-cart-shopping"></i> ATC율
            </button>` : ''}
        </div>`;

    // 성과 분석 탭: Single one(ROAS) | 전체(지표 선택) 두 열 나란히
    container.innerHTML = `
        <div class="appeal-insight-dual-grid">
            <div class="appeal-section appeal-section-winner">
                <div class="appeal-section-header">
                    <i class="fas fa-trophy"></i>
                    <span>${scopeText} · Single one&nbsp;<span class="appeal-header-metric roas">ROAS 기준</span></span>
                </div>
                <div class="appeal-section-body">${roasWinnersHtml}</div>
            </div>
            <div class="appeal-section appeal-section-winner appeal-section-ctr">
                <div class="appeal-section-header appeal-section-header-flex">
                    <div class="appeal-section-header-left">
                        <i class="fas ${ctrCartMode ? 'fa-cart-shopping' : 'fa-chart-line'}"></i>
                        <span>${scopeText} · 전체&nbsp;<span class="appeal-header-metric ${ctrCartMode ? 'atc' : 'ctr'}">${ctrCartMode ? 'ATC율 기준' : 'CTR 기준'}</span></span>
                    </div>
                    ${rightMetricBtns}
                </div>
                <div class="appeal-section-body">${ctrWinnersHtml}</div>
            </div>
        </div>
    `;

    // 지표 토글 버튼 이벤트 바인딩
    container.querySelectorAll('.appeal-metric-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = btn.getAttribute('data-metric');
            if (m && m !== appealRightMetric) {
                appealRightMetric = m;
                renderAppealInsight();
            }
        });
    });

    // AI 인사이트 탭: "다음 소재는 이렇게" 박스 렌더링
    const aiGuideContainer = document.getElementById('next-creative-ai-guide');
    if (aiGuideContainer) {
        // AI 프롬프트 생성용 데이터 저장 (전역)
        window._lastNextCreativeData = { topWinner, winners, topHooks, topEmotions, topCopies, topMediaType, scopeText };

        aiGuideContainer.innerHTML = `<!-- NEXT 추천 박스 — 4개 섹션 강화 -->
        <div class="appeal-next-box">
            <div class="appeal-next-header">
                <span class="appeal-next-icon"><i class="fas fa-wand-magic-sparkles"></i></span>
                <span class="appeal-next-title">💡 다음 소재는 이렇게 만들어 보세요</span>
                <span class="appeal-next-subtitle">위너 소재 ${winnerCreativeTotal}개 분석 기반 실전 가이드</span>
            </div>

            <div class="appeal-next-sections">

                <!-- 1) 핵심 소구포인트 -->
                <div class="appeal-next-section appeal-next-section-appeal">
                    <div class="appeal-next-section-head">
                        <span class="appeal-next-section-num">1</span>
                        <span class="appeal-next-section-title"><i class="fas fa-bullseye"></i> 핵심 소구포인트</span>
                    </div>
                    <div class="appeal-next-section-body">
                        ${topWinner ? `
                            <div class="appeal-appeal-primary">
                                <span class="appeal-suggest-chip primary big">${topWinner.keyword}</span>
                                <div class="appeal-appeal-stats">
                                    <div class="appeal-appeal-stat">
                                        <span class="appeal-appeal-stat-val">+${Math.round((topWinner.roas / (avgRoas || 1) - 1) * 100)}%</span>
                                        <span class="appeal-appeal-stat-lbl">평균比 ROAS</span>
                                    </div>
                                    <div class="appeal-appeal-stat">
                                        <span class="appeal-appeal-stat-val">${Math.round(topWinner.roas * 100)}%</span>
                                        <span class="appeal-appeal-stat-lbl">달성 ROAS</span>
                                    </div>
                                    <div class="appeal-appeal-stat">
                                        <span class="appeal-appeal-stat-val">${topWinner.pickedCount || (topWinner.pickedCreatives||[]).length || 0}</span>
                                        <span class="appeal-appeal-stat-lbl">검증 소재 수</span>
                                    </div>
                                </div>
                            </div>
                            ${winners.length > 1 ? `
                                <div class="appeal-appeal-also">
                                    <span class="appeal-appeal-also-lbl">함께 시도해볼 소구</span>
                                    <div class="appeal-suggest-chips">
                                        ${winners.slice(1, 4).map(w => `<span class="appeal-suggest-chip soft">${w.keyword}</span>`).join('')}
                                    </div>
                                </div>
                            ` : ''}
                        ` : `<div class="appeal-suggest-empty">위너 소구포인트 데이터가 부족합니다</div>`}
                    </div>
                </div>

                <!-- 2) 캐치카피 예시 -->
                <div class="appeal-next-section appeal-next-section-copy">
                    <div class="appeal-next-section-head">
                        <span class="appeal-next-section-num">2</span>
                        <span class="appeal-next-section-title"><i class="fas fa-quote-left"></i> 캐치카피 예시</span>
                        <span class="appeal-next-section-hint">실제 위너 소재의 카피 ${topCopies.length}건</span>
                    </div>
                    <div class="appeal-next-section-body">
                        <div class="appeal-copy-grid">
                            ${copyCardsHtml}
                        </div>
                        ${topCopies.length ? `
                            <div class="appeal-copy-guide">
                                <i class="fas fa-lightbulb"></i>
                                위 카피들의 <b>구조·길이·말투</b>를 참고하되, 핵심 소구포인트 <b>"${topWinner ? topWinner.keyword : ''}"</b>를 자연스럽게 녹여 변형해보세요.
                            </div>
                        ` : ''}
                    </div>
                </div>

                <!-- 3) 후킹 방식 추천 -->
                <div class="appeal-next-section appeal-next-section-hook">
                    <div class="appeal-next-section-head">
                        <span class="appeal-next-section-num">3</span>
                        <span class="appeal-next-section-title"><i class="fas fa-bolt"></i> 후킹 방식 추천</span>
                    </div>
                    <div class="appeal-next-section-body">
                        <div class="appeal-hook-row">
                            <span class="appeal-hook-row-lbl">초반 3초 훅</span>
                            <div class="appeal-suggest-chips">${recommendChips(topHooks, 'cyan')}</div>
                        </div>
                        <div class="appeal-hook-row">
                            <span class="appeal-hook-row-lbl">감정 코드</span>
                            <div class="appeal-suggest-chips">${recommendChips(topEmotions, 'rose')}</div>
                        </div>
                        <div class="appeal-hook-tip">
                            <i class="fas fa-circle-info"></i>
                            상위 소구 소재가 공통적으로 사용한 패턴 — 이 조합이 클릭과 전환을 함께 끌어올림
                        </div>
                    </div>
                </div>

                <!-- 4) 레이아웃 / 디자인 추천 -->
                <div class="appeal-next-section appeal-next-section-design">
                    <div class="appeal-next-section-head">
                        <span class="appeal-next-section-num">4</span>
                        <span class="appeal-next-section-title"><i class="fas fa-palette"></i> 레이아웃 / 디자인 추천</span>
                    </div>
                    <div class="appeal-next-section-body">
                        <div class="appeal-design-grid">
                            <div class="appeal-design-card">
                                <div class="appeal-design-card-head"><i class="fas fa-photo-film"></i> 추천 포맷</div>
                                ${topMediaType ? `
                                    <div class="appeal-design-format">
                                        <span class="appeal-design-format-main">${topMediaType[0]}</span>
                                        <span class="appeal-design-format-share">위너 ${mediaShare}% 차지</span>
                                    </div>
                                ` : '<div class="appeal-suggest-empty">데이터 부족</div>'}
                                <div class="appeal-media-bars">${mediaBarHtml}</div>
                            </div>
                            <div class="appeal-design-card">
                                <div class="appeal-design-card-head"><i class="fas fa-ruler-combined"></i> 구성 가이드</div>
                                <div class="appeal-design-tip">${layoutTip || '핵심 카피와 시각 요소를 명확히 분리해 시선 동선을 단순화'}</div>
                                ${topTones.length ? `
                                    <div class="appeal-design-tone">
                                        <span class="appeal-design-tone-lbl">추천 톤·무드</span>
                                        <div class="appeal-suggest-chips">${topTones.map(t => `<span class="appeal-suggest-chip rose">${t}</span>`).join('')}</div>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>

        <!-- AI 이미지 프롬프트 생성 버튼 -->
        <div class="ai-image-gen-wrap">
            <button class="ai-image-gen-btn" onclick="window.openCreativePromptModal()">
                <i class="fas fa-wand-magic-sparkles"></i>
                <span>AI 이미지 프롬프트 생성</span>
                <span class="ai-image-gen-badge">ChatGPT · DALL-E</span>
            </button>
            <p class="ai-image-gen-hint">위 인사이트를 기반으로 ChatGPT/DALL-E에 바로 쓸 수 있는 이미지 생성 프롬프트를 만들어드립니다</p>
        </div>
        `;
        // aiGuideContainer.innerHTML 닫기
    }

    // ★ hover preview 바인딩 — 소구포인트 키워드에 마우스 올리면 대표 소재 카드 표시
    attachAppealInsightHoverPreview([...roasPool, ...ctrPool]);
}

// ============================
// 제품별 소구포인트 인사이트 — 대표 소재 hover preview
// ============================
function attachAppealInsightHoverPreview(scopedPool) {
    const container = document.getElementById('appeal-insight-content');
    if (!container) return;

    // 1) 현재 pool 기준으로 keywordCreativeMap 빌드/보장
    //    ★ scopedPool은 이미 filterByMedianSpend로 필터된 상태이므로
    //      threshold를 0으로 전달하여 재필터링 방지 (그러지 않으면 대부분 키워드가 빈 결과)
    if (typeof window.buildKeywordCreativeMap === 'function') {
        window.buildKeywordCreativeMap(scopedPool, { threshold: 0 });
    }

    if (typeof window.showInsightPreview !== 'function' ||
        typeof window.hideInsightPreview !== 'function') {
        return; // hover preview 시스템이 없으면 skip
    }

    // 2) winner / loser 행에 hover 이벤트 바인딩
    container.querySelectorAll('.appeal-rank-row').forEach(row => {
        const kwEl = row.querySelector('.appeal-rank-keyword');
        if (!kwEl) return;
        const keyword = kwEl.textContent.trim();
        if (!keyword) return;

        row.style.cursor = 'pointer';
        row.addEventListener('mouseenter', e => {
            window.showInsightPreview(keyword, 'appeal_points', e);
        });
        row.addEventListener('mouseleave', () => {
            window.hideInsightPreview();
        });
        // 클릭 시 첫 번째 대표 소재 모달
        row.addEventListener('click', () => {
            const map = (typeof window.getKeywordCreativeMap === 'function')
                ? window.getKeywordCreativeMap()
                : null;
            const items = map?.appeal_points?.get(keyword) || [];
            if (items.length && typeof window.openModal === 'function') {
                window.openModal(items[0].id);
                if (typeof window.forceHideInsightPreview === 'function') {
                    window.forceHideInsightPreview();
                }
            }
        });
    });

    // 3) NEXT 추천 박스의 소구 칩에도 동일하게 적용
    container.querySelectorAll('.appeal-suggest-chip.primary, .appeal-suggest-chip.avoid').forEach(chip => {
        const keyword = chip.textContent.trim();
        if (!keyword) return;
        chip.style.cursor = 'pointer';
        chip.addEventListener('mouseenter', e => {
            window.showInsightPreview(keyword, 'appeal_points', e);
        });
        chip.addEventListener('mouseleave', () => {
            window.hideInsightPreview();
        });
    });
}

// ============================
// 제품별 KPI 요약 (개요 탭)
// ============================
function renderProductKPIs() {
    const grid = document.getElementById('product-kpi-grid');
    const empty = document.getElementById('product-kpi-empty');
    const countEl = document.getElementById('product-kpi-count');
    if (!grid) return;

    // ★ 광고명(ad_name) 단위 합산 — 캠페인이 달라도 같은 소재는 하나로 카운트
    let list = getBrandCreatives();
    if (typeof aggregateByAdName === 'function') {
        list = aggregateByAdName(list);
    }

    // 제품별 집계
    const map = new Map();
    list.forEach(c => {
        const prod = (c.product || '').trim();
        if (!prod) return;
        if (!map.has(prod)) {
            map.set(prod, {
                product: prod,
                count: 0,
                impressions: 0,
                clicks: 0,
                spend: 0,
                conversions: 0,
                revenue: 0,
                spend_jpy: 0
            });
        }
        const item = map.get(prod);
        item.count++;
        item.impressions += c.impressions || 0;
        item.clicks += c.clicks || 0;
        item.spend += c.spend || 0;
        item.conversions += c.conversions || 0;
        item.revenue += c.revenue || 0;
        item.spend_jpy += c.spend_jpy || 0;
    });

    if (!map.size) {
        grid.innerHTML = '';
        empty?.classList.remove('hidden');
        if (countEl) countEl.textContent = '';
        return;
    }
    empty?.classList.add('hidden');

    // 광고비 내림차순 정렬
    const products = Array.from(map.values()).sort((a, b) => b.spend - a.spend);
    if (countEl) countEl.textContent = `· ${products.length}개 제품`;

    // 파생 지표 계산
    products.forEach(p => {
        p.ctr = p.impressions > 0 ? (p.clicks / p.impressions) : 0;
        p.cvr = p.clicks > 0 ? (p.conversions / p.clicks) : 0;
        p.roas = p.spend > 0 ? (p.revenue / p.spend) : 0;
        p.cpa = p.conversions > 0 ? Math.round(p.spend / p.conversions) : 0;
    });

    // ★ 0) 한눈에 보기 — 인사이트 결론 카드 (best/worst 제품 진단)
    renderProductInsightSummary(products);
    // 1) 광고비 vs 매출 비교 차트
    renderProductCompareChart(products);
    // 2) 광고비 비중 도넛
    renderProductSpendDonut(products);
    // 3) ROAS 랭킹 가로 막대
    renderProductRoasRanking(products);

    // 4) 컴팩트 카드 그리드 (각 제품 요약)
    grid.innerHTML = products.map(p => {
        const roasClass = p.roas >= 4 ? 'roas-good' : p.roas >= 2.5 ? 'roas-warn' : 'roas-bad';
        return `
            <div class="product-kpi-card-compact">
                <div class="pkc-header">
                    <div class="pkc-title"><i class="fas fa-cube"></i> ${p.product}</div>
                    <span class="pkc-count">${p.count}개</span>
                </div>
                <div class="pkc-roas-badge ${roasClass}">
                    ROAS <b>${Math.round(p.roas * 100)}%</b>
                </div>
                <div class="pkc-stats-row">
                    <span><b>광고비</b> ₩${formatNumber(p.spend)}</span>
                    <span><b>매출</b> ₩${formatNumber(p.revenue)}</span>
                </div>
                <div class="pkc-stats-row">
                    <span><b>CTR</b> ${(p.ctr * 100).toFixed(2)}%</span>
                    <span><b>CVR</b> ${(p.cvr * 100).toFixed(2)}%</span>
                    <span><b>전환</b> ${formatNumber(p.conversions)}</span>
                </div>
            </div>
        `;
    }).join('');
}

// ============================
// 제품별 인사이트 결론 카드 (어떤 제품이 좋았는가)
// ============================
function renderProductInsightSummary(products) {
    const el = document.getElementById('product-insight-summary');
    if (!el) return;
    if (!products || !products.length) {
        el.innerHTML = '';
        return;
    }

    // 광고비 ₩10,000 이상인 제품만 ROAS 평가 (outlier 방지)
    const qualified = products.filter(p => p.spend >= 10000);
    const evalPool = qualified.length ? qualified : products;

    // 가중 평균 ROAS / CTR / CVR (광고비 가중)
    const totalSpend = evalPool.reduce((s, p) => s + p.spend, 0) || 1;
    const totalRevenue = evalPool.reduce((s, p) => s + p.revenue, 0);
    const totalImpr = evalPool.reduce((s, p) => s + p.impressions, 0) || 1;
    const totalClicks = evalPool.reduce((s, p) => s + p.clicks, 0);
    const totalConv = evalPool.reduce((s, p) => s + p.conversions, 0);
    const avgRoas = totalRevenue / totalSpend;
    const avgCtr = totalClicks / totalImpr;
    const avgCvr = totalClicks > 0 ? totalConv / totalClicks : 0;

    // ROAS 기준 정렬
    const byRoas = [...evalPool].sort((a, b) => b.roas - a.roas);
    const best = byRoas[0];
    const worst = byRoas[byRoas.length - 1];

    // 광고비 1등 (가장 많이 투자한 제품)
    const topSpender = [...evalPool].sort((a, b) => b.spend - a.spend)[0];

    // 매출 1등
    const topRevenue = [...evalPool].sort((a, b) => b.revenue - a.revenue)[0];

    // 효율 좋은 제품들 (평균 대비 +20% 이상)
    const efficient = evalPool.filter(p => avgRoas > 0 && p.roas >= avgRoas * 1.2);
    // 부진 제품들 (평균 대비 -30% 이하)
    const underperform = evalPool.filter(p => avgRoas > 0 && p.roas <= avgRoas * 0.7 && p.spend >= 10000);

    // ★ 핵심 진단 메시지 생성
    const diagnoses = [];

    // 진단 1: ROAS 1위 제품
    if (best && best.roas > 0) {
        const lift = avgRoas > 0 ? Math.round(((best.roas / avgRoas) - 1) * 100) : 0;
        diagnoses.push({
            type: 'win',
            icon: '🏆',
            title: `<b>${best.product}</b>이(가) 가장 좋았습니다`,
            desc: `ROAS <b>${Math.round(best.roas * 100)}%</b>${lift > 0 ? ` (평균 대비 +${lift}% 우위)` : ''} · 매출 ₩${formatNumber(best.revenue)} · 소재 ${best.count}개`
        });
    }

    // 진단 2: 광고비 1등 vs ROAS 1등 비교 (예산 배분 진단)
    if (topSpender && best && topSpender.product !== best.product) {
        const spenderEff = topSpender.roas;
        if (spenderEff < avgRoas * 0.9) {
            diagnoses.push({
                type: 'warn',
                icon: '⚠️',
                title: `예산 배분 재검토 필요`,
                desc: `광고비 1위는 <b>${topSpender.product}</b>(ROAS ${Math.round(topSpender.roas * 100)}%)이지만, 효율은 <b>${best.product}</b>(ROAS ${Math.round(best.roas * 100)}%)이 더 좋음 → <b>${best.product}</b>에 예산 확대 고려`
            });
        } else {
            diagnoses.push({
                type: 'info',
                icon: '💰',
                title: `광고비 집중 제품: <b>${topSpender.product}</b>`,
                desc: `광고비 ₩${formatNumber(topSpender.spend)} (점유율 ${Math.round((topSpender.spend / totalSpend) * 100)}%) · ROAS ${Math.round(topSpender.roas * 100)}%`
            });
        }
    } else if (topSpender && best && topSpender.product === best.product) {
        diagnoses.push({
            type: 'win',
            icon: '✅',
            title: `예산-효율 정렬 양호`,
            desc: `광고비 1위(<b>${topSpender.product}</b>)가 ROAS도 1위 — 현재 예산 배분이 효율적`
        });
    }

    // 진단 3: 부진 제품 (개선 권장)
    if (worst && worst.roas < avgRoas * 0.7 && worst.spend >= 10000 && worst.product !== best?.product) {
        const drop = avgRoas > 0 ? Math.round((1 - (worst.roas / avgRoas)) * 100) : 0;
        diagnoses.push({
            type: 'bad',
            icon: '🔻',
            title: `<b>${worst.product}</b> 개선이 시급합니다`,
            desc: `ROAS <b>${Math.round(worst.roas * 100)}%</b> (평균 대비 -${drop}% 미달) · 광고비 ₩${formatNumber(worst.spend)} 소진 → 소재 리프레시 또는 예산 축소 검토`
        });
    }

    // 진단 4: 효율 좋은 제품군 (확장 추천)
    if (efficient.length > 1) {
        const others = efficient.filter(p => p.product !== best?.product).slice(0, 2);
        if (others.length > 0) {
            diagnoses.push({
                type: 'info',
                icon: '🚀',
                title: `함께 성과가 좋은 제품들`,
                desc: `${others.map(p => `<b>${p.product}</b>(ROAS ${Math.round(p.roas * 100)}%)`).join(', ')} 도 평균 이상 — 확대 여력 있음`
            });
        }
    }

    // 진단 5: 데이터 부족 안내
    if (evalPool.length === 1) {
        diagnoses.push({
            type: 'info',
            icon: 'ℹ️',
            title: `비교 가능한 제품이 1개뿐입니다`,
            desc: `다른 제품 데이터를 추가하면 효율 비교가 가능합니다`
        });
    }

    // 카드 렌더
    const headlineRoas = Math.round(avgRoas * 100);
    const totalConvDisplay = formatNumber(totalConv);

    el.innerHTML = `
        <div class="product-insight-card">
            <div class="pi-headline">
                <div class="pi-headline-left">
                    <div class="pi-headline-icon"><i class="fas fa-lightbulb"></i></div>
                    <div class="pi-headline-text">
                        <div class="pi-headline-title">한눈에 보기 · 어떤 제품이 좋았나요?</div>
                        <div class="pi-headline-sub">
                            ${evalPool.length}개 제품 평균 ROAS <b>${headlineRoas}%</b>
                            · 총 매출 <b>₩${formatNumber(totalRevenue)}</b>
                            · 총 전환 <b>${totalConvDisplay}</b>건
                        </div>
                    </div>
                </div>
                ${best ? `
                <div class="pi-headline-best">
                    <span class="pi-best-label"><i class="fas fa-crown"></i> BEST 제품</span>
                    <span class="pi-best-name">${best.product}</span>
                    <span class="pi-best-roas">ROAS ${Math.round(best.roas * 100)}%</span>
                </div>
                ` : ''}
            </div>
            <div class="pi-diagnoses">
                ${diagnoses.map(d => `
                    <div class="pi-diagnosis pi-diagnosis-${d.type}">
                        <span class="pi-diag-icon">${d.icon}</span>
                        <div class="pi-diag-body">
                            <div class="pi-diag-title">${d.title}</div>
                            <div class="pi-diag-desc">${d.desc}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ============================
// 제품별 시각화 차트들
// ============================

function renderProductCompareChart(products) {
    destroyChart('productCompare');
    const ctx = document.getElementById('productCompareChart');
    if (!ctx || !products.length) return;

    // 상위 10개 제품
    const top = products.slice(0, 10);

    charts.productCompare = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top.map(p => p.product.length > 14 ? p.product.substring(0, 14) + '…' : p.product),
            datasets: [
                {
                    label: '광고비',
                    data: top.map(p => p.spend),
                    backgroundColor: 'rgba(99, 102, 241, 0.6)',
                    borderColor: '#6366f1',
                    borderWidth: 1.5,
                    borderRadius: 6,
                },
                {
                    label: '매출',
                    data: top.map(p => p.revenue),
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderRadius: 6,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const v = ctx.raw;
                            return `${ctx.dataset.label}: ₩${formatNumber(v)}`;
                        },
                        afterBody: (items) => {
                            const p = top[items[0].dataIndex];
                            return [
                                `ROAS: ${Math.round(p.roas * 100)}%`,
                                `소재 ${p.count}개`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { font: { size: 10 }, maxRotation: 30 } },
                y: {
                    beginAtZero: true,
                    ticks: {
                        font: { size: 10 },
                        callback: v => '₩' + (v >= 10000 ? (v/10000).toFixed(0) + '만' : v)
                    }
                }
            }
        }
    });
}

function renderProductSpendDonut(products) {
    destroyChart('productSpendDonut');
    const ctx = document.getElementById('productSpendDonut');
    if (!ctx || !products.length) return;

    const top = products.slice(0, 8);
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16'];

    charts.productSpendDonut = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: top.map(p => p.product),
            datasets: [{
                data: top.map(p => p.spend),
                backgroundColor: colors.slice(0, top.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: { font: { size: 10 }, boxWidth: 10, padding: 6 }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const v = ctx.raw;
                            const total = ctx.dataset.data.reduce((s, x) => s + x, 0);
                            const pct = total > 0 ? ((v / total) * 100).toFixed(1) : 0;
                            return `${ctx.label}: ₩${formatNumber(v)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderProductRoasRanking(products) {
    const el = document.getElementById('product-roas-ranking');
    if (!el || !products.length) {
        if (el) el.innerHTML = '';
        return;
    }
    // ROAS 내림차순 정렬
    const sorted = [...products].sort((a, b) => b.roas - a.roas);
    const maxRoas = Math.max(...sorted.map(p => p.roas), 1);
    // 전체 광고비
    const totalSpend = sorted.reduce((s, p) => s + p.spend, 0);

    el.innerHTML = `
        <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-900 flex items-center gap-2">
                <i class="fas fa-ranking-star text-amber-500"></i>
                제품별 ROAS 랭킹
            </h3>
            <span class="text-xs text-slate-400">막대 길이 = ROAS, 우측 칩 = 광고비 비중</span>
        </div>
        <div class="space-y-2">
            ${sorted.map((p, i) => {
                const pct = maxRoas > 0 ? (p.roas / maxRoas) * 100 : 0;
                const roasClass = p.roas >= 4 ? 'good' : p.roas >= 2.5 ? 'warn' : 'bad';
                const spendShare = totalSpend > 0 ? ((p.spend / totalSpend) * 100).toFixed(1) : 0;
                return `
                    <div class="roas-rank-row">
                        <div class="roas-rank-label">
                            <span class="roas-rank-no">${i + 1}</span>
                            <span class="roas-rank-name">${p.product}</span>
                        </div>
                        <div class="roas-rank-bar-wrap">
                            <div class="roas-rank-bar roas-rank-bar-${roasClass}" style="width:${pct.toFixed(1)}%">
                                <span class="roas-rank-value">${Math.round(p.roas * 100)}%</span>
                            </div>
                        </div>
                        <div class="roas-rank-meta">
                            <span class="roas-rank-share">${spendShare}%</span>
                            <span class="roas-rank-spend">₩${formatNumber(p.spend)}</span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// ============================
// 제품별 BEST TOP 5 / WORST 5
// ============================

// 제품 셀렉트 박스 옵션 채우기 (현재 브랜드 기준)
function populateProductOptions() {
    const sel = document.getElementById('product-select');
    if (!sel) return;
    const list = getBrandCreatives();
    const products = Array.from(new Set(
        list.map(c => (c.product || '').trim()).filter(Boolean)
    )).sort();

    const currentValue = sel.value;
    sel.innerHTML = '<option value="">전체 제품 (통합)</option>' +
        products.map(p => `<option value="${p}">${p}</option>`).join('');

    // 이전 선택값 유지 (가능한 경우)
    if (currentValue && products.includes(currentValue)) {
        sel.value = currentValue;
    }
}

// 정렬 기준별 라벨/등급 기준
const METRIC_CONFIG = {
    roas:         { label: 'ROAS',          format: v => Math.round((v||0) * 100) + '%',        higherIsBetter: true },
    ctr:          { label: 'CTR',           format: v => ((v||0) * 100).toFixed(2) + '%',       higherIsBetter: true },
    cvr:          { label: 'CVR',           format: v => ((v||0) * 100).toFixed(2) + '%',       higherIsBetter: true },
    revenue:      { label: '매출',           format: v => '₩' + formatNumber(v||0),             higherIsBetter: true },
    conversions:  { label: '전환수',         format: v => formatNumber(v||0) + '건',            higherIsBetter: true },
    impressions:  { label: '노출수',         format: v => formatNumber(v||0),                   higherIsBetter: true },
    // 장바구니 최적화 지표
    atc_rate:     { label: 'ATC율',          format: v => ((v||0) * 100).toFixed(2) + '%',       higherIsBetter: true },
    add_to_cart:  { label: 'ATC 건수',       format: v => formatNumber(v||0) + '건',            higherIsBetter: true },
    cost_per_atc: { label: 'Cost per ATC',  format: v => '₩' + formatNumber(Math.round(v||0)), higherIsBetter: false },
};

// ============================
// 소재 집계 유틸 (ad_name 기준 합산)
// ============================
// 일별로 breakdown 된 같은 소재(동일 ad_name)를 하나로 합쳐주는 함수
// - spend, impressions, clicks, conversions, revenue 등 누적 가능한 지표는 합산
// - CTR/CVR/ROAS/CPC/CPA 등 비율형 지표는 합산 후 재계산
// - 텍스트/메타 필드(브랜드, 제품, 플랫폼, 소구포인트, 썸네일 등)는 첫 행 기준
// ============================
// 광고명(ad_name) 단위 합산
// ★ 캠페인이 달라도 광고명이 같으면 하나의 소재로 합산
// ★ 소구포인트/훅/감정 등 배열형 키워드는 "빈도 기반 종합"
//    - 같은 광고명을 가진 행들에서 가장 자주 등장한 키워드 우선
//    - 동일 빈도면 등장 순서 보존
// ★ 캐싱: 동일 입력 배열(참조)에 대해 재계산 방지 (페이지 속도 개선)
// ============================
const _aggregateCache = new WeakMap();
function aggregateByAdName(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    // ★ 캐시 조회 — 동일 배열 참조면 즉시 반환
    if (_aggregateCache.has(rows)) return _aggregateCache.get(rows);
    const groups = new Map();

    rows.forEach(r => {
        // ad_name 우선, 없으면 creative_name, 없으면 id로 그룹핑 (집계 불가능 → 단독 그룹)
        const key = (r.ad_name || r.creative_name || r.id || '').toString().trim();
        if (!key) {
            // 키가 없는 행은 고유 id로 단독 그룹
            groups.set('__nogroup__' + r.id, [r]);
            return;
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    });

    // 키워드 배열 필드 빈도 기반 통합 헬퍼
    // (split & normalize → 카운트 → 빈도 내림차순으로 정렬)
    function mergeKeywordField(items, field, topN) {
        const counter = new Map();
        const order = []; // 처음 등장 순서 보존용
        items.forEach(it => {
            let raw = it[field];
            if (!raw) return;
            // 배열/문자열 모두 처리 (insights.js의 normalizeKeywords와 동일 규칙)
            let arr;
            if (Array.isArray(raw)) {
                arr = raw.flatMap(v => String(v).split(/[,、，·・]/).map(s => s.trim()).filter(Boolean));
            } else {
                arr = String(raw).split(/[,、，·・]/).map(s => s.trim()).filter(Boolean);
            }
            arr.forEach(k => {
                if (!k || k.startsWith('❌')) return;
                if (!counter.has(k)) {
                    counter.set(k, 0);
                    order.push(k);
                }
                counter.set(k, counter.get(k) + 1);
            });
        });
        if (!counter.size) return '';
        // 빈도 내림차순, 동률이면 등장 순서
        const sorted = order.slice().sort((a, b) => {
            const diff = counter.get(b) - counter.get(a);
            if (diff !== 0) return diff;
            return order.indexOf(a) - order.indexOf(b);
        });
        const top = (topN && topN > 0) ? sorted.slice(0, topN) : sorted;
        return top.join(', ');
    }

    // 일반 텍스트 필드: 가장 자주 나오는 값 1개 선택
    function pickMostFrequent(items, field) {
        const counter = new Map();
        const order = [];
        items.forEach(it => {
            const v = (it[field] == null) ? '' : String(it[field]).trim();
            if (!v) return;
            if (!counter.has(v)) {
                counter.set(v, 0);
                order.push(v);
            }
            counter.set(v, counter.get(v) + 1);
        });
        if (!counter.size) return '';
        const sorted = order.slice().sort((a, b) => {
            const diff = counter.get(b) - counter.get(a);
            if (diff !== 0) return diff;
            return order.indexOf(a) - order.indexOf(b);
        });
        return sorted[0];
    }

    const merged = [];
    groups.forEach((items, key) => {
        if (items.length === 1) {
            merged.push(items[0]);
            return;
        }
        // 다중 행 합산
        const first = items[0];
        const sumSpend       = items.reduce((s, x) => s + (x.spend || 0), 0);
        const sumSpendJpy    = items.reduce((s, x) => s + (x.spend_jpy || 0), 0);
        const sumImpr        = items.reduce((s, x) => s + (x.impressions || 0), 0);
        const sumClicks      = items.reduce((s, x) => s + (x.clicks || 0), 0);
        const sumConv        = items.reduce((s, x) => s + (x.conversions || 0), 0);
        const sumRev         = items.reduce((s, x) => s + (x.revenue || 0), 0);
        const sumRevJpy      = items.reduce((s, x) => s + (x.revenue_jpy || 0), 0);
        const sumAtc         = items.reduce((s, x) => s + (x.add_to_cart || 0), 0);

        // 비율형 지표 재계산 (분모 0 방지)
        const ctr  = sumImpr   > 0 ? (sumClicks / sumImpr)        : 0;
        const cvr  = sumClicks > 0 ? (sumConv   / sumClicks)      : 0;
        const rawRoasArr = items.map(x => Number(x.roas) || 0).filter(v => v > 0);
        const roas = sumSpend > 0
            ? (sumRev / sumSpend)
            : rawRoasArr.length > 0
                ? rawRoasArr.reduce((a, b) => a + b, 0) / rawRoasArr.length
                : 0;
        const cpc         = sumClicks > 0 ? (sumSpend / sumClicks) : 0;
        const cpa         = sumConv   > 0 ? (sumSpend / sumConv)   : 0;
        // 장바구니 파생 지표 재계산
        const atc_rate    = sumClicks > 0 ? (sumAtc   / sumClicks) : 0;
        const cost_per_atc = sumAtc   > 0 ? Math.round(sumSpend / sumAtc) : 0;

        // 날짜 범위 (가장 이른 시작일 ~ 가장 늦은 종료일)
        const dates = items.map(x => x.start_date).filter(Boolean).sort();
        const endDates = items.map(x => x.end_date).filter(Boolean).sort();

        // ★ 키워드 배열 필드: 빈도 기반 통합 (자주 반복되는 포인트 우선)
        const mergedAppeals  = mergeKeywordField(items, 'appeal_points');
        const mergedHooks    = mergeKeywordField(items, 'hook_type');
        const mergedEmotions = mergeKeywordField(items, 'target_emotion');

        // ★ 평문 텍스트 필드: 가장 자주 나오는 값 선택
        const mergedPlatform = pickMostFrequent(items, 'platform') || first.platform || '';
        const mergedProduct  = pickMostFrequent(items, 'product')  || first.product  || '';
        const mergedBrand    = pickMostFrequent(items, 'brand')    || first.brand    || '';

        // 캠페인 정보: 여러 캠페인을 모두 보존 (모달/상세에서 활용)
        const campaignsSet = new Set();
        items.forEach(it => {
            const cn = (it.campaign_name || '').toString().trim();
            if (cn) campaignsSet.add(cn);
        });
        const campaignsArr = Array.from(campaignsSet);
        const mergedCampaign = campaignsArr.length
            ? (campaignsArr.length === 1 ? campaignsArr[0] : `${campaignsArr[0]} 외 ${campaignsArr.length - 1}건`)
            : (first.campaign_name || '');

        merged.push({
            ...first,
            // 합산 지표
            spend: sumSpend,
            spend_jpy: sumSpendJpy,
            impressions: sumImpr,
            clicks: sumClicks,
            conversions: sumConv,
            revenue: sumRev,
            revenue_jpy: sumRevJpy,
            // 재계산 지표
            ctr, cvr, roas, cpc, cpa,
            add_to_cart: sumAtc, atc_rate, cost_per_atc,
            // 날짜 범위
            start_date: dates[0] || first.start_date,
            end_date: endDates[endDates.length - 1] || first.end_date,
            // ★ 통합된 키워드/카테고리 필드
            appeal_points: mergedAppeals || first.appeal_points || '',
            hook_type: mergedHooks || first.hook_type || '',
            target_emotion: mergedEmotions || first.target_emotion || '',
            platform: mergedPlatform,
            product: mergedProduct,
            brand: mergedBrand,
            campaign_name: mergedCampaign,
            // 집계 메타
            _aggregated: true,
            _row_count: items.length,
            _campaigns: campaignsArr,            // 합쳐진 캠페인 목록 (디버그/상세용)
            _appeal_top: mergedAppeals,          // 빈도 종합된 소구포인트
            _hook_top: mergedHooks,
            _emotion_top: mergedEmotions,
            // 대표 id (첫 행) → 모달 열기용
            id: first.id,
        });
    });

    // ★ 캐시 저장 (동일 입력 참조 시 즉시 반환)
    try { _aggregateCache.set(rows, merged); } catch (_) {}
    return merged;
}

// 숫자 배열의 중앙값
function median(arr) {
    if (!arr || !arr.length) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

// ★ renderProductPerformance 전용 집계 캐시
// 동일 필터 상태 + 동일 allCreatives 참조면 재집계 생략
let _perfPerfCache = null;
function _getPerfData() {
    const cacheKey = `${currentBrand}|${currentPlatform}|${currentEvent}|${performanceProduct}`;
    const src = window.allCreatives || allCreatives || [];
    if (_perfPerfCache && _perfPerfCache.key === cacheKey && _perfPerfCache.src === src) {
        return _perfPerfCache;
    }
    let data = src;
    if (currentBrand && currentBrand !== 'ALL') data = data.filter(c => c.brand === currentBrand);
    if (currentPlatform) data = data.filter(c => (c.platform || '').toString().trim() === currentPlatform);
    if (currentEvent)   data = data.filter(c => (c.event    || '').toString().trim() === currentEvent);
    if (performanceProduct) data = data.filter(c => (c.product || '').trim() === performanceProduct);

    const isAllPlatform = !currentPlatform;
    const dataForRanking = isAllPlatform ? filterTrackedOnly(data) : data;
    const aggregated = (typeof aggregateByAdName === 'function') ? aggregateByAdName(dataForRanking) : dataForRanking;

    _perfPerfCache = { key: cacheKey, src, data: aggregated, isAllPlatform };
    return _perfPerfCache;
}
// 필터 변경 시 캐시 무효화 (invalidatePerformancePoolCache와 함께 호출)
const _origInvalidate = window.invalidatePerformancePoolCache || (() => {});
window.invalidatePerformancePoolCache = function() { _perfPerfCache = null; _origInvalidate(); };

function renderProductPerformance() {
    const metricSel = document.getElementById('product-sort-metric');
    const bestEl = document.getElementById('best-creatives-list');
    const summaryEl = document.getElementById('product-summary');
    if (!bestEl) return;

    const { data: dataArr, isAllPlatform } = _getPerfData();

    if (!dataArr.length) {
        if (summaryEl) summaryEl.innerHTML = '';
        bestEl.innerHTML = `<div class="text-center text-slate-400 text-sm py-8"><i class="fas fa-folder-open text-2xl mb-2"></i><br>데이터 없음</div>`;
        return;
    }

    // 장바구니 모드 감지
    const cartMode = isCartMode(dataArr);

    // 정렬 지표 결정 (사용자 선택 유지 — 자동 전환 없음)
    let metric = metricSel?.value || 'ctr';

    // 장바구니 모드일 때 셀렉트에 ATC 옵션 동적 추가
    if (metricSel) {
        const hasAtcOpt = metricSel.querySelector('option[value="atc_rate"]');
        if (cartMode && !hasAtcOpt) {
            const grp = document.createElement('optgroup');
            grp.label = '🛒 장바구니';
            grp.innerHTML = `
                <option value="atc_rate">ATC율 (장바구니율)</option>
                <option value="add_to_cart">ATC 건수</option>
                <option value="cost_per_atc">Cost per ATC</option>`;
            metricSel.appendChild(grp);
        } else if (!cartMode && hasAtcOpt) {
            // 장바구니 모드 해제 시 ATC 옵션 제거
            metricSel.querySelectorAll('optgroup').forEach(g => {
                if (g.label === '🛒 장바구니') g.remove();
            });
        }
    }

    // 지표값 > 0인 소재 우선, 없으면 impressions > 0, 그래도 없으면 전체
    let pool = dataArr.filter(c => (c[metric] || 0) > 0);
    if (!pool.length) pool = dataArr.filter(c => (c.impressions || 0) > 0 || (c.clicks || 0) > 0);
    if (!pool.length) pool = dataArr;

    const cfg = METRIC_CONFIG[metric] || { label: metric };
    const cartLabel = cartMode ? '🛒 ' : '';
    const trackingNote = isAllPlatform
        ? `<span class="text-[10px] text-indigo-400 ml-1">· 전환 추적 매체 종합 합산</span>`
        : `<span class="text-[10px] text-slate-400 ml-1">· ${currentPlatform} 단독</span>`;
    if (summaryEl) summaryEl.innerHTML = `<span class="text-xs text-slate-400">BEST TOP 5 · ${pool.length}개 후보 · ${cartLabel}${cfg.label || metric} 기준${trackingNote}</span>`;

    // 정렬: cost_per_atc는 낮을수록 좋음 → 오름차순
    const sortAsc = metric === 'cost_per_atc';
    const best = [...pool]
        .sort((a, b) => sortAsc
            ? (a[metric] || Infinity) - (b[metric] || Infinity)
            : (b[metric] || 0) - (a[metric] || 0))
        .slice(0, 5);

    // benchmark
    const totalSpend  = pool.reduce((s, x) => s + (x.spend || 0), 0);
    const totalRev    = pool.reduce((s, x) => s + (x.revenue || 0), 0);
    const totalImpr   = pool.reduce((s, x) => s + (x.impressions || 0), 0);
    const totalClicks = pool.reduce((s, x) => s + (x.clicks || 0), 0);
    const totalConv   = pool.reduce((s, x) => s + (x.conversions || 0), 0);
    const totalAtc    = pool.reduce((s, x) => s + (x.add_to_cart || 0), 0);
    const benchmark = {
        roas:         totalSpend  > 0 ? totalRev    / totalSpend  : 0,
        ctr:          totalImpr   > 0 ? totalClicks / totalImpr   : 0,
        cvr:          totalClicks > 0 ? totalConv   / totalClicks : 0,
        revenue:      pool.length > 0 ? totalRev    / pool.length : 0,
        conversions:  pool.length > 0 ? totalConv   / pool.length : 0,
        atc_rate:     totalClicks > 0 ? totalAtc    / totalClicks : 0,
        add_to_cart:  pool.length > 0 ? totalAtc    / pool.length : 0,
        cost_per_atc: totalAtc   > 0 ? totalSpend  / totalAtc    : 0,
    };

    bestEl.innerHTML = best.map((c, i) => createRankRow(c, i + 1, metric, 'best', benchmark)).join('');

    // ★ 집계 creative 직접 전달 (allCreatives 단일 행 대신 합산 데이터 사용)
    bestEl.querySelectorAll('.rank-row').forEach((row, idx) => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('.rank-comment-toggle')) return;
            openModal(row.dataset.id, best[idx]);
        });
    });
    bestEl.querySelectorAll('.rank-comment-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const row = btn.closest('.rank-row');
            const comment = row?.querySelector('.rank-comment');
            if (comment) {
                comment.classList.toggle('expanded');
                btn.classList.toggle('expanded');
            }
        });
    });

    // ──────────────────────────────────────────
    // WORST TOP 5 렌더링
    // ──────────────────────────────────────────
    const worstEl = document.getElementById('worst-creatives-list');
    const worstSummaryEl = document.getElementById('worst-summary');
    if (worstEl) {
        // 지표값 > 0 & 지출 > 0인 소재만 WORST 후보 (노출·클릭 없는 소재 제외)
        let worstPool = pool.filter(c => (c[metric] || 0) > 0 && (c.impressions || 0) > 0);
        if (!worstPool.length) worstPool = pool.filter(c => (c.impressions || 0) > 0);
        if (!worstPool.length) worstPool = pool;

        // BEST와 반대 방향으로 정렬 → 하위 5개
        const worst = [...worstPool]
            .sort((a, b) => sortAsc
                ? (b[metric] || 0) - (a[metric] || 0)   // cost_per_atc: 높을수록 나쁨
                : (a[metric] || 0) - (b[metric] || 0))  // 나머지: 낮을수록 나쁨
            .slice(0, 5);

        // BEST 소재와 중복 제거 (동일 id 제외)
        const bestIds = new Set(best.map(c => c.id));
        const worstFiltered = worst.filter(c => !bestIds.has(c.id));
        const worstFinal = worstFiltered.length ? worstFiltered : worst;

        if (worstSummaryEl) {
            worstSummaryEl.innerHTML = `<span class="text-xs text-slate-400">WORST TOP 5 · ${worstPool.length}개 후보 · ${cartLabel}${cfg.label || metric} 기준${isAllPlatform ? '<span class="text-[10px] text-indigo-400 ml-1">· 전환 추적 매체 종합 합산</span>' : ''}</span>`;
        }

        worstEl.innerHTML = worstFinal.map((c, i) => createRankRow(c, i + 1, metric, 'worst', benchmark)).join('');

        worstEl.querySelectorAll('.rank-row').forEach((row, idx) => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('.rank-comment-toggle')) return;
                openModal(row.dataset.id, worstFinal[idx]);
            });
        });
        worstEl.querySelectorAll('.rank-comment-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = btn.closest('.rank-row');
                const comment = row?.querySelector('.rank-comment');
                if (comment) {
                    comment.classList.toggle('expanded');
                    btn.classList.toggle('expanded');
                }
            });
        });
    }
}

// ============================
// AI 코멘트 생성 (왜 좋았나/나빴나)
// ============================
function buildPerformanceComment(c, type, benchmark) {
    const isBest = type === 'best';
    const reasons = [];
    const tips = [];

    // ROAS 평가
    if (benchmark.roas > 0 && c.roas > 0) {
        const ratio = c.roas / benchmark.roas;
        if (isBest && ratio >= 1.3) {
            reasons.push(`📈 ROAS가 평균(${Math.round(benchmark.roas*100)}%) 대비 <b>${Math.round((ratio-1)*100)}% 우위</b>`);
        } else if (!isBest && ratio <= 0.7) {
            reasons.push(`📉 ROAS가 평균(${Math.round(benchmark.roas*100)}%) 대비 <b>${Math.round((1-ratio)*100)}% 미달</b>`);
        }
    }

    // CTR 평가
    if (benchmark.ctr > 0 && c.ctr > 0) {
        const ratio = c.ctr / benchmark.ctr;
        if (ratio >= 1.2) {
            reasons.push(`👀 클릭률이 평균보다 <b>${Math.round((ratio-1)*100)}% 높음</b> → 후킹이 강함`);
        } else if (ratio <= 0.7) {
            reasons.push(`👎 클릭률이 평균보다 <b>${Math.round((1-ratio)*100)}% 낮음</b> → 초반 후킹 약함`);
        }
    }

    // CVR 평가
    if (benchmark.cvr > 0 && c.cvr > 0) {
        const ratio = c.cvr / benchmark.cvr;
        if (ratio >= 1.2) {
            reasons.push(`✅ 전환율 평균比 <b>${Math.round((ratio-1)*100)}% 우위</b> → 메시지 설득력 강함`);
        } else if (ratio <= 0.7) {
            reasons.push(`⚠️ 전환율 평균比 <b>${Math.round((1-ratio)*100)}% 낮음</b> → 클릭은 발생하나 전환 약함`);
        }
    }

    // 소구포인트 기반 추론
    const appeals = normalizeArrayField(c.appeal_points);
    const hooks = normalizeArrayField(c.hook_type);
    const emotions = normalizeArrayField(c.target_emotion);

    if (isBest) {
        // BEST의 추론 코멘트
        if (appeals.length) {
            tips.push(`<b>"${appeals[0]}"</b> 소구가 핵심 동력. 유사 소재 추가 제작 추천`);
        }
        if (hooks.length) {
            tips.push(`후킹 방식 <b>"${hooks[0]}"</b>을 다른 소구포인트에도 응용 가능`);
        }
        if (emotions.length && benchmark.cvr > 0 && c.cvr >= benchmark.cvr) {
            tips.push(`<b>"${emotions[0]}"</b> 감정 코드가 전환 유도 효과적`);
        }
        if (c.media_type === 'video') {
            tips.push(`영상 포맷이 ${appeals[0] || '해당 소구'}와 잘 맞음`);
        }
    } else {
        // WORST의 추론 코멘트
        if (c.ctr < benchmark.ctr * 0.7 && c.cvr >= benchmark.cvr) {
            tips.push(`클릭 단계가 병목 → <b>썸네일/카피 재설계</b> 필요`);
        } else if (c.cvr < benchmark.cvr * 0.7 && c.ctr >= benchmark.ctr) {
            tips.push(`클릭은 잘 되나 전환 약함 → <b>랜딩페이지/오퍼</b> 점검 필요`);
        } else if (c.ctr < benchmark.ctr * 0.7 && c.cvr < benchmark.cvr * 0.7) {
            tips.push(`타겟·소구가 시장과 미스매치 → <b>다른 소구포인트로 재시도</b>`);
        }
        if (appeals.length) {
            tips.push(`<b>"${appeals[0]}"</b> 소구가 이 제품에선 약함 → 다른 각도 시도`);
        }
        if (c.spend > 0 && c.conversions === 0) {
            tips.push(`전환 0건 → <b>조기 중단</b> 검토 권장`);
        }
    }

    // 신호가 부족하면 기본 메시지
    if (!reasons.length) {
        reasons.push(isBest
            ? '주요 지표가 평균 수준에서 상위권으로 안정적'
            : '주요 지표 모두 평균보다 낮음 — 종합 개선 필요');
    }
    if (!tips.length) {
        tips.push(isBest
            ? '강점을 더 명확히 분석하려면 AI 소구 데이터 보강 필요'
            : '개선 방향 도출을 위해 AI 소구/후킹 데이터 보강 추천');
    }

    return { reasons, tips };
}

// 순위 행 (썸네일 즉시 렌더링 + Drive URL 자동 변환 + AI 추론 코멘트)
function createRankRow(c, rank, metric, type, benchmark) {
    const cfg = METRIC_CONFIG[metric];
    const medals = ['🥇', '🥈', '🥉', '4', '5'];
    const medal = medals[rank - 1] || rank;
    const isBest = type === 'best';
    const value = cfg.format(c[metric]);

    // 썸네일 (Drive URL 다중 fallback 체인 → thumbnail → lh3 CDN → uc?export=view)
    const isVideo = c.media_type === 'video';
    const rawThumb = c.thumbnail_url || c.media_url || '';
    const finalFallback = `<div class="rank-thumb rank-thumb-fallback"><i class="fas fa-${isVideo ? 'video' : 'image'}"></i></div>`;

    let thumbHtml;
    if (!rawThumb) {
        thumbHtml = finalFallback;
    } else if (typeof window.isDriveUrl === 'function' && window.isDriveUrl(rawThumb) && typeof window.buildDriveImgHtml === 'function') {
        thumbHtml = window.buildDriveImgHtml(rawThumb, {
            className: 'rank-thumb',
            alt: '',
            finalFallbackHtml: finalFallback,
        });
    } else {
        thumbHtml = `<img src="${rawThumb}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer"
              class="rank-thumb"
              onerror="this.outerHTML='${finalFallback.replace(/'/g, "\\'")}'">`;
    }

    // 소구포인트 칩 (최대 3개)
    const appeals = normalizeArrayField(c.appeal_points).slice(0, 3);
    const appealHtml = appeals.length
        ? appeals.map(a => `<span class="rank-appeal-chip">${a}</span>`).join('')
        : '<span class="rank-no-appeal">소구포인트 분석 전</span>';

    // 집계 배지
    const aggBadge = c._aggregated && c._row_count > 1
        ? `<span class="rank-agg-badge" title="일별 데이터 ${c._row_count}건 합산"><i class="fas fa-layer-group"></i> ${c._row_count}일</span>`
        : '';

    // 피로도 경고 배지
    const fatigueKey = (c.brand || '') + '||' + (c.ad_name || '');
    const isFatigued = window._creativeFatigue && window._creativeFatigue.has(fatigueKey);
    const fatigueBadge = isFatigued
        ? `<span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-300" title="전반부 대비 후반부 CTR 20% 이상 하락 감지"><i class="fas fa-fire-flame-curved"></i> 피로도</span>`
        : '';

    // ★ AI 추론 코멘트 (왜 좋았나/나빴나)
    let commentHtml = '';
    if (benchmark && typeof buildPerformanceComment === 'function') {
        const { reasons, tips } = buildPerformanceComment(c, type, benchmark);
        const commentIcon = isBest ? '💡' : '🔍';
        const commentLabel = isBest ? '이 소재가 좋았던 이유' : '개선이 필요한 이유';
        commentHtml = `
            <div class="rank-comment-wrap">
                <button class="rank-comment-toggle" type="button">
                    <span class="rank-comment-icon">${commentIcon}</span>
                    <span class="rank-comment-label">${commentLabel}</span>
                    <i class="fas fa-chevron-down rank-comment-arrow"></i>
                </button>
                <div class="rank-comment">
                    <div class="rank-comment-section">
                        <div class="rank-comment-title">${isBest ? '✨ 성과 요인' : '⚠️ 부진 요인'}</div>
                        <ul class="rank-comment-list">
                            ${reasons.map(r => `<li>${r}</li>`).join('')}
                        </ul>
                    </div>
                    <div class="rank-comment-section">
                        <div class="rank-comment-title">${isBest ? '🚀 다음 액션' : '🔧 개선 방향'}</div>
                        <ul class="rank-comment-list">
                            ${tips.map(t => `<li>${t}</li>`).join('')}
                        </ul>
                    </div>
                </div>
            </div>
        `;
    }

    return `
        <div class="rank-row rank-row-${isBest ? 'best' : 'worst'}" data-id="${c.id}">
            <div class="rank-main">
                <div class="rank-medal">${medal}</div>
                <div class="rank-thumb-wrap">
                    ${thumbHtml}
                    ${isVideo ? '<span class="rank-video-badge">▶</span>' : ''}
                </div>
                <div class="rank-info">
                    <div class="rank-appeals">${appealHtml}</div>
                    <div class="rank-meta">
                        <span><i class="fas fa-broadcast-tower"></i> ${c.platform || '-'}</span>
                        ${c.product ? `<span class="rank-dot">·</span><span>${c.product}</span>` : ''}
                        ${aggBadge}
                        ${fatigueBadge}
                    </div>
                </div>
                <div class="rank-value-wrap">
                    <div class="rank-value">${value}</div>
                    <div class="rank-sub">광고비 ₩${formatNumber(c.spend || 0)}</div>
                </div>
            </div>
            ${commentHtml}
        </div>
    `;
}

// ============================
// 카드 (모달용 / 기존 호환)
// ============================
function createCard(c) {
    // CTR/ROAS는 비율 기준 (CTR 0.03 = 3%, ROAS 4.0 = 400%)
    const roasClass = c.roas >= 4 ? 'good' : c.roas >= 2.5 ? 'warn' : 'bad';
    const ctrClass = c.ctr >= 0.03 ? 'good' : c.ctr >= 0.018 ? 'warn' : 'bad';
    const thumbHtml = typeof window.createMediaElement === 'function'
        ? window.createMediaElement(c, false)
        : `<img src="${c.thumbnail_url}" alt="${c.creative_name}" loading="lazy" onerror="this.src='https://via.placeholder.com/400x400/e2e8f0/64748b?text=No+Image'">`;

    // AI 분석 칩 (소구포인트 최대 3개)
    const appealList = normalizeArrayField(c.appeal_points).slice(0, 3);
    const appealHtml = appealList.length
        ? `<div class="card-ai-section">
                <div class="card-ai-label"><i class="fas fa-magic-wand-sparkles"></i> AI 소구포인트</div>
                <div class="card-appeal-chips">
                    ${appealList.map(a => `<span class="card-appeal-chip">${a}</span>`).join('')}
                </div>
           </div>`
        : '';

    return `
        <article class="creative-card" data-id="${c.id}">
            <div class="creative-thumb">
                ${thumbHtml}
                <span class="media-badge">
                    <i class="fas fa-${c.media_type === 'video' ? 'video' : 'image'} mr-1"></i>
                    ${c.media_type === 'video' ? '영상' : '이미지'}
                </span>
                <span class="brand-badge ${c.brand}">${c.brand}</span>
                ${c.media_type === 'video' ? '<div class="play-overlay"><i class="fas fa-play-circle"></i></div>' : ''}
            </div>
            <div class="creative-body">
                <h3 class="creative-name">${c.creative_name}</h3>
                <div class="creative-meta">
                    <span class="meta-chip platform"><i class="fas fa-broadcast-tower mr-1"></i>${c.platform}</span>
                    <span class="meta-chip">${c.campaign_type}</span>
                    <span class="meta-chip">${c.status}</span>
                </div>
                <div class="creative-stats">
                    <div class="stat-item">
                        <span class="stat-label">CTR</span>
                        <span class="stat-value ${ctrClass}">${((c.ctr || 0) * 100).toFixed(2)}%</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">ROAS</span>
                        <span class="stat-value ${roasClass}">${Math.round((c.roas || 0) * 100)}%</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">광고비</span>
                        <span class="stat-value">₩${formatNumber(c.spend)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">전환</span>
                        <span class="stat-value">${formatNumber(c.conversions)}</span>
                    </div>
                </div>
                ${appealHtml}
            </div>
        </article>
    `;
}

// 배열/문자열을 키워드 배열로 정규화
function normalizeArrayField(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value.flatMap(v => String(v).split(/[,、，·・]/).map(s => s.trim()).filter(Boolean));
    }
    return String(value).split(/[,、，·・]/).map(s => s.trim()).filter(Boolean);
}

// ============================
// Modal
// ============================
function openModal(id, preloadedCreative) {
    // ★ preloadedCreative: ranking 등에서 집계 데이터를 직접 전달 (모달에서 0 표시 방지)
    // preloadedCreative 없으면 같은 ad_name 행을 집계해서 사용 (ATC 등 누락 방지)
    let c = preloadedCreative;
    if (!c) {
        const raw = allCreatives.find(x => x.id === id);
        if (!raw) return;
        const adName = (raw.ad_name || raw.creative_name || '').toString().trim();
        if (adName && typeof aggregateByAdName === 'function') {
            const sameAd = allCreatives.filter(x =>
                (x.ad_name || x.creative_name || '').toString().trim() === adName
            );
            const agg = aggregateByAdName(sameAd);
            c = (agg && agg.length) ? agg[0] : raw;
        } else {
            c = raw;
        }
    }
    if (!c) return;

    const mediaHtml = typeof window.createMediaElement === 'function'
        ? window.createMediaElement(c, true)
        : (c.media_type === 'video' && c.video_url
            ? `<video controls playsinline webkit-playsinline autoplay muted><source src="${c.video_url}" type="video/mp4"></video>`
            : `<img src="${c.thumbnail_url}" alt="${c.creative_name}" loading="lazy" decoding="async">`);

    const startDate = c.start_date ? new Date(c.start_date).toLocaleDateString('ko-KR') : '-';

    // AI 분석 결과 처리
    const appealList = normalizeArrayField(c.appeal_points);
    const hookList = normalizeArrayField(c.hook_type);
    const emotionList = normalizeArrayField(c.target_emotion);

    const aiSectionHtml = (appealList.length || hookList.length || emotionList.length || c.key_message_kr)
        ? `<div class="modal-ai-section">
                <div class="modal-ai-header">
                    <i class="fas fa-magic-wand-sparkles"></i>
                    <span>AI 소재 분석</span>
                </div>
                ${(c.key_message_kr || c.key_message_jp) ? `
                    <div class="modal-message-box">
                        <div class="msg-kr">"${c.key_message_kr || c.key_message_jp}"</div>
                        ${c.key_message_jp && c.key_message_kr ? `<div class="msg-jp">🇯🇵 ${c.key_message_jp}</div>` : ''}
                    </div>` : ''}
                ${appealList.length ? `
                    <div class="ai-row">
                        <span class="ai-row-label"><i class="fas fa-bullseye"></i> 소구포인트</span>
                        <div class="ai-chips">${appealList.map(a => `<span class="ai-chip purple">${a}</span>`).join('')}</div>
                    </div>` : ''}
                ${hookList.length ? `
                    <div class="ai-row">
                        <span class="ai-row-label"><i class="fas fa-fish"></i> 후킹</span>
                        <div class="ai-chips">${hookList.map(a => `<span class="ai-chip cyan">${a}</span>`).join('')}</div>
                    </div>` : ''}
                ${emotionList.length ? `
                    <div class="ai-row">
                        <span class="ai-row-label"><i class="fas fa-heart"></i> 감정</span>
                        <div class="ai-chips">${emotionList.map(a => `<span class="ai-chip rose">${a}</span>`).join('')}</div>
                    </div>` : ''}
           </div>`
        : '';

    document.getElementById('modal-content').innerHTML = `
        <div class="modal-body">
            <div class="modal-media">${mediaHtml}</div>
            <div class="modal-info">
                <div class="flex items-center gap-2 mb-2">
                    <span class="brand-badge ${c.brand}" style="position: static;">${c.brand}</span>
                    ${c.platform ? `<span class="meta-chip platform">${c.platform}</span>` : ''}
                    ${c.campaign_type ? `<span class="meta-chip">${c.campaign_type}</span>` : ''}
                </div>
                <h2>${c.creative_name}</h2>
                <p class="subtitle"><i class="far fa-calendar mr-1"></i>${startDate} 시작 · ${c.status}</p>
                ${aiSectionHtml}
                <div class="modal-metrics">
                    <div class="metric-box">
                        <div class="label">노출수</div>
                        <div class="value">${formatNumber(c.impressions)}</div>
                    </div>
                    <div class="metric-box">
                        <div class="label">클릭수</div>
                        <div class="value">${formatNumber(c.clicks)}</div>
                    </div>
                    <div class="metric-box">
                        <div class="label">CTR</div>
                        <div class="value">${((c.ctr || 0) * 100).toFixed(2)}%</div>
                    </div>
                    <div class="metric-box">
                        <div class="label">전환수</div>
                        <div class="value">${formatNumber(c.conversions)}</div>
                    </div>
                    <div class="metric-box">
                        <div class="label">CVR</div>
                        <div class="value">${((c.cvr || 0) * 100).toFixed(2)}%</div>
                    </div>
                    <div class="metric-box" title="${c.spend_jpy ? '원본: ¥' + formatNumber(c.spend_jpy) : ''}">
                        <div class="label">광고비</div>
                        <div class="value">₩${formatNumber(c.spend)}</div>
                        ${c.spend_jpy ? `<div class="text-[10px] text-slate-400 mt-0.5">¥${formatNumber(c.spend_jpy)}</div>` : ''}
                    </div>
                    <div class="metric-box">
                        <div class="label">CPC</div>
                        <div class="value">₩${formatNumber(Math.round(c.cpc || 0))}</div>
                    </div>
                    <div class="metric-box">
                        <div class="label">CPA</div>
                        <div class="value">₩${formatNumber(c.cpa)}</div>
                    </div>
                    <div class="metric-box" title="${c.revenue_jpy ? '원본: ¥' + formatNumber(c.revenue_jpy) : ''}">
                        <div class="label">매출</div>
                        <div class="value">₩${formatNumber(c.revenue)}</div>
                        ${c.revenue_jpy ? `<div class="text-[10px] text-slate-400 mt-0.5">¥${formatNumber(c.revenue_jpy)}</div>` : ''}
                    </div>
                    <div class="metric-box highlight">
                        <div class="label">ROAS</div>
                        <div class="value">${Math.round((c.roas || 0) * 100)}%</div>
                    </div>
                </div>
                ${isCartMode(Array.isArray(allCreatives) ? allCreatives : []) ? `
                <div class="modal-atc-section">
                    <div class="modal-atc-header"><i class="fas fa-cart-shopping"></i> 장바구니 최적화 지표</div>
                    <div class="modal-metrics">
                        <div class="metric-box">
                            <div class="label">ATC 건수</div>
                            <div class="value">${formatNumber(c.add_to_cart || 0)}건</div>
                        </div>
                        <div class="metric-box">
                            <div class="label">ATC율</div>
                            <div class="value">${((c.atc_rate || 0) * 100).toFixed(2)}%</div>
                        </div>
                        <div class="metric-box highlight">
                            <div class="label">Cost per ATC</div>
                            <div class="value">₩${formatNumber(c.cost_per_atc || 0)}</div>
                        </div>
                    </div>
                </div>` : ''}
            </div>
        </div>
    `;
    document.getElementById('detail-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

// ============================
// AI 이미지 생성 (DALL-E 3)
// ============================
const OPENAI_KEY_STORAGE = 'google_ai_api_key';
const REF_IMAGES_STORAGE = 'product_ref_images';
const MAX_REF_IMAGES = 4;

function loadRefImages() {
    try { return JSON.parse(localStorage.getItem(REF_IMAGES_STORAGE) || '[]'); }
    catch { return []; }
}
function saveRefImages(imgs) {
    localStorage.setItem(REF_IMAGES_STORAGE, JSON.stringify(imgs));
}

window.renderRefImageThumbs = function() {
    const grid = document.getElementById('ref-img-grid');
    const badge = document.getElementById('ref-count-badge');
    if (!grid) return;
    const imgs = loadRefImages();
    if (imgs.length === 0) {
        grid.innerHTML = '<p class="text-xs text-slate-400 mb-2">등록된 이미지 없음</p>';
        if (badge) badge.classList.add('hidden');
        return;
    }
    if (badge) { badge.textContent = `${imgs.length}개 등록됨`; badge.classList.remove('hidden'); }
    grid.innerHTML = imgs.map((img, i) => `
        <div class="ref-img-thumb" title="${img.name || ''}">
            <img src="${img.data}" alt="${img.name || ''}">
            <button class="ref-img-delete" onclick="window.deleteRefImage(${i})" title="삭제"><i class="fas fa-times"></i></button>
            <span class="ref-img-name">${(img.name || '').length > 10 ? img.name.slice(0,10)+'…' : (img.name || '')}</span>
        </div>
    `).join('');
};

window.addRefImages = function(input) {
    const files = Array.from(input.files || []);
    const existing = loadRefImages();
    const slots = MAX_REF_IMAGES - existing.length;
    if (slots <= 0) { alert(`최대 ${MAX_REF_IMAGES}개까지 등록 가능합니다.`); input.value = ''; return; }
    const toAdd = files.slice(0, slots);
    let loaded = 0;
    toAdd.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            existing.push({ id: Date.now() + Math.random(), name: file.name.replace(/\.[^.]+$/, ''), data: e.target.result, mimeType: file.type || 'image/jpeg' });
            loaded++;
            if (loaded === toAdd.length) { saveRefImages(existing); window.renderRefImageThumbs(); }
        };
        reader.readAsDataURL(file);
    });
    input.value = '';
};

window.deleteRefImage = function(idx) {
    const imgs = loadRefImages();
    imgs.splice(idx, 1);
    saveRefImages(imgs);
    window.renderRefImageThumbs();
};

window.openCreativePromptModal = function() {
    const d = window._lastNextCreativeData;
    const modal = document.getElementById('creative-prompt-modal');
    const textEl = document.getElementById('creative-prompt-text');
    if (!modal || !textEl) return;

    // 저장된 API 키 복원
    const savedKey = localStorage.getItem(OPENAI_KEY_STORAGE) || '';
    const keyInput = document.getElementById('ai-apikey-input');
    if (keyInput && savedKey) keyInput.value = savedKey;

    // 결과/에러 초기화
    document.getElementById('ai-gen-result')?.classList.add('hidden');
    document.getElementById('ai-gen-error')?.classList.add('hidden');

    // 레퍼런스 이미지 썸네일 렌더
    window.renderRefImageThumbs();

    // 인사이트 기반 프롬프트 생성
    const appeal = d?.topWinner?.keyword || '핵심 소구포인트';
    const hook = d?.topHooks?.[0] || '감성적 후킹';
    const emotion = d?.topEmotions?.[0] || '공감';
    const format = d?.topMediaType?.[0] || '이미지';
    const copy = d?.topCopies?.[0]?.kr || d?.topCopies?.[0]?.jp || '';
    const scope = d?.scopeText || '해당 제품';
    const alsoAppeals = (d?.winners || []).slice(1, 3).map(w => w.keyword).filter(Boolean).join(', ');

    const prompt = `High-quality advertising creative image for a Japanese beauty/cosmetics brand.

Key appeal: "${appeal}"${alsoAppeals ? ` / also: ${alsoAppeals}` : ''}
Hook style: ${hook}
Target emotion: ${emotion}
Format: ${format === '영상' ? 'video thumbnail still frame' : format === '캐러셀' ? 'carousel single card' : 'static banner'}
${copy ? `Reference copy: "${copy}"` : `Headline emphasizes: "${appeal}"`}

Visual: Clean premium K-beauty aesthetic, soft lighting, bold headline + product hero shot.
Mood: ${emotion} — warm, trustworthy, aspirational. Soft neutrals with brand accent color.
No watermarks, no placeholder text. Suitable for Meta/Instagram feed ads (${scope}).`;

    textEl.value = prompt;
    modal.classList.remove('hidden');
};

window.saveApiKey = function() {
    const key = document.getElementById('ai-apikey-input')?.value?.trim();
    if (!key) return;
    localStorage.setItem(OPENAI_KEY_STORAGE, key);
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = '저장됨 ✓';
    btn.classList.add('text-emerald-600');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('text-emerald-600'); }, 1500);
};

window.toggleApiKeyVisibility = function() {
    const input = document.getElementById('ai-apikey-input');
    const eye = document.getElementById('ai-apikey-eye');
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        eye.className = 'fas fa-eye-slash text-sm';
    } else {
        input.type = 'password';
        eye.className = 'fas fa-eye text-sm';
    }
};

function buildGeminiParts(promptText) {
    const refs = loadRefImages();
    const parts = [];
    refs.forEach(img => {
        parts.push({ inlineData: { mimeType: img.mimeType || 'image/jpeg', data: img.data.split(',')[1] } });
    });
    const refHint = refs.length > 0
        ? `The above ${refs.length} image(s) are the actual product references. Generate an ad creative using the same product — maintain brand identity, packaging design, and color palette.\n\n`
        : '';
    parts.push({ text: refHint + promptText });
    return parts;
}

window.generateDalleImage = async function() {
    const apiKey = document.getElementById('ai-apikey-input')?.value?.trim()
                || localStorage.getItem(OPENAI_KEY_STORAGE) || '';
    const prompt = document.getElementById('creative-prompt-text')?.value?.trim() || '';
    const aspectRatio = document.getElementById('ai-gen-size')?.value || '1:1';

    const errEl = document.getElementById('ai-gen-error');
    const resultEl = document.getElementById('ai-gen-result');
    const btn = document.getElementById('ai-gen-btn');
    const btnLabel = document.getElementById('ai-gen-btn-label');

    errEl.classList.add('hidden');
    resultEl.classList.add('hidden');

    if (!apiKey) {
        errEl.textContent = '⚠️ Google AI Studio API 키를 입력해주세요. (AIza... 형식)';
        errEl.classList.remove('hidden');
        return;
    }
    if (!prompt) {
        errEl.textContent = '⚠️ 프롬프트를 입력해주세요.';
        errEl.classList.remove('hidden');
        return;
    }

    btn.disabled = true;
    const refImgs = loadRefImages();
    btnLabel.textContent = refImgs.length > 0 ? `생성 중... (레퍼런스 ${refImgs.length}개 포함)` : '생성 중... (10~30초 소요)';
    btn.querySelector('i').className = 'fas fa-spinner fa-spin';

    const modelId = document.getElementById('ai-gen-model')?.value || 'gemini-2.0-flash-exp';

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: buildGeminiParts(prompt) }],
                    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
                })
            }
        );

        const json = await res.json();

        if (!res.ok) {
            const msg = json?.error?.message || `API 오류 (${res.status})`;
            throw new Error(msg);
        }

        const parts = json?.candidates?.[0]?.content?.parts || [];
        const imgPart = parts.find(p => p.inlineData);
        if (!imgPart) throw new Error('이미지 데이터를 받지 못했습니다. 프롬프트를 수정해보세요.');

        const b64 = imgPart.inlineData.data;
        const mime = imgPart.inlineData.mimeType || 'image/png';
        const dataUrl = `data:${mime};base64,${b64}`;

        const img = document.getElementById('ai-gen-result-img');
        const dlBtn = document.getElementById('ai-gen-download-btn');
        img.src = dataUrl;
        dlBtn.href = dataUrl;
        dlBtn.download = `creative-imagen3-${Date.now()}.png`;
        resultEl.classList.remove('hidden');

        localStorage.setItem(OPENAI_KEY_STORAGE, apiKey);

    } catch(e) {
        errEl.textContent = `❌ ${e.message}`;
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btnLabel.textContent = '이미지 생성하기';
        btn.querySelector('i').className = 'fas fa-wand-magic-sparkles';
    }
};

window.listImageModels = async function() {
    const apiKey = document.getElementById('ai-apikey-input')?.value?.trim()
                || localStorage.getItem(OPENAI_KEY_STORAGE) || '';
    const resultEl = document.getElementById('ai-model-list-result');
    const errEl = document.getElementById('ai-gen-error');
    if (!apiKey) {
        errEl.textContent = '⚠️ API 키를 먼저 입력해주세요.';
        errEl.classList.remove('hidden');
        return;
    }
    resultEl.textContent = '조회 중...';
    resultEl.classList.remove('hidden');
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message || `오류 ${res.status}`);
        const models = (json.models || [])
            .filter(m => {
                const n = (m.name || '').toLowerCase();
                return n.includes('image') || n.includes('imagen') || n.includes('flash');
            })
            .map(m => m.name.replace('models/', ''));
        if (models.length === 0) {
            resultEl.textContent = '이미지 관련 모델 없음. 전체: ' + (json.models||[]).map(m=>m.name.replace('models/','')).join(', ');
        } else {
            // 드롭다운 업데이트
            const sel = document.getElementById('ai-gen-model');
            sel.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
            resultEl.textContent = `✅ ${models.length}개 모델 로드됨 — 위 목록에서 선택하세요`;
        }
    } catch(e) {
        resultEl.textContent = `❌ ${e.message}`;
    }
};

function closeModal() {
    document.getElementById('detail-modal').classList.add('hidden');
    document.body.style.overflow = '';
    const v = document.querySelector('#modal-content video');
    if (v) v.pause();
}

window.closeModal = closeModal;

// ============================
// Utils
// ============================
function formatNumber(num) {
    if (num == null) return '0';
    if (num >= 100000000) return (num / 100000000).toFixed(1) + '억';
    if (num >= 10000) return (num / 10000).toFixed(1) + '만';
    return num.toLocaleString('ko-KR');
}

// ============================
// KPI 전용 금액/숫자 포맷
// ============================
// 큰 금액을 더 보기 좋게: 메인 = 콤마 자릿수, 보조 = 한국어 단위(억/만)
function formatKoreanShort(num) {
    if (num == null || isNaN(num)) return '0';
    num = Number(num);
    if (num >= 100000000) {
        const eok = num / 100000000;
        const man = (num % 100000000) / 10000;
        if (man >= 1) {
            return `${Math.floor(eok)}억 ${Math.round(man).toLocaleString('ko-KR')}만`;
        }
        return `${eok.toFixed(eok >= 10 ? 0 : 1)}억`;
    }
    if (num >= 10000) {
        return `${(num / 10000).toFixed(num >= 100000 ? 0 : 1)}만`;
    }
    return Math.round(num).toLocaleString('ko-KR');
}

// KPI 금액 카드용 HTML 생성 (메인 콤마 + 보조 한국식 단위)
function formatKpiCurrency(num, opts) {
    if (num == null || isNaN(num)) num = 0;
    num = Math.round(Number(num));
    const main = num.toLocaleString('ko-KR');
    const sub = formatKoreanShort(num);
    const symbol = (opts && opts.symbol) || '₩';
    // 메인은 풀 자릿수 콤마, 단위 기호는 약하게, 보조는 작게 한국어 단위
    return `
        <span class="kpi-currency-symbol">${symbol}</span><span class="kpi-currency-amount">${main}</span>
        <span class="kpi-currency-sub">≈ ${sub}</span>
    `;
}

// KPI 큰 숫자 카드용 (노출/클릭/전환 등) — 가독성 위해 풀 콤마 + 보조 한국식 단위
function formatKpiCount(num) {
    if (num == null || isNaN(num)) num = 0;
    num = Math.round(Number(num));
    const main = num.toLocaleString('ko-KR');
    if (num < 10000) {
        return `<span class="kpi-currency-amount">${main}</span>`;
    }
    const sub = formatKoreanShort(num);
    return `
        <span class="kpi-currency-amount">${main}</span>
        <span class="kpi-currency-sub">≈ ${sub}</span>
    `;
}

window.formatKoreanShort = formatKoreanShort;
window.formatKpiCurrency = formatKpiCurrency;
window.formatKpiCount = formatKpiCount;
