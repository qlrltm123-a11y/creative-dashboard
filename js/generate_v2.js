// ============================
// 광고 생성 패널 — Higgsfield 직접 API 연동
// ============================

const HF_DIRECT_URL  = 'https://platform.higgsfield.ai';
const HF_STORAGE_KEY = 'hf_api_key';
const HF_PROXY_KEY   = 'hf_proxy_url';  // Cloudflare Worker 프록시 URL
const HF_POLL_MS     = 3000;
const HF_MAX_WAIT    = 180000;

// 프록시 URL이 설정되어 있으면 프록시 사용, 없으면 직접 호출
function _getBaseUrl() {
    return (localStorage.getItem(HF_PROXY_KEY) || '').trim().replace(/\/$/, '') || HF_DIRECT_URL;
}

let _genPatterns   = null;
let _genCurrentTab = 'image';
let _genPollingTimer = null;

// ---- 토스트 ----
function genToast(msg, duration) {
    let t = document.getElementById('gen-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'gen-toast';
        t.className = 'gen-toast';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), duration || 3000);
}

// ---- API 키 관리 ----
function _getHfKey()     { return localStorage.getItem(HF_STORAGE_KEY) || ''; }
function _saveHfKey(key) { localStorage.setItem(HF_STORAGE_KEY, key.trim()); }

