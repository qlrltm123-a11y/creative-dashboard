# 🎯 Performance Creative Dashboard

퍼포먼스 마케팅 광고 소재 효율 모니터링 대시보드. **BOH, WM, CG** 3개 브랜드의 광고 소재(이미지·영상)와 매체별 성과를 한눈에 시각화합니다. (일본 시장 타겟, JPY→KRW 자동 환산)

---

## ✅ 현재 구현된 기능

### 0. 섹션 탭 네비게이션
대시보드를 3개의 섹션 탭으로 분리하여 한 화면에 보이는 정보를 최적화:
- **📊 개요** — KPI 6종 + 브랜드/매체 핵심 차트 + **브랜드 & 제품별 위닝 요소 인사이트 (NEW)**
- **🏆 성과 분석** — 제품×캠페인 필터 + 제품별 BEST/WORST TOP 5 + AI 추론 코멘트 + 제품별 소구포인트 인사이트 + 갤러리
- **✨ AI 인사이트** — 제품×캠페인 필터 + 소구포인트 워드맵 (키워드 군집화) + 성공 패턴 + TOP 카피 메시지

부드러운 페이드 전환 + 탭 전환 시 차트 자동 리사이즈

### 1. 브랜드별 필터링
- 전체 / BOH / WM / CG 탭 전환으로 즉시 데이터 갱신
- 브랜드별 컬러 시스템 (BOH 🔴 / WM 🟢 / CG 🟡)
- **자동 브랜드 추론**: 빈 brand 행은 도미넌트 브랜드로 채움
- ⚠️ **전체 캠페인 필터 제거됨** — 섹션별 개별 필터로 대체

### 2. KPI 요약 카드 (6종)
총 노출수 · 총 클릭수 · 평균 CTR · 총 광고비 · 전환수 · 평균 ROAS

### 3. 브랜드 & 제품별 위닝 요소 인사이트 (개요 탭) — NEW ✨
"무엇이 성과를 만들었는가"를 2개 카드로 한눈에:
- **🏷 소구포인트 위너** — 평균 ROAS 기준 TOP 키워드 (최소 2개 이상 소재로 검증된 군집만)
- **🎨 디자인/포맷 위너** — media_type/hook_type 조합별 위너 (최소 2개 소재 이상)
- 각 행 클릭 시 → 해당 키워드의 대표 소재 상세 모달
- ❌ "인물 vs 상품" 카드는 데이터 신뢰도 이슈로 제거됨

### 4. 성과 분석 (BEST/WORST + 추론 코멘트)
- 섹션 상단 **제품 + 캠페인 필터 (NEW)** — 섹션 단위 정밀 필터
- 제품별·지표별 (ROAS/CTR/CVR) BEST/WORST TOP 5 랭킹
- **중앙값(median) 광고비 필터** — 충분히 광고비가 소진된 소재만 평가
- **ad_name 기준 집계** — 일별 breakdown 행을 하나의 소재로 합산 (`✕N일` 배지)
- **AI 추론 코멘트** (각 행 펼침형 토글):
  - 💡 성과 요인 — ROAS/CTR/CVR이 벤치마크 대비 ±X% 우위/미달 정량 분석
  - 🚀 다음 액션 — 핵심 소구포인트·후킹·감정 코드 기반 추천
  - 🔍 부진 요인 + 🔧 개선 방향
- 썸네일 + 비디오 배지 + 소구포인트 칩

### 5. 제품별 소구포인트 인사이트 (성과 분석 탭) — 업데이트 ✨
- "이 소구는 좋았다 → 다음에 이렇게 만들자" 처방형 인사이트
- ✨ **위너 소구포인트** (단일 컬럼 레이아웃)
- **최소 2개 이상 소재 검증 필터 (NEW)** — 1개 소재 평균값으로 인한 노이즈 제거
  - 조건 충족 후보가 3개 미만이면 fallback으로 전체 후보 사용
- ⚠️ LOSER 섹션은 의사결정 가치가 낮아 제거됨
- 🚀 다음 소재 제작 추천 — primary/cyan/rose/avoid 칩으로 시각적 가이드

