# 📊 Google Sheets 연동 가이드

대시보드와 Google Sheets를 실시간 연동하는 방법입니다.

## 1️⃣ Google Sheets 생성

### Step 1. 새 스프레드시트 만들기
1. [Google Sheets](https://sheets.google.com) 접속
2. **빈 스프레드시트** 생성
3. 시트 이름을 **`creatives`** 로 변경 (하단 시트 탭 더블클릭)

### Step 2. 템플릿 CSV 가져오기
1. 프로젝트의 `spreadsheet/creatives_template.csv` 파일 다운로드
2. Google Sheets에서 **파일 → 가져오기 → 업로드** → CSV 선택
3. 가져오기 위치: **현재 시트 바꾸기** 선택 → **데이터 가져오기**

## 2️⃣ 시트를 웹에 게시 (CSV 공개)

### Step 1. 게시 메뉴 열기
- 상단 메뉴: **파일 → 공유 → 웹에 게시**

### Step 2. 게시 옵션 설정
- **링크 탭** 선택
- 첫 번째 드롭다운: **`creatives` 시트** 선택 (전체 문서 X)
- 두 번째 드롭다운: **쉼표로 구분된 값(.csv)** 선택
- **게시** 버튼 클릭 → 확인

### Step 3. URL 복사
생성된 URL 예시:
```
https://docs.google.com/spreadsheets/d/e/2PACX-XXXXXXXXX/pub?gid=0&single=true&output=csv
```
이 URL을 복사해두세요.

## 3️⃣ 대시보드에 연동

### Step 1. 대시보드 접속
대시보드 우측 상단의 **⚙️ 시트 연동** 버튼 클릭

### Step 2. URL 입력
- 위에서 복사한 CSV URL 붙여넣기
- **연결** 버튼 클릭
- 자동으로 데이터 fetch → 차트 갱신

### Step 3. 자동 갱신
- 한 번 연결하면 브라우저 LocalStorage에 저장됨
- 새로고침 시 자동으로 최신 데이터 fetch
- Google Sheets에서 데이터 수정 → 약 5분 이내 반영 (Google 캐시)

## 4️⃣ 데이터 입력 규칙

### 필수 컬럼 (헤더는 절대 수정 금지)
```
id, creative_name, brand, media_type, thumbnail_url, video_url,
platform, campaign_type, description, tags, impressions, clicks,
ctr, spend, conversions, cpa, roas, revenue, start_date, status
```

### 입력 가능값
| 컬럼 | 허용값 |
|------|--------|
| `brand` | BOH / WM / CG |
| `media_type` | image / video |
| `platform` | Meta / Google / TikTok / Naver / Kakao |
| `campaign_type` | 브랜딩 / 퍼포먼스 / 리타겟팅 |
| `status` | 운영중 / 종료 / 일시정지 |
| `tags` | 쉼표 구분 (예: `여름신상,MZ타겟`) |
| `start_date` | YYYY-MM-DD |

### 주의사항
- ✅ `id`는 유니크 (cr001, cr002...)
- ✅ 숫자 컬럼은 숫자만 입력 (단위 X)
- ✅ `tags`에 쉼표가 포함된 단어는 사용 불가
- ⚠️ 게시 후 시트를 비공개로 바꾸면 연동이 끊김

## 5️⃣ 트러블슈팅

| 문제 | 해결 |
|------|------|
| "데이터를 불러올 수 없습니다" | 시트가 '웹에 게시'되어 있는지 확인 |
| 차트가 비어있음 | 헤더 컬럼명이 정확한지 확인 |
| 한글이 깨짐 | UTF-8 인코딩 확인 (Google Sheets 기본) |
| 5분 지나도 반영 안됨 | 대시보드 [🔄 새로고침] 버튼 클릭 |

## 6️⃣ 추천 워크플로우

1. **마케터**가 Google Sheets에 신규 소재 행 추가
2. 일 1회 매체 리포트 데이터를 시트에 업데이트
3. **팀 전체**가 대시보드 URL 북마크 → 항상 최신 데이터 조회
4. 주간 보고: 대시보드 스크린샷 + Google Sheets 원본 데이터 첨부
