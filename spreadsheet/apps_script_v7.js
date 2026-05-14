// ============================================
// 광고 소재 AI 자동 분석 (Gemini 2.5 Flash)
// v7: 유료 등급 최적화 + 자체 일일 한도 + 카운터 + 메일 알림
// ============================================

// 🔑 유료 결제 활성화된 API 키 1개 (충분합니다)
// https://aistudio.google.com/app/apikey 에서 발급
const GEMINI_API_KEY = 'AIza_여기에_유료_키_입력';

// 🛡️ 자체 안전장치 (Cloud Console 권한 없어도 코드 레벨에서 차단)
const DAILY_CALL_LIMIT = 3000;          // 일일 최대 호출 수 (이거 넘으면 자동 차단)
const COST_PER_CALL = 0.0003;            // 1회당 평균 비용 (USD)
const ALERT_EMAIL = '';                  // 한도 80% 도달 시 알림 받을 이메일 (빈칸이면 알림 X)
const ALERT_THRESHOLD = 0.8;             // 80% 도달 시 메일 알림

// 시트 컬럼 인덱스 (1부터 시작)
const COLS = {
  media_url: 10,
  appeal_points: 24,
  hook_type: 25,
  target_emotion: 26,
  key_message_jp: 27,
  key_message_kr: 28
};

// 속도 설정 (유료 등급은 RPM 1000+ 이므로 빠르게 가능)
const SLEEP_BETWEEN_REQUESTS = 1000;     // 1초 간격 (유료 등급)
const MAX_RETRY_ON_429 = 2;              // 429 발생 시 재시도 횟수
const RETRY_WAIT_MS = 5000;              // 재시도 대기 (유료는 짧게)

// ============================================
// ⚠️ 사전 준비:
// 1. Advanced Drive Service 활성화 (왼쪽 "서비스" → Drive API 추가)
// 2. GEMINI_API_KEY 에 유료 결제 활성화된 키 입력
// 3. (선택) ALERT_EMAIL 에 알림 받을 이메일 입력
// ============================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🤖 AI 분석')
    .addItem('▶ 선택한 행 분석', 'analyzeSelectedRow')
    .addItem('▶▶ 빈 칸 모두 분석 (6분 제한)', 'analyzeAllEmpty')
    .addItem('🌙 끝까지 자동 처리 (이어달리기)', 'startAutoRunUntilDone')
    .addItem('⏹️ 자동 처리 중단', 'stopAutoRun')
    .addSeparator()
    .addItem('📊 오늘 사용량 / 비용', 'showUsageStats')
    .addItem('🔄 일일 카운터 수동 리셋', 'resetDailyCounter')
    .addSeparator()
    .addItem('⚙️ 컬럼 위치 확인', 'showColumnInfo')
    .addItem('🎬 영상 썸네일 진단', 'diagnoseVideoThumbnail')
    .addToUi();
}

// ============================================
// 🌙 이어달리기: 6분 제한 우회해서 끝까지 자동 처리
// ============================================

const AUTO_RUN_TRIGGER_NAME = 'autoRunContinue';
const SAFE_RUNTIME_MS = 5 * 60 * 1000;  // 5분 안전 마진 (6분 제한 대비)