### 6. AI 소재 인사이트 — 향상됨 ✨
- 섹션 상단 **제품 + 캠페인 필터 (NEW)**
- **소구포인트 워드맵 키워드 군집화 (NEW)**
  - `extractAppealTokens` + `clusterAppealKeywords` + `APPEAL_STOP_WORDS`
  - 의미적 동의어를 하나의 클러스터로 통합 (점선 밑줄 표시)
- Gemini 분석 컬럼 (`appeal_points`, `hook_type`, `target_emotion`) 기반 효율 분석
- 성공 패턴 카드 3종 + 소구포인트 워드맵
- **호버 프리뷰 카드 강화 (NEW)** — 썸네일 52×52 → **96×96px** 확대
  - 영상 배지: 우측 하단 → **중앙 32px 원형 플레이 버튼**
  - 프리뷰 카드 폭 340 → 400px, padding/gap 확대
- 차트 hover/click 인터랙션 → 키워드별 ROAS 상위 3개 소재 즉시 표시

### 7. 광고 소재 갤러리
- 카드형 그리드 (반응형 1~4열)
- 썸네일 + 영상 플레이 오버레이
- 매체/캠페인 타입/상태 칩 + 효율 등급별 컬러 (녹/주/적)

### 8. 소재 상세 모달
- 정사각형(1:1) 고정 비율 + sticky 포지셔닝
- 영상 자동재생, iframe 임베드 지원
- 8가지 상세 지표 + AI 분석 칩

### 9. 필터 & 검색 (갤러리)
- 매체 / 소재타입 / 캠페인타입 필터
- ROAS / CTR / 광고비 / 전환수 정렬
- 소재명 실시간 검색

### 10. 환율(JPY → KRW) 설정
- 헤더에서 환율 직접 입력 → 즉시 재환산
- LocalStorage에 저장되어 새로고침 시 유지

---

## ⚡ 페이지 속도 최적화 (NEW)

| 최적화 | 구현 | 효과 |
|--------|------|------|
| **Lazy 섹션 렌더링** | `_renderedSections` 플래그 — 성과/AI 섹션은 첫 진입 시에만 렌더 | 초기 로드 비용 감소 |
| **WeakMap 캐시** | `aggregateByAdName()` 입력 참조 기반 메모이제이션 | 반복 집계 제거 |
| **디바운스 (120ms)** | 모든 섹션 필터 change/reset 핸들러 | 연속 클릭 시 마지막 호출만 |
| **updateCharts/Dashboard 스킵** | 비활성 섹션의 차트 재그리기 회피 | 불필요한 chart.update() 제거 |
| **이미지 lazy-load** | 모든 `<img>` 태그에 `loading="lazy"` + `decoding="async"` | 뷰포트 밖 이미지 로드 지연 |
| **CDN preconnect/dns-prefetch** | Google Fonts·jsDelivr·Tailwind·Drive·LH3 도메인 사전 연결 | TLS 핸드셰이크 RTT 단축 |
| **Chart.js defer** | `<script ... defer>` | HTML 파싱 비차단 |

검증: PlaywrightConsoleCapture → JS 에러 0, 1,401개 데이터 정상 로드, 페이지 로드 14.89s (이전 15.65s 대비 단축)

---

## 🌐 주요 진입 경로

| 경로 | 설명 |
|------|------|
| `/index.html` | 메인 대시보드 |
| `/debug-sheet.html` | 시트 연동 디버깅 |
| `/data-check.html` | 데이터 정합성 점검 |
| `GET tables/creatives` | 전체 소재 목록 (페이지네이션) |
| `GET tables/creatives/{id}` | 단일 소재 상세 |
| `POST tables/creatives` | 신규 소재 등록 |
| `PATCH tables/creatives/{id}` | 소재 정보 수정 |
| `DELETE tables/creatives/{id}` | 소재 삭제 |

### 섹션별 필터 ID
- 성과 분석: `#performance-product-select`, `#performance-campaign-select`, `#performance-filter-reset`
- AI 인사이트: `#ai-product-select`, `#ai-campaign-select`, `#ai-filter-reset`
- 위닝 요소: `#winning-product-select`

---

## 🗂 데이터 모델 (`creatives` 테이블)

