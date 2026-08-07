// ============================
// Google Drive URL 자동 변환
// ============================
// 다양한 형태의 Google Drive 링크를 대시보드에서 표시 가능한 URL로 변환

/**
 * Google Drive 파일 ID 추출
 * 지원 형식:
 * - https://drive.google.com/file/d/{ID}/view?usp=sharing
 * - https://drive.google.com/file/d/{ID}/preview
 * - https://drive.google.com/open?id={ID}
 * - https://drive.google.com/uc?id={ID}
 * - https://docs.google.com/document/d/{ID}/...
 */
function extractDriveFileId(url) {
    if (!url || typeof url !== 'string') return null;

    // /file/d/{ID}/ 형식
    let match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];

    // /d/{ID}/ 형식 (docs, sheets 등)
    match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];

    // ?id={ID} 형식
    match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];

    return null;
}

/**
 * Google Drive URL인지 확인
 */
function isDriveUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /drive\.google\.com|docs\.google\.com/.test(url);
}

/**
 * 이미지 표시용 URL 변환
 * Google Drive 링크 → 썸네일 이미지 URL
 */
function convertDriveImageUrl(url) {
    if (!isDriveUrl(url)) return url;
    const id = extractDriveFileId(url);
    if (!id) return url;
    // thumbnail API 사용 (CORS 안전, 빠른 로딩)
    return `https://drive.google.com/thumbnail?id=${id}&sz=w800`;
}

/**
 * 다중 URL fallback 체인 생성
 * Drive 이미지가 첫 URL에서 실패하면 다음 URL로 자동 재시도
 * 순서: thumbnail → lh3 CDN → uc?export=view
 */
function getDriveUrlFallbackChain(url) {
    if (!isDriveUrl(url)) return [url];
    const id = extractDriveFileId(url);
    if (!id) return [url];
    return [
        `https://drive.google.com/thumbnail?id=${id}&sz=w800`,
        `https://lh3.googleusercontent.com/d/${id}=w800`,
        `https://drive.google.com/uc?export=view&id=${id}`,
        `https://drive.google.com/thumbnail?id=${id}&sz=w400`,
    ];
}

/**
 * 다중 fallback 이미지 HTML 생성
 * 첫 URL 실패시 두번째, 세번째 URL로 자동 재시도. 모두 실패해야 finalFallback 표시.
 */