function startAutoRunUntilDone() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();

  // 처리할 빈 칸 개수 미리 계산
  let emptyCount = 0;
  for (let row = 2; row <= lastRow; row++) {
    const mediaUrl = sheet.getRange(row, COLS.media_url).getValue();
    const appealPoints = sheet.getRange(row, COLS.appeal_points).getValue();
    if (mediaUrl && (!appealPoints || String(appealPoints).startsWith('❌'))) {
      emptyCount++;
    }
  }

  if (emptyCount === 0) {
    ui.alert('✅ 처리할 빈 칸이 없습니다.');
    return;
  }

  const estimatedCost = emptyCount * COST_PER_CALL;
  const estimatedMinutes = Math.ceil(emptyCount * (SLEEP_BETWEEN_REQUESTS + 3000) / 1000 / 60);

  const resp = ui.alert(
    '🌙 끝까지 자동 처리',
    `처리할 빈 칸: ${emptyCount}개\n` +
    `예상 비용: $${estimatedCost.toFixed(3)} (≒ ${Math.round(estimatedCost * 1400)}원)\n` +
    `예상 소요시간: 약 ${estimatedMinutes}분\n\n` +
    `6분 제한을 자동으로 이어가며 끝까지 처리합니다.\n` +
    `노트북 꺼도 Google 서버가 계속 실행합니다.\n\n` +
    `시작하시겠습니까?`,
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  // 기존 트리거 모두 제거 (중복 방지)
  removeAutoRunTriggers();

  // 진행 상태 초기화 (★ 시트 ID 저장이 핵심)
  const props = PropertiesService.getScriptProperties();
  props.setProperty('AUTO_RUN_ACTIVE', 'true');
  props.setProperty('AUTO_RUN_LAST_ROW', '1');  // 다음 시작 행 (2부터 시작)
  props.setProperty('AUTO_RUN_TOTAL_PROCESSED', '0');
  props.setProperty('AUTO_RUN_START_TIME', String(new Date().getTime()));
  props.setProperty('AUTO_RUN_SPREADSHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  props.setProperty('AUTO_RUN_SHEET_NAME', sheet.getName());

  ui.alert(`🚀 자동 처리 시작!\n\n` +
    `예상 완료까지 약 ${estimatedMinutes}분.\n` +
    `중간에 멈추려면 메뉴 → "⏹️ 자동 처리 중단"\n` +
    `현황 확인은 "📊 오늘 사용량 / 비용"`);

  // 즉시 첫 실행 시작
  autoRunContinue();
}

function autoRunContinue() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('AUTO_RUN_ACTIVE') !== 'true') {
    removeAutoRunTriggers();
    return;
  }

  // ★ 트리거 실행 시에도 정확한 시트를 잡기 위해 저장된 ID 사용
  const spreadsheetId = props.getProperty('AUTO_RUN_SPREADSHEET_ID');
  const sheetName = props.getProperty('AUTO_RUN_SHEET_NAME');
  let sheet;

  if (spreadsheetId && sheetName) {
    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      sheet = ss.getSheetByName(sheetName);
      if (!sheet) throw new Error(`시트 "${sheetName}"를 찾을 수 없음`);
    } catch (e) {
      Logger.log('❌ 시트 접근 실패: ' + e.message);
      stopAutoRun(true);
      sendCompletionMail(0, '❌ 시트 접근 실패: ' + e.message);
      return;
    }
  } else {
    // 폴백: 활성 시트
    sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  }

  const lastRow = sheet.getLastRow();
  Logger.log(`▶ 자동 처리 회차 시작: 시트="${sheet.getName()}", 마지막 행=${lastRow}`);
  const startRow = parseInt(props.getProperty('AUTO_RUN_LAST_ROW') || '1') + 1;
  const startTime = new Date().getTime();
  let processed = 0;
  let failCount = 0;
  let currentRow = startRow;
  let dailyLimitHit = false;

  for (let row = startRow; row <= lastRow; row++) {
    currentRow = row;

    // 시간 체크: 5분 넘으면 중단하고 다음 트리거 예약
    if (new Date().getTime() - startTime > SAFE_RUNTIME_MS) {
      Logger.log(`⏰ 5분 도달 → 행 ${row}에서 중단, 다음 트리거 예약`);
      props.setProperty('AUTO_RUN_LAST_ROW', String(row - 1));
      scheduleNextRun();
      logProgress(processed, failCount);
      return;
    }

    const mediaUrl = sheet.getRange(row, COLS.media_url).getValue();
    const appealPoints = sheet.getRange(row, COLS.appeal_points).getValue();

    if (mediaUrl && (!appealPoints || String(appealPoints).startsWith('❌'))) {
      // 일일 한도 체크
      try {
        checkDailyLimit();
      } catch (e) {
        Logger.log('🛑 일일 한도 도달, 자동 처리 중단');
        dailyLimitHit = true;
        break;
      }

      const success = analyzeRow(sheet, row);
      if (success) processed++;
      else failCount++;
      Utilities.sleep(SLEEP_BETWEEN_REQUESTS);
    }
  }

  // 끝까지 도달 or 한도 도달 → 완료 처리
  props.setProperty('AUTO_RUN_LAST_ROW', String(currentRow));
  logProgress(processed, failCount);

  const totalProcessed = parseInt(props.getProperty('AUTO_RUN_TOTAL_PROCESSED') || '0') + processed;
  props.setProperty('AUTO_RUN_TOTAL_PROCESSED', String(totalProcessed));

  if (dailyLimitHit) {
    stopAutoRun(true);
    sendCompletionMail(totalProcessed, '🛑 일일 한도 도달로 자동 중단');
  } else {
    // 모든 행 처리 완료
    stopAutoRun(true);
    sendCompletionMail(totalProcessed, '✅ 모든 빈 칸 처리 완료');
  }
}