// ---- 워킹 패턴 추출 ----
function getWinningPatterns() {
    let data = Array.isArray(window.allCreatives) ? [...window.allCreatives]
             : (typeof allCreatives !== 'undefined' && Array.isArray(allCreatives)) ? [...allCreatives] : [];
    if (!data.length) return null;

    if (typeof currentBrand !== 'undefined' && currentBrand && currentBrand !== 'ALL')
        data = data.filter(c => c.brand === currentBrand);
    if (typeof currentPlatform !== 'undefined' && currentPlatform)
        data = data.filter(c => (c.platform || '').toString().trim() === currentPlatform);
    if (typeof currentEvent !== 'undefined' && currentEvent)
        data = data.filter(c => (c.event || '').toString().trim() === currentEvent);

    if (typeof aggregateByAdName === 'function') data = aggregateByAdName(data);

    let top5 = [...data].filter(c => (c.roas || 0) > 0)
        .sort((a, b) => (b.roas || 0) - (a.roas || 0)).slice(0, 5);
    if (!top5.length) {
        top5 = [...data].filter(c => (c.ctr || 0) > 0)
            .sort((a, b) => (b.ctr || 0) - (a.ctr || 0)).slice(0, 5);
    }
    if (!top5.length) return null;

    function extractTopTags(items, field, topN) {
        const counter = new Map();
        items.forEach(c => {
            const raw = c[field];
            if (!raw) return;
            const arr = Array.isArray(raw)
                ? raw.flatMap(v => String(v).split(/[,、，·・\n]/).map(s => s.trim()).filter(Boolean))
                : String(raw).split(/[,、，·・\n]/).map(s => s.trim()).filter(Boolean);
            arr.forEach(tag => { if (tag && !tag.startsWith('❌')) counter.set(tag, (counter.get(tag) || 0) + 1); });
        });
        return [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(e => e[0]);
    }

    return {
        top5,
        topAppeal:  extractTopTags(top5, 'appeal_points', 6),
        topHook:    extractTopTags(top5, 'hook_type', 4),
        topEmotion: extractTopTags(top5, 'target_emotion', 4),
        avgRoas: top5.reduce((s, c) => s + (c.roas || 0), 0) / top5.length,
        avgCtr:  top5.reduce((s, c) => s + (c.ctr  || 0), 0) / top5.length,
        brand:    (typeof currentBrand !== 'undefined' && currentBrand && currentBrand !== 'ALL') ? currentBrand : (top5[0]?.brand || ''),
        platform: (typeof currentPlatform !== 'undefined' && currentPlatform) || '',
        sampleThumb: top5[0]?.thumbnail_url || top5[0]?.media_url || '',
        sampleName:  top5[0]?.ad_name || top5[0]?.creative_name || '',
    };
}

// ---- 프롬프트 빌더 ----
function buildHiggsfieldPrompt(patterns, productName, productImageUrl, type) {
    if (!patterns) return '';
    const brand    = patterns.brand || 'Brand';
    const product  = productName || (patterns.sampleName ? patterns.sampleName.split('_')[0] : 'product');
    const appeals  = patterns.topAppeal.slice(0, 3).join(', ');
    const hookMain = patterns.topHook[0] || 'engaging visual hook';
    const emotions = patterns.topEmotion.slice(0, 3).join(', ');
    const roas     = Math.round(patterns.avgRoas * 100);
    const ctr      = (patterns.avgCtr * 100).toFixed(2);
    const imgNote  = productImageUrl ? `\nProduct image reference: ${productImageUrl}` : '';
    const platformNote = patterns.platform ? ` Optimized for ${patterns.platform} feed ads.` : '';

    if (type === 'video') {
        return `High-converting DTC video ad for ${brand}'s ${product}.${imgNote}
Opening hook (0-2s): ${hookMain} — stop-the-scroll moment.
Core appeal: ${appeals}.
Emotional arc: ${emotions}.
Bright, fast-paced product showcase with text overlay highlighting key value proposition. Premium ${brand} aesthetic.${platformNote}
Performance target: ROAS ${roas}%+ CTR ${ctr}%+`;
    } else {
        return `High-converting DTC advertisement image for ${brand}'s ${product}.${imgNote}
Key appeal: ${appeals}.
Visual hook: ${hookMain}.
Emotional response: ${emotions}.
Product prominently featured, lifestyle context, eye-catching text overlay with price/value proposition. Clean, aspirational, bright colors matching ${brand} brand aesthetic.${platformNote}`;
    }
}

// ============================
// Higgsfield API 호출
// ============================

// 워크스페이스 ID (Higgsfield 계정 고유값)
const HF_WORKSPACE_ID = 'b3a6bab3-3047-49bf-9dd8-0fd38e8fda8f';

// aspect_ratio → width/height 변환 (MCP가 실제로 사용하는 값)
function _aspectToSize(ar) {
    const map = {
        '1:1':  { width: 1024, height: 1024 },
        '9:16': { width: 576,  height: 1024 },
        '16:9': { width: 1024, height: 576  },
        '4:5':  { width: 819,  height: 1024 },
        '3:2':  { width: 1024, height: 683  },
        '2:3':  { width: 683,  height: 1024 },
    };
    return map[ar] || { width: 1024, height: 1024 };
}

// MCP 분석 결과: nano_banana_2 요청 시 실제 사용 모델 = nano_banana_flash
// body에 MCP가 실제로 보내는 필드 포함 (width, height, batch_size, reference_elements)
function _buildImageBody({ prompt, aspect_ratio, resolution, workspace_id, model }) {
    const { width, height } = _aspectToSize(aspect_ratio);
    return {
        model: model || 'nano_banana_flash',
        prompt,
        aspect_ratio,
        width,
        height,
        resolution: resolution || '1k',
        batch_size: 1,
        reference_elements: [],
        medias: [],
        workspace_id,
    };
}

// 이미지 엔드포인트 우선순위 목록
const HF_IMAGE_ENDPOINTS = [
    // 패턴 1: /v1/text2image/nano_banana_flash (실제 모델명)
    [
        (base) => `${base}/v1/text2image/nano_banana_flash`,
        (p) => _buildImageBody({ ...p, model: 'nano_banana_flash' }),
    ],
    // 패턴 2: /v1/text2image/nano_banana_2 (원래 모델명)
    [
        (base) => `${base}/v1/text2image/nano_banana_2`,
        (p) => _buildImageBody({ ...p, model: 'nano_banana_2' }),
    ],
    // 패턴 3: workspace URL 포함
    [
        (base) => `${base}/v1/workspaces/${HF_WORKSPACE_ID}/text2image/nano_banana_flash`,
        (p) => _buildImageBody({ ...p, model: 'nano_banana_flash' }),
    ],
    // 패턴 4: /v1/image/generate — 통합 엔드포인트
    [
        (base) => `${base}/v1/image/generate`,
        (p) => _buildImageBody(p),
    ],
    // 패턴 5: /v1/generate
    [
        (base) => `${base}/v1/generate`,
        (p) => ({ type: 'image', ..._buildImageBody(p) }),
    ],
    // 패턴 6: /v1/jobs (일부 플랫폼 스타일)
    [
        (base) => `${base}/v1/jobs`,
        (p) => ({ type: 'text2image', ..._buildImageBody(p) }),
    ],
];

// 이 응답코드는 "경로 자체가 없음" 으로 간주해 다음 엔드포인트 시도
const HF_SKIP_STATUSES = new Set([404, 405, 500, 502, 503]);

async function _tryImageEndpoint(base, apiKey, params) {
    let lastRes  = null;
    let lastText = '';

    for (const [makeUrl, makeBody] of HF_IMAGE_ENDPOINTS) {
        const url  = makeUrl(base);
        const body = makeBody(params);
        console.log('[HF] Trying POST', url, JSON.stringify(body));

        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch (e) {
            console.warn('[HF] Fetch error, trying next:', url, e.message);
            continue;
        }

        const text = await res.text();
        const usedBase = res.headers?.get?.('X-Target-Base') || '?';
        console.log('[HF] Status:', res.status, '| Base:', usedBase, '| Body:', text.slice(0, 400));

        // 401/403은 인증/권한 오류 → 즉시 중단 (재시도 의미없음)
        if (res.status === 401 || res.status === 403) {
            return _fakeResponse(res.status, text);
        }

        // 2xx = 성공
        if (res.ok) {
            return _fakeResponse(res.status, text);
        }

        // 500/404/405 등: "이 경로 없음" 으로 보고 다음 시도
        if (HF_SKIP_STATUSES.has(res.status)) {
            console.warn('[HF] Skipping endpoint (status', res.status, '):', url);
            lastRes  = res;
            lastText = text;
            continue;
        }

        // 그 외 오류코드 (422 등): 경로는 맞는데 파라미터 오류 → 즉시 반환
        return _fakeResponse(res.status, text);
    }

    // 모든 엔드포인트 실패 → 마지막 응답 반환 (에러 표시용)
    console.error('[HF] All endpoints failed. Last status:', lastRes?.status, lastText);
    return _fakeResponse(lastRes?.status || 500, lastText || '{"detail":"모든 엔드포인트 실패"}');
}

// fetch Response와 호환되는 가짜 객체 (text는 이미 소비했으므로 래핑)
function _fakeResponse(status, text) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
            try { return JSON.parse(text); }
            catch (_) { return { detail: text }; }
        },
        text: async () => text,
    };
}