function buildDriveImgHtml(url, opts = {}) {
    const {
        className = '',
        alt = '',
        finalFallbackHtml = '',
        extraAttrs = '',
        loading = 'eager', // ★ 기본값을 eager로: 핵심 시각 정보 (랭킹·프리뷰·TOP 조합) 즉시 로드
    } = opts;
    const chain = getDriveUrlFallbackChain(url);
    // onerror에 데이터 인덱스로 다음 URL 순차 시도
    const chainJson = JSON.stringify(chain).replace(/"/g, '&quot;');
    const fallbackEsc = finalFallbackHtml.replace(/"/g, '&quot;').replace(/'/g, "\\'");
    const onerror = `(function(img){
        try {
            var urls = JSON.parse(img.getAttribute('data-urls'));
            var i = parseInt(img.getAttribute('data-idx')||'0',10) + 1;
            if (i < urls.length) {
                img.setAttribute('data-idx', i);
                img.src = urls[i];
            } else {
                img.outerHTML = '${fallbackEsc}';
            }
        } catch(e) { img.outerHTML = '${fallbackEsc}'; }
    })(this)`.replace(/\s+/g, ' ');
    return `<img src="${chain[0]}" alt="${alt}" class="${className}" loading="${loading}" decoding="async" referrerpolicy="no-referrer" data-urls="${chainJson}" data-idx="0" ${extraAttrs} onerror="${onerror}">`;
}

/**
 * 영상 임베드용 URL 변환
 * Google Drive 영상 링크 → iframe 임베드 URL
 */
function convertDriveVideoUrl(url) {
    if (!isDriveUrl(url)) return url;
    const id = extractDriveFileId(url);
    if (!id) return url;
    return `https://drive.google.com/file/d/${id}/preview`;
}

/**
 * 미디어 HTML 생성 (이미지 or 영상 자동 판별)
 * @param {object} creative - 소재 객체
 * @param {boolean} forModal - 모달용(true) / 카드용(false)
 */
function createMediaElement(creative, forModal = false) {
    const isVideo = creative.media_type === 'video';

    if (isVideo) {
        // 영상 처리
        const videoUrl = creative.video_url || creative.thumbnail_url;

        if (forModal) {
            // 모달: 실제 영상 재생
            if (isDriveUrl(videoUrl)) {
                const embedUrl = convertDriveVideoUrl(videoUrl);
                const driveId = extractDriveFileId(videoUrl);
                const openUrl = driveId ? `https://drive.google.com/file/d/${driveId}/view` : videoUrl;
                const uid = 'drv_' + (driveId || Date.now());
                // iframe 로드 성공 시: 로딩 오버레이 제거 + 로드됨 표시만 (onload는 embed 차단 시에도
                // 발생할 수 있어 신뢰하되, 내용 접근은 불가능한 cross-origin이라 성공 여부 자체는 판단하지 않음)
                const onloadScript = `
                    (function(){
                        var w = document.getElementById('${uid}');
                        if (!w) return;
                        w.setAttribute('data-loaded', '1');
                        w.querySelector('.dv-loading') && w.querySelector('.dv-loading').remove();
                    })()
                `.replace(/\s+/g, ' ');
                // ★ 워치독: iframe onload 이벤트 자체가 발생하지 않는 경우(임베드 차단·네트워크 문제 등)에도
                // 무한 로딩에 빠지지 않도록, onload와 무관하게 삽입 즉시 독립적으로 8초 타이머를 건다.
                // innerHTML로 삽입되는 <script>는 실행되지 않으므로 즉시 onerror가 발생하는 img를 이용해 트리거.
                const watchdogScript = `
                    (function(){
                        setTimeout(function(){
                            var w = document.getElementById('${uid}');
                            if (!w || w.getAttribute('data-loaded') === '1') return;
                            w.querySelector('.dv-loading') && w.querySelector('.dv-loading').remove();
                            w.querySelector('.dv-fallback') && (w.querySelector('.dv-fallback').style.display = 'flex');
                        }, 8000);
                    })()
                `.replace(/\s+/g, ' ');
                return `
                    <div id="${uid}" class="drive-video-wrap">
                        <iframe src="${embedUrl}" allow="autoplay" allowfullscreen frameborder="0" class="dv-iframe" onload="${onloadScript.trim()}"></iframe>
                        <img src="x" alt="" style="display:none" onerror="${watchdogScript.trim()}">
                        <div class="dv-loading">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>영상 로딩 중...</span>
                        </div>
                        <div class="dv-fallback" style="display:none">
                            <i class="fas fa-video-slash"></i>
                            <span>영상을 불러올 수 없습니다</span>
                            <span class="dv-fallback-name">${creative.creative_name || ''}</span>
                        </div>
                        <a href="${openUrl}" target="_blank" rel="noopener" class="dv-open-btn">
                            <i class="fas fa-external-link-alt"></i> Drive에서 열기
                        </a>
                    </div>`;
            } else {
                // 일반 MP4 URL
                return `<video controls playsinline webkit-playsinline autoplay muted><source src="${videoUrl}" type="video/mp4"></video>`;
            }
        } else {
            // 카드: 썸네일 이미지 표시 (다중 fallback 체인)
            if (isDriveUrl(creative.thumbnail_url)) {
                return buildDriveImgHtml(creative.thumbnail_url, {
                    alt: creative.creative_name || '',
                    finalFallbackHtml: `<img src="https://via.placeholder.com/400x400/e2e8f0/64748b?text=No+Preview" alt="${creative.creative_name||''}">`,
                });
            }
            const thumbUrl = convertDriveImageUrl(creative.thumbnail_url);
            return `<img src="${thumbUrl}" alt="${creative.creative_name}" loading="lazy" referrerpolicy="no-referrer" onerror="this.src='https://via.placeholder.com/400x400/e2e8f0/64748b?text=No+Preview'">`;
        }
    } else {
        // 이미지 처리 (다중 fallback 체인)
        if (isDriveUrl(creative.thumbnail_url)) {
            return buildDriveImgHtml(creative.thumbnail_url, {
                alt: creative.creative_name || '',
                finalFallbackHtml: `<img src="https://via.placeholder.com/400x400/e2e8f0/64748b?text=No+Image" alt="${creative.creative_name||''}">`,
            });
        }
        const imgUrl = convertDriveImageUrl(creative.thumbnail_url);
        return `<img src="${imgUrl}" alt="${creative.creative_name}" loading="lazy" referrerpolicy="no-referrer" onerror="this.src='https://via.placeholder.com/400x400/e2e8f0/64748b?text=No+Image'">`;
    }
}

// 전역 노출
window.extractDriveFileId = extractDriveFileId;
window.isDriveUrl = isDriveUrl;
window.convertDriveImageUrl = convertDriveImageUrl;
window.convertDriveVideoUrl = convertDriveVideoUrl;
window.createMediaElement = createMediaElement;
window.getDriveUrlFallbackChain = getDriveUrlFallbackChain;
window.buildDriveImgHtml = buildDriveImgHtml;
