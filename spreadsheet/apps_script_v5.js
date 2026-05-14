// ============================================
// 광고 소재 AI 자동 분석 (Gemini 2.5 Flash)
// v5: 429 자동 재시도 + 대기시간 증가 + 토큰 절약
// ============================================

// 🔑 발급받은 Gemini API 키를 여기에 붙여넣기
const GEMINI_API_KEY = 'AIzaSy여기에_본인_API_키_붙여넣기';

// 시트 컬럼 인덱스 (1부터 시작)
const COLS = {
  media_url: 10,
  appeal_points: 24,
  hook_type: 25,
  target_emotion: 26,
  key_message_jp: 27,
  key_message_kr: 28
};

// ⚙️ 속도 설정 (분당 무료 한도 보호)
const SLEEP_BETWEEN_REQUESTS = 8000;   // 분석 사이 대기 (8초 = 분당 7회)
const MAX_RETRY_ON_429 = 3;            // 429 에러 시 재시도 횟수
const RETRY_WAIT_MS = 65000;           // 429 후 65초 대기 (분당 한도 리셋)

// ============================================
// ⚠️ 사전 준비: Advanced Drive Service 활성화 필요
// Apps Script 편집기 → 왼쪽 "서비스" → "+" → "Drive API" 추가
// ============================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🤖 AI 분석')
    .addItem('▶ 선택한 행 분석', 'analyzeSelectedRow')
    .addItem('▶▶ 빈 칸 모두 분석', 'analyzeAllEmpty')
    .addSeparator()
    .addItem('⚙️ 컬럼 위치 확인', 'showColumnInfo')
    .addItem('🎬 영상 썸네일 진단 (상세)', 'diagnoseVideoThumbnail')
    .addItem('📊 API 할당량 정보', 'showQuotaInfo')
    .addToUi();
}

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

function analyzeAllEmpty() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  let count = 0;
  let failCount = 0;

  for (let row = 2; row <= lastRow; row++) {
    const mediaUrl = sheet.getRange(row, COLS.media_url).getValue();
    const appealPoints = sheet.getRange(row, COLS.appeal_points).getValue();

    if (mediaUrl && (!appealPoints || String(appealPoints).startsWith('❌'))) {
      const success = analyzeRow(sheet, row);
      if (success) count++;
      else failCount++;
      Utilities.sleep(SLEEP_BETWEEN_REQUESTS); // 분당 한도 보호
    }
  }
  SpreadsheetApp.getUi().alert(`✅ 완료: ${count}개 성공 / ${failCount}개 실패`);
}

function analyzeRow(sheet, row) {
  const mediaUrl = sheet.getRange(row, COLS.media_url).getValue();
  if (!mediaUrl) return false;

  try {
    const result = analyzeWithGemini(mediaUrl);
    sheet.getRange(row, COLS.appeal_points).setValue(result.appeal_points || '');
    sheet.getRange(row, COLS.hook_type).setValue(result.hook_type || '');
    sheet.getRange(row, COLS.target_emotion).setValue(result.target_emotion || '');
    sheet.getRange(row, COLS.key_message_jp).setValue(result.key_message_jp || '');
    sheet.getRange(row, COLS.key_message_kr).setValue(result.key_message_kr || '');
    return true;
  } catch (e) {
    sheet.getRange(row, COLS.appeal_points).setValue('❌ 오류: ' + e.message);
    return false;
  }
}

