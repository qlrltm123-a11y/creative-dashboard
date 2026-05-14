# 📥 Google Sheets 임포트 & 연동 가이드

## Step 1 — 구글 스프레드시트 생성

1. [sheets.new](https://sheets.new) 접속 → 새 스프레드시트 생성
2. 스프레드시트 이름 변경 → **"AD Studio 광고 데이터"**

---

## Step 2 — CSV 파일 임포트 (시트 3개)

### performance 시트
```
파일 → 가져오기 → 업로드 → performance.csv 선택
  ✅ 가져오기 위치: "새 시트 삽입"
  ✅ 구분자: 쉼표
  ✅ 시트 이름을 "performance" 로 변경
```

### creatives 시트
```
하단 + 버튼 → 새 시트 추가
파일 → 가져오기 → 업로드 → creatives.csv 선택
  ✅ 가져오기 위치: "현재 시트 바꾸기"
  ✅ 시트 이름을 "creatives" 로 변경
```

### config 시트
```
하단 + 버튼 → 새 시트 추가
파일 → 가져오기 → 업로드 → config.csv 선택
  ✅ 가져오기 위치: "현재 시트 바꾸기"
  ✅ 시트 이름을 "config" 로 변경
```

---

## Step 3 — 수식 자동계산 설정 (performance 시트)

> CTR / CPC / CPA / ROAS 는 수식으로 자동계산되도록 설정

**M2 셀 (CTR)**
```
=IF(H2=0, 0, ROUND(I2/H2*100, 2))
```

**N2 셀 (CPC)**
```
=IF(I2=0, 0, ROUND(J2/I2, 0))
```

**O2 셀 (CPA)**
```
=IF(K2=0, 0, ROUND(J2/K2, 0))
```

**P2 셀 (ROAS)**
```
=IF(J2=0, 0, ROUND(L2/J2*100, 0))
```

> ✅ 수식 입력 후 M2:P2 선택 → 마지막 데이터 행까지 드래그

---

## Step 4 — 데이터 유효성 검사 설정

> 입력 오류 방지를 위한 드롭다운 설정

| 열 | 설정 방법 |
|---|---|
| B열 (brand) | 데이터 → 유효성 검사 → 범위: `config!A2:A4` |
| C열 (channel) | 데이터 → 유효성 검사 → 범위: `config!E2:E7` |
| L열 (status) | 데이터 → 유효성 검사 → 목록: `active,paused,ended` |

---

## Step 5 — Apps Script 설치

```
스프레드시트 메뉴
  → 확장프로그램
  → Apps Script
  → 기존 코드 전체 삭제
  → apps_script.js 내용 붙여넣기
  → 💾 저장 (Ctrl+S)
```

---

## Step 6 — 테스트 실행

```
Apps Script 편집기
  → 함수 선택: testReadPerformance
  → ▶ 실행
  → 하단 로그에서 데이터 확인

예상 출력:
  총 행 수: 66
  첫 번째 행: {"date":"2025-03-01","brand":"BOH","channel":"Meta",...}
```

---

## Step 7 — 웹앱으로 배포

```
Apps Script 편집기
  → 오른쪽 상단 "배포" 버튼
  → 새 배포
  → 유형: 웹앱
  → 설명: AD Studio v1
  → 다음 사용자로 실행: 나 (본인 계정)
  → 액세스 권한: 모든 사용자  ← ⚠️ 반드시 이걸로!
  → 배포
  → URL 복사 (https://script.google.com/macros/s/AKfy.../exec)
```

---

## Step 8 — 대시보드 연동

`js/data.js` 파일 상단에 아래 코드를 추가하세요.

```javascript
// ✅ 여기에 복사한 Apps Script URL 붙여넣기
const SHEET_API_URL = 'https://script.google.com/macros/s/여기에붙여넣기/exec';
```

---

## 완성된 URL 예시

```
전체 데이터:
https://script.google.com/macros/s/AKfy.../exec?sheet=all

performance 만:
https://script.google.com/macros/s/AKfy.../exec?sheet=performance

creatives 만:
https://script.google.com/macros/s/AKfy.../exec?sheet=creatives
```
