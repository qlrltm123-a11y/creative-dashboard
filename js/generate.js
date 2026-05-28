// ============================
// 광고 생성 패널 — Higgsfield 연동 브리프
// ============================

let _genPatterns   = null;
let _genCurrentTab = 'image';

// ---- 토스트 알림 (generate 전용) ----
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

// ---- 워킹 패턴 추출 ----
function getWinningPatterns() {
    let data = Array.isArray(window.allCreatives) ? [...window.allCreatives]
             : (typeof allCreatives !== 'undefined' && Array.isArray(allCreatives)) ? [...allCreatives] : [];
    if (!data.length) return null;

    // 현재 전역 필터 적용
    if (typeof currentBrand !== 'undefined' && currentBrand && currentBrand !== 'ALL')
        data = data.filter(c => c.brand === currentBrand);
    if (typeof currentPlatform !== 'undefined' && currentPlatform)
        data = data.filter(c => (c.platform || '').toString().trim() === currentPlatform);
    if (typeof currentEvent !== 'undefined' && currentEvent)
        data = data.filter(c => (c.event || '').toString().trim() === currentEvent);

    // ad_name 단위 집계
    if (typeof aggregateByAdName === 'function') data = aggregateByAdName(data);

    // ROAS 기준 TOP5, 없으면 CTR 기준
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
            arr.forEach(tag => {
                if (!tag || tag.startsWith('❌')) return;
                counter.set(tag, (counter.get(tag) || 0) + 1);
            });
        });
        return [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(e => e[0]);
    }

    const avgRoas = top5.reduce((s, c) => s + (c.roas || 0), 0) / top5.length;
    const avgCtr  = top5.reduce((s, c) => s + (c.ctr  || 0), 0) / top5.length;

    return {
        top5,
        topAppeal:  extractTopTags(top5, 'appeal_points', 6),
        topHook:    extractTopTags(top5, 'hook_type', 4),
        topEmotion: extractTopTags(top5, 'target_emotion', 4),
        avgRoas, avgCtr,
        brand: (typeof currentBrand !== 'undefined' && currentBrand && currentBrand !== 'ALL')
            ? currentBrand : (top5[0]?.brand || ''),
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
    const platformNote = patterns.platform ? `\nOptimized for ${patterns.platform} feed ad placement.` : '';
    const imgNote  = productImageUrl ? `\nProduct image reference: ${productImageUrl}` : '';

    if (type === 'video') {
        return `Create a high-converting DTC video advertisement for ${brand}'s ${product}.${imgNote}

⏱ Opening hook (0–2s): ${hookMain} — stop-the-scroll moment
🎯 Core appeal message: ${appeals}
💭 Emotional journey: ${emotions}
📣 CTA: Clear, compelling call-to-action at the end${platformNote}

Visual style: Fast-paced cuts, bright product showcase, text overlay with key value proposition. Premium aesthetic matching ${brand} brand identity.

Target performance: ROAS ${roas}%+ | CTR ${ctr}%+ (based on BEST TOP5 analysis)`;
    } else {
        return `Create a high-converting DTC advertisement image for ${brand}'s ${product}.${imgNote}

🎯 Key appeal points: ${appeals}
🪝 Visual hook strategy: ${hookMain}
💭 Target emotional response: ${emotions}${platformNote}

Composition: Product prominently featured with lifestyle context. Eye-catching text overlay with key value proposition and pricing.
Style: Clean, aspirational, bright colors matching ${brand} aesthetic.

Target performance: ROAS ${roas}% | CTR ${ctr}% (BEST TOP5 baseline)`;
    }
}