function extractDriveFileId(url) {
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Drive API thumbnailLink 가져오기
function getDriveThumbnailLink(fileId) {
  try {
    const file = Drive.Files.get(fileId, {
      fields: 'thumbnailLink,hasThumbnail,videoMediaMetadata,mimeType,name,size',
      supportsAllDrives: true
    });
    if (!file.hasThumbnail || !file.thumbnailLink) return null;
    // ⚠️ v5: 토큰 절약 위해 s800으로 축소 (기존 s1280에서 감소)
    return file.thumbnailLink.replace(/=s\d+$/, '=s800');
  } catch (e) {
    Logger.log(`Drive API 오류: ${e.message}`);
    return null;
  }
}

// 영상 썸네일 다단계 폴백
function fetchVideoThumbnail(fileId) {
  const attempts = [];

  const apiThumbUrl = getDriveThumbnailLink(fileId);
  if (apiThumbUrl) {
    attempts.push({ name: 'Drive API thumbnailLink', url: apiThumbUrl });
  }

  // v5: 사이즈 축소 (토큰 절약)
  attempts.push({ name: '공개 API w800', url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w800` });
  attempts.push({ name: '공개 API w600', url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w600` });
  attempts.push({ name: '공개 API w400', url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400` });
  attempts.push({ name: '공개 API 기본', url: `https://drive.google.com/thumbnail?id=${fileId}` });

  const token = ScriptApp.getOAuthToken();

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      const response = UrlFetchApp.fetch(attempt.url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const code = response.getResponseCode();
      if (code !== 200) {
        Logger.log(`❌ ${attempt.name}: HTTP ${code}`);
        continue;
      }
      const blob = response.getBlob();
      const bytes = blob.getBytes();
      const contentType = (blob.getContentType() || '').toLowerCase();
      if (bytes.length < 3072) {
        Logger.log(`❌ ${attempt.name}: 빈 썸네일 (${bytes.length}b)`);
        continue;
      }
      if (contentType.includes('html') || contentType.includes('text')) {
        Logger.log(`❌ ${attempt.name}: HTML 응답`);
        continue;
      }
      const isImage = contentType.includes('image') || contentType.includes('jpeg') ||
                      contentType.includes('jpg') || contentType.includes('png');
      if (!isImage) continue;
      Logger.log(`✅ ${attempt.name} 성공! ${(bytes.length/1024).toFixed(1)}KB`);
      return blob;
    } catch (e) {
      Logger.log(`❌ ${attempt.name}: ${e.message}`);
    }
  }

  throw new Error(
    '영상 썸네일 생성 실패. ① Drive에서 영상 미리보기 재생 → 30초 후 재시도 ' +
    '② 또는 영상 스크린샷을 별도로 업로드'
  );
}

function fetchImageBlob(url) {
  const fileId = extractDriveFileId(url);
  if (fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      const mimeType = file.getMimeType();
      if (mimeType.startsWith('video/')) return fetchVideoThumbnail(fileId);
      return file.getBlob();
    } catch (e) {
      throw new Error(`Drive 파일 접근 실패: ${e.message}`);
    }
  }
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error(`이미지 다운로드 실패 (HTTP ${response.getResponseCode()})`);
  }
  return response.getBlob();
}

// ★ v5 핵심: 429 자동 재시도 래퍼
function callGeminiWithRetry(payload, retryCount) {
  retryCount = retryCount || 0;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const responseText = response.getContentText();
  const responseCode = response.getResponseCode();

  // 429 에러: 할당량 초과 → 65초 대기 후 자동 재시도
  if (responseCode === 429) {
    if (retryCount >= MAX_RETRY_ON_429) {
      throw new Error(
        `API 할당량 초과 (HTTP 429). ${MAX_RETRY_ON_429}회 재시도 모두 실패. ` +
        `1) 1시간 후 다시 시도하거나 ` +
        `2) 무료 한도(분당 10회/일 250회) 확인하세요. ` +
        `https://aistudio.google.com/app/apikey 에서 사용량 확인 가능`
      );
    }
    Logger.log(`⏰ 429 에러. ${RETRY_WAIT_MS/1000}초 후 재시도 (${retryCount+1}/${MAX_RETRY_ON_429})`);
    Utilities.sleep(RETRY_WAIT_MS);
    return callGeminiWithRetry(payload, retryCount + 1);
  }

  if (responseCode !== 200) {
    throw new Error(`API 오류 (HTTP ${responseCode}): ${responseText.substring(0, 200)}`);
  }

  return responseText;
}

