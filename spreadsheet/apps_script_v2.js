// ============================================
// 광고 소재 AI 자동 분석 (Gemini 2.5 Flash)
// v2: Google Drive 인증 다운로드 지원
// ============================================

// 🔑 발급받은 Gemini API 키를 여기에 붙여넣기
const GEMINI_API_KEY = 'AIzaSy여기에_본인_API_키_붙여넣기';

// 시트 컬럼 인덱스 (1부터 시작) - 실제 시트에 맞게 조정
const COLS = {
  media_url: 10,         // J열 (media_url 컬럼)
  appeal_points: 24,     // X열
  hook_type: 25,         // Y열
  target_emotion: 26,    // Z열
  key_message_jp: 27,    // AA열
  key_message_kr: 28     // AB열
};

// 메뉴 추가 (스프레드시트 열면 자동 실행)
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🤖 AI 분석')
    .addItem('▶ 선택한 행 분석', 'analyzeSelectedRow')
    .addItem('▶▶ 빈 칸 모두 분석', 'analyzeAllEmpty')
    .addSeparator()
    .addItem('⚙️ 컬럼 위치 확인', 'showColumnInfo')
    .addItem('🧪 URL 테스트 (이미지 다운로드만)', 'testImageDownload')
    .addToUi();
}

// 선택한 행 분석
function analyzeSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    SpreadsheetApp.getUi().alert('데이터 행을 선택해주세요 (2행 이상)');
    return;
  }
  analyzeRow(sheet, row);
  SpreadsheetApp.getUi().alert('✅ 분석 완료!');
}

// 빈 칸 모두 분석
function analyzeAllEmpty() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  let count = 0;

  for (let row = 2; row <= lastRow; row++) {
    const mediaUrl = sheet.getRange(row, COLS.media_url).getValue();
    const appealPoints = sheet.getRange(row, COLS.appeal_points).getValue();

    if (mediaUrl && (!appealPoints || String(appealPoints).startsWith('❌'))) {
      analyzeRow(sheet, row);
      count++;
      Utilities.sleep(4000); // 4초 대기 (할당량 보호)
    }
  }
  SpreadsheetApp.getUi().alert(`✅ ${count}개 소재 분석 완료!`);
}

// 한 행 분석
function analyzeRow(sheet, row) {
  const mediaUrl = sheet.getRange(row, COLS.media_url).getValue();
  if (!mediaUrl) return;

  try {
    const result = analyzeWithGemini(mediaUrl);
    sheet.getRange(row, COLS.appeal_points).setValue(result.appeal_points || '');
    sheet.getRange(row, COLS.hook_type).setValue(result.hook_type || '');
    sheet.getRange(row, COLS.target_emotion).setValue(result.target_emotion || '');
    sheet.getRange(row, COLS.key_message_jp).setValue(result.key_message_jp || '');
    sheet.getRange(row, COLS.key_message_kr).setValue(result.key_message_kr || '');
  } catch (e) {
    sheet.getRange(row, COLS.appeal_points).setValue('❌ 오류: ' + e.message);
  }
}

// ★ 핵심: Google Drive 파일을 OAuth 인증으로 직접 가져오기
function fetchImageBlob(url) {
  // Google Drive 파일 ID 추출
  const driveMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                     url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                     url.match(/\/d\/([a-zA-Z0-9_-]+)/);

  if (driveMatch) {
    // Drive 파일이면 DriveApp으로 직접 가져오기 (본인 권한 사용)
    const fileId = driveMatch[1];
    try {
      const file = DriveApp.getFileById(fileId);
      return file.getBlob();
    } catch (e) {
      throw new Error(`Drive 파일 접근 실패 (파일ID: ${fileId}). 권한을 확인하세요.`);
    }
  }

  // 일반 URL은 그냥 fetch
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error(`이미지 다운로드 실패 (HTTP ${code})`);
  }
  return response.getBlob();
}

// 영상 파일인지 판단
function isVideoBlob(blob) {
  const contentType = (blob.getContentType() || '').toLowerCase();
  return contentType.startsWith('video/');
}

// 영상에서 첫 프레임 썸네일 얻기 (Drive 영상용)
function getVideoThumbnailUrl(driveFileId) {
  return `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w1000`;
}