// ---- 패널 HTML 생성 ----
function _buildGeneratePanelHTML(p) {
    function rankBadge(tag, idx) {
        const styles = [
            'gen-tag-1', 'gen-tag-2', 'gen-tag-3', 'gen-tag-4', 'gen-tag-5', 'gen-tag-6'
        ];
        const rankIcon = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
        return `<span class="gen-tag ${styles[idx % styles.length]}">${rankIcon} ${tag}</span>`;
    }

    const thumbsHtml = p.top5
        .filter(c => c.thumbnail_url)
        .map((c, i) => `<div class="gen-thumb" title="${c.ad_name || ''}">
            <img src="${c.thumbnail_url}" alt="" loading="lazy">
            <span class="gen-thumb-rank">${i + 1}</span>
        </div>`).join('');

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
                    ${p.topAppeal.length ? p.topAppeal.map((t, i) => rankBadge(t, i)).join('') : '<span class="text-slate-400 text-xs">데이터 없음</span>'}
                </div>
            </div>
            <div class="gen-pattern-card">
                <div class="gen-pattern-title"><i class="fas fa-fish text-cyan-500 mr-1.5"></i>후킹 전략</div>
                <div class="gen-tag-list">
                    ${p.topHook.length ? p.topHook.map((t, i) => rankBadge(t, i)).join('') : '<span class="text-slate-400 text-xs">데이터 없음</span>'}
                </div>
            </div>
            <div class="gen-pattern-card">
                <div class="gen-pattern-title"><i class="fas fa-heart text-rose-500 mr-1.5"></i>타겟 감정</div>
                <div class="gen-tag-list">
                    ${p.topEmotion.length ? p.topEmotion.map((t, i) => rankBadge(t, i)).join('') : '<span class="text-slate-400 text-xs">데이터 없음</span>'}
                </div>
            </div>
        </div>

        <div class="gen-benchmark-bar">
            <div class="gen-benchmark-item">
                <span class="gen-benchmark-label">ROAS 평균</span>
                <span class="gen-benchmark-value" style="color:#7c3aed">${Math.round(p.avgRoas * 100)}%</span>
            </div>
            <div class="gen-benchmark-item">
                <span class="gen-benchmark-label">CTR 평균</span>
                <span class="gen-benchmark-value" style="color:#2563eb">${(p.avgCtr * 100).toFixed(2)}%</span>
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
                <input id="gen-product-name" type="text" class="gen-input"
                    placeholder="예: ShinchanSET 립글로스 세트">
            </div>
            <div class="gen-input-group">
                <label class="gen-input-label">제품 이미지 URL <span class="font-normal text-slate-400">(선택)</span></label>
                <input id="gen-product-image" type="url" class="gen-input"
                    placeholder="https://drive.google.com/...">
            </div>
        </div>
    </div>

    <!-- 힉스필드 브리프 -->
    <div class="gen-section">
        <div class="gen-section-header">
            <i class="fas fa-wand-magic-sparkles text-pink-500"></i>
            <span>힉스필드 생성 브리프</span>
            <button id="gen-refresh-btn" class="ml-auto text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 transition">
                <i class="fas fa-rotate-right"></i> 새로고침
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

        <div id="gen-brief-image">
            <textarea id="gen-prompt-image" class="gen-prompt-textarea" rows="11" readonly spellcheck="false"></textarea>
            <div class="gen-actions">
                <button id="gen-copy-image" class="gen-btn-copy">
                    <i class="fas fa-copy mr-1.5"></i>프롬프트 복사
                </button>
                <button id="gen-generate-image" class="gen-btn-generate">
                    <i class="fas fa-image mr-1.5"></i>힉스필드 이미지 생성
                </button>
            </div>
        </div>

        <div id="gen-brief-video" class="hidden">
            <textarea id="gen-prompt-video" class="gen-prompt-textarea" rows="11" readonly spellcheck="false"></textarea>
            <div class="gen-actions">
                <button id="gen-copy-video" class="gen-btn-copy">
                    <i class="fas fa-copy mr-1.5"></i>프롬프트 복사
                </button>
                <button id="gen-generate-video" class="gen-btn-generate">
                    <i class="fas fa-video mr-1.5"></i>힉스필드 영상 생성
                </button>
            </div>
        </div>

        <div class="gen-info-box">
            <i class="fas fa-circle-info text-indigo-400 flex-shrink-0 mt-0.5"></i>
            <p class="text-xs text-slate-600 leading-relaxed">
                <b class="text-slate-800">생성 방법</b> —
                "힉스필드 생성" 버튼을 누르면 Claude Code 채팅에 붙여넣을 명령이 클립보드에 복사됩니다.
                Claude Code 채팅창에 붙여넣으면 힉스필드 MCP를 통해 자동으로 광고 소재가 생성돼요.
            </p>
        </div>
    </div>`;
}

// ---- 이벤트 바인딩 ----
function _bindGeneratePanelEvents() {
    const tabImg = document.getElementById('gen-tab-image');
    const tabVid = document.getElementById('gen-tab-video');
    if (tabImg) tabImg.addEventListener('click', () => _switchGenTab('image'));
    if (tabVid) tabVid.addEventListener('click', () => _switchGenTab('video'));

    const refreshBtn = document.getElementById('gen-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', renderGeneratePanel);

    ['gen-product-name', 'gen-product-image'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', _refreshPrompts);
    });

    const copyImg = document.getElementById('gen-copy-image');
    const copyVid = document.getElementById('gen-copy-video');
    if (copyImg) copyImg.addEventListener('click', () => _copyPrompt('image'));
    if (copyVid) copyVid.addEventListener('click', () => _copyPrompt('video'));

    const genImg = document.getElementById('gen-generate-image');
    const genVid = document.getElementById('gen-generate-video');
    if (genImg) genImg.addEventListener('click', () => _sendToHiggsfield('image'));
    if (genVid) genVid.addEventListener('click', () => _sendToHiggsfield('video'));
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
    if (!ta || !ta.value) return;
    navigator.clipboard.writeText(ta.value).then(() => {
        const btn = document.getElementById(`gen-copy-${type}`);
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check mr-1.5"></i>복사됨!';
            btn.classList.add('copied');
            setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
        }
        genToast('프롬프트가 클립보드에 복사됐어요!');
    });
}

function _sendToHiggsfield(type) {
    if (!_genPatterns) return;
    const productName     = document.getElementById('gen-product-name')?.value  || '';
    const productImageUrl = document.getElementById('gen-product-image')?.value || '';
    const prompt = buildHiggsfieldPrompt(_genPatterns, productName, productImageUrl, type);

    const brand   = _genPatterns.brand || '';
    const product = productName || (_genPatterns.sampleName ? _genPatterns.sampleName.split('_')[0] : '제품');
    const typeKo  = type === 'video' ? '영상' : '이미지';

    const claudeCommand = `힉스필드 MCP로 아래 브리프 기반 ${typeKo} 광고 소재 생성해줘.

브랜드: ${brand}
제품: ${product}${productImageUrl ? `\n제품 이미지: ${productImageUrl}` : ''}

[생성 프롬프트]
${prompt}`;

    navigator.clipboard.writeText(claudeCommand).then(() => {
        const btn = document.getElementById(`gen-generate-${type}`);
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = `<i class="fas fa-check mr-1.5"></i>Claude Code에 붙여넣으세요!`;
            btn.classList.add('copied');
            setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 3500);
        }
        genToast('💬 Claude Code 채팅창에 붙여넣으면 힉스필드로 자동 생성돼요!', 4000);
    });
}

// ---- 메인 렌더 ----
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
