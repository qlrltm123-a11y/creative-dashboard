// ============================================
// 광고 소재 AI 분석 - 단순 작동 보장 버전
// ============================================

// 🔑 API 키
const GEMINI_API_KEY = 'AIzaSyAeJxxNh4fA7SlUyssU5vI-GwYV_eupMQg';

// ⚠️ 시트의 실제 컬럼 번호로 수정하세요!
const COLS = {
  media_url: 10,        // ← J열 (URL 위치)
  appeal_points: 22,    // ← V열 (결과 쓸 자리, 비어있어야 함)
  hook_type: 23,
  target_emotion: 24,
  key_message_jp: 25,
  key_message_kr: 26
};

const SLEEP_MS = 1500;
const DAILY_LIMIT = 3000;

// ============================================
// 메뉴
// ============================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🤖 AI 분석')
    .addItem('1️⃣ 컬럼 확인 (먼저 실행!)', 'showColumnInfo')
    .addItem('2️⃣ 처리 대상 진단', 'debugWhyZero')
    .addSeparator()
    .addItem('▶ 선택한 행 분석', 'analyzeSelectedRow')
    .addItem('▶▶ 빈 칸 모두 분석 (6분 제한)', 'analyzeAllEmpty')
    .addItem('🌙 끝까지 자동 처리', 'startAutoRun')
    .addItem('⏹️ 자동 처리 중단', 'stopAutoRun')
    .addSeparator()
    .addItem('📊 진행 상태', 'showStatus')
    .addItem('🔄 모든 상태 리셋', 'fullReset')
    .addToUi();
}

// ============================================
// 진단 도구 (먼저 실행해서 문제 파악)
// ============================================

function showColumnInfo() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  let info = '📋 시트의 모든 컬럼:\n\n';
  headers.forEach((h, i) => {
    const num = i + 1;
    const marker = (num === COLS.media_url) ? ' ← URL' :
                   (num === COLS.appeal_points) ? ' ← 결과쓸자리' : '';
    info += `${num}번 (${columnToLetter(num)}): ${h}${marker}\n`;
  });
  info += `\n\n현재 코드 설정:\n`;
  info += `URL: ${COLS.media_url}번\n`;
  info += `결과: ${COLS.appeal_points}번\n`;
  SpreadsheetApp.getUi().alert(info);
}

function debugWhyZero() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();

  let report = '=== 처리 대상 진단 ===\n\n';
  report += `시트: ${sheet.getName()}\n`;
  report += `행 수: ${lastRow}\n\n`;

  let hasUrl = 0, hasAppeal = 0, isTarget = 0;

  for (let row = 2; row <= lastRow; row++) {
    const url = sheet.getRange(row, COLS.media_url).getValue();
    const ap = sheet.getRange(row, COLS.appeal_points).getValue();
    if (url) hasUrl++;
    if (ap) hasAppeal++;
    if (url && (!ap || String(ap).startsWith('❌'))) isTarget++;
  }

  report += `📊 결과:\n`;
  report += `  URL 있는 행: ${hasUrl}개\n`;
  report += `  결과컬럼 채워진 행: ${hasAppeal}개\n`;
  report += `  → 처리 대상: ${isTarget}개\n\n`;

  // 첫 3행 샘플
  report += `=== 샘플 (2~4행) ===\n`;
  for (let row = 2; row <= Math.min(4, lastRow); row++) {
    const url = sheet.getRange(row, COLS.media_url).getValue();
    const ap = sheet.getRange(row, COLS.appeal_points).getValue();
    const will = url && (!ap || String(ap).startsWith('❌'));
    report += `\n행${row}: ${will ? '✅처리' : '❌건너뜀'}\n`;
    report += `  URL: "${String(url).substring(0, 30)}"\n`;
    report += `  결과: "${String(ap).substring(0, 30)}"\n`;
  }

  SpreadsheetApp.getUi().alert(report);
}

function showStatus() {
  const p = PropertiesService.getScriptProperties();
  let info = '📊 현재 상태\n\n';
  info += `오늘 호출: ${p.getProperty('CALL_COUNT') || 0} / ${DAILY_LIMIT}\n`;
  info += `자동처리 활성: ${p.getProperty('AUTO_RUN_ACTIVE') || 'false'}\n`;
  info += `마지막 처리 행: ${p.getProperty('AUTO_RUN_LAST_ROW') || '-'}\n`;
  info += `누적 처리: ${p.getProperty('AUTO_RUN_TOTAL') || 0}\n`;
  info += `등록된 트리거: ${ScriptApp.getProjectTriggers().length}개`;
  SpreadsheetApp.getUi().alert(info);
}

function fullReset() {
  const p = PropertiesService.getScriptProperties();
  p.deleteAllProperties();
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  SpreadsheetApp.getUi().alert('✅ 모든 상태 리셋 완료');
}