// Gemini API 호출
function analyzeWithGemini(mediaUrl) {
  let imageBlob;

  // Drive 영상은 썸네일을 받아서 분석
  const driveMatch = mediaUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                     mediaUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);

  if (driveMatch) {
    const fileId = driveMatch[1];
    try {
      const file = DriveApp.getFileById(fileId);
      const mimeType = file.getMimeType();

      if (mimeType.startsWith('video/')) {
        // 영상이면 Drive 썸네일 사용
        const thumbUrl = getVideoThumbnailUrl(fileId);
        imageBlob = UrlFetchApp.fetch(thumbUrl).getBlob();
      } else {
        // 이미지면 그대로
        imageBlob = file.getBlob();
      }
    } catch (e) {
      throw new Error(`Drive 파일 접근 실패: ${e.message}`);
    }
  } else {
    // 외부 URL
    imageBlob = fetchImageBlob(mediaUrl);
  }

  // 이미지 크기 제한 (Gemini는 큰 이미지 거부할 수 있음)
  let mimeType = imageBlob.getContentType() || 'image/jpeg';
  if (!mimeType.startsWith('image/')) {
    mimeType = 'image/jpeg';
  }
  const base64Image = Utilities.base64Encode(imageBlob.getBytes());

  // 프롬프트
  const prompt = `당신은 일본 시장 전문 광고 마케팅 분석가입니다.
이 이미지는 일본 시장 광고 소재입니다. 분석하여 아래 JSON 형식으로만 답해주세요.
다른 설명, 마크다운, 코드블록 등은 절대 추가하지 마세요.

⚠️ 만약 이 이미지가 광고 소재가 아니라 로그인 화면, 에러 페이지, 일반 웹사이트 등이면
appeal_points에 "❌ 광고소재 아님" 이라고만 적어주세요.

{
  "appeal_points": "소구포인트를 자유로운 키워드로 3-5개 (한국어, 쉼표구분). 카테고리에 갇히지 말고 실제로 느껴지는 포인트 표현. 예: 여름한정, 가족친화, 가성비, 안심품질",
  "hook_type": "후킹 방식 1-2개 키워드 (한국어). 예: 사용자후기, 숫자강조, 한정성, 비교",
  "target_emotion": "타겟이 느낄 감정 1-2개 키워드 (한국어). 예: 신뢰, 욕구, 긴급함, 호기심",
  "key_message_jp": "소재 안의 핵심 일본어 카피/문구 (원문 그대로). 텍스트가 없으면 빈 문자열",
  "key_message_kr": "key_message_jp의 자연스러운 한국어 번역"
}`;

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64Image } }
      ]
    }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json"
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const responseText = response.getContentText();
  const json = JSON.parse(responseText);

  if (!json.candidates || !json.candidates[0]) {
    throw new Error('API 응답: ' + responseText.substring(0, 150));
  }

  const text = json.candidates[0].content.parts[0].text;
  try {
    return JSON.parse(text);
  } catch (e) {
    // JSON 파싱 실패 시 텍스트에서 추출 시도
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('JSON 파싱 실패: ' + text.substring(0, 100));
  }
}

// 컬럼 위치 안내
function showColumnInfo() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let info = '📋 현재 시트 컬럼 위치:\n\n';
  headers.forEach((h, i) => {
    info += `${i+1}번 (${columnToLetter(i+1)}): ${h}\n`;
  });
  info += '\n💡 코드 상단 COLS 값을 위 번호에 맞게 조정하세요.';
  SpreadsheetApp.getUi().alert(info);
}

// 이미지 다운로드 테스트 (디버깅용)
function testImageDownload() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    SpreadsheetApp.getUi().alert('데이터 행을 선택해주세요');
    return;
  }
  const url = sheet.getRange(row, COLS.media_url).getValue();
  if (!url) {
    SpreadsheetApp.getUi().alert('이 행에 URL이 없습니다');
    return;
  }
  try {
    const blob = fetchImageBlob(url);
    const size = blob.getBytes().length;
    const type = blob.getContentType();
    SpreadsheetApp.getUi().alert(
      `✅ 다운로드 성공!\n\n` +
      `타입: ${type}\n` +
      `크기: ${(size/1024).toFixed(1)} KB\n` +
      `URL: ${url.substring(0, 80)}...`
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert(`❌ 다운로드 실패:\n${e.message}`);
  }
}

function columnToLetter(col) {
  let letter = '';
  while (col > 0) {
    const mod = (col - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    col = Math.floor((col - mod) / 26);
  }
  return letter;
}