async function _callHiggsfieldGenerate(prompt, type, aspectRatio) {
    const apiKey = _getHfKey();
    if (!apiKey) throw new Error('API 키를 먼저 입력해주세요.');

    const base = _getBaseUrl();
    let res;

    if (type === 'video') {
        const url  = `${base}/v1/image2video/dop`;
        const body = { model: 'dop-turbo', prompt, aspect_ratio: aspectRatio || '16:9' };
        console.log('[HF] POST', url, JSON.stringify(body));
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    } else {
        // 이미지: 엔드포인트 자동 탐색
        res = await _tryImageEndpoint(base, apiKey, {
            prompt,
            aspect_ratio: aspectRatio || '1:1',
            resolution: '1k',
            workspace_id: HF_WORKSPACE_ID,
        });
    }

    // 상세 에러 메시지
    if (!res.ok) {
        let errMsg = `API 오류 (${res.status})`;
        try {
            const errBody = await res.json();
            const detail = errBody.message || errBody.error || errBody.detail || JSON.stringify(errBody);
            console.error('[HF Error]', res.status, JSON.stringify(errBody));
            errMsg = `${res.status}: ${detail}`;
        } catch (_) {
            const errText = await res.text().catch(() => '');
            errMsg = `${res.status}: ${errText.slice(0, 300)}`;
            console.error('[HF Error raw]', errMsg);
        }
        if (res.status === 401) errMsg = '인증 실패 (401) — API 키를 확인해주세요 (KEY_ID:KEY_SECRET)';
        if (res.status === 403) errMsg = '권한 없음 (403) — 크레딧 부족 또는 플랜 확인';
        throw new Error(errMsg);
    }

    const data = await res.json();
    console.log('[HF] Response:', JSON.stringify(data));

    if (data.status === 'completed') return _extractResultUrl(data, type);
    // 즉시 URL이 있으면 반환 (일부 모델은 동기 응답)
    const immediateUrl = _extractResultUrl(data, type);
    if (immediateUrl) return immediateUrl;
    // 비동기: status_url 우선, 없으면 request_id로 구성
    const requestId = data.request_id || data.id || data.job_id;
    const statusUrl = data.status_url || data.polling_url || null;
    if (!requestId && !statusUrl) throw new Error(`request_id를 받지 못했어요. 응답: ${JSON.stringify(data).slice(0,200)}`);
    return { requestId, statusUrl, type };
}

