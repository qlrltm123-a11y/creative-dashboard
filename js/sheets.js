// ============================
// Google Sheets Integration
// ============================
const SHEET_URL_KEY = 'gsheet_creative_url';
const FX_RATE_KEY = 'jpy_to_krw_rate';

// 🌟 기본 시트 URL (배포 사이트에서도 자동 로드)
// LocalStorage에 저장된 URL이 없으면 이 URL을 사용
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTVqotU6K1y0u9atjKrRpaFgDamwAdUmxldvBbYepguKNm6MzzRDm5uUMmEGFFw_R3EOxmu1_ihWfKE/pub?gid=1561941261&single=true&output=csv';

// 💴 → 💰 엔화→원화 환율 (기본값: 1엔 = 9.5원, 2025년 5월 기준 근사치)
// LocalStorage에 저장된 값이 있으면 우선 사용 (사용자가 UI에서 변경 가능)
const DEFAULT_FX_JPY_TO_KRW = 9.5;

function getFxRate() {
    try {
        const v = parseFloat(localStorage.getItem(FX_RATE_KEY));
        if (!isNaN(v) && v > 0) return v;
    } catch {}
    return DEFAULT_FX_JPY_TO_KRW;
}

function setFxRate(rate) {
    const r = parseFloat(rate);
    if (isNaN(r) || r <= 0) return false;
    try {
        localStorage.setItem(FX_RATE_KEY, String(r));
        return true;
    } catch { return false; }
}

window.getFxRate = getFxRate;
window.setFxRate = setFxRate;

// CSV 파싱 (쉼표/따옴표 처리)
function parseCSV(text) {
    const rows = [];
    let current = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];

        if (inQuotes) {
            if (ch === '"' && next === '"') {
                field += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                field += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                current.push(field);
                field = '';
            } else if (ch === '\n' || ch === '\r') {
                if (field !== '' || current.length > 0) {
                    current.push(field);
                    rows.push(current);
                    current = [];
                    field = '';
                }
                if (ch === '\r' && next === '\n') i++;
            } else {
                field += ch;
            }
        }
    }
    if (field !== '' || current.length > 0) {
        current.push(field);
        rows.push(current);
    }
    return rows;
}

// 컬럼명 별칭 매핑 (다양한 컬럼명을 통일된 키로 변환)
const COLUMN_ALIASES = {
    // 매체
    'media': 'platform',
    'platform': 'platform',
    '매체': 'platform',
    '플랫폼': 'platform',
    // 비용
    'cost': 'spend',
    'spend': 'spend',
    'ad_spend': 'spend',
    'ad_cost': 'spend',
    '광고비': 'spend',
    '비용': 'spend',
    '집행비': 'spend',
    'amount': 'spend',
    // 매출
    'sales': 'revenue',
    'revenue': 'revenue',
    'sales_amount': 'revenue',
    'total_sales': 'revenue',
    '매출': 'revenue',
    '매출액': 'revenue',
    '판매액': 'revenue',
    // 날짜
    'date': 'start_date',
    'start_date': 'start_date',
    '개시일': 'start_date',
    '날짜': 'start_date',
    '시작일': 'start_date',
    // 미디어 URL (통합)
    'media_url': 'media_url',
    'thumbnail_url': 'thumbnail_url',
    'video_url': 'media_url',
    'url': 'media_url',
    '소재url': 'media_url',
    '소재링크': 'media_url',
    '미디어': 'media_url',
    // 광고명/소재명 (한국어 별칭 강화)
    'creative_name': 'creative_name',
    'ad_name': 'ad_name',
    '광고명': 'ad_name',
    '소재명': 'creative_name',
    '광고소재': 'creative_name',
    '광고소재명': 'creative_name',
    'name': 'creative_name',
    'ad name': 'ad_name',
    // 제품
    'product': 'product',
    '제품': 'product',
    '제품명': 'product',
    // 기타 동일
    'id': 'id',
    'brand': 'brand',
    '브랜드': 'brand',
    'media_type': 'media_type',
    '소재타입': 'media_type',
    'campaign_type': 'campaign_type',
    '캠페인타입': 'campaign_type',
    'campaign_name': 'campaign_name',
    '캠페인명': 'campaign_name',
    'adgroup_name': 'adgroup_name',
    '광고그룹': 'adgroup_name',
    'impressions': 'impressions',
    '노출수': 'impressions',
    '노출': 'impressions',
    'clicks': 'clicks',
    '클릭수': 'clicks',
    '클릭': 'clicks',
    'ctr': 'ctr',
    'cpc': 'cpc',
    'cvr': 'cvr',
    'conversions': 'conversions',
    '전환수': 'conversions',
    '전환': 'conversions',
    'cpa': 'cpa',
    'roas': 'roas',
    'status': 'status',
    '상태': 'status',
    // AI 분석 결과
    'appeal_points': 'appeal_points',
    '소구포인트': 'appeal_points',
    'hook_type': 'hook_type',
    '후킹': 'hook_type',
    'target_emotion': 'target_emotion',
    '감정': 'target_emotion',
    'key_message_jp': 'key_message_jp',
    'key_message_kr': 'key_message_kr',
    '카피_jp': 'key_message_jp',
    '카피_kr': 'key_message_kr',
    // Retail 채널
    'retail': 'retail',
    'retail_channel': 'retail',
    '리테일': 'retail',
    '리테일채널': 'retail',
    'channel': 'retail',
    // Event (AA열)
    'event': 'event',
    'event_name': 'event',
    '이벤트': 'event',
    '이벤트명': 'event',
    'campaign_event': 'event',
    // 장바구니 추가 건수 (Add to Cart CV)
    'add cart cv': 'add_to_cart',
    'add_cart_cv': 'add_to_cart',
    'add_to_cart': 'add_to_cart',
    'atc': 'add_to_cart',
    '장바구니': 'add_to_cart',
    '장바구니추가': 'add_to_cart',
    'cart_adds': 'add_to_cart'
};

