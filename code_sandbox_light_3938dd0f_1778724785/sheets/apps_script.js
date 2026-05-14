/**
 * ================================================
 * AD Studio — Google Apps Script
 * 광고 소재 대시보드 ↔ Google Sheets 연동
 * ================================================
 *
 * [설치 방법]
 * 1. Google Sheets 열기
 * 2. 확장프로그램 → Apps Script
 * 3. 이 코드 전체 붙여넣기
 * 4. 배포 → 새 배포 → 웹앱 → 액세스: 모든 사용자 → 배포
 * 5. 생성된 URL을 대시보드 js/data.js 에 붙여넣기
 * ================================================
 */

// ──────────────────────────────────────────
// 1) 메인 GET 핸들러
//    ?sheet=performance  (기본값)
//    ?sheet=creatives
//    ?sheet=all          (두 시트 동시 반환)
// ──────────────────────────────────────────
function doGet(e) {
  try {
    const sheetParam = (e && e.parameter && e.parameter.sheet)
      ? e.parameter.sheet
      : 'performance';

    let result;

    if (sheetParam === 'all') {
      // 두 시트 한 번에 반환
      result = {
        performance : readSheet('performance'),
        creatives   : readSheet('creatives'),
        updated_at  : getKSTNow()
      };
    } else {
      const data = readSheet(sheetParam);
      result = {
        sheet      : sheetParam,
        count      : data.length,
        updated_at : getKSTNow(),
        data       : data
      };
    }

    return buildResponse(result);

  } catch (err) {
    return buildResponse({ error: err.message }, true);
  }
}


// ──────────────────────────────────────────
// 2) 시트 읽기 공통 함수
// ──────────────────────────────────────────
function readSheet(sheetName) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) throw new Error('시트를 찾을 수 없습니다: ' + sheetName);

  const rows    = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => String(h).trim());

  // 숫자형으로 변환할 컬럼 목록
  const NUM_COLS = [
    'impressions','clicks','spend','conversions','revenue',
    'ctr','cpc','cpa','roas','budget_monthly'
  ];

  return rows.slice(1)
    .filter(row => row[0] !== '' && row[0] !== null && row[0] !== undefined)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        let val = row[i];

        // Date 객체 → 문자열 변환 (yyyy-MM-dd)
        if (val instanceof Date) {
          val = Utilities.formatDate(val, 'Asia/Seoul', 'yyyy-MM-dd');
        }

        // 숫자 컬럼 타입 강제 변환
        if (NUM_COLS.includes(h) && val !== '' && val !== null) {
          val = Number(val) || 0;
        }

        // 빈 문자열 처리
        obj[h] = (val === null || val === undefined) ? '' : val;
      });
      return obj;
    });
}


// ──────────────────────────────────────────
// 3) 응답 빌더 (CORS 허용)
// ──────────────────────────────────────────
function buildResponse(data, isError) {
  const payload = isError
    ? JSON.stringify({ success: false, ...data })
    : JSON.stringify({ success: true, ...data });

  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}


// ──────────────────────────────────────────
// 4) 현재 시간 KST 반환
// ──────────────────────────────────────────
function getKSTNow() {
  return Utilities.formatDate(
    new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss'+09:00'"
  );
}


// ──────────────────────────────────────────
// 5) 테스트 함수 (배포 전 로컬 실행용)
//    Apps Script 편집기에서 직접 실행해서
//    로그로 결과 확인 가능
// ──────────────────────────────────────────
function testReadPerformance() {
  const data = readSheet('performance');
  Logger.log('총 행 수: ' + data.length);
  Logger.log('첫 번째 행: ' + JSON.stringify(data[0]));
}

function testReadCreatives() {
  const data = readSheet('creatives');
  Logger.log('총 소재 수: ' + data.length);
  Logger.log('첫 번째 소재: ' + JSON.stringify(data[0]));
}

function testAll() {
  const mock = { parameter: { sheet: 'all' } };
  const res  = doGet(mock);
  Logger.log(res.getContent());
}
