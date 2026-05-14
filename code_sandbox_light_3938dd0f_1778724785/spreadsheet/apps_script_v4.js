// ============================================
// 광고 소재 AI 자동 분석 (Gemini 2.5 Flash)
// v4: Drive API thumbnailLink + videoMediaMetadata + 다중 폴백
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

// ============================================
// ⚠️ 사전 준비: Advanced Drive Service 활성화 필요
// Apps Script 편집기 → 왼쪽 메뉴 "서비스" → "+" → "Drive API" 추가
// ============================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🤖 AI 분석')
    .addItem('▶ 선택한 행 분석', 'analyzeSelectedRow')
    .addItem('▶▶ 빈 칸 모두 분석', 'analyzeAllEmpty')
    .addSeparator()
    .addItem('⚙️ 컬럼 위치 확인', 'showColumnInfo')
    .addItem('🎬 영상 썸네일 진단 (상세)', 'diagnoseVideoThumbnail')
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

  for (let row = 2; row <= lastRow; row++) {
    const mediaUrl = sheet.getRange(row, COLS.media_url).getValue();
    const appealPoints = sheet.getRange(row, COLS.appeal_points).getValue();

    if (mediaUrl && (!appealPoints || String(appealPoints).startsWith('❌'))) {
      analyzeRow(sheet, row);
      count++;
      Utilities.sleep(4000);
    }
  }
  SpreadsheetApp.getUi().alert(`✅ ${count}개 소재 분석 완료!`);
}

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

function extractDriveFileId(url) {
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// ★ v4 핵심 1: Drive API로 진짜 썸네일 URL 가져오기
function getDriveThumbnailLink(fileId) {
  try {
    // Advanced Drive Service 사용 (Drive API v3)
    const file = Drive.Files.get(fileId, {
      fields: 'thumbnailLink,hasThumbnail,videoMediaMetadata,mimeType,name,size',
      supportsAllDrives: true
    });

    Logger.log(`Drive API 응답: ${JSON.stringify(file)}`);

    if (!file.hasThumbnail || !file.thumbnailLink) {
      return null;
    }

    // thumbnailLink는 기본적으로 s220 (220px) 사이즈
    // =s1280으로 바꿔서 더 큰 이미지 요청
    return file.thumbnailLink.replace(/=s\d+$/, '=s1280');
  } catch (e) {
    Logger.log(`Drive API 오류: ${e.message}`);
    return null;
  }
}

// ★ v4 핵심 2: 다단계 썸네일 획득 전략
function fetchVideoThumbnail(fileId) {
  const attempts = [];

  // 전략 1: Drive API thumbnailLink (가장 안정적)
  const apiThumbUrl = getDriveThumbnailLink(fileId);
  if (apiThumbUrl) {
    attempts.push({ name: 'Drive API thumbnailLink', url: apiThumbUrl });
  }

  // 전략 2: 공개 thumbnail API (다양한 사이즈)
  attempts.push({ name: '공개 API w1280', url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1280` });
  attempts.push({ name: '공개 API w800', url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w800` });
  attempts.push({ name: '공개 API w400', url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400` });
  attempts.push({ name: '공개 API 기본', url: `https://drive.google.com/thumbnail?id=${fileId}` });

  // OAuth 토큰 추가 (인증 필요한 썸네일도 받기 위해)
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

      // 빈 이미지 검증 (3KB 이상이어야 진짜 썸네일)
      if (bytes.length < 3072) {
        Logger.log(`❌ ${attempt.name}: 빈 썸네일 (${bytes.length}b)`);
        continue;
      }

      // HTML 응답 차단 (로그인 페이지 등)
      if (contentType.includes('html') || contentType.includes('text')) {
        Logger.log(`❌ ${attempt.name}: HTML 응답`);
        continue;
      }

      // 이미지 타입 검증
      const isImage = contentType.includes('image') ||
                      contentType.includes('jpeg') ||
                      contentType.includes('jpg') ||
                      contentType.includes('png');
      if (!isImage) {
        Logger.log(`❌ ${attempt.name}: 비이미지 타입(${contentType})`);
        continue;
      }

      Logger.log(`✅ ${attempt.name} 성공! ${(bytes.length/1024).toFixed(1)}KB, ${contentType}`);
      return blob;
    } catch (e) {
      Logger.log(`❌ ${attempt.name}: 예외 ${e.message}`);
      continue;
    }
  }

  // 모두 실패 - 친절한 안내 메시지
  throw new Error(
    '영상 썸네일 생성 실패. 해결 방법:\n' +
    '① 영상을 한 번 더 클릭해서 Drive 미리보기에서 재생해보세요 (썸네일 생성 트리거)\n' +
    '② 그래도 안되면 영상 캡처 스크린샷을 따로 업로드하여 그 URL을 media_url에 입력\n' +
    '③ "영상 썸네일 진단" 메뉴로 상세 원인 확인'
  );
}

function fetchImageBlob(url) {
  const fileId = extractDriveFileId(url);

  if (fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      const mimeType = file.getMimeType();

      if (mimeType.startsWith('video/')) {
        return fetchVideoThumbnail(fileId);
      } else {
        return file.getBlob();
      }
    } catch (e) {
      throw new Error(`Drive 파일 접근 실패: ${e.message}`);
    }
  }

  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = response.getResponseCode();
  if (code !== 200) {
    throw new Error(`이미지 다운로드 실패 (HTTP ${code})`);
  }
  return response.getBlob();
}