// URL 또는 파일명에서 미디어 타입 자동 감지
function detectMediaType(url) {
    if (!url) return 'image';
    const lowerUrl = url.toLowerCase();
    // 영상 확장자
    if (/\.(mp4|mov|webm|avi|mkv|m4v)(\?|$)/.test(lowerUrl)) return 'video';
    // YouTube, Vimeo
    if (/youtube\.com|youtu\.be|vimeo\.com/.test(lowerUrl)) return 'video';
    // 이미지 확장자
    if (/\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/.test(lowerUrl)) return 'image';
    // Google Drive는 확장자 추정 불가 → 별도 처리 필요
    return 'image'; // 기본값
}

// CSV → 객체 배열
function csvToObjects(csvText) {
    const rows = parseCSV(csvText.trim());
    if (rows.length < 2) {
        console.warn('[Sheets] CSV에 행이 부족합니다. 총 행 수:', rows.length);
        return [];
    }

    const rawHeaders = rows[0].map(h => h.trim().toLowerCase());
    // 별칭 매핑 적용
    const headers = rawHeaders.map(h => COLUMN_ALIASES[h] || h);

    const numberFields = ['impressions', 'clicks', 'ctr', 'spend', 'conversions', 'cpa', 'roas', 'revenue', 'cpc', 'cvr', 'add_to_cart', 'atc_rate', 'cost_per_atc'];
    const arrayFields = ['appeal_points', 'hook_type', 'target_emotion'];

    // ★ 숫자 파싱 함수 (쉼표, 통화기호, 퍼센트 처리)
    const parseNumber = (raw) => {
        if (raw === '' || raw == null) return 0;
        let s = String(raw).trim();
        if (s === '' || s === '-' || s.toLowerCase() === 'n/a') return 0;
        // 통화기호, 쉼표, 공백, 퍼센트, 원 제거
        s = s.replace(/[¥₩$€£,\s%원]/g, '');
        // 괄호 음수 처리: (123) → -123
        if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
        const n = parseFloat(s);
        return isNaN(n) ? 0 : n;
    };

    let autoIdCounter = 1;

    // ★ 매체(Platform)명 표준화 — 매체별 표기는 모두 별개 매체로 취급(임의 병합 금지)
    //   같은 매체로 의도된 표기 차이(앞뒤 공백, 중간 다중 공백)만 정리하고
    //   대소문자는 단어 단위 Title Case로 통일 → 드롭다운 정렬과 매칭 안정화.
    //   예) "single one meta"      → "Single One Meta"
    //       "  single one tiktok " → "Single One Tiktok"
    //       "Meta"                 → "Meta"   (그대로)
    //       "TikTok"               → "Tiktok" (Title Case)
    //       "X"                    → "X"
    const normalizePlatform = (raw) => {
        if (raw == null) return '';
        const s = String(raw).trim().replace(/\s+/g, ' ');
        if (!s) return '';
        // 단어 단위 Title Case (한글/숫자/특수문자는 원본 유지)
        return s.split(' ').map(w => {
            if (!w) return w;
            // 영문 단어만 첫 글자 대문자 + 나머지 소문자
            if (/^[A-Za-z]+$/.test(w)) {
                return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
            }
            return w;
        }).join(' ');
    };

    const result = rows.slice(1).map((row, idx) => {
        const obj = {};
        headers.forEach((key, i) => {
            let val = (row[i] || '').trim();
            if (numberFields.includes(key)) {
                val = parseNumber(val);
            } else if (arrayFields.includes(key)) {
                val = val ? val.split(',').map(t => t.trim()).filter(Boolean) : [];
            } else if (key === 'start_date' && val) {
                try { val = new Date(val).toISOString(); } catch(e) {}
            }
            obj[key] = val;
        });

        // ★ Platform 정규화 — 원본은 platform_raw로 보존
        if (obj.platform) {
            obj.platform_raw = obj.platform;
            obj.platform = normalizePlatform(obj.platform);
        }

        // ★ Retail 채널명 정규화 — 대소문자 표기 통일
        if (obj.retail) {
            const RETAIL_DISPLAY = {
                'qoo10': 'Qoo10',
                'rkt': 'RKT',
                'rakuten': 'Rakuten',
                'amazon': 'Amazon',
                'yahoo': 'Yahoo',
            };
            const key = obj.retail.trim().toLowerCase();
            obj.retail = RETAIL_DISPLAY[key] || obj.retail.trim();
        }

        // event 필드 정규화
        if (obj.event) {
            obj.event = String(obj.event).trim();
        }

        // 장바구니(ATC) 파생 지표 자동 계산
        if (obj.add_to_cart > 0) {
            // ATC율: 장바구니추가 / 클릭수 (비율, 표시 시 ×100)
            if (!obj.atc_rate && obj.clicks > 0) {
                obj.atc_rate = obj.add_to_cart / obj.clicks;
            }
            // Cost per ATC: 광고비 / 장바구니추가건수 (KRW 환산 후 계산됨)
            // → spend는 아직 환산 전이므로 환산 후 재계산 필요 — 아래 spend 환산 후 처리
        }

        // ★ 통화 처리: Single One 플랫폼 → 엔화(JPY)→원화(KRW) 환산
        //              직매체(X/Meta/TikTok 등) → 이미 원화, 환산 불필요
        const _platLc = (obj.platform || '').toLowerCase();
        const isJpyPlatform = _platLc.includes('single');

        if (isJpyPlatform) {
            const fx = getFxRate();
            obj.spend_jpy   = obj.spend   || 0;
            obj.revenue_jpy = obj.revenue || 0;
            obj.spend   = Math.round((obj.spend   || 0) * fx);
            obj.revenue = Math.round((obj.revenue || 0) * fx);
            if (obj.cpc) { obj.cpc_jpy = obj.cpc; obj.cpc = Math.round(obj.cpc * fx); }
            if (obj.cpa) { obj.cpa_jpy = obj.cpa; obj.cpa = Math.round(obj.cpa * fx); }
        } else {
            // 직매체: 원화 그대로 — JPY 필드는 null (모달에서 엔화 서브라인 미표시)
            obj.spend_jpy   = null;
            obj.revenue_jpy = null;
        }

        // ★ 파생 지표 자동 계산 (시트에 없으면 채워줌)
        // CTR/CVR/ROAS 모두 "비율(ratio)" 단위로 통일 (예: 3% → 0.03, 730% → 7.3)
        // 표시할 때만 ×100 적용

        // CTR: 비율로 계산 (clicks/impressions)
        if (!obj.ctr && obj.impressions > 0) {
            obj.ctr = obj.clicks / obj.impressions;
        } else if (obj.ctr && obj.ctr > 1) {
            // 시트 값이 1 초과면 %로 입력된 것 → ÷100해서 비율화
            // 예: 3.5 → 0.035, 2.6 → 0.026 (CTR 비율은 보통 0~0.2 범위)
            obj.ctr = obj.ctr / 100;
        }

        // CPC: 원화/클릭 단위 (KRW 환산 후)
        if (!obj.cpc && obj.clicks > 0) {
            obj.cpc = Math.round(obj.spend / obj.clicks);
        }

        // CVR: 비율로 계산 (conversions/clicks)
        if (!obj.cvr && obj.clicks > 0) {
            obj.cvr = obj.conversions / obj.clicks;
        } else if (obj.cvr && obj.cvr > 1) {
            // 시트 값이 1 초과면 %로 입력된 것 → ÷100해서 비율화
            obj.cvr = obj.cvr / 100;
        }

        // CPA: 원화/전환 단위 (KRW 환산 후)
        if (!obj.cpa && obj.conversions > 0) {
            obj.cpa = Math.round(obj.spend / obj.conversions);
        }

        // Cost per ATC: spend 환산 완료 후 계산
        if (obj.add_to_cart > 0 && obj.spend > 0) {
            obj.cost_per_atc = Math.round(obj.spend / obj.add_to_cart);
        }
        // ATC율 재확인 (spend 환산과 무관하지만 여기서 통일)
        if (obj.add_to_cart > 0 && !obj.atc_rate && obj.clicks > 0) {
            obj.atc_rate = obj.add_to_cart / obj.clicks;
        }

        // ROAS: 비율 단위 (예: 7.3 = 730%)
        // ★ 환율이 곱해진 후에도 revenue/spend는 동일한 비율이므로 영향 없음
        if (!obj.roas && obj.spend > 0) {
            obj.roas = obj.revenue / obj.spend;
        } else if (obj.roas && obj.roas > 20) {
            // 20 초과는 % 단위로 입력된 것 → ÷100
            // 예: 730 → 7.3, 8190 → 81.9
            obj.roas = obj.roas / 100;
        }

        // id가 없으면 자동 생성
        if (!obj.id) {
            obj.id = `row_${String(autoIdCounter++).padStart(4, '0')}`;
        }
        // creative_name 없으면 ad_name 또는 첫 번째 비어있지 않은 텍스트 컬럼 사용
        if (!obj.creative_name && obj.ad_name) {
            obj.creative_name = obj.ad_name;
        }
        // ★ 그래도 없으면 행 번호로 기본값 (필터링 방지)
        if (!obj.creative_name) {
            obj.creative_name = `소재 #${idx + 1}`;
        }
        // media_type 자동 판별 (media_url 기반)
        if (!obj.media_type || !['image', 'video'].includes(obj.media_type)) {
            obj.media_type = detectMediaType(obj.media_url);
        }
        // 호환성: thumbnail_url 없으면 media_url로 fallback, video_url 채우기
        if (obj.media_url) {
            if (!obj.thumbnail_url) obj.thumbnail_url = obj.media_url;
            if (obj.media_type === 'video') {
                obj.video_url = obj.media_url;
            }
        }
        // status 기본값
        if (!obj.status) obj.status = '운영중';
        // brand는 일단 그대로 둠 (아래에서 추론 처리)

        return obj;
    });

    // ★ 필터 완화: 행 전체가 완전히 비어있는 경우만 제외
    const filtered = result.filter(o => {
        const hasAnyValue = Object.values(o).some(v => {
            if (Array.isArray(v)) return v.length > 0;
            return v !== '' && v !== 0 && v != null;
        });
        return hasAnyValue;
    });

    // ★★ brand 추론: 시트에서 가장 많이 등장한 brand를 "기본 브랜드"로 사용
    // 빈 brand 행을 'ALL'로 두면 전체탭과 브랜드탭의 합계가 달라지는 버그 발생!
    // (전체탭은 모든 행 포함, 브랜드탭은 brand === 특정값인 행만 포함하므로 'ALL' 행 누락)
    const brandCount = {};
    filtered.forEach(o => {
        if (o.brand && o.brand !== 'ALL') {
            brandCount[o.brand] = (brandCount[o.brand] || 0) + 1;
        }
    });
    const dominantBrand = Object.keys(brandCount).sort((a, b) => brandCount[b] - brandCount[a])[0] || 'BOH';
    let inferredCount = 0;
    filtered.forEach(o => {
        if (!o.brand || o.brand === 'ALL') {
            o.brand = dominantBrand;
            inferredCount++;
        }
    });

    console.log(`[Sheets] 파싱 완료: ${filtered.length}개 / 총 ${result.length}개`);
    console.log(`[Sheets] 브랜드 분포:`, brandCount, `· 기본 브랜드: ${dominantBrand}` + (inferredCount ? ` (빈 brand ${inferredCount}개 자동 보정)` : ''));
    if (filtered.length === 0 && result.length > 0) {
        console.warn('[Sheets] ⚠️ 모든 행이 빈 값으로 판별됨. 첫 행 샘플:', result[0]);
    }
    return filtered;
}