| 필드 | 타입 | 설명 |
|------|------|------|
| id | text | 고유 ID |
| creative_name / ad_name | text | 소재명 (ad_name 기준 집계) |
| brand | text | BOH / WM / CG (빈 값은 도미넌트 브랜드로 추론) |
| product | text | 제품명 |
| campaign_name | text | 캠페인명 (섹션 필터 기준) |
| media_type | text | image / video |
| thumbnail_url / video_url / media_url | text | 미디어 URL (Google Drive 자동 변환) |
| platform | text | Meta / Google / TikTok / Naver / Kakao |
| campaign_type | text | 브랜딩 / 퍼포먼스 / 리타겟팅 |
| impressions, clicks | number | 노출/클릭 |
| ctr, cvr, roas | number | 비율(ratio) — 표시 시 ×100% |
| spend, revenue | number | 광고비/매출 (KRW 환산값) |
| conversions, cpa | number | 전환/CPA |
| appeal_points | array | AI 소구포인트 |
| hook_type | array | AI 후킹 방식 |
| target_emotion | array | AI 타겟 감정 |
| key_message_kr / key_message_jp | text | 핵심 카피 메시지 |
| start_date | datetime | 시작일 |
| status | text | 운영중 / 종료 / 일시정지 |

### 데이터 처리 규칙
- **MIN_SPEND_FOR_ROAS = ₩10,000** — 미달 소재는 ROAS 평가 제외
- **중앙값(median) spend 필터** — BEST/WORST는 중앙값 이상 소진 소재만 대상
- **ad_name 집계** — 동일 ad_name의 일별 행을 하나로 합산
- **벤치마크 계산** — 제품 내 가중평균 ROAS/CTR/CVR
- **최소 2개 소재 검증** — 소구포인트/디자인 위너는 `pickedCount >= 2`인 키워드만 노출 (fallback: 후보 < 3 시 전체 사용)

---

## 🚀 추후 개발 권장 사항

1. **기간 필터** — 시작일~종료일 범위 선택
2. **소재 비교 모드** — 2개 이상 소재 동시 비교
3. **데일리 트렌드 차트** — 시계열 라인 차트
4. **CSV/Excel 내보내기** — 보고용 데이터 다운로드
5. **이상 소재 알림** — ROAS/CPA 임계값 기반 경고
6. **AI 추론 코멘트 PDF 리포트** — 종합 분석서 자동 생성
7. **광고 API 실연동** — Meta Marketing/Google Ads (인증 필요시 별도 백엔드)
8. **Tailwind 프로덕션 빌드** — CDN 경고 해소 (PostCSS/CLI 사용)

---

## 🛠 기술 스택

- HTML5 + Tailwind CSS (CDN)
- Vanilla JavaScript (ES6+) — 모듈 분리: `main.js`, `insights.js`, `gallery.js`, `sheets.js`, `drive-converter.js`
- Chart.js v4 (bar/bubble/doughnut)
- Pretendard 폰트, FontAwesome 6
- RESTful Table API
- Google Sheets Published CSV 연동
- WeakMap 메모이제이션 + Debounce + Lazy section rendering

---

## 🖼️ Google Drive 자동 변환 (4단계 폴백)

1. `drive.google.com/thumbnail?id={ID}&sz=w800`
2. `lh3.googleusercontent.com/d/{ID}=w800`
3. `drive.google.com/uc?export=view&id={ID}`
4. `drive.google.com/thumbnail?id={ID}&sz=w400`

영상: `drive.google.com/file/d/{ID}/preview` iframe 임베드.

---

## 🔗 Google Sheets 실시간 연동

1. `spreadsheet/creatives_template.csv`를 Google Sheets로 가져오기
2. **파일 → 공유 → 웹에 게시 → CSV 형식**
3. 대시보드 우측 상단 **[🗂 시트 연동]** 클릭 → URL 붙여넣기 → 연결

LocalStorage 자동 저장 · 헤더 데이터 소스 라벨에 연결 상태 표시. Apps Script 자동 분석은 `spreadsheet/apps_script_v7.js` (Gemini API).

자세한 가이드: `GOOGLE_SHEETS_GUIDE.md`

---

## 📌 배포

대시보드를 라이브로 공개하려면 상단의 **Publish 탭**을 이용해주세요.
