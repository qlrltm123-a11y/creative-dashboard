// ============================
// 광고 생성 패널 — Higgsfield 직접 API 연동
// ============================

const HF_STORAGE_KEY  = 'hf_api_key';
const HF_VERCEL_KEY   = 'hf_vercel_url';   // Vercel 함수 기본 URL (예: https://xxx.vercel.app)
const HF_PROXY_KEY    = 'hf_proxy_url';    // 구버전 Cloudflare Worker (fallback)
const HF_POLL_MS      = 3000;
const HF_MAX_WAIT     = 180000;

// Vercel URL이 설정돼 있으면 /api/hf 사용, 없으면 같은 origin의 /api/hf 시도
function _getVercelBase() {
    const stored = (localStorage.getItem(HF_VERCEL_KEY) || '').trim().replace(/\/$/, '');
    if (stored) return stored;
    // Vercel 배포 환경이면 같은 origin
    if (window.location.hostname.includes('vercel.app')) return window.location.origin;
    return null;
}

let _genPatterns      = null;
let _genCurrentTab    = 'image';
let _genPollingTimer  = null;
let _genProductFilter = '';   // 패널 내 제품 필터 ('' = 전체)

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

    // 전역 필터 (브랜드 / 매체 / 이벤트)
    const brand    = (typeof currentBrand    !== 'undefined') ? currentBrand    : '';
    const platform = (typeof currentPlatform !== 'undefined') ? currentPlatform : '';
    const event_   = (typeof currentEvent    !== 'undefined') ? currentEvent    : '';

    if (brand && brand !== 'ALL')
        data = data.filter(c => c.brand === brand);
    if (platform)
        data = data.filter(c => (c.platform || '').toString().trim() === platform);
    if (event_)
        data = data.filter(c => (c.event || '').toString().trim() === event_);

    // 제품 목록 추출 (전역 필터 적용 후, 제품 필터 적용 전)
    const productList = Array.from(new Set(
        data.map(c => (c.product || '').trim()).filter(Boolean)
    )).sort();

    // 패널 내 제품 필터 (현재 브랜드에 없는 제품이면 자동 초기화)
    if (_genProductFilter && !productList.includes(_genProductFilter)) {
        _genProductFilter = '';
    }
    if (_genProductFilter)
        data = data.filter(c => (c.product || '').trim() === _genProductFilter);

    if (typeof aggregateByAdName === 'function') data = aggregateByAdName(data);

    let top5 = [...data].filter(c => (c.roas || 0) > 0)
        .sort((a, b) => (b.roas || 0) - (a.roas || 0)).slice(0, 8);
    if (!top5.length) {
        top5 = [...data].filter(c => (c.ctr || 0) > 0)
            .sort((a, b) => (b.ctr || 0) - (a.ctr || 0)).slice(0, 8);
    }
    if (!top5.length) return { top5: [], productList, noData: true, brand, platform };

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
        brand:    (brand && brand !== 'ALL') ? brand : (top5[0]?.brand || ''),
        platform,
        selectedProduct: _genProductFilter,
        productList,
        sampleThumb: top5[0]?.thumbnail_url || top5[0]?.media_url || '',
        sampleName:  top5[0]?.ad_name || top5[0]?.creative_name || '',
    };
}

// ---- 제품명 → 시각적 카테고리 추측 ----
function _guessProductCategory(name) {
    const n = (name || '').toLowerCase();
    if (/cream|크림|refill|リフィル|lift|ハリ/.test(n))  return 'anti-aging lifting face cream in elegant jar packaging';
    if (/serum|세럼|精華|essence|에센스/.test(n))          return 'premium facial serum in dropper bottle';
    if (/lip|リップ|글로스|tint/.test(n))                  return 'lip care product (tube or compact)';
    if (/toner|토너|化粧水|lotion/.test(n))                return 'facial toner in clean bottle';
    if (/mask|마스크|パック|pack/.test(n))                  return 'face mask / sheet pack product';
    if (/eye|아이|アイ/.test(n))                            return 'eye cream in small jar';
    if (/sun|サン|선크림|spf/.test(n))                     return 'sunscreen in tube';
    if (/cleansing|클렌징|クレンジング/.test(n))            return 'facial cleanser';
    if (/3d|3D/.test(n))                                    return 'anti-aging 3D lifting skincare cream';
    return 'premium K-beauty skincare product';
}

// ---- 한국어 소구 태그 → 영어 순수 비주얼 묘사 (텍스트/배지/버블 완전 제외) ----
const _APPEAL_VISUAL = {
    '할인 혜택':       'vibrant lifestyle energy, confident expression',
    '리프팅 효과':     'visibly lifted and sculpted facial contour',
    '탄력 개선':       'firm elastic luminous skin close-up',
    '가성비':          'premium product elegance, aspirational feel',
    '신제품 출시':     'fresh clean product reveal aesthetic',
    '간편한 사용':     'effortless elegant one-step application gesture',
    '문제 해결 제시':  'skin concern to radiant glow transformation',
    '비포앤애프터 비교':'subtle skin texture improvement composition',
    '혜택 강조':       'radiant beautiful skin result, glowing complexion',
    '이미지 개선':     'confident glowing beauty transformation moment',
    '가격 경쟁력':     'premium product hero shot, aspirational lifestyle',
    '신뢰감':          'clean minimal ingredient close-up, clinical precision',
};

const _HOOK_VISUAL = {
    '문제 해결 제시':  'model touching skin with concern, then confident glow',
    '비포앤애프터 비교':'dramatic skin texture improvement, dull to radiant',
    '신제품 출시 알림':'bold clean product launch composition',
    '혜택 강조':       'model with radiantly glowing clear skin, confident pose',
    '가격/할인 강조':  'product hero shot with dynamic lifestyle energy',
    '유명인 추천':     'authentic approachable beauty moment, genuine smile',
    '신뢰감 형성':     'extreme close-up of clear smooth skin, ingredient drop',
};

function _tagToVisual(tag, map, fallback) {
    return map[tag] || fallback || tag;
}