// Google Sheets에서 fetch
async function fetchGoogleSheet(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.includes('<HTML>') || text.includes('<!DOCTYPE')) {
        throw new Error('CSV가 아닌 HTML이 반환되었습니다. 시트가 웹에 게시되었는지 확인하세요.');
    }
    return csvToObjects(text);
}

// 저장된 URL 가져오기
function getSavedSheetUrl() {
    try {
        return localStorage.getItem(SHEET_URL_KEY) || '';
    } catch {
        return '';
    }
}

function saveSheetUrl(url) {
    try {
        localStorage.setItem(SHEET_URL_KEY, url);
    } catch {}
}

function clearSheetUrl() {
    try {
        localStorage.removeItem(SHEET_URL_KEY);
    } catch {}
}

// 상태 메시지 표시
function showSheetStatus(type, message) {
    const el = document.getElementById('sheet-status');
    if (!el) return;
    const colors = {
        success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        error: 'bg-rose-50 border-rose-200 text-rose-800',
        loading: 'bg-blue-50 border-blue-200 text-blue-800'
    };
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        loading: 'fa-spinner fa-spin'
    };
    el.className = `border rounded-lg p-3 text-sm ${colors[type]}`;
    el.innerHTML = `<i class="fas ${icons[type]} mr-2"></i>${message}`;
    el.classList.remove('hidden');
}