function scheduleNextRun() {
  removeAutoRunTriggers();
  ScriptApp.newTrigger(AUTO_RUN_TRIGGER_NAME)
    .timeBased()
    .after(60 * 1000)  // 1분 후 재시작
    .create();
}

function removeAutoRunTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === AUTO_RUN_TRIGGER_NAME) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function stopAutoRun(silent) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('AUTO_RUN_ACTIVE', 'false');
  removeAutoRunTriggers();
  if (!silent) {
    const totalProcessed = props.getProperty('AUTO_RUN_TOTAL_PROCESSED') || '0';
    SpreadsheetApp.getUi().alert(`⏹️ 자동 처리 중단됨\n누적 처리: ${totalProcessed}건`);
  }
}

function logProgress(processed, failCount) {
  Logger.log(`📊 이번 회차: ${processed}건 성공 / ${failCount}건 실패`);
}

function sendCompletionMail(totalProcessed, statusMsg) {
  if (!ALERT_EMAIL) return;
  try {
    const cost = totalProcessed * COST_PER_CALL;
    MailApp.sendEmail(
      ALERT_EMAIL,
      `🤖 광고소재 AI 자동 처리 완료`,
      `${statusMsg}\n\n` +
      `누적 처리: ${totalProcessed}건\n` +
      `예상 비용: $${cost.toFixed(3)} (≒ ${Math.round(cost * 1400)}원)\n` +
      `완료 시각: ${new Date().toLocaleString('ko-KR')}`
    );
  } catch (e) {
    Logger.log('완료 메일 발송 실패: ' + e.message);
  }
}

// ============================================
// 🛡️ 일일 한도 카운터 (PropertiesService 사용)
// ============================================

function getTodayKey() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function getDailyCount() {
  const props = PropertiesService.getScriptProperties();
  const today = getTodayKey();
  const lastDate = props.getProperty('LAST_DATE');
  let count = parseInt(props.getProperty('CALL_COUNT') || '0');

  // 날짜가 바뀌면 자동 리셋
  if (lastDate !== today) {
    count = 0;
    props.setProperty('LAST_DATE', today);
    props.setProperty('CALL_COUNT', '0');
    props.setProperty('ALERT_SENT', 'false');
  }
  return count;
}

function incrementDailyCount() {
  const props = PropertiesService.getScriptProperties();
  const count = getDailyCount() + 1;
  props.setProperty('CALL_COUNT', String(count));

  // 80% 도달 시 메일 알림 (한 번만)
  if (ALERT_EMAIL && count >= DAILY_CALL_LIMIT * ALERT_THRESHOLD) {
    const alertSent = props.getProperty('ALERT_SENT') === 'true';
    if (!alertSent) {
      try {
        MailApp.sendEmail(
          ALERT_EMAIL,
          `⚠️ Gemini API 일일 한도 ${Math.floor(ALERT_THRESHOLD * 100)}% 도달`,
          `오늘 사용량: ${count} / ${DAILY_CALL_LIMIT} 회\n` +
          `예상 비용: $${(count * COST_PER_CALL).toFixed(3)}\n\n` +
          `한도(${DAILY_CALL_LIMIT}회) 도달 시 자동 차단됩니다.`
        );
        props.setProperty('ALERT_SENT', 'true');
      } catch (e) {
        Logger.log('메일 발송 실패: ' + e.message);
      }
    }
  }
  return count;
}