async function _pollHiggsfieldStatus(requestId, statusUrl) {
    const apiKey = _getHfKey();
    const base   = _getBaseUrl();
    // 후보 URL 목록 (statusUrl이 있으면 그것만, 없으면 두 패턴 시도)
    const urls = statusUrl
        ? [statusUrl]
        : [`${base}/v1/requests/${requestId}`, `${base}/requests/${requestId}/status`, `${base}/v1/jobs/${requestId}`];

    for (const url of urls) {
        try {
            const res = await fetch(url, {
                headers: { 'Authorization': `Key ${apiKey}` },
            });
            if (res.status === 404) continue;
            if (!res.ok) throw new Error(`폴링 오류 (${res.status})`);
            return await res.json();
        } catch (e) {
            if (urls.indexOf(url) === urls.length - 1) throw e;
        }
    }
    throw new Error('폴링 엔드포인트를 찾지 못했어요.');
}

function _extractResultUrl(data, type) {
    // MCP 형식: data.results[0].rawUrl / minUrl
    const firstResult = Array.isArray(data.results) ? data.results[0] : null;
    if (firstResult?.rawUrl) return firstResult.rawUrl;
    if (firstResult?.minUrl) return firstResult.minUrl;

    if (type === 'video') {
        return data.video?.url
            || data.videos?.[0]?.url
            || data.output?.[0]
            || data.result?.url
            || data.url
            || null;
    }
    return data.images?.[0]?.url
        || data.image?.url
        || data.output?.[0]
        || data.result?.url
        || data.url
        || null;
}