// 모달 열기/닫기
function openSheetModal() {
    const input = document.getElementById('sheet-url-input');
    input.value = getSavedSheetUrl();
    document.getElementById('sheet-status').classList.add('hidden');
    document.getElementById('sheet-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeSheetModal() {
    document.getElementById('sheet-modal').classList.add('hidden');
    document.body.style.overflow = '';
}

window.closeSheetModal = closeSheetModal;

// 시트 연결
async function connectSheet() {
    const url = document.getElementById('sheet-url-input').value.trim();
    if (!url) {
        showSheetStatus('error', 'CSV URL을 입력해주세요.');
        return;
    }
    if (!url.includes('docs.google.com') || !url.includes('output=csv')) {
        showSheetStatus('error', 'Google Sheets의 CSV 게시 URL이 아닙니다.');
        return;
    }

    showSheetStatus('loading', '데이터를 불러오는 중...');
    try {
        const data = await fetchGoogleSheet(url);
        if (!data.length) {
            showSheetStatus('error',
                '데이터가 비어있습니다. 브라우저 콘솔(F12)을 열어 [Sheets] 로그를 확인하세요. ' +
                '시트 헤더가 1행에 있고, 2행부터 데이터가 입력되어 있는지 확인해주세요.'
            );
            return;
        }
        saveSheetUrl(url);
        window.allCreatives = data;
        showSheetStatus('success', `${data.length}개 소재 데이터 연동 성공! 대시보드 갱신 중...`);
        setTimeout(() => {
            closeSheetModal();
            if (typeof window.updateDashboard === 'function') window.updateDashboard();
            updateDataSourceLabel(true);
        }, 800);
    } catch (e) {
        console.error(e);
        showSheetStatus('error', `연동 실패: ${e.message}`);
    }
}

// 연결 해제
function disconnectSheet() {
    if (!confirm('Google Sheets 연결을 해제하고 샘플 데이터로 돌아갈까요?')) return;
    clearSheetUrl();
    showSheetStatus('success', '연결이 해제되었습니다. 페이지를 새로고침합니다...');
    setTimeout(() => location.reload(), 700);
}

// 데이터 소스 라벨 업데이트
function updateDataSourceLabel(connected) {
    const el = document.getElementById('data-source');
    if (!el) return;
    if (connected) {
        el.innerHTML = '<i class="fas fa-circle text-emerald-500 text-[8px] mr-1"></i>Google Sheets';
        el.classList.add('text-emerald-600');
    } else {
        el.innerHTML = '샘플 데이터';
        el.classList.remove('text-emerald-600');
    }
}

// 초기 로드 시 저장된 시트 연결
async function tryLoadSavedSheet() {
    // 1순위: LocalStorage에 저장된 URL
    // 2순위: 코드에 박아둔 DEFAULT_SHEET_URL (배포 환경용)
    const url = getSavedSheetUrl() || DEFAULT_SHEET_URL;
    if (!url) return null;
    console.log('[Sheets] 시트 로드 시도:', url.substring(0, 80) + '...');
    try {
        const data = await fetchGoogleSheet(url);
        console.log(`[Sheets] ✅ 로드 성공: ${data.length}개 데이터`);
        updateDataSourceLabel(true);
        return data;
    } catch (e) {
        console.warn('[Sheets] ❌ 시트 로드 실패:', e.message);
        updateDataSourceLabel(false);
        return null;
    }
}

// CSV 템플릿 다운로드
async function downloadCsvTemplate() {
    try {
        const res = await fetch('spreadsheet/creatives_template.csv');
        if (!res.ok) throw new Error('파일을 찾을 수 없습니다');
        const blob = await res.blob();
        // BOM 추가하여 한글 깨짐 방지
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const blobWithBom = new Blob([bom, blob], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blobWithBom);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'creatives_template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showSheetStatus('success', '템플릿 CSV 파일이 다운로드되었습니다! Google Sheets에서 열어보세요.');
    } catch (e) {
        showSheetStatus('error', `다운로드 실패: ${e.message}`);
    }
}

// CSV 텍스트 클립보드 복사 (Google Sheets에 바로 붙여넣기 가능)
async function copyCsvToClipboard() {
    try {
        const res = await fetch('spreadsheet/creatives_template.csv');
        if (!res.ok) throw new Error('파일을 찾을 수 없습니다');
        const text = await res.text();
        // CSV를 TSV(탭 구분)로 변환 - Google Sheets 붙여넣기 호환
        const rows = parseCSV(text);
        const tsv = rows.map(row => row.join('\t')).join('\n');
        await navigator.clipboard.writeText(tsv);
        showSheetStatus('success', '클립보드에 복사 완료! Google Sheets A1 셀에 Ctrl+V로 붙여넣으세요.');
    } catch (e) {
        showSheetStatus('error', `복사 실패: ${e.message}`);
    }
}

// 이벤트 바인딩
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-sheet-config')?.addEventListener('click', openSheetModal);
    document.getElementById('btn-connect-sheet')?.addEventListener('click', connectSheet);
    document.getElementById('btn-disconnect-sheet')?.addEventListener('click', disconnectSheet);
    document.getElementById('btn-refresh')?.addEventListener('click', () => location.reload());
    document.getElementById('btn-download-csv')?.addEventListener('click', downloadCsvTemplate);
    document.getElementById('btn-copy-csv')?.addEventListener('click', copyCsvToClipboard);
    document.getElementById('sheet-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'sheet-modal') closeSheetModal();
    });
});

window.tryLoadSavedSheet = tryLoadSavedSheet;
window.updateDataSourceLabel = updateDataSourceLabel;