function checkDailyLimit() {
  const count = getDailyCount();
  if (count >= DAILY_CALL_LIMIT) {
    throw new Error(
      `🛑 일일 한도(${DAILY_CALL_LIMIT}회) 초과. ` +
      `오늘 사용: ${count}회. 내일 자동 리셋됩니다. ` +
      `(긴급 시 메뉴 → "일일 카운터 수동 리셋")`
    );
  }
}

function resetDailyCounter() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert(
    '일일 카운터 리셋',
    '오늘 사용량을 0으로 리셋합니다. 계속하시겠습니까?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  const props = PropertiesService.getScriptProperties();
  props.setProperty('CALL_COUNT', '0');
  props.setProperty('LAST_DATE', getTodayKey());
  props.setProperty('ALERT_SENT', 'false');
  ui.alert('✅ 리셋 완료. 오늘 사용량 = 0');
}

function showUsageStats() {
  const count = getDailyCount();
  const cost = count * COST_PER_CALL;
  const remaining = DAILY_CALL_LIMIT - count;
  const percent = (count / DAILY_CALL_LIMIT * 100).toFixed(1);

  let info = '📊 오늘 사용량 / 비용\n\n';
  info += `📅 날짜: ${getTodayKey()}\n`;
  info += `📞 호출 수: ${count} / ${DAILY_CALL_LIMIT} (${percent}%)\n`;
  info += `💰 예상 비용: $${cost.toFixed(4)} (≒ ${Math.round(cost * 1400)}원)\n`;
  info += `🎫 남은 호출: ${remaining}회\n\n`;

  if (count >= DAILY_CALL_LIMIT) {
    info += '🛑 일일 한도 도달! 호출 차단 중\n';
  } else if (count >= DAILY_CALL_LIMIT * ALERT_THRESHOLD) {
    info += '⚠️ 80% 초과 - 주의\n';
  } else {
    info += '✅ 정상\n';
  }

  info += `\n💡 월 예상 (현재 추세 유지 시):\n`;
  info += `  ${count * 30}회 × $${COST_PER_CALL} = $${(count * 30 * COST_PER_CALL).toFixed(2)}`;

  SpreadsheetApp.getUi().alert(info);
}

// ============================================
// 메인 분석 함수
// ============================================

function analyzeSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    SpreadsheetApp.getUi().alert('데이터 행을 선택해주세요 (2행 이상)');
    return;
  }
  try {
    checkDailyLimit();
    analyzeRow(sheet, row);
    SpreadsheetApp.getUi().alert(`✅ 분석 완료! (오늘 ${getDailyCount()}회 사용)`);
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ ' + e.message);
  }
}

function analyzeAllEmpty() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  let count = 0, failCount = 0, blockedByLimit = false;

  for (let row = 2; row <= lastRow; row++) {
    const mediaUrl = sheet.getRange(row, COLS.media_url).getValue();
    const appealPoints = sheet.getRange(row, COLS.appeal_points).getValue();

    if (mediaUrl && (!appealPoints || String(appealPoints).startsWith('❌'))) {
      try {
        checkDailyLimit();
      } catch (e) {
        blockedByLimit = true;
        break;
      }
      const success = analyzeRow(sheet, row);
      if (success) count++;
      else failCount++;
      Utilities.sleep(SLEEP_BETWEEN_REQUESTS);
    }
  }

  let msg = `✅ 완료: ${count}개 성공 / ${failCount}개 실패\n`;
  msg += `📊 오늘 누적: ${getDailyCount()} / ${DAILY_CALL_LIMIT}\n`;
  msg += `💰 오늘 누적 비용: $${(getDailyCount() * COST_PER_CALL).toFixed(4)}`;
  if (blockedByLimit) msg += '\n\n🛑 일일 한도 도달로 중단됨';
  SpreadsheetApp.getUi().alert(msg);
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