function analyzeWithGemini(mediaUrl) {
  let imageBlob;
  let isVideo = false;

  const fileId = extractDriveFileId(mediaUrl);

  if (fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      const mimeType = file.getMimeType();
      Logger.log(`파일 MIME: ${mimeType}`);

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

  // MIME 타입 강제 변환 (Gemini Vision API 호환)
  let mimeType = (imageBlob.getContentType() || '').toLowerCase();
  const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!supportedTypes.includes(mimeType)) {
    mimeType = 'image/jpeg';
  }

  const bytes = imageBlob.getBytes();
  if (bytes.length < 500) {
    throw new Error(`이미지가 너무 작거나 비어있습니다 (${bytes.length} bytes).`);
  }
  if (bytes.length > 20 * 1024 * 1024) {
    throw new Error(`이미지가 너무 큽니다 (${(bytes.length/1024/1024).toFixed(1)}MB).`);
  }

  const base64Image = Utilities.base64Encode(bytes);

  const videoNote = isVideo
    ? '\n\n참고: 이 이미지는 영상의 첫 프레임 썸네일입니다. 영상 전체 흐름을 추측해서 분석하세요.'
    : '';

  const prompt = `당신은 일본 시장 전문 광고 마케팅 분석가입니다.
이 이미지는 일본 시장 광고 소재입니다. 분석하여 아래 JSON 형식으로만 답해주세요.
다른 설명, 마크다운, 코드블록 등은 절대 추가하지 마세요.${videoNote}

⚠️ 만약 이 이미지가 광고 소재가 아니라 로그인 화면, 에러 페이지, 일반 웹사이트 등이면
appeal_points에 "❌ 광고소재 아님" 이라고만 적어주세요.

{
  "appeal_points": "소구포인트를 자유로운 키워드로 3-5개 (한국어, 쉼표구분)",
  "hook_type": "후킹 방식 1-2개 키워드 (한국어)",
  "target_emotion": "타겟이 느낄 감정 1-2개 키워드 (한국어)",
  "key_message_jp": "소재 안의 핵심 일본어 카피/문구 (원문 그대로)",
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
  const responseCode = response.getResponseCode();

  if (responseCode !== 200) {
    throw new Error(`API 오류 (HTTP ${responseCode}): ${responseText.substring(0, 200)}`);
  }

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

// ★ v4 신규: 영상 썸네일 상세 진단 도구 (자동 URL 탐색)
function diagnoseVideoThumbnail() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const activeCell = sheet.getActiveCell();
  const row = activeCell.getRow();

  if (row < 2) {
    SpreadsheetApp.getUi().alert(
      '⚠️ 데이터 행을 선택해주세요 (2행 이상)\n\n' +
      '현재 선택: ' + activeCell.getA1Notation() + '\n' +
      '헤더(1행)가 아닌, 영상 URL이 입력된 행의 셀을 클릭한 후 다시 실행하세요.'
    );
    return;
  }

  // 1차: 설정된 COLS.media_url 위치에서 시도
  let url = sheet.getRange(row, COLS.media_url).getValue();
  let foundCol = COLS.media_url;
  let foundMethod = `설정된 컬럼 ${columnToLetter(COLS.media_url)}(${COLS.media_url}번)`;

  // 2차: URL이 없으면 현재 활성 셀 자체에서 확인
  if (!url) {
    const activeValue = activeCell.getValue();
    if (activeValue && String(activeValue).includes('http')) {
      url = activeValue;
      foundCol = activeCell.getColumn();
      foundMethod = `현재 셀 ${activeCell.getA1Notation()}`;
    }
  }

  // 3차: 그래도 없으면 같은 행 전체 스캔
  if (!url) {
    const lastCol = sheet.getLastColumn();
    const rowValues = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
    for (let i = 0; i < rowValues.length; i++) {
      const v = String(rowValues[i] || '');
      if (v.includes('drive.google.com') || (v.includes('http') && (v.includes('.jpg') || v.includes('.png') || v.includes('.mp4') || v.includes('.mov')))) {
        url = v;
        foundCol = i + 1;
        foundMethod = `자동탐색 ${columnToLetter(i+1)}열(${i+1}번)`;
        break;
      }
    }
  }

  if (!url) {
    // 헤더 정보까지 보여서 친절한 안내
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    let info = '❌ 이 행에 URL이 없습니다.\n\n';
    info += `선택된 행: ${row}행\n`;
    info += `선택된 셀: ${activeCell.getA1Notation()}\n`;
    info += `코드 설정 media_url 위치: ${columnToLetter(COLS.media_url)}열 (${COLS.media_url}번)\n\n`;
    info += '📋 현재 시트 헤더:\n';
    headers.forEach((h, i) => {
      const colLetter = columnToLetter(i+1);
      const marker = (i+1 === COLS.media_url) ? ' ★현재설정★' : '';
      info += `  ${colLetter}(${i+1}): ${h}${marker}\n`;
    });
    info += '\n💡 해결: 코드 상단 COLS.media_url 값을 실제 컬럼 번호로 수정하세요.';
    SpreadsheetApp.getUi().alert(info);
    return;
  }

  const fileId = extractDriveFileId(url);
  if (!fileId) {
    SpreadsheetApp.getUi().alert(
      `❌ Google Drive 링크가 아닙니다.\n\n` +
      `발견된 URL (${foundMethod}):\n${String(url).substring(0, 200)}\n\n` +
      `💡 Drive 링크 형식 예시:\n` +
      `https://drive.google.com/file/d/[파일ID]/view`
    );
    return;
  }

  let report = '🔍 영상 썸네일 진단 결과\n\n';

  // 1. 파일 기본 정보
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

  // 2. Drive API thumbnailLink 확인
  try {
    const driveFile = Drive.Files.get(fileId, {
      fields: 'thumbnailLink,hasThumbnail,videoMediaMetadata,mimeType',
      supportsAllDrives: true
    });
    report += `🔗 hasThumbnail: ${driveFile.hasThumbnail}\n`;
    report += `🔗 thumbnailLink: ${driveFile.thumbnailLink ? '있음 ✅' : '없음 ❌'}\n`;
    if (driveFile.videoMediaMetadata) {
      report += `🎬 영상 메타: ${JSON.stringify(driveFile.videoMediaMetadata)}\n`;
    }
    report += '\n';
  } catch (e) {
    report += `⚠️ Drive API 호출 실패 (Advanced Drive Service 활성화 필요): ${e.message}\n\n`;
  }

  // 3. 각 썸네일 URL 시도 결과
  const token = ScriptApp.getOAuthToken();
  const tests = [
    { name: 'API w1280', url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1280` },
    { name: 'API w400', url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400` }
  ];

  for (const t of tests) {
    try {
      const res = UrlFetchApp.fetch(t.url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const code = res.getResponseCode();
      const blob = res.getBlob();
      const size = blob.getBytes().length;
      const type = blob.getContentType();
      report += `${t.name}: HTTP ${code}, ${(size/1024).toFixed(1)}KB, ${type}\n`;
    } catch (e) {
      report += `${t.name}: 예외 ${e.message}\n`;
    }
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
