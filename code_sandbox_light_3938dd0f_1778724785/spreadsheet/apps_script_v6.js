// ============================================
// 광고 소재 AI 자동 분석 (Gemini 2.5 Flash)
// v6: API 키 5개 분산 (일일 한도 5배 확장)
// ============================================

// 🔑 API 키 여러 개 등록 (분당/일일 한도 분산)
// 각 Google 계정 → https://aistudio.google.com/app/apikey 에서 키 발급
const API_KEYS = [
  'AIza_계정1_키_여기에_입력',
  'AIza_계정2_키_여기에_입력',
  'AIza_계정3_키_여기에_입력',
  'AIza_계정4_키_여기에_입력',
  'AIza_계정5_키_여기에_입력'
];

// 시트 컬럼 인덱스 (1부터 시작)
const COLS = {
  media_url: 10,
  appeal_points: 24,
  hook_type: 25,
  target_emotion: 26,
  key_message_jp: 27,
  key_message_kr: 28
};

// 속도 설정
const SLEEP_BETWEEN_REQUESTS = 3000;   // 키가 여러 개라 짧게 (3초)
const MAX_RETRY_PER_KEY = 1;           // 키당 재시도 횟수

// ============================================
// ⚠️ 사전 준비:
// 1. Advanced Drive Service 활성화 (왼쪽 "서비스" → Drive API 추가)
// 2. API_KEYS 배열에 5개 키 입력
// ============================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🤖 AI 분석')
    .addItem('▶ 선택한 행 분석', 'analyzeSelectedRow')
    .addItem('▶▶ 빈 칸 모두 분석', 'analyzeAllEmpty')
    .addSeparator()
    .addItem('⚙️ 컬럼 위치 확인', 'showColumnInfo')
    .addItem('🎬 영상 썸네일 진단', 'diagnoseVideoThumbnail')
    .addItem('🔑 API 키 상태 확인', 'showApiKeyStatus')
    .addToUi();
}

// 현재 사용 중인 키 인덱스 (PropertiesService로 영구 저장)
function getCurrentKeyIndex() {
  const props = PropertiesService.getScriptProperties();
  const idx = parseInt(props.getProperty('current_key_index') || '0');
  return idx % API_KEYS.length;
}

function rotateKey() {
  const props = PropertiesService.getScriptProperties();
  const current = getCurrentKeyIndex();
  const next = (current + 1) % API_KEYS.length;
  props.setProperty('current_key_index', String(next));
  return next;
}