// ============================
// 패널 HTML 생성
// ============================
function _buildGeneratePanelHTML(p) {
    function rankBadge(tag, idx) {
        const styles = ['gen-tag-1','gen-tag-2','gen-tag-3','gen-tag-4','gen-tag-5','gen-tag-6'];
        const rankIcon = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx+1}.`;
        return `<span class="gen-tag ${styles[idx % styles.length]}">${rankIcon} ${tag}</span>`;
    }

    const thumbsHtml = p.top5.filter(c => c.thumbnail_url)
        .map((c, i) => `<div class="gen-thumb" title="${c.ad_name || ''}">
            <img src="${c.thumbnail_url}" alt="" loading="lazy">
            <span class="gen-thumb-rank">${i+1}</span>
        </div>`).join('');

    const savedKey = _getHfKey();
    const maskedKey = savedKey ? savedKey.slice(0, 6) + '••••••••••' : '';

    return `
    <!-- 워킹 패턴 분석 -->
    <div class="gen-section">
        <div class="gen-section-header">
            <i class="fas fa-trophy text-amber-500"></i>
            <span>워킹 패턴 분석</span>
            <span class="gen-section-sub">ROAS 기준 BEST TOP5 · ${p.top5.length}개 소재</span>
        </div>
        <div class="gen-pattern-grid">
            <div class="gen-pattern-card">
                <div class="gen-pattern-title"><i class="fas fa-bullseye text-violet-500 mr-1.5"></i>소구포인트</div>
                <div class="gen-tag-list">
                    ${p.topAppeal.length ? p.topAppeal.map((t,i) => rankBadge(t,i)).join('') : '<span class="text-slate-400 text-xs">데이터 없음</span>'}
                </div>
            </div>
            <div class="gen-pattern-card">
                <div class="gen-pattern-title"><i class="fas fa-fish text-cyan-500 mr-1.5"></i>후킹 전략</div>
                <div class="gen-tag-list">
                    ${p.topHook.length ? p.topHook.map((t,i) => rankBadge(t,i)).join('') : '<span class="text-slate-400 text-xs">데이터 없음</span>'}
                </div>
            </div>
            <div class="gen-pattern-card">
                <div class="gen-pattern-title"><i class="fas fa-heart text-rose-500 mr-1.5"></i>타겟 감정</div>
                <div class="gen-tag-list">
                    ${p.topEmotion.length ? p.topEmotion.map((t,i) => rankBadge(t,i)).join('') : '<span class="text-slate-400 text-xs">데이터 없음</span>'}
                </div>
            </div>
        </div>
        <div class="gen-benchmark-bar">
            <div class="gen-benchmark-item">
                <span class="gen-benchmark-label">ROAS 평균</span>
                <span class="gen-benchmark-value" style="color:#7c3aed">${Math.round(p.avgRoas*100)}%</span>
            </div>
            <div class="gen-benchmark-item">
                <span class="gen-benchmark-label">CTR 평균</span>
                <span class="gen-benchmark-value" style="color:#2563eb">${(p.avgCtr*100).toFixed(2)}%</span>
            </div>
            <div class="gen-benchmark-item">
                <span class="gen-benchmark-label">브랜드</span>
                <span class="gen-benchmark-value">${p.brand || '전체'}</span>
            </div>
            <div class="gen-benchmark-item">
                <span class="gen-benchmark-label">매체</span>
                <span class="gen-benchmark-value">${p.platform || '전체'}</span>
            </div>
        </div>
        ${thumbsHtml ? `<div class="gen-top5-thumbs">${thumbsHtml}</div>` : ''}
    </div>

    <!-- 제품 정보 -->
    <div class="gen-section">
        <div class="gen-section-header">
            <i class="fas fa-box-open text-indigo-500"></i>
            <span>제품 정보</span>
            <span class="gen-section-sub">입력하면 더 정밀한 브리프 생성</span>
        </div>
        <div class="gen-product-inputs">
            <div class="gen-input-group">
                <label class="gen-input-label">제품명</label>
                <input id="gen-product-name" type="text" class="gen-input" placeholder="예: ShinchanSET 립글로스 세트">
            </div>
            <div class="gen-input-group">
                <label class="gen-input-label">제품 이미지 URL <span class="font-normal text-slate-400">(선택)</span></label>
                <input id="gen-product-image" type="url" class="gen-input" placeholder="https://drive.google.com/...">
            </div>
        </div>
    </div>

    <!-- 연결 설정 -->
    <div class="gen-section">
        <div class="gen-section-header">
            <i class="fas fa-plug text-amber-500"></i>
            <span>연결 설정</span>
        </div>

        <!-- API 키 -->
        <div class="mt-3">
            <div class="flex items-center justify-between mb-1">
                <label class="gen-input-label">Higgsfield API 키 (KEY_ID:KEY_SECRET)</label>
                <a href="https://cloud.higgsfield.ai/api-keys" target="_blank"
                   class="text-xs text-indigo-500 hover:text-indigo-700 font-semibold flex items-center gap-1">
                    <i class="fas fa-external-link-alt text-[10px]"></i> 키 발급
                </a>
            </div>
            <div class="flex gap-2">
                <input id="gen-api-key" type="password" class="gen-input flex-1"
                    placeholder="abc123:xxxxxxxxxxxxxxxx"
                    value="${savedKey}">
                <button id="gen-save-key" class="gen-btn-copy whitespace-nowrap">
                    <i class="fas fa-save mr-1.5"></i>저장
                </button>
            </div>
            ${savedKey ? `<p class="text-xs text-emerald-600 mt-1 flex items-center gap-1"><i class="fas fa-circle-check"></i> 저장됨: ${maskedKey}</p>` : ''}
        </div>

        <!-- 프록시 URL -->
        <div class="mt-4">
            <div class="flex items-center justify-between mb-1">
                <label class="gen-input-label">CORS 프록시 URL
                    <span class="text-slate-400 font-normal ml-1">(Cloudflare Worker — 필수)</span>
                </label>
                <a href="https://workers.cloudflare.com" target="_blank"
                   class="text-xs text-indigo-500 hover:text-indigo-700 font-semibold flex items-center gap-1">
                    <i class="fas fa-external-link-alt text-[10px]"></i> 워커 만들기
                </a>
            </div>
            <div class="flex gap-2">
                <input id="gen-proxy-url" type="url" class="gen-input flex-1"
                    placeholder="https://hf-proxy.이름.workers.dev"
                    value="${localStorage.getItem('hf_proxy_url') || ''}">
                <button id="gen-save-proxy" class="gen-btn-copy whitespace-nowrap">
                    <i class="fas fa-save mr-1.5"></i>저장
                </button>
            </div>
            ${(localStorage.getItem('hf_proxy_url') || '') ? `<p class="text-xs text-emerald-600 mt-1 flex items-center gap-1"><i class="fas fa-circle-check"></i> 프록시 설정됨</p>` :
              `<p class="text-xs text-amber-600 mt-1 flex items-center gap-1"><i class="fas fa-triangle-exclamation"></i> 프록시 없으면 CORS 오류 발생 — workers.cloudflare.com에서 무료로 5분 만에 설정 가능</p>`}
        </div>
    </div>

    <!-- 생성 브리프 -->
    <div class="gen-section">
        <div class="gen-section-header">
            <i class="fas fa-wand-magic-sparkles text-pink-500"></i>
            <span>생성 브리프 & 결과</span>
            <button id="gen-refresh-btn" class="ml-auto text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 transition">
                <i class="fas fa-rotate-right"></i> 분석 새로고침
            </button>
        </div>

        <div class="gen-type-tabs">
            <button id="gen-tab-image" class="gen-type-tab active">
                <i class="fas fa-image mr-1.5"></i>이미지 광고
            </button>
            <button id="gen-tab-video" class="gen-type-tab">
                <i class="fas fa-video mr-1.5"></i>영상 광고
            </button>
        </div>

        <!-- 이미지 탭 -->
        <div id="gen-brief-image">
            <textarea id="gen-prompt-image" class="gen-prompt-textarea" rows="8" spellcheck="false"
                placeholder="프롬프트 자동 생성 중..."></textarea>
            <div class="gen-aspect-row">
                <label class="gen-input-label">비율</label>
                <select id="gen-aspect-image" class="gen-select">
                    <option value="9:16">9:16 (세로 / 릴스)</option>
                    <option value="1:1" selected>1:1 (정방형)</option>
                    <option value="16:9">16:9 (가로)</option>
                    <option value="4:5">4:5 (피드)</option>
                </select>
            </div>
            <div class="gen-actions">
                <button id="gen-copy-image" class="gen-btn-copy">
                    <i class="fas fa-copy mr-1.5"></i>프롬프트 복사
                </button>
                <button id="gen-generate-image" class="gen-btn-generate">
                    <i class="fas fa-sparkles mr-1.5"></i>이미지 생성
                </button>
            </div>
            <!-- 결과 표시 -->
            <div id="gen-result-image" class="gen-result-area hidden"></div>
        </div>

        <!-- 영상 탭 -->
        <div id="gen-brief-video" class="hidden">
            <textarea id="gen-prompt-video" class="gen-prompt-textarea" rows="8" spellcheck="false"
                placeholder="프롬프트 자동 생성 중..."></textarea>
            <div class="gen-aspect-row">
                <label class="gen-input-label">비율</label>
                <select id="gen-aspect-video" class="gen-select">
                    <option value="9:16">9:16 (세로 / 릴스)</option>
                    <option value="16:9" selected>16:9 (가로)</option>
                    <option value="1:1">1:1 (정방형)</option>
                </select>
            </div>
            <div class="gen-actions">
                <button id="gen-copy-video" class="gen-btn-copy">
                    <i class="fas fa-copy mr-1.5"></i>프롬프트 복사
                </button>
                <button id="gen-generate-video" class="gen-btn-generate">
                    <i class="fas fa-sparkles mr-1.5"></i>영상 생성
                </button>
            </div>
            <!-- 결과 표시 -->
            <div id="gen-result-video" class="gen-result-area hidden"></div>
        </div>
    </div>`;
}

// ============================
// 이벤트 바인딩
// ============================
function _bindGeneratePanelEvents() {
    document.getElementById('gen-tab-image')?.addEventListener('click', () => _switchGenTab('image'));
    document.getElementById('gen-tab-video')?.addEventListener('click', () => _switchGenTab('video'));
    document.getElementById('gen-refresh-btn')?.addEventListener('click', renderGeneratePanel);

    // API 키 저장
    document.getElementById('gen-save-key')?.addEventListener('click', () => {
        const key = document.getElementById('gen-api-key')?.value?.trim();
        if (!key) return genToast('API 키를 입력해주세요.', 2500);
        _saveHfKey(key);
        genToast('✅ API 키가 저장됐어요!');
        renderGeneratePanel();
    });

    document.getElementById('gen-save-proxy')?.addEventListener('click', () => {
        const url = document.getElementById('gen-proxy-url')?.value?.trim();
        if (!url) return genToast('프록시 URL을 입력해주세요.', 2500);
        localStorage.setItem(HF_PROXY_KEY, url);
        genToast('✅ 프록시 URL이 저장됐어요!');
        renderGeneratePanel();
    });

    // 제품 정보 변경 시 프롬프트 갱신
    ['gen-product-name', 'gen-product-image'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', _refreshPrompts);
    });

    // 복사 버튼
    document.getElementById('gen-copy-image')?.addEventListener('click', () => _copyPrompt('image'));
    document.getElementById('gen-copy-video')?.addEventListener('click', () => _copyPrompt('video'));

    // 생성 버튼
    document.getElementById('gen-generate-image')?.addEventListener('click', () => _triggerGenerate('image'));
    document.getElementById('gen-generate-video')?.addEventListener('click', () => _triggerGenerate('video'));
}

function _switchGenTab(type) {
    _genCurrentTab = type;
    document.getElementById('gen-tab-image')?.classList.toggle('active', type === 'image');
    document.getElementById('gen-tab-video')?.classList.toggle('active', type === 'video');
    document.getElementById('gen-brief-image')?.classList.toggle('hidden', type !== 'image');
    document.getElementById('gen-brief-video')?.classList.toggle('hidden', type !== 'video');
}

function _refreshPrompts() {
    if (!_genPatterns) return;
    const productName     = document.getElementById('gen-product-name')?.value  || '';
    const productImageUrl = document.getElementById('gen-product-image')?.value || '';
    const imgTA = document.getElementById('gen-prompt-image');
    const vidTA = document.getElementById('gen-prompt-video');
    if (imgTA) imgTA.value = buildHiggsfieldPrompt(_genPatterns, productName, productImageUrl, 'image');
    if (vidTA) vidTA.value = buildHiggsfieldPrompt(_genPatterns, productName, productImageUrl, 'video');
}

function _copyPrompt(type) {
    const ta = document.getElementById(`gen-prompt-${type}`);
    if (!ta?.value) return;
    navigator.clipboard.writeText(ta.value).then(() => {
        const btn = document.getElementById(`gen-copy-${type}`);
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check mr-1.5"></i>복사됨!';
            btn.classList.add('copied');
            setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
        }
    });
}

// ============================
// 생성 트리거 (메인 흐름)
// ============================
async function _triggerGenerate(type) {
    if (!_getHfKey()) {
        genToast('❌ Higgsfield API 키를 먼저 입력하고 저장해주세요.', 3000);
        document.getElementById('gen-api-key')?.focus();
        return;
    }

    const promptEl = document.getElementById(`gen-prompt-${type}`);
    const prompt   = promptEl?.value?.trim();
    if (!prompt) {
        genToast('프롬프트가 비어있어요.', 2500);
        return;
    }

    const aspectEl = document.getElementById(`gen-aspect-${type}`);
    const aspect   = aspectEl?.value || '9:16';
    const resultEl = document.getElementById(`gen-result-${type}`);
    const genBtn   = document.getElementById(`gen-generate-${type}`);

    // UI → 로딩 상태
    _setGenerating(type, true);
    _showResultLoading(resultEl, type);

    try {
        const result = await _callHiggsfieldGenerate(prompt, type, aspect);

        if (result && typeof result === 'string') {
            // 즉시 완료
            _showResultSuccess(resultEl, result, type);
        } else if (result?.requestId || result?.statusUrl) {
            // 비동기 폴링
            genToast('⏳ 생성 중... 잠시 기다려주세요.');
            await _pollUntilDone(result.requestId, result.statusUrl, result.type, resultEl);
        }
    } catch (e) {
        _showResultError(resultEl, e.message);
        genToast(`❌ ${e.message}`, 4000);
        console.error('[HF Generate]', e);
    } finally {
        _setGenerating(type, false);
    }
}

async function _pollUntilDone(requestId, statusUrl, type, resultEl) {
    const start = Date.now();
    while (Date.now() - start < HF_MAX_WAIT) {
        await new Promise(r => setTimeout(r, HF_POLL_MS));
        try {
            const data = await _pollHiggsfieldStatus(requestId, statusUrl);
            const status = data.status;

            if (status === 'completed') {
                const url = _extractResultUrl(data, type);
                if (url) {
                    _showResultSuccess(resultEl, url, type);
                } else {
                    _showResultError(resultEl, '결과 URL을 받지 못했어요.');
                }
                return;
            } else if (status === 'failed' || status === 'nsfw') {
                _showResultError(resultEl, status === 'nsfw' ? '콘텐츠 정책으로 생성 실패' : '생성 실패');
                return;
            }
            // in_progress / queued → 계속 폴링
            _updateResultProgress(resultEl, Math.round((Date.now() - start) / 1000));
        } catch (e) {
            // 일시적 오류는 무시하고 재시도
        }
    }
    _showResultError(resultEl, '시간 초과 (3분). 다시 시도해주세요.');
}

// ============================
// 결과 UI 헬퍼
// ============================
function _setGenerating(type, isLoading) {
    const btn = document.getElementById(`gen-generate-${type}`);
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-1.5"></i>생성 중...`;
    } else {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-sparkles mr-1.5"></i>${type === 'video' ? '영상' : '이미지'} 생성`;
    }
}