function analyzeWithGemini(mediaUrl) {
  let imageBlob;
  let isVideo = false;

  const fileId = extractDriveFileId(mediaUrl);

  if (fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      const mimeType = file.getMimeType();
      if (mimeType.startsWith('video/')) {
        isVideo = true;
        imageBlob = fetchVideoThumbnail(fileId);
      } else if (mimeType.startsWith('image/')) {
        imageBlob = file.getBlob();
      } else {
        throw new Error(`지원하지 않는 파일 타입: ${mimeType}`);
      }
    } catch (e) {
      throw new Error(`Drive 파일 접근 실패: ${e.message}`);
    }
  } else {
    imageBlob = fetchImageBlob(mediaUrl);
  }

  let mimeType = (imageBlob.getContentType() || '').toLowerCase();
  const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!supportedTypes.includes(mimeType)) mimeType = 'image/jpeg';

  const bytes = imageBlob.getBytes();
  if (bytes.length < 500) {
    throw new Error(`이미지가 너무 작거나 비어있습니다 (${bytes.length} bytes).`);
  }
  if (bytes.length > 20 * 1024 * 1024) {
    throw new Error(`이미지가 너무 큽니다 (${(bytes.length/1024/1024).toFixed(1)}MB).`);
  }

  const base64Image = Utilities.base64Encode(bytes);

  // v5: 프롬프트 압축 (토큰 절약)
  const videoNote = isVideo ? ' (영상의 첫 프레임 썸네일임)' : '';
  const prompt = `일본 시장 광고 소재 분석.${videoNote} JSON으로만 답해:
광고 소재가 아니면 appeal_points에 "❌ 광고소재 아님"만 적기.

{
  "appeal_points": "소구포인트 3-5개 키워드 한국어 쉼표구분 (예: 여름한정, 가성비)",
  "hook_type": "후킹 방식 1-2개 한국어 (예: 사용자후기, 숫자강조)",
  "target_emotion": "타겟 감정 1-2개 한국어 (예: 신뢰, 욕구)",
  "key_message_jp": "핵심 일본어 카피 원문 (없으면 빈 문자열)",
  "key_message_kr": "한국어 번역"
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

  const responseText = callGeminiWithRetry(payload);
  const json = JSON.parse(responseText);

  if (!json.candidates || !json.candidates[0]) {
    throw new Error('API 응답 형식 오류: ' + responseText.substring(0, 150));
  }

  const text = json.candidates[0].content.parts[0].text;
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('JSON 파싱 실패: ' + text.substring(0, 100));
  }
}

function showColumnInfo() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let info = '📋 현재 시트 컬럼 위치:\n\n';
  headers.forEach((h, i) => {
    info += `${i+1}번 (${columnToLetter(i+1)}): ${h}\n`;
  });
  SpreadsheetApp.getUi().alert(info);
}

// ★ v5 신규: API 할당량 정보 표시
function showQuotaInfo() {
  const info =
    '📊 Gemini 2.5 Flash 무료 할당량\n\n' +
    '• 분당 요청 (RPM): 10회\n' +
    '• 분당 토큰 (TPM): 250,000\n' +
    '• 일일 요청 (RPD): 250회\n\n' +
    '⚙️ 현재 설정:\n' +
    `• 분석 사이 대기: ${SLEEP_BETWEEN_REQUESTS/1000}초\n` +
    `• 429 발생 시: ${RETRY_WAIT_MS/1000}초 후 자동 재시도 (최대 ${MAX_RETRY_ON_429}회)\n\n` +
    '💡 권장 운영:\n' +
    '• 한 번에 50개 이하 분석\n' +
    '• 영상이 많으면 더 천천히\n' +
    '• 일일 한도 초과시 24시간 대기\n\n' +
    '🔗 사용량 확인:\n' +
    'https://aistudio.google.com/app/apikey';
  SpreadsheetApp.getUi().alert(info);
}

function diagnoseVideoThumbnail() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const activeCell = sheet.getActiveCell();
  const row = activeCell.getRow();

  if (row < 2) {
    SpreadsheetApp.getUi().alert('⚠️ 데이터 행 선택 필요 (2행 이상)');
    return;
  }

  let url = sheet.getRange(row, COLS.media_url).getValue();
  if (!url) {
    const activeValue = activeCell.getValue();
    if (activeValue && String(activeValue).includes('http')) {
      url = activeValue;
    }
  }
  if (!url) {
    const lastCol = sheet.getLastColumn();
    const rowValues = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
    for (let i = 0; i < rowValues.length; i++) {
      const v = String(rowValues[i] || '');
      if (v.includes('drive.google.com')) {
        url = v;
        break;
      }
    }
  }
  if (!url) {
    SpreadsheetApp.getUi().alert('❌ 이 행에 URL이 없습니다.');
    return;
  }

  const fileId = extractDriveFileId(url);
  if (!fileId) {
    SpreadsheetApp.getUi().alert('❌ Google Drive 링크가 아닙니다.');
    return;
  }

  let report = '🔍 영상 썸네일 진단\n\n';
  try {
    const file = DriveApp.getFileById(fileId);
    report += `📄 파일명: ${file.getName()}\n`;
    report += `📦 MIME: ${file.getMimeType()}\n`;
    report += `💾 크기: ${(file.getSize()/1024/1024).toFixed(2)} MB\n\n`;
  } catch (e) {
    report += `❌ 파일 접근 실패: ${e.message}\n`;
    SpreadsheetApp.getUi().alert(report);
    return;
  }

  try {
    const driveFile = Drive.Files.get(fileId, {
      fields: 'thumbnailLink,hasThumbnail,videoMediaMetadata',
      supportsAllDrives: true
    });
    report += `🔗 hasThumbnail: ${driveFile.hasThumbnail}\n`;
    report += `🔗 thumbnailLink: ${driveFile.thumbnailLink ? '있음 ✅' : '없음 ❌'}\n\n`;
  } catch (e) {
    report += `⚠️ Drive API 호출 실패: ${e.message}\n\n`;
  }

  SpreadsheetApp.getUi().alert(report);
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