// ============================================
// 분석 함수들
// ============================================

function analyzeSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    SpreadsheetApp.getUi().alert('데이터 행 선택 필요 (2행 이상)');
    return;
  }
  const success = analyzeRow(sheet, row);
  SpreadsheetApp.getUi().alert(success ? '✅ 완료!' : '❌ 실패');
}

function analyzeAllEmpty() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  let ok = 0, fail = 0;

  for (let row = 2; row <= lastRow; row++) {
    const url = sheet.getRange(row, COLS.media_url).getValue();
    const ap = sheet.getRange(row, COLS.appeal_points).getValue();
    if (url && (!ap || String(ap).startsWith('❌'))) {
      if (getCallCount() >= DAILY_LIMIT) break;
      if (analyzeRow(sheet, row)) ok++;
      else fail++;
      Utilities.sleep(SLEEP_MS);
    }
  }
  SpreadsheetApp.getUi().alert(`완료\n성공: ${ok}\n실패: ${fail}`);
}

function analyzeRow(sheet, row) {
  const url = sheet.getRange(row, COLS.media_url).getValue();
  if (!url) return false;
  try {
    const r = analyzeWithGemini(url);
    sheet.getRange(row, COLS.appeal_points).setValue(r.appeal_points || '');
    sheet.getRange(row, COLS.hook_type).setValue(r.hook_type || '');
    sheet.getRange(row, COLS.target_emotion).setValue(r.target_emotion || '');
    sheet.getRange(row, COLS.key_message_jp).setValue(r.key_message_jp || '');
    sheet.getRange(row, COLS.key_message_kr).setValue(r.key_message_kr || '');
    return true;
  } catch (e) {
    sheet.getRange(row, COLS.appeal_points).setValue('❌ ' + e.message);
    return false;
  }
}

// ============================================
// 자동 처리 (이어달리기)
// ============================================

function startAutoRun() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();

  let cnt = 0;
  for (let r = 2; r <= lastRow; r++) {
    const url = sheet.getRange(r, COLS.media_url).getValue();
    const ap = sheet.getRange(r, COLS.appeal_points).getValue();
    if (url && (!ap || String(ap).startsWith('❌'))) cnt++;
  }

  if (cnt === 0) {
    ui.alert('처리할 빈 칸이 없습니다.\n\n"2️⃣ 처리 대상 진단"으로 컬럼 설정 확인하세요.');
    return;
  }

  const resp = ui.alert('자동 처리 시작',
    `${cnt}개 행 처리 예정\n예상 비용: $${(cnt * 0.0003).toFixed(3)}\n\n시작?`,
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;

  // 트리거 정리
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'autoRunContinue') ScriptApp.deleteTrigger(t);
  });

  const p = PropertiesService.getScriptProperties();
  p.setProperty('AUTO_RUN_ACTIVE', 'true');
  p.setProperty('AUTO_RUN_LAST_ROW', '1');
  p.setProperty('AUTO_RUN_TOTAL', '0');
  p.setProperty('AUTO_SS_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  p.setProperty('AUTO_SHEET_NAME', sheet.getName());

  ui.alert(`🚀 시작!\n${cnt}개 처리 예정\n중단: "⏹️ 자동 처리 중단"`);

  autoRunContinue();
}

function autoRunContinue() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('AUTO_RUN_ACTIVE') !== 'true') return;

  const ssId = p.getProperty('AUTO_SS_ID');
  const sheetName = p.getProperty('AUTO_SHEET_NAME');
  let sheet;
  try {
    sheet = SpreadsheetApp.openById(ssId).getSheetByName(sheetName);
    if (!sheet) throw new Error('시트 없음');
  } catch (e) {
    Logger.log('시트 접근 실패: ' + e.message);
    stopAutoRun(true);
    return;
  }

  const lastRow = sheet.getLastRow();
  const startRow = parseInt(p.getProperty('AUTO_RUN_LAST_ROW')) + 1;
  const t0 = Date.now();
  let processed = 0;

  Logger.log(`회차 시작: 행 ${startRow}부터, 마지막 ${lastRow}`);

  for (let row = startRow; row <= lastRow; row++) {
    // 5분 도달 → 다음 회차로
    if (Date.now() - t0 > 5 * 60 * 1000) {
      p.setProperty('AUTO_RUN_LAST_ROW', String(row - 1));
      ScriptApp.newTrigger('autoRunContinue').timeBased().after(60 * 1000).create();
      Logger.log(`5분 도달, 행 ${row}에서 중단`);
      return;
    }

    const url = sheet.getRange(row, COLS.media_url).getValue();
    const ap = sheet.getRange(row, COLS.appeal_points).getValue();

    if (url && (!ap || String(ap).startsWith('❌'))) {
      if (getCallCount() >= DAILY_LIMIT) {
        Logger.log('일일 한도 도달');
        break;
      }
      analyzeRow(sheet, row);
      processed++;
      Utilities.sleep(SLEEP_MS);
    }
    p.setProperty('AUTO_RUN_LAST_ROW', String(row));
  }

  const total = parseInt(p.getProperty('AUTO_RUN_TOTAL') || '0') + processed;
  p.setProperty('AUTO_RUN_TOTAL', String(total));
  Logger.log(`완료: ${processed}건 (누적 ${total})`);
  stopAutoRun(true);
}