function _showResultLoading(el, type) {
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = `
        <div class="gen-result-loading">
            <div class="gen-result-spinner"></div>
            <div>
                <p class="font-semibold text-slate-700">${type === 'video' ? '영상' : '이미지'} 생성 중...</p>
                <p class="text-xs text-slate-400 mt-0.5" id="gen-progress-msg">잠시 기다려주세요</p>
            </div>
        </div>`;
}

function _updateResultProgress(el, sec) {
    const msg = el?.querySelector('#gen-progress-msg');
    if (msg) msg.textContent = `${sec}초 경과... 보통 20-60초 소요`;
}

function _showResultSuccess(el, url, type) {
    if (!el) return;
    el.classList.remove('hidden');
    if (type === 'video') {
        el.innerHTML = `
            <div class="gen-result-success">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-sm font-bold text-emerald-700 flex items-center gap-1.5">
                        <i class="fas fa-circle-check"></i> 생성 완료!
                    </span>
                    <a href="${url}" target="_blank" download
                       class="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1">
                        <i class="fas fa-download"></i> 다운로드
                    </a>
                </div>
                <video controls autoplay muted loop playsinline class="gen-result-media">
                    <source src="${url}" type="video/mp4">
                </video>
            </div>`;
    } else {
        el.innerHTML = `
            <div class="gen-result-success">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-sm font-bold text-emerald-700 flex items-center gap-1.5">
                        <i class="fas fa-circle-check"></i> 생성 완료!
                    </span>
                    <a href="${url}" target="_blank" download
                       class="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1">
                        <i class="fas fa-download"></i> 다운로드
                    </a>
                </div>
                <img src="${url}" alt="생성된 광고 이미지" class="gen-result-media" loading="lazy">
            </div>`;
    }
    genToast('✨ 생성 완료!', 3000);
}

function _showResultError(el, msg) {
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = `
        <div class="gen-result-error">
            <i class="fas fa-triangle-exclamation text-rose-400"></i>
            <span>${msg}</span>
        </div>`;
}

// ============================
// 메인 렌더
// ============================
function renderGeneratePanel() {
    const panel = document.getElementById('generate-panel-content');
    if (!panel) return;

    _genPatterns   = getWinningPatterns();
    _genCurrentTab = 'image';

    if (!_genPatterns) {
        panel.innerHTML = `<div class="text-center text-slate-400 py-20">
            <i class="fas fa-database text-5xl mb-4 block opacity-30"></i>
            <p class="font-semibold text-slate-500">분석할 데이터가 없어요</p>
            <p class="text-sm mt-1">스프레드시트를 연동하거나 필터를 확인해주세요</p>
        </div>`;
        return;
    }

    panel.innerHTML = _buildGeneratePanelHTML(_genPatterns);
    _bindGeneratePanelEvents();
    _refreshPrompts();
}
window.renderGeneratePanel = renderGeneratePanel;