// ============================================
// Drive / 이미지 / 영상 처리
// ============================================

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
    return file.thumbnailLink.replace(/=s\d+$/, '=s1280'); // 유료 등급 → 고화질 사용
  } catch (e) {
    return null;
  }
}

function fetchVideoThumbnail(fileId) {
  const attempts = [];
  const apiThumbUrl = getDriveThumbnailLink(fileId);
  if (apiThumbUrl) attempts.push({ name: 'API thumbnailLink', url: apiThumbUrl });
  attempts.push({ name: '공개 w1280', url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1280` });
  attempts.push({ name: '공개 w800', url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w800` });
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

// ============================================
// Gemini API 호출 (유료 등급 + 429 안전장치)
// ============================================

function callGeminiAPI(payload, retryCount) {
  retryCount = retryCount || 0;

  if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('여기에')) {
    throw new Error('⚠️ GEMINI_API_KEY를 코드 상단에 입력하세요.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const responseText = response.getContentText();
  const responseCode = response.getResponseCode();

  // 429: 유료 등급에서도 가끔 발생 - 짧게 대기 후 재시도
  if (responseCode === 429) {
    if (retryCount >= MAX_RETRY_ON_429) {
      throw new Error(`429 한도 초과 (${MAX_RETRY_ON_429}회 재시도 실패)`);
    }
    Logger.log(`⚠️ 429 - ${RETRY_WAIT_MS / 1000}초 대기 후 재시도 (${retryCount + 1}/${MAX_RETRY_ON_429})`);
    Utilities.sleep(RETRY_WAIT_MS);
    return callGeminiAPI(payload, retryCount + 1);
  }

  if (responseCode !== 200) {
    throw new Error(`API 오류 (HTTP ${responseCode}): ${responseText.substring(0, 200)}`);
  }

  // 성공 시 카운터 증가
  incrementDailyCount();
  return responseText;
}

function analyzeWithGemini(mediaUrl) {
  // 호출 직전에도 한도 체크 (이중 안전장치)
  checkDailyLimit();

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
  if (bytes.length > 20 * 1024 * 1024) throw new Error(`이미지 너무 큼 (${(bytes.length / 1024 / 1024).toFixed(1)}MB)`);

  const base64Image = Utilities.base64Encode(bytes);
  const videoNote = isVideo ? ' (영상 첫 프레임)' : '';

  // 유료 등급 → 프롬프트 품질 복원 (자세하게)
  const prompt = `일본 시장 광고 소재 분석.${videoNote} 반드시 JSON 형식으로만 답하세요.
광고 소재가 아니면 appeal_points 필드에 "❌ 광고소재 아님"만 입력.

{
  "appeal_points": "주요 소구포인트 3-5개를 한국어로 쉼표 구분 (예: 가성비, 디자인, 신뢰성)",
  "hook_type": "후킹 방식 1-2개 한국어 (예: 호기심 유발, 문제 제기)",
  "target_emotion": "유발하는 감정 1-2개 한국어 (예: 안도감, 기대감)",
  "key_message_jp": "핵심 카피 일본어 원문 그대로",
  "key_message_kr": "위 카피의 자연스러운 한국어 번역"
}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Image } }] }],
    generationConfig: { temperature: 0.4, responseMimeType: "application/json" }
  };

  const responseText = callGeminiAPI(payload);
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

// ============================================
// 유틸리티
// ============================================

function showColumnInfo() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let info = '📋 현재 시트 컬럼 위치:\n\n';
  headers.forEach((h, i) => {
    info += `${i + 1}번 (${columnToLetter(i + 1)}): ${h}\n`;
  });
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
    report += `크기: ${(file.getSize() / 1024 / 1024).toFixed(2)} MB\n\n`;
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