// ---- 프롬프트 빌더 (이미지 생성 모델용 — 순수 포토 지시어, 텍스트 완전 배제) ----
function buildHiggsfieldPrompt(patterns, productName, productImageUrl, type) {
    if (!patterns) return '';

    const product  = productName || patterns.selectedProduct || patterns.sampleName?.split('_')[0] || 'skincare product';
    const category = _guessProductCategory(product);

    // 소구 → 영어 비주얼 (텍스트·숫자·배지·버블 없는 것만)
    const appealVisuals = (patterns.topAppeal || []).slice(0, 2)
        .map(a => _tagToVisual(a, _APPEAL_VISUAL, null)).filter(Boolean).join(', ')
        || 'radiant glowing skin, premium product elegance';
    const hookVisual = _tagToVisual((patterns.topHook || [])[0], _HOOK_VISUAL,
        'confident model with smooth luminous skin');

    const platform     = patterns.platform || '';
    const platformHint = platform ? ` Optimized for ${platform} vertical feed format.` : '';

    // 참고 이미지
    const refUrls = _getAutoReferenceUrls();
    const refNote = refUrls.length > 0
        ? `\nSTYLE REFERENCE (${refUrls.length} top-performing creatives): Match their exact composition, color palette, lighting mood, product angle, and model pose. Improve upon their winning formula with fresh visual execution.`
        : '';

    // 제품 이미지 힌트
    const productImgNote = productImageUrl
        ? `\nProduct visual reference: ${productImageUrl}` : '';

    // 핵심 금지 규칙 (항상 마지막에)
    const noText = `\nCRITICAL — ZERO TEXT RULE: Absolutely NO text, letters, numbers, kanji, hangul, latin characters, or symbols anywhere in the image — not on the product bottle, not on the background, not as overlays, not anywhere. The product bottle must be plain clean white with no label, no brand mark, no writing of any kind. Pure visual photography only.`;

    if (type === 'video') {
        return `Cinematic K-beauty skincare advertisement video. ${category}. Clean minimalist white product packaging, no label, no text on bottle.${productImgNote}

OPENING HOOK (0-2s): ${hookVisual}.
VISUAL MOOD: ${appealVisuals}.
SCENE: Asian woman model (late 20s, radiant clear skin) applying product. Skin appears luminous. Bright lifestyle studio setting.
BACKGROUND: Soft pastel pink and white gradient. Clean modern studio.
STYLE: Premium K-beauty aesthetic. Bright soft-box lighting. Elegant and fresh. Pastel color palette.
FORMAT: Vertical 9:16 social media video.${platformHint}${noText}${refNote}`;
    } else {
        return `Premium K-beauty skincare product photography. ${category}. Clean minimalist white product packaging, no label, no text on bottle.${productImgNote}

COMPOSITION: Product left-center foreground on white surface, Asian woman model (late 20s, clear radiant skin, natural soft expression) right background, slightly blurred.
VISUAL MOOD: ${hookVisual}.
SKIN DETAIL: ${appealVisuals}.
BACKGROUND: Soft gradient pastel pink-to-white studio backdrop.
LIGHTING: Bright soft-box studio lighting. Skin appears luminous and poreless. Product has clean specular highlight.
COLOR PALETTE: Pastel pink, soft peach, white. No harsh colors.
STYLE: Editorial premium K-beauty cosmetics photography. Clean elegant minimal layout. Lifestyle beauty.${platformHint}${noText}${refNote}`;
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

// ============================================================
// SDK 분석 결과: Higgsfield V2 API 형식
//   POST /{model}/text-to-image
//   body: { input: { prompt, aspect_ratio, safety_tolerance, seed } }
//   Auth: Authorization: Key KEY_ID:KEY_SECRET
//   주의: 브라우저 직접 호출 차단 → Cloudflare Worker(서버) 통해야 함
// ============================================================

// SDK 소스 확인: body는 input 필드를 직접 top-level로 보냄 (input:{} 래퍼 없음)
// POST body = { ...input } = { prompt, aspect_ratio, safety_tolerance }
function _buildV2Body({ prompt, aspect_ratio }) {
    return {
        prompt,
        aspect_ratio: aspect_ratio || '1:1',
        safety_tolerance: 2,
    };
}

// 이미지 엔드포인트 우선순위 목록 (V2 SDK 형식)
const HF_IMAGE_ENDPOINTS = [
    // 패턴 1: nano_banana_flash (MCP 실제 사용 모델)
    [
        (base) => `${base}/nano_banana_flash/text-to-image`,
        (p) => _buildV2Body(p),
    ],
    // 패턴 2: nano_banana_2 (원래 요청 모델)
    [
        (base) => `${base}/nano_banana_2/text-to-image`,
        (p) => _buildV2Body(p),
    ],
    // 패턴 3: nano_banana (짧은 이름)
    [
        (base) => `${base}/nano_banana/text-to-image`,
        (p) => _buildV2Body(p),
    ],
    // 패턴 4: flux-pro/kontext/max (SDK 예시에서 확인된 패턴)
    [
        (base) => `${base}/flux-pro/kontext/max/text-to-image`,
        (p) => _buildV2Body(p),
    ],
    // 패턴 5: 구버전 V1 형식 (fallback)
    [
        (base) => `${base}/v1/text2image/nano_banana_flash`,
        (p) => ({ prompt: p.prompt, aspect_ratio: p.aspect_ratio, resolution: '1k' }),
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

// Google Drive / 다양한 링크 → 직접 이미지 URL 변환
// drive-converter.js의 convertDriveImageUrl 사용 (thumbnail API — CORS 안전)
function _toDirectImageUrl(url) {
    if (!url) return null;
    url = url.trim();
    if (typeof convertDriveImageUrl === 'function' && /drive\.google\.com|docs\.google\.com/.test(url)) {
        return convertDriveImageUrl(url);
    }
    // Drive fallback: /file/d/ID 또는 ?id=ID → thumbnail API
    const driveMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (driveMatch) return `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w800`;
    // 이미 직접 URL이면 그대로
    if (url.startsWith('http')) return url;
    return null;
}

// 저장된 참고 소재 URL 목록 가져오기 (최대 3개)
function _getReferenceUrls() {
    const raw = localStorage.getItem('hf_reference_urls') || '';
    return raw.split('\n')
        .map(l => _toDirectImageUrl(l.trim()))
        .filter(Boolean)
        .slice(0, 3);
}

// 최종 참고 소재 URL 결정
// ① 현재 브랜드/제품의 ROAS top3 자동 포함 (항상)
// ② 사용자가 수동 선택한 소재 추가 (+)
// → 브랜드/제품 바뀌면 ①이 즉시 교체되어 항상 현재 컨텍스트에 맞는 참조 사용
function _getAutoReferenceUrls() {
    // 자동: 현재 분석 중인 top3 이미지
    const auto = (_genPatterns?.top5 || [])
        .filter(c => c.media_url || c.thumbnail_url)
        .slice(0, 3)
        .map(c => _toDirectImageUrl(c.media_url || c.thumbnail_url))
        .filter(Boolean);

    // 수동: 사용자가 추가로 클릭/입력한 소재
    const manual = _getReferenceUrls();

    // 합치되 중복 제거, 최대 5개 (API는 3개까지 반영)
    return [...new Set([...auto, ...manual])].slice(0, 5);
}

async function _callHiggsfieldGenerate(prompt, type, aspectRatio, extraRefs = []) {
    const apiKey = _getHfKey();
    if (!apiKey) throw new Error('API 키를 먼저 입력해주세요.');

    const vercelBase = _getVercelBase();
    const baseRefs = type === 'image' ? _getAutoReferenceUrls() : [];
    const referenceUrls = [...new Set([...baseRefs, ...extraRefs])].slice(0, 5);
    let res;

    if (vercelBase) {
        // ✅ Vercel 서버리스 함수 사용 (IP 차단 없음)
        const url = `${vercelBase}/api/hf`;
        const body = {
            prompt,
            aspect_ratio: aspectRatio || (type === 'video' ? '16:9' : '1:1'),
            type,
            referenceUrls: referenceUrls.length ? referenceUrls : undefined,
        };
        console.log('[HF→Vercel] POST', url, JSON.stringify(body));
        res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Hf-Key': apiKey,
            },
            body: JSON.stringify(body),
        });
    } else {
        // ⚠️ Vercel URL 미설정 — 구 Worker 방식 시도
        const base = (localStorage.getItem(HF_PROXY_KEY) || '').trim().replace(/\/$/, '') || 'https://platform.higgsfield.ai';
        if (type === 'video') {
            const url  = `${base}/v1/image2video/dop`;
            const body = { model: 'dop-turbo', prompt, aspect_ratio: aspectRatio || '16:9' };
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } else {
            res = await _tryImageEndpoint(base, apiKey, {
                prompt,
                aspect_ratio: aspectRatio || '1:1',
                workspace_id: HF_WORKSPACE_ID,
            });
        }
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

    // Vercel SDK 응답: { url, type } — 이미 폴링 완료된 결과
    if (data.url) return data.url;

    if (data.status === 'completed') return _extractResultUrl(data, type);
    const immediateUrl = _extractResultUrl(data, type);
    if (immediateUrl) return immediateUrl;
    // 비동기 폴링 필요
    const requestId = data.requestId || data.request_id || data.id || data.job_id;
    const statusUrl = data.statusUrl || data.status_url || data.polling_url || null;
    if (!requestId && !statusUrl) throw new Error(`request_id를 받지 못했어요. 응답: ${JSON.stringify(data).slice(0,200)}`);
    return { requestId, statusUrl, type };
}

async function _pollHiggsfieldStatus(requestId, statusUrl) {
    // Vercel 프록시를 통해 폴링 (CORS 우회)
    const vercelBase = _getVercelBase();
    if (vercelBase) {
        const proxyUrl = `${vercelBase}/api/hf?poll=${encodeURIComponent(requestId)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`폴링 오류 (${res.status})`);
        return await res.json();
    }
    // fallback: 직접 호출
    const apiKey = _getHfKey();
    const pollUrl = statusUrl || `https://platform.higgsfield.ai/requests/${requestId}/status`;
    const res = await fetch(pollUrl, {
        headers: { 'Authorization': `Key ${apiKey}` },
    });
    if (!res.ok) throw new Error(`폴링 오류 (${res.status})`);
    return await res.json();
}

function _extractResultUrl(data, type) {
    // MCP 형식: data.results[0].rawUrl / minUrl
    const firstResult = Array.isArray(data.results) ? data.results[0] : null;
    if (firstResult?.rawUrl) return firstResult.rawUrl;
    if (firstResult?.minUrl) return firstResult.minUrl;

    if (type === 'video') {
        return data.images?.[0]?.url
            || data.video?.url
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

    const thumbsHtml = p.top5.filter(c => c.thumbnail_url || c.media_url)
        .map((c, i) => {
            const raw = c.thumbnail_url || c.media_url || '';
            const imgHtml = (typeof buildDriveImgHtml === 'function' && typeof isDriveUrl === 'function' && isDriveUrl(raw))
                ? buildDriveImgHtml(raw, { loading: 'lazy', extraAttrs: 'style="width:100%;height:100%;object-fit:cover;display:block"' })
                : `<img src="${_toDirectImageUrl(raw) || raw}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.opacity='0.12'">`;
            return `<div class="gen-thumb" title="${c.ad_name || ''}">
                ${imgHtml}
                <span class="gen-thumb-rank">${i+1}</span>
            </div>`;
        }).join('');

    const savedKey = _getHfKey();
    const maskedKey = savedKey ? savedKey.slice(0, 6) + '••••••••••' : '';

    // 제품 선택 드롭다운 옵션
    const productOptions = (p.productList || []).map(prod =>
        `<option value="${prod.replace(/"/g,'&quot;')}" ${p.selectedProduct === prod ? 'selected' : ''}>${prod}</option>`
    ).join('');

    // 패턴 분석 내용 (데이터 없으면 안내 메시지)
    const patternInner = p.noData ? `
        <div class="py-6 text-center">
            <i class="fas fa-magnifying-glass text-3xl mb-2 block opacity-30 text-slate-400"></i>
            <p class="text-sm font-semibold text-slate-500">해당 제품의 소재 데이터가 없어요</p>
            <p class="text-xs mt-1 text-slate-400">다른 제품을 선택하거나 필터를 조정해주세요</p>
        </div>` : `
        <div class="gen-pattern-grid">
            <div class="gen-pattern-card">
                <div class="gen-pattern-title"><i class="fas fa-bullseye text-violet-500 mr-1.5"></i>소구포인트</div>
                <div class="gen-tag-list">${p.topAppeal?.length ? p.topAppeal.map((t,i) => rankBadge(t,i)).join('') : '<span class="text-slate-400 text-xs">데이터 없음</span>'}</div>
            </div>
            <div class="gen-pattern-card">
                <div class="gen-pattern-title"><i class="fas fa-fish text-cyan-500 mr-1.5"></i>후킹 전략</div>
                <div class="gen-tag-list">${p.topHook?.length ? p.topHook.map((t,i) => rankBadge(t,i)).join('') : '<span class="text-slate-400 text-xs">데이터 없음</span>'}</div>
            </div>
            <div class="gen-pattern-card">
                <div class="gen-pattern-title"><i class="fas fa-heart text-rose-500 mr-1.5"></i>타겟 감정</div>
                <div class="gen-tag-list">${p.topEmotion?.length ? p.topEmotion.map((t,i) => rankBadge(t,i)).join('') : '<span class="text-slate-400 text-xs">데이터 없음</span>'}</div>
            </div>
        </div>
        <div class="gen-benchmark-bar">
            <div class="gen-benchmark-item">
                <span class="gen-benchmark-label">ROAS 평균</span>
                <span class="gen-benchmark-value" style="color:#7c3aed">${Math.round((p.avgRoas||0)*100)}%</span>
            </div>
            <div class="gen-benchmark-item">
                <span class="gen-benchmark-label">CTR 평균</span>
                <span class="gen-benchmark-value" style="color:#2563eb">${((p.avgCtr||0)*100).toFixed(2)}%</span>
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
        ${thumbsHtml ? `<div class="gen-top5-thumbs">${thumbsHtml}</div>` : ''}`;

    // 참고 소재 썸네일 (top5 중 이미지 있는 것)
    const refThumbsHtml = (p.top5 || []).filter(c => c.thumbnail_url || c.media_url).slice(0, 8).map((c, i) => {
        const rawThumb = c.thumbnail_url || c.media_url || '';
        const rawRef   = c.media_url || c.thumbnail_url || '';
        const refUrl   = _toDirectImageUrl(rawRef) || rawRef;
        const imgHtml  = (typeof buildDriveImgHtml === 'function' && typeof isDriveUrl === 'function' && isDriveUrl(rawThumb))
            ? buildDriveImgHtml(rawThumb, { className: 'gen-ref-thumb', loading: 'lazy' })
            : `<img src="${_toDirectImageUrl(rawThumb) || rawThumb}" class="gen-ref-thumb" loading="lazy" onerror="this.style.opacity='0.12'">`;
        return `<div class="gen-ref-item" data-url="${refUrl}" onclick="_toggleRefItem(this)" title="${c.ad_name || ''}">
            ${imgHtml}
            <span class="gen-ref-rank">${i===0?'🥇':i===1?'🥈':i===2?'🥉':(i+1)+'위'}</span>
            <button class="gen-ref-insert-btn" onclick="event.stopPropagation();_insertRefToPrompt('${refUrl}')">📎 삽입</button>
        </div>`;
    }).join('') || '<p class="text-xs text-slate-400 py-2">소재 없음</p>';

    return `
    <!-- ① 제품 필터 바 -->
    <div class="gen-product-filter-bar">
        <i class="fas fa-cube text-indigo-500 flex-shrink-0"></i>
        <span class="gen-product-filter-label">제품 선택</span>
        <select id="gen-product-filter-sel" class="gen-product-filter-sel">
            <option value="">전체 제품</option>
            ${productOptions}
        </select>
        ${p.selectedProduct ? `<span class="gen-product-filter-badge">${p.selectedProduct}</span>` : `<span class="text-xs text-slate-400">제품 선택 시 해당 소재만 분석</span>`}
    </div>

    <!-- ② 워킹 패턴 분석 -->
    <div class="gen-section">
        <div class="gen-section-header">
            <i class="fas fa-trophy text-amber-500"></i>
            <span>워킹 패턴 분석</span>
            <span class="gen-section-sub">
                ${p.selectedProduct ? `<b>${p.selectedProduct}</b> ·` : 'ROAS 기준 BEST ·'}
                ${p.top5?.length || 0}개 소재
            </span>
        </div>
        ${patternInner}
    </div>

    <!-- ③ 제품 정보 -->
    <div class="gen-section">
        <div class="gen-section-header">
            <i class="fas fa-box-open text-indigo-500"></i>
            <span>제품 정보</span>
            <span class="gen-section-sub">소재 생성 타겟 제품</span>
        </div>
        <div class="gen-product-inputs">
            <div class="gen-input-group">
                <label class="gen-input-label">제품명 <span class="font-normal text-slate-400">(생성에 반영)</span></label>
                <input id="gen-product-name" type="text" class="gen-input"
                    placeholder="예: 립글로스 세트"
                    value="${(p.selectedProduct || '').replace(/"/g,'&quot;')}">
            </div>
            <div class="gen-input-group">
                <label class="gen-input-label">제품 이미지 URL <span class="font-normal text-slate-400">(선택)</span></label>
                <input id="gen-product-image" type="url" class="gen-input" placeholder="https://drive.google.com/...">
            </div>
        </div>
    </div>

    <!-- ④ 참고 소재 -->
    <div class="gen-section">
        <div class="gen-section-header">
            <i class="fas fa-images text-emerald-500"></i>
            <span>참고 소재</span>
            <span class="gen-section-sub">클릭해서 선택 → AI가 스타일 학습</span>
        </div>
        <div class="mt-2 space-y-3">
            <div>
                <p class="gen-input-label mb-2">
                    <i class="fas fa-trophy text-amber-500 mr-1"></i>
                    ROAS 상위 소재 <span class="font-normal text-slate-400">(클릭해서 선택)</span>
                </p>
                <div class="flex gap-2 flex-wrap" id="gen-top-refs">${refThumbsHtml}</div>
                <p class="text-xs text-slate-400 mt-1.5">선택한 소재의 스타일·구도를 참고해서 생성합니다</p>
            </div>
            <div>
                <p class="gen-input-label mb-1">
                    <i class="fas fa-link text-indigo-400 mr-1"></i>
                    직접 URL 추가 <span class="font-normal text-slate-400">(Drive 파일 링크 — 줄바꿈 구분)</span>
                </p>
                <textarea id="gen-reference-urls" rows="2" class="gen-input font-mono text-xs"
                    placeholder="https://drive.google.com/file/d/xxxxxx/view"
                    style="resize:vertical">${localStorage.getItem('hf_reference_urls') || ''}</textarea>
                <div class="flex items-center justify-between mt-1">
                    <p class="text-xs text-slate-400">Drive 링크 → 자동 변환됨</p>
                    <button id="gen-save-refs" class="text-xs text-indigo-600 font-semibold hover:underline">저장</button>
                </div>
            </div>
            <div id="gen-ref-preview" class="flex gap-2 flex-wrap items-center"></div>
        </div>
    </div>

    <!-- ⑤ 연결 설정 -->
    <div class="gen-section">
        <div class="gen-section-header">
            <i class="fas fa-plug text-amber-500"></i>
            <span>연결 설정</span>
        </div>
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
                    placeholder="abc123:xxxxxxxxxxxxxxxx" value="${savedKey}">
                <button id="gen-save-key" class="gen-btn-copy whitespace-nowrap">
                    <i class="fas fa-save mr-1.5"></i>저장
                </button>
            </div>
            ${savedKey ? `<p class="text-xs text-emerald-600 mt-1 flex items-center gap-1"><i class="fas fa-circle-check"></i> 저장됨: ${maskedKey}</p>` : ''}
        </div>
        <div class="mt-4">
            <div class="flex items-center justify-between mb-1">
                <label class="gen-input-label">Vercel 배포 URL <span class="text-slate-400 font-normal">(필수)</span></label>
                <a href="https://vercel.com/new" target="_blank"
                   class="text-xs text-indigo-500 hover:text-indigo-700 font-semibold flex items-center gap-1">
                    <i class="fas fa-external-link-alt text-[10px]"></i> Vercel 배포
                </a>
            </div>
            <div class="flex gap-2">
                <input id="gen-vercel-url" type="url" class="gen-input flex-1"
                    placeholder="https://creative-dashboard-xxx.vercel.app"
                    value="${localStorage.getItem('hf_vercel_url') || ''}">
                <button id="gen-save-vercel" class="gen-btn-copy whitespace-nowrap">
                    <i class="fas fa-save mr-1.5"></i>저장
                </button>
            </div>
            ${(localStorage.getItem('hf_vercel_url') || '')
                ? `<p class="text-xs text-emerald-600 mt-1 flex items-center gap-1"><i class="fas fa-circle-check"></i> Vercel 연결됨 ✅</p>`
                : `<div class="mt-2 p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800 space-y-1">
                    <p class="font-semibold">⚡ Vercel 설정 방법 (2분)</p>
                    <p>1. <a href="https://vercel.com" target="_blank" class="underline">vercel.com</a> → GitHub 로그인</p>
                    <p>2. "Add New Project" → 이 저장소(creative-dashboard) 선택</p>
                    <p>3. Settings → Environment Variables → <code class="bg-amber-100 px-1 rounded">HF_CREDENTIALS</code> 추가</p>
                    <p>4. Deploy → 완료 후 URL 복붙</p>
                   </div>`}
        </div>
    </div>

    <!-- ⑥ 생성 브리프 & 결과 -->
    <div class="gen-section">
        <div class="gen-section-header">
            <i class="fas fa-wand-magic-sparkles text-pink-500"></i>
            <span>생성 브리프 & 결과</span>
            <button id="gen-refresh-btn" class="ml-auto text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 transition">
                <i class="fas fa-rotate-right"></i> 분석 새로고침
            </button>
        </div>
        <!-- 참조 이미지 상태 표시 -->
        <div id="gen-ref-status" class="mb-2"></div>
        <div id="gen-brief-image">
            <div id="gen-prompt-image"
                class="gen-prompt-editor"
                contenteditable="true"
                spellcheck="false"
                data-placeholder="프롬프트 자동 생성 중... ✦ 이미지를 여기에 Ctrl+V 붙여넣거나 드래그하세요"></div>
            <p class="text-xs text-slate-400 mt-1 mb-2 flex items-center gap-1.5">
                <i class="fas fa-image text-indigo-400"></i>
                이미지 <b class="text-slate-500">Ctrl+V 붙여넣기</b> · <b class="text-slate-500">드래그 앤 드롭</b> · 아래 썸네일 <b class="text-slate-500">📎 삽입</b> 버튼
            </p>
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
            <div id="gen-result-image" class="gen-result-area hidden"></div>
        </div>
    </div>`;
}

// ============================
// 이벤트 바인딩
// ============================
function _bindGeneratePanelEvents() {
    document.getElementById('gen-refresh-btn')?.addEventListener('click', () => {
        _genProductFilter = '';  // 새로고침 시 제품 필터 초기화
        renderGeneratePanel();
    });

    // 제품 필터 변경 → 즉시 재렌더
    document.getElementById('gen-product-filter-sel')?.addEventListener('change', (e) => {
        _genProductFilter = e.target.value;
        renderGeneratePanel();
    });

    // API 키 저장
    document.getElementById('gen-save-key')?.addEventListener('click', () => {
        const key = document.getElementById('gen-api-key')?.value?.trim();
        if (!key) return genToast('API 키를 입력해주세요.', 2500);
        _saveHfKey(key);
        genToast('✅ API 키가 저장됐어요!');
        renderGeneratePanel();
    });

    document.getElementById('gen-save-vercel')?.addEventListener('click', () => {
        const url = document.getElementById('gen-vercel-url')?.value?.trim();
        if (!url) return genToast('Vercel URL을 입력해주세요.', 2500);
        localStorage.setItem(HF_VERCEL_KEY, url.replace(/\/$/, ''));
        genToast('✅ Vercel URL이 저장됐어요!');
        renderGeneratePanel();
    });

    // 제품 정보 변경 시 프롬프트 갱신
    ['gen-product-name', 'gen-product-image'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', _refreshPrompts);
    });

    // 참고 소재 저장
    document.getElementById('gen-save-refs')?.addEventListener('click', () => {
        const val = document.getElementById('gen-reference-urls')?.value || '';
        localStorage.setItem('hf_reference_urls', val);
        _updateRefPreview();
        genToast('✅ 참고 소재가 저장됐어요!');
    });

    // 복사 / 생성 버튼
    document.getElementById('gen-copy-image')?.addEventListener('click', () => _copyPrompt('image'));
    document.getElementById('gen-generate-image')?.addEventListener('click', () => _triggerGenerate('image'));

    // 초기 미리보기 + 저장된 선택 복원
    _restoreRefSelections();
    _updateRefPreview();
    _updateRefStatus();

    // 프롬프트 에디터 초기화 (이미지 붙여넣기/드롭)
    _initPromptEditor();
}

// ROAS 상위 소재 썸네일 클릭 토글
function _toggleRefItem(el) {
    el.classList.toggle('selected');
    const selected = [...document.querySelectorAll('#gen-top-refs .gen-ref-item.selected')]
        .map(e => e.dataset.url).filter(Boolean)
        .map(u => _toDirectImageUrl(u) || u);
    const manual = (document.getElementById('gen-reference-urls')?.value || '')
        .split('\n').map(l => _toDirectImageUrl(l.trim())).filter(Boolean);
    const all = [...new Set([...selected, ...manual])].slice(0, 10);
    localStorage.setItem('hf_reference_urls', all.join('\n'));
    _updateRefPreview();
    _updateRefStatus();
    const count = all.length;
    if (el.classList.contains('selected')) {
        genToast(`✅ 참고 소재 추가됨 (총 ${count}개)`, 2000);
    }
}
window._toggleRefItem = _toggleRefItem;

// 패널 재렌더 시 저장된 URL과 일치하는 썸네일 자동 선택
function _restoreRefSelections() {
    const saved = (localStorage.getItem('hf_reference_urls') || '').split('\n').filter(Boolean);
    document.querySelectorAll('#gen-top-refs .gen-ref-item').forEach(el => {
        const url = el.dataset.url || '';
        const direct = _toDirectImageUrl(url) || url;
        if (saved.some(s => s === url || s === direct)) {
            el.classList.add('selected');
        }
    });
}

function _selectAllRefs() {
    document.querySelectorAll('#gen-top-refs .gen-ref-item').forEach(el => el.classList.add('selected'));
    const selected = [...document.querySelectorAll('#gen-top-refs .gen-ref-item')]
        .map(e => _toDirectImageUrl(e.dataset.url) || e.dataset.url).filter(Boolean);
    localStorage.setItem('hf_reference_urls', selected.slice(0, 10).join('\n'));
    _updateRefPreview();
    genToast(`✅ 전체 ${selected.length}개 선택됨`);
}
window._selectAllRefs = _selectAllRefs;

function _applySelectedRefs() {
    const selected = [...document.querySelectorAll('#gen-top-refs .gen-ref-item.selected')]
        .map(e => _toDirectImageUrl(e.dataset.url) || e.dataset.url).filter(Boolean);
    const manual = (document.getElementById('gen-reference-urls')?.value || '')
        .split('\n').map(l => _toDirectImageUrl(l.trim())).filter(Boolean);
    const all = [...new Set([...selected, ...manual])].slice(0, 10);
    localStorage.setItem('hf_reference_urls', all.join('\n'));
    _updateRefPreview();
    genToast(`✅ 참고 소재 ${all.length}개 적용!`);
}
window._applySelectedRefs = _applySelectedRefs;

function _updateRefPreview() {
    const previewEl = document.getElementById('gen-ref-preview');
    if (!previewEl) return;

    // 자동(현재 제품 top3) + 수동(사용자 선택)
    const autoUrls   = (_genPatterns?.top5 || [])
        .filter(c => c.media_url || c.thumbnail_url).slice(0, 3)
        .map(c => _toDirectImageUrl(c.media_url || c.thumbnail_url)).filter(Boolean);
    const manualUrls = _getReferenceUrls();
    const extraUrls  = manualUrls.filter(u => !autoUrls.includes(u));
    const allUrls    = [...autoUrls, ...extraUrls].slice(0, 5);

    if (!allUrls.length) {
        previewEl.innerHTML = `<p class="text-xs text-slate-400 italic">소재 데이터 없음</p>`;
        return;
    }

    const autoCount  = autoUrls.length;
    const extraCount = extraUrls.length;

    function _previewImgHtml(u, badge, borderColor) {
        const inner = (typeof buildDriveImgHtml === 'function' && typeof isDriveUrl === 'function' && isDriveUrl(u))
            ? buildDriveImgHtml(u, { loading: 'lazy', extraAttrs: 'style="width:100%;height:100%;object-fit:cover"' })
            : `<img src="${u}" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="this.style.opacity='0.2'">`;
        return `<div class="relative w-14 h-14 rounded-lg overflow-hidden border-2 ${borderColor} bg-slate-100 flex-shrink-0">
            ${inner}
            <span style="position:absolute;bottom:2px;right:2px;background:${badge==='AUTO'?'#4f46e5':'#059669'};color:#fff;font-size:7px;padding:1px 3px;border-radius:3px;font-weight:700;line-height:1.4">${badge}</span>
        </div>`;
    }

    previewEl.innerHTML =
        autoUrls.map(u => _previewImgHtml(u, 'AUTO', 'border-indigo-300')).join('')
        + extraUrls.map(u => _previewImgHtml(u, '+', 'border-emerald-400')).join('')
        + `<div class="self-center ml-1 text-xs leading-5">
            <p class="text-indigo-600 font-semibold">⚡ ${autoCount}개 자동 (${_genPatterns?.selectedProduct || _genPatterns?.brand || '현재 컨텍스트'})</p>
            ${extraCount > 0 ? `<p class="text-emerald-600 font-semibold">✅ ${extraCount}개 수동 추가</p>` : ''}
           </div>`;
}

// 프롬프트 섹션 상단 - 참조 이미지 현황 배지
function _updateRefStatus() {
    const el = document.getElementById('gen-ref-status');
    if (!el) return;

    const autoUrls  = (_genPatterns?.top5 || [])
        .filter(c => c.media_url || c.thumbnail_url).slice(0, 3)
        .map(c => _toDirectImageUrl(c.media_url || c.thumbnail_url)).filter(Boolean);
    const manualUrls = _getReferenceUrls();
    const total      = new Set([...autoUrls, ...manualUrls]).size;
    const ctx        = _genPatterns?.selectedProduct
        ? `${_genPatterns.brand} › ${_genPatterns.selectedProduct}`
        : (_genPatterns?.brand || '현재 필터');

    if (total === 0) {
        el.innerHTML = `<div class="gen-ref-status-none">
            <i class="fas fa-image opacity-40"></i>
            <span>소재 이미지 없음 — 위에서 ROAS 상위 소재를 선택하거나 데이터를 확인하세요</span>
        </div>`;
        return;
    }
    el.innerHTML = `<div class="gen-ref-status-auto">
        <i class="fas fa-bolt"></i>
        <span>
            <b>${ctx}</b> ROAS 상위 ${autoUrls.length}개 소재 자동 참조 중
            ${manualUrls.length > 0 ? `+ 수동 ${manualUrls.length}개` : ''} —
            AI가 구도·색감·카피 스타일을 학습해서 생성합니다
        </span>
    </div>`;
}

function _switchGenTab(type) {
    _genCurrentTab = type;
    document.getElementById('gen-tab-image')?.classList.toggle('active', type === 'image');
    document.getElementById('gen-tab-video')?.classList.toggle('active', type === 'video');
    document.getElementById('gen-brief-image')?.classList.toggle('hidden', type !== 'image');
    document.getElementById('gen-brief-video')?.classList.toggle('hidden', type !== 'video');
}

// ── 프롬프트 에디터 초기화 (이미지 붙여넣기 / 드래그앤드롭) ──────────────
function _initPromptEditor() {
    const editor = document.getElementById('gen-prompt-image');
    if (!editor) return;

    // Ctrl+V 붙여넣기
    editor.addEventListener('paste', (e) => {
        const items = [...(e.clipboardData?.items || [])];
        const imgItem = items.find(it => it.type.startsWith('image/'));
        if (!imgItem) return; // 텍스트는 기본 동작 유지
        e.preventDefault();
        const file = imgItem.getAsFile();
        const reader = new FileReader();
        reader.onload = (ev) => _insertImgChip(editor, ev.target.result);
        reader.readAsDataURL(file);
    });

    // 드래그오버
    editor.addEventListener('dragover', (e) => {
        e.preventDefault();
        editor.classList.add('drag-over');
    });
    editor.addEventListener('dragleave', () => editor.classList.remove('drag-over'));

    // 드롭 (파일 or URL)
    editor.addEventListener('drop', (e) => {
        e.preventDefault();
        editor.classList.remove('drag-over');
        const files = [...(e.dataTransfer.files || [])].filter(f => f.type.startsWith('image/'));
        if (files.length) {
            files.forEach(f => {
                const reader = new FileReader();
                reader.onload = (ev) => _insertImgChip(editor, ev.target.result);
                reader.readAsDataURL(f);
            });
            return;
        }
        const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (url?.startsWith('http')) _insertImgChip(editor, url);
    });
}

// 에디터 커서 위치에 이미지 칩 삽입
function _insertImgChip(editor, src) {
    editor.focus();
    const chip = document.createElement('span');
    chip.className = 'prompt-img-chip';
    chip.contentEditable = 'false';

    const img = document.createElement('img');
    img.src = src;
    img.className = 'prompt-img-thumb';
    img.alt = '';

    const del = document.createElement('button');
    del.className = 'prompt-img-del';
    del.innerHTML = '×';
    del.type = 'button';
    del.addEventListener('click', (e) => { e.stopPropagation(); chip.remove(); });

    chip.appendChild(img);
    chip.appendChild(del);

    const sel = window.getSelection();
    if (sel?.rangeCount && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(chip);
        range.setStartAfter(chip);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    } else {
        editor.appendChild(chip);
    }
    genToast('📎 이미지 삽입됨', 1500);
}

// 외부(썸네일 삽입 버튼)에서 호출
function _insertRefToPrompt(url) {
    const editor = document.getElementById('gen-prompt-image');
    if (!editor) return;
    _insertImgChip(editor, _toDirectImageUrl(url) || url);
}
window._insertRefToPrompt = _insertRefToPrompt;

// 에디터 텍스트 추출 (이미지 칩 제외)
function _getEditorText(editor) {
    if (!editor) return '';
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('.prompt-img-chip').forEach(c => c.remove());
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    clone.querySelectorAll('div, p').forEach(el => {
        el.insertAdjacentText('afterend', '\n');
        el.replaceWith(...el.childNodes);
    });
    return clone.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

// 에디터에서 인라인 이미지 URL 추출
function _getEditorImages(editor) {
    if (!editor) return [];
    return [...editor.querySelectorAll('.prompt-img-chip img')].map(i => i.src).filter(Boolean);
}

function _refreshPrompts() {
    if (!_genPatterns) return;
    const productName     = document.getElementById('gen-product-name')?.value  || '';
    const productImageUrl = document.getElementById('gen-product-image')?.value || '';

    const editor = document.getElementById('gen-prompt-image');
    if (editor) {
        // 이미 삽입된 이미지 칩 보존
        const existingChips = [...editor.querySelectorAll('.prompt-img-chip')].map(c => c.cloneNode(true));
        const newText = buildHiggsfieldPrompt(_genPatterns, productName, productImageUrl, 'image');
        // 텍스트를 안전하게 HTML 인코딩해서 세팅
        editor.innerHTML = newText
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
        // 칩 복원
        if (existingChips.length) {
            editor.appendChild(document.createElement('br'));
            existingChips.forEach(chip => {
                // 삭제 버튼 이벤트 재연결
                chip.querySelector('.prompt-img-del')?.addEventListener('click', (e) => {
                    e.stopPropagation(); chip.remove();
                });
                editor.appendChild(chip);
            });
        }
    }

    const vidTA = document.getElementById('gen-prompt-video');
    if (vidTA) vidTA.value = buildHiggsfieldPrompt(_genPatterns, productName, productImageUrl, 'video');
}

function _copyPrompt(type) {
    const editor = document.getElementById(`gen-prompt-${type}`);
    if (!editor) return;
    const text = type === 'image' ? _getEditorText(editor) : (editor.value || '');
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
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
    const prompt   = type === 'image' ? _getEditorText(promptEl) : (promptEl?.value?.trim() || '');
    if (!prompt) {
        genToast('프롬프트가 비어있어요.', 2500);
        return;
    }
    // 에디터에 직접 삽입된 이미지를 참고 소재로 추가
    const inlineImgs = type === 'image' ? _getEditorImages(promptEl) : [];

    // 크레딧 경고 (영상은 더 많이 소모)
    const creditCost = type === 'video' ? '~25 크레딧 (이미지+영상 2단계)' : '~2 크레딧';
    if (!confirm(`생성하면 Higgsfield 크레딧이 소모됩니다.\n예상 비용: ${creditCost}\n\n계속하시겠어요?`)) return;

    const aspectEl = document.getElementById(`gen-aspect-${type}`);
    const aspect   = aspectEl?.value || '9:16';
    const resultEl = document.getElementById(`gen-result-${type}`);
    const genBtn   = document.getElementById(`gen-generate-${type}`);

    // UI → 로딩 상태
    _setGenerating(type, true);
    _showResultLoading(resultEl, type);

    try {
        if (type === 'video') {
            // 영상: 브라우저가 직접 2단계 조율
            // Step1: 이미지 생성
            genToast('⏳ [1/2] 이미지 생성 중...', 0);
            const imgResult = await _callHiggsfieldGenerate(prompt, 'image', aspect);
            let imageUrl = typeof imgResult === 'string' ? imgResult : null;

            if (!imageUrl && (imgResult?.requestId || imgResult?.statusUrl)) {
                imageUrl = await _pollUntilUrl(imgResult.requestId, imgResult.statusUrl, 'image', resultEl);
            }
            if (!imageUrl) throw new Error('소스 이미지 생성 실패');

            // Step2: 이미지→영상 변환 (안전한 짧은 프롬프트 사용)
            genToast('⏳ [2/2] 영상 변환 중... (1분 소요)', 0);
            const vercelBase = _getVercelBase();
            // NSFW 오탐 방지: 첫 문장만 추출해서 간결하게
            const safePrompt = prompt.split('\n')[0].slice(0, 120);
            const vidRes = await fetch(`${vercelBase}/api/hf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: safePrompt, aspect_ratio: aspect, type: 'video-step2', imageUrl }),
            });
            const vidData = await vidRes.json();
            if (!vidRes.ok) throw new Error(`영상 변환 실패: ${vidData.error || vidRes.status}`);

            const videoUrl = vidData.url || null;
            if (videoUrl) {
                _showResultSuccess(resultEl, videoUrl, 'video');
            } else if (vidData.requestId) {
                const finalUrl = await _pollUntilUrl(vidData.requestId, vidData.statusUrl, 'video', resultEl);
                if (finalUrl) _showResultSuccess(resultEl, finalUrl, 'video');
                else _showResultError(resultEl, '영상 URL을 받지 못했어요.');
            }
        } else {
            // 이미지: 기존 흐름
            const result = await _callHiggsfieldGenerate(prompt, type, aspect, inlineImgs);
            if (result && typeof result === 'string') {
                _showResultSuccess(resultEl, result, type);
            } else if (result?.requestId || result?.statusUrl) {
                genToast('⏳ 이미지 생성 중... 잠시 기다려주세요.', 0);
                await _pollUntilDone(result.requestId, result.statusUrl, type, resultEl);
            }
        }
    } catch (e) {
        _showResultError(resultEl, e.message);
        genToast(`❌ ${e.message}`, 4000);
        console.error('[HF Generate]', e);
    } finally {
        _setGenerating(type, false);
    }
}

// ============================
// 영상 변환 (이미지 → 영상)
// ============================
async function _triggerVideoConvert(imageUrl) {
    if (!confirm('이 이미지로 영상을 만들까요?\n예상 비용: ~25 크레딧\n\n계속하시겠어요?')) return;

    const btn = document.getElementById('gen-to-video-btn');
    const resultEl = document.getElementById('gen-video-from-image');
    if (!resultEl) return;

    // 버튼 로딩 상태
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>영상 변환 중...'; }
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `<div class="gen-result-loading">
        <div class="gen-spinner"></div>
        <p class="text-sm text-slate-500 mt-2">영상 변환 중... (보통 30~60초)</p>
    </div>`;

    const prompt = _getEditorText(document.getElementById('gen-prompt-image'));
    const aspect = document.getElementById('gen-aspect-image')?.value || '1:1';
    const safePrompt = prompt.split('\n')[0].slice(0, 120);
    const vercelBase = _getVercelBase();

    try {
        const res = await fetch(`${vercelBase}/api/hf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: safePrompt, aspect_ratio: aspect, type: 'video-step2', imageUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `${res.status}`);

        let videoUrl = data.url || null;
        if (!videoUrl && data.requestId) {
            videoUrl = await _pollUntilUrl(data.requestId, data.statusUrl, 'video', resultEl);
        }

        if (videoUrl) {
            _showResultSuccess(resultEl, videoUrl, 'video');
        } else {
            resultEl.innerHTML = `<div class="gen-result-error"><i class="fas fa-triangle-exclamation text-rose-400"></i><span>영상 변환 결과를 받지 못했어요.</span></div>`;
        }
    } catch (e) {
        resultEl.innerHTML = `<div class="gen-result-error"><i class="fas fa-triangle-exclamation text-rose-400"></i><span>${e.message}</span></div>`;
        genToast(`❌ ${e.message}`, 4000);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-video mr-2"></i>이 이미지로 영상 만들기 <span class="text-violet-200 font-normal text-xs">(~25 크레딧)</span>'; }
    }
}
window._triggerVideoConvert = _triggerVideoConvert;

// 폴링하면서 URL 반환 (영상 2단계용)
async function _pollUntilUrl(requestId, statusUrl, type, resultEl) {
    const start = Date.now();
    while (Date.now() - start < HF_MAX_WAIT) {
        await new Promise(r => setTimeout(r, HF_POLL_MS));
        try {
            const data = await _pollHiggsfieldStatus(requestId, statusUrl);
            console.log(`[Poll ${type}] status=${data.status}`, JSON.stringify(data).slice(0, 600));
            if (data.status === 'completed') {
                const url = _extractResultUrl(data, type);
                console.log(`[Poll ${type}] FULL URL=`, url);
                console.log(`[Poll ${type}] ALL FIELDS=`, JSON.stringify(data));
                return url;
            }
            if (data.status === 'failed' || data.status === 'nsfw') return null;
            _updateResultProgress(resultEl, Math.round((Date.now() - start) / 1000));
        } catch (e) { console.warn('[Poll error]', e.message); }
    }
    return null;
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
        // 영상 결과 (변환 완료)
        const isVideo = url && (url.endsWith('.mp4') || url.endsWith('.webm') || url.endsWith('.mov'));
        el.innerHTML = `
            <div class="gen-result-success">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-sm font-bold text-emerald-700 flex items-center gap-1.5">
                        <i class="fas fa-circle-check"></i> 영상 변환 완료!
                    </span>
                    <a href="${url}" target="_blank" download
                       class="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1">
                        <i class="fas fa-download"></i> 다운로드
                    </a>
                </div>
                ${isVideo
                    ? `<video src="${url}" controls autoplay muted loop playsinline class="gen-result-media"></video>`
                    : `<img src="${url}" alt="생성된 영상 소재" class="gen-result-media" loading="lazy">`
                }
            </div>`;
        genToast('🎬 영상 변환 완료!', 3000);
    } else {
        // 이미지 결과 + 영상 변환 옵션
        const safeUrl = url.replace(/'/g, "\\'");
        el.innerHTML = `
            <div class="gen-result-success">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-sm font-bold text-emerald-700 flex items-center gap-1.5">
                        <i class="fas fa-circle-check"></i> 이미지 생성 완료!
                    </span>
                    <a href="${url}" target="_blank" download
                       class="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1">
                        <i class="fas fa-download"></i> 다운로드
                    </a>
                </div>
                <img src="${url}" alt="생성된 광고 이미지" class="gen-result-media" loading="lazy">
                <!-- 영상 변환 버튼 -->
                <div class="mt-3 pt-3 border-t border-slate-200">
                    <button id="gen-to-video-btn"
                        onclick="_triggerVideoConvert('${safeUrl}')"
                        class="w-full py-2.5 px-4 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition">
                        <i class="fas fa-video"></i> 이 이미지로 영상 만들기
                        <span class="text-violet-200 font-normal text-xs">(~25 크레딧)</span>
                    </button>
                </div>
                <!-- 영상 변환 결과 -->
                <div id="gen-video-from-image" class="mt-3 hidden"></div>
            </div>`;
        genToast('✨ 이미지 생성 완료!', 3000);
    }
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