function stopAutoRun(silent) {
  const p = PropertiesService.getScriptProperties();
  p.setProperty('AUTO_RUN_ACTIVE', 'false');
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'autoRunContinue') ScriptApp.deleteTrigger(t);
  });
  if (!silent) {
    SpreadsheetApp.getUi().alert(`⏹️ 중단됨\n누적 처리: ${p.getProperty('AUTO_RUN_TOTAL') || 0}건`);
  }
}

// ============================================
// 카운터
// ============================================

function getCallCount() {
  const p = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (p.getProperty('CALL_DATE') !== today) {
    p.setProperty('CALL_DATE', today);
    p.setProperty('CALL_COUNT', '0');
  }
  return parseInt(p.getProperty('CALL_COUNT') || '0');
}

function incrementCallCount() {
  const p = PropertiesService.getScriptProperties();
  p.setProperty('CALL_COUNT', String(getCallCount() + 1));
}

// ============================================
// Gemini API
// ============================================

function callGemini(payload, retry) {
  retry = retry || 0;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const text = res.getContentText();

  if (code === 429 && retry < 2) {
    Utilities.sleep(5000);
    return callGemini(payload, retry + 1);
  }
  if (code !== 200) throw new Error(`HTTP ${code}: ${text.substring(0, 150)}`);

  incrementCallCount();
  return text;
}

function analyzeWithGemini(mediaUrl) {
  let blob;
  const fileId = extractDriveFileId(mediaUrl);

  if (fileId) {
    const file = DriveApp.getFileById(fileId);
    const mime = file.getMimeType();
    if (mime.startsWith('video/')) blob = fetchVideoThumbnail(fileId);
    else if (mime.startsWith('image/')) blob = file.getBlob();
    else throw new Error('지원안함: ' + mime);
  } else {
    blob = UrlFetchApp.fetch(mediaUrl, { muteHttpExceptions: true }).getBlob();
  }

  let mime = (blob.getContentType() || 'image/jpeg').toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) mime = 'image/jpeg';

  const bytes = blob.getBytes();
  if (bytes.length < 500) throw new Error('이미지 작음');

  const payload = {
    contents: [{
      parts: [
        { text: `일본 광고 분석. JSON만:\n{"appeal_points":"한국어 3-5개","hook_type":"한국어","target_emotion":"한국어","key_message_jp":"일본어","key_message_kr":"한국어"}` },
        { inline_data: { mime_type: mime, data: Utilities.base64Encode(bytes) } }
      ]
    }],
    generationConfig: { temperature: 0.4, responseMimeType: "application/json" }
  };

  const resText = callGemini(payload);
  const json = JSON.parse(resText);
  const txt = json.candidates[0].content.parts[0].text;
  try { return JSON.parse(txt); }
  catch (e) {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('JSON 파싱 실패');
  }
}

function extractDriveFileId(url) {
  const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
            url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
            url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function fetchVideoThumbnail(fileId) {
  let thumbUrl = null;
  try {
    const f = Drive.Files.get(fileId, { fields: 'thumbnailLink,hasThumbnail' });
    if (f.hasThumbnail && f.thumbnailLink) {
      thumbUrl = f.thumbnailLink.replace(/=s\d+$/, '=s1280');
    }
  } catch (e) {}

  const urls = thumbUrl ? [thumbUrl] : [];
  urls.push(`https://drive.google.com/thumbnail?id=${fileId}&sz=w1280`);
  urls.push(`https://drive.google.com/thumbnail?id=${fileId}&sz=w800`);

  const token = ScriptApp.getOAuthToken();
  for (const u of urls) {
    try {
      const res = UrlFetchApp.fetch(u, {
        muteHttpExceptions: true,
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (res.getResponseCode() !== 200) continue;
      const blob = res.getBlob();
      if (blob.getBytes().length < 3072) continue;
      const ct = (blob.getContentType() || '').toLowerCase();
      if (ct.includes('html') || ct.includes('text')) continue;
      return blob;
    } catch (e) { continue; }
  }
  throw new Error('영상 썸네일 생성 실패');
}

function columnToLetter(col) {
  let s = '';
  while (col > 0) {
    const m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - m) / 26);
  }
  return s;
}