function getActiveApiKey() {
  // 유효한 키 찾기 (placeholder 제외)
  const validKeys = API_KEYS.filter(k => k && !k.includes('여기에'));
  if (validKeys.length === 0) {
    throw new Error('⚠️ API_KEYS 배열에 유효한 키가 없습니다. 코드 상단에 키를 입력하세요.');
  }
  let idx = getCurrentKeyIndex();
  // placeholder 키 건너뛰기
  let attempts = 0;
  while (API_KEYS[idx].includes('여기에') && attempts < API_KEYS.length) {
    idx = rotateKey();
    attempts++;
  }
  return { key: API_KEYS[idx], index: idx };
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
  let count = 0, failCount = 0;

  for (let row = 2; row <= lastRow; row++) {
    const mediaUrl = sheet.getRange(row, COLS.media_url).getValue();
    const appealPoints = sheet.getRange(row, COLS.appeal_points).getValue();

    if (mediaUrl && (!appealPoints || String(appealPoints).startsWith('❌'))) {
      const success = analyzeRow(sheet, row);
      if (success) count++;
      else failCount++;
      rotateKey(); // 매 분석마다 키 로테이션
      Utilities.sleep(SLEEP_BETWEEN_REQUESTS);
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

function getDriveThumbnailLink(fileId) {
  try {
    const file = Drive.Files.get(fileId, {
      fields: 'thumbnailLink,hasThumbnail,videoMediaMetadata,mimeType',
      supportsAllDrives: true
    });
    if (!file.hasThumbnail || !file.thumbnailLink) return null;
    return file.thumbnailLink.replace(/=s\d+$/, '=s600'); // 토큰 절약
  } catch (e) {
    return null;
  }
}

function fetchVideoThumbnail(fileId) {
  const attempts = [];
  const apiThumbUrl = getDriveThumbnailLink(fileId);
  if (apiThumbUrl) attempts.push({ name: 'API thumbnailLink', url: apiThumbUrl });
  attempts.push({ name: '공개 w600', url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w600` });
  attempts.push({ name: '공개 w400', url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400` });

  const token = ScriptApp.getOAuthToken();
  for (const attempt of attempts) {
    try {
      const response = UrlFetchApp.fetch(attempt.url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (response.getResponseCode() !== 200) continue;
      const blob = response.getBlob();
      const bytes = blob.getBytes();
      if (bytes.length < 3072) continue;
      const ct = (blob.getContentType() || '').toLowerCase();
      if (ct.includes('html') || ct.includes('text')) continue;
      if (!ct.includes('image') && !ct.includes('jpeg') && !ct.includes('png')) continue;
      return blob;
    } catch (e) { continue; }
  }
  throw new Error('영상 썸네일 생성 실패. Drive에서 영상 미리보기 재생 후 재시도하세요.');
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
    throw new Error(`다운로드 실패 (HTTP ${response.getResponseCode()})`);
  }
  return response.getBlob();
}

// ★ v6 핵심: 429 시 다음 키로 즉시 전환
function callGeminiWithKeyRotation(payload, triedKeys) {
  triedKeys = triedKeys || [];
  const validKeyCount = API_KEYS.filter(k => k && !k.includes('여기에')).length;

  if (triedKeys.length >= validKeyCount) {
    throw new Error(
      `모든 ${validKeyCount}개 API 키가 한도 초과. ` +
      `1시간 후 재시도 또는 키를 추가 등록하세요. ` +
      `(현재 등록된 유효 키: ${validKeyCount}개)`
    );
  }

  const { key, index } = getActiveApiKey();
  if (triedKeys.includes(index)) {
    rotateKey();
    return callGeminiWithKeyRotation(payload, triedKeys);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const responseText = response.getContentText();
  const responseCode = response.getResponseCode();

  // 429: 이 키는 한도 초과 → 다음 키로 즉시 전환 (대기 없음!)
  if (responseCode === 429) {
    Logger.log(`⚠️ 키 #${index+1} 한도 초과 → 다음 키로 전환`);
    triedKeys.push(index);
    rotateKey();
    return callGeminiWithKeyRotation(payload, triedKeys);
  }

  if (responseCode !== 200) {
    throw new Error(`API 오류 (HTTP ${responseCode}): ${responseText.substring(0, 200)}`);
  }
  return responseText;
}

function analyzeWithGemini(mediaUrl) {
  let imageBlob, isVideo = false;
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
  const supported = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!supported.includes(mimeType)) mimeType = 'image/jpeg';

  const bytes = imageBlob.getBytes();
  if (bytes.length < 500) throw new Error(`이미지 너무 작음 (${bytes.length}b)`);
  if (bytes.length > 20 * 1024 * 1024) throw new Error(`이미지 너무 큼 (${(bytes.length/1024/1024).toFixed(1)}MB)`);

  const base64Image = Utilities.base64Encode(bytes);
  const videoNote = isVideo ? ' (영상 첫 프레임)' : '';
  const prompt = `일본 광고 소재 분석.${videoNote} JSON으로만 답해:
광고 아니면 appeal_points에 "❌ 광고소재 아님"만.

{
  "appeal_points": "소구포인트 3-5개 한국어 쉼표구분",
  "hook_type": "후킹 1-2개 한국어",
  "target_emotion": "감정 1-2개 한국어",
  "key_message_jp": "일본어 카피 원문",
  "key_message_kr": "한국어 번역"
}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }],
    generationConfig: { temperature: 0.4, responseMimeType: "application/json" }
  };

  const responseText = callGeminiWithKeyRotation(payload);
  const json = JSON.parse(responseText);
  if (!json.candidates || !json.candidates[0]) {
    throw new Error('API 응답 형식 오류');
  }
  const text = json.candidates[0].content.parts[0].text;
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('JSON 파싱 실패');
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

function showApiKeyStatus() {
  const validKeys = API_KEYS.filter(k => k && !k.includes('여기에'));
  const currentIdx = getCurrentKeyIndex();
  let info = '🔑 API 키 등록 상태\n\n';
  info += `총 슬롯: ${API_KEYS.length}개\n`;
  info += `유효 키: ${validKeys.length}개\n`;
  info += `현재 키: #${currentIdx + 1}\n\n`;
  info += `📊 일일 무료 한도:\n`;
  info += `${validKeys.length}개 × 250회 = ${validKeys.length * 250}회/일\n\n`;
  info += `📊 분당 한도:\n`;
  info += `${validKeys.length}개 × 10회 = ${validKeys.length * 10}회/분\n\n`;
  info += '💡 키가 부족하면 코드 상단 API_KEYS 배열에 추가하세요.';
  SpreadsheetApp.getUi().alert(info);
}

function diagnoseVideoThumbnail() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    SpreadsheetApp.getUi().alert('데이터 행 선택 필요');
    return;
  }
  let url = sheet.getRange(row, COLS.media_url).getValue();
  if (!url) {
    SpreadsheetApp.getUi().alert('이 행에 URL이 없습니다');
    return;
  }
  const fileId = extractDriveFileId(url);
  if (!fileId) {
    SpreadsheetApp.getUi().alert('Drive 링크가 아닙니다');
    return;
  }
  let report = '🔍 진단 결과\n\n';
  try {
    const file = DriveApp.getFileById(fileId);
    report += `파일: ${file.getName()}\n`;
    report += `MIME: ${file.getMimeType()}\n`;
    report += `크기: ${(file.getSize()/1024/1024).toFixed(2)} MB\n\n`;
  } catch (e) {
    report += `❌ 접근 실패: ${e.message}`;
  }
  try {
    const dFile = Drive.Files.get(fileId, { fields: 'thumbnailLink,hasThumbnail' });
    report += `hasThumbnail: ${dFile.hasThumbnail}\n`;
    report += `thumbnailLink: ${dFile.thumbnailLink ? '있음' : '없음'}`;
  } catch (e) {
    report += `Drive API: ${e.message}`;
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
