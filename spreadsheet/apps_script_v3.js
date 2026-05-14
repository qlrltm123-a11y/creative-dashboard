// ============================================
// 광고 소재 AI 자동 분석 (Gemini 2.5 Flash)
// v3: 영상 썸네일 다중 폴백 + MIME 타입 강제 변환
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
    .addItem('🧪 미디어 다운로드 테스트', 'testImageDownload')
    .addItem('🎬 영상 썸네일 테스트', 'testVideoThumbnail')
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

// Drive 파일 ID 추출
function extractDriveFileId(url) {
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// ★ v3 핵심: 영상 썸네일 다중 폴백 전략
// 영상 업로드 직후엔 썸네일이 미생성 상태이거나 빈 이미지일 수 있음
// 여러 사이즈와 방법을 순차 시도
function fetchVideoThumbnail(fileId) {
  const attempts = [
    // 1차: 큰 사이즈 썸네일 (가장 선명)
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w1280`,
    // 2차: 중간 사이즈
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`,
    // 3차: 작은 사이즈 (썸네일 생성 빠름)
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`,
    // 4차: 기본 사이즈
    `https://drive.google.com/thumbnail?id=${fileId}`
  ];

  for (let i = 0; i < attempts.length; i++) {
    try {
      const response = UrlFetchApp.fetch(attempts[i], {
        muteHttpExceptions: true,
        followRedirects: true
      });
      const code = response.getResponseCode();
      if (code !== 200) continue;

      const blob = response.getBlob();
      const bytes = blob.getBytes();

      // 빈 이미지 체크 (1KB 이하면 썸네일 미생성으로 간주)
      if (bytes.length < 1024) continue;

      // 컨텐츠 타입이 이미지가 아니면 스킵
      const contentType = (blob.getContentType() || '').toLowerCase();
      if (!contentType.includes('image') && !contentType.includes('jpeg') && !contentType.includes('png')) {
        continue;
      }

      Logger.log(`✅ 썸네일 획득 (시도 ${i+1}/${attempts.length}, 크기: ${(bytes.length/1024).toFixed(1)}KB, 타입: ${contentType})`);
      return blob;
    } catch (e) {
      Logger.log(`시도 ${i+1} 실패: ${e.message}`);
      continue;
    }
  }

  throw new Error(
    '영상 썸네일 생성 실패. 다음을 확인하세요:\n' +
    '1) 영상이 업로드된지 5분 이상 지났는지\n' +
    '2) 영상이 "링크가 있는 모든 사용자" 공유 설정인지\n' +
    '3) 영상 파일 크기가 너무 크지 않은지 (1GB 미만 권장)'
  );
}

// 미디어 다운로드 테스트용 (디버깅)
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

// Gemini API 호출
function analyzeWithGemini(mediaUrl) {
  let imageBlob;
  let isVideo = false;

  const fileId = extractDriveFileId(mediaUrl);

  if (fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      const mimeType = file.getMimeType();
      Logger.log(`파일 MIME 타입: ${mimeType}`);

      if (mimeType.startsWith('video/')) {
        // 영상이면 썸네일 다중 폴백 시도
        isVideo = true;
        imageBlob = fetchVideoThumbnail(fileId);
      } else if (mimeType.startsWith('image/')) {
        // 이미지면 그대로
        imageBlob = file.getBlob();
      } else {
        throw new Error(`지원하지 않는 파일 타입: ${mimeType}`);
      }
    } catch (e) {
      throw new Error(`Drive 파일 접근 실패: ${e.message}`);
    }
  } else {
    // 외부 URL
    imageBlob = fetchImageBlob(mediaUrl);
  }

  // ★ v3 핵심: MIME 타입 강제 변환
  // Gemini Vision API는 image/jpeg, image/png, image/webp, image/heic, image/heif만 지원
  let mimeType = (imageBlob.getContentType() || '').toLowerCase();
  Logger.log(`Blob MIME: ${mimeType}, 크기: ${imageBlob.getBytes().length} bytes`);

  // image/* 가 아니거나 지원하지 않는 타입이면 jpeg로 변환
  const supportedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!supportedTypes.includes(mimeType)) {
    // Drive 썸네일은 종종 image/jpeg로 응답하지만 content-type 헤더가 누락되거나 다른 값일 수 있음
    // 강제로 image/jpeg로 처리
    mimeType = 'image/jpeg';
  }
  // image/jpg는 일부 API에서 미지원이므로 image/jpeg로 표준화
  if (mimeType === 'image/jpg') {
    mimeType = 'image/jpeg';
  }

  const bytes = imageBlob.getBytes();

  // 빈 이미지 방어
  if (bytes.length < 500) {
    throw new Error(`이미지가 너무 작거나 비어있습니다 (${bytes.length} bytes). 영상이면 썸네일이 아직 생성되지 않았을 수 있습니다.`);
  }

  // 이미지가 너무 크면 (20MB 초과) 경고
  if (bytes.length > 20 * 1024 * 1024) {
    throw new Error(`이미지가 너무 큽니다 (${(bytes.length/1024/1024).toFixed(1)}MB). 20MB 이하여야 합니다.`);
  }

  const base64Image = Utilities.base64Encode(bytes);

  // 프롬프트 (영상 여부에 따라 살짝 안내문 추가)
  const videoNote = isVideo
    ? '\n\n참고: 이 이미지는 영상의 첫 프레임 썸네일입니다. 영상 전체 흐름을 추측해서 분석하세요.'
    : '';

  const prompt = `당신은 일본 시장 전문 광고 마케팅 분석가입니다.
이 이미지는 일본 시장 광고 소재입니다. 분석하여 아래 JSON 형식으로만 답해주세요.
다른 설명, 마크다운, 코드블록 등은 절대 추가하지 마세요.${videoNote}

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
  const responseCode = response.getResponseCode();

  if (responseCode !== 200) {
    // 영상이고 400 에러면 더 친절한 메시지
    if (isVideo && responseCode === 400) {
      throw new Error(
        `영상 썸네일 분석 실패 (HTTP 400). ` +
        `Drive에서 영상 썸네일이 아직 생성되지 않았을 수 있습니다. ` +
        `5-10분 후 다시 시도하거나, 영상에서 스크린샷을 캡처해서 이미지로 업로드해보세요. ` +
        `원본 응답: ${responseText.substring(0, 200)}`
      );
    }
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

// 미디어 다운로드 테스트 (디버깅용)
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

// ★ v3 신규: 영상 썸네일 단독 테스트
function testVideoThumbnail() {
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

  const fileId = extractDriveFileId(url);
  if (!fileId) {
    SpreadsheetApp.getUi().alert('Google Drive 링크가 아닙니다');
    return;
  }

  try {
    const file = DriveApp.getFileById(fileId);
    const mimeType = file.getMimeType();
    const fileName = file.getName();
    const fileSize = file.getSize();

    let info = `📄 파일 정보:\n`;
    info += `- 이름: ${fileName}\n`;
    info += `- 타입: ${mimeType}\n`;
    info += `- 크기: ${(fileSize/1024/1024).toFixed(2)} MB\n\n`;

    if (mimeType.startsWith('video/')) {
      info += `🎬 영상 파일 → 썸네일 시도 중...\n\n`;
      const blob = fetchVideoThumbnail(fileId);
      const thumbSize = blob.getBytes().length;
      const thumbType = blob.getContentType();
      info += `✅ 썸네일 획득 성공!\n`;
      info += `- 타입: ${thumbType}\n`;
      info += `- 크기: ${(thumbSize/1024).toFixed(1)} KB`;
    } else {
      info += `🖼️ 이미지 파일 (썸네일 불필요)`;
    }

    SpreadsheetApp.getUi().alert(info);
  } catch (e) {
    SpreadsheetApp.getUi().alert(`❌ 실패:\n${e.message}`);
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
