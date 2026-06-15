// POST /api/analyze-video
// Drive 영상 URL → Gemini Files API 업로드 → 전체 영상 내용 분석
// 환경변수: GEMINI_API_KEY, GOOGLE_API_KEY (Drive 다운로드)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
  const DRIVE_KEY  = process.env.GOOGLE_API_KEY  || '';
  if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 없습니다.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { videoUrl, creativeName, question } = body || {};
  if (!videoUrl) return res.status(400).json({ error: 'videoUrl이 필요합니다.' });

  // ── 1) Drive 파일 ID 추출 → 다운로드 URL ──
  const driveIdMatch = videoUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                       videoUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const driveId = driveIdMatch?.[1];

  let downloadUrl = videoUrl;
  if (driveId && DRIVE_KEY) {
    // Drive API alt=media 다운로드 (파일이 "링크 있는 모든 사용자" 공유 필요)
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${driveId}?alt=media&key=${DRIVE_KEY}`;
  } else if (driveId) {
    // API key 없으면 uc?export=download 시도
    downloadUrl = `https://drive.google.com/uc?export=download&id=${driveId}&confirm=t`;
  }

  // ── 2) 영상 다운로드 ──
  let videoBuffer, mimeType;
  try {
    const dlRes = await fetch(downloadUrl, { redirect: 'follow' });
    if (!dlRes.ok) {
      return res.status(502).json({
        error: `영상 다운로드 실패 (HTTP ${dlRes.status}). ` +
               `Drive 파일이 "링크 있는 모든 사용자 — 뷰어"로 공유되어 있는지 확인해주세요.`,
      });
    }
    mimeType = (dlRes.headers.get('content-type') || 'video/mp4').split(';')[0].trim();
    if (!mimeType.startsWith('video/') && !mimeType.startsWith('image/')) mimeType = 'video/mp4';

    const MAX = 80 * 1024 * 1024; // 80 MB
    const cl = parseInt(dlRes.headers.get('content-length') || '0');
    if (cl > MAX) return res.status(413).json({ error: `영상이 너무 큽니다 (${Math.round(cl/1024/1024)}MB). 80MB 이하만 가능합니다.` });

    const buf = await dlRes.arrayBuffer();
    if (buf.byteLength > MAX) return res.status(413).json({ error: `영상이 너무 큽니다 (${Math.round(buf.byteLength/1024/1024)}MB).` });
    videoBuffer = Buffer.from(buf);
  } catch (e) {
    return res.status(502).json({ error: `영상 다운로드 오류: ${e.message}` });
  }

  // ── 3) Gemini Files API 업로드 (resumable) ──
  let fileUri;
  try {
    // 3-a) 업로드 세션 시작
    const initRes = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(videoBuffer.byteLength),
          'X-Goog-Upload-Header-Content-Type': mimeType,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: creativeName || 'creative_video' } }),
      }
    );
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}));
      return res.status(502).json({ error: `Files API 초기화 실패: ${err?.error?.message || initRes.status}` });
    }
    const uploadUrl = initRes.headers.get('x-goog-upload-url');
    if (!uploadUrl) return res.status(502).json({ error: 'Files API upload URL을 받지 못했습니다.' });

    // 3-b) 바이트 업로드
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length': String(videoBuffer.byteLength),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
        'Content-Type': mimeType,
      },
      body: videoBuffer,
    });
    const uploadData = await uploadRes.json();
    fileUri = uploadData?.file?.uri;
    if (!fileUri) return res.status(502).json({ error: `Files API 업로드 실패: ${JSON.stringify(uploadData)}` });
  } catch (e) {
    return res.status(502).json({ error: `Files API 오류: ${e.message}` });
  }

  // ── 4) Gemini generateContent — 영상 전체 분석 ──
  const extraQ = (question || '').trim();
  const analysisPrompt = `당신은 일본 이커머스(라쿠텐 메가와리) 퍼포먼스 마케팅 전문가입니다.
소재명: ${creativeName || '(미상)'}
${extraQ ? `추가 질문: ${extraQ}\n` : ''}
이 광고 영상의 전체 내용을 아래 항목으로 분석해주세요.

### 1. 영상 전체 구조
- 시작(첫 3초) → 중간 → 마무리 흐름 요약

### 2. 후킹 방식
- 첫 3초 장면 묘사 & 사용된 카피 문장

### 3. 핵심 소구포인트
- 영상이 내세우는 제품 강점 (실제 화면/자막 기반)

### 4. 타겟 감정
- 이 영상이 노리는 감정 반응 (설렘/신뢰/불안해소/FOMO 등)

### 5. 비주얼 & 카피 스타일
- 색감·편집 속도·자막 스타일 특징

### 6. 약기법(薬機法) 주의 표현
- 위반 가능성 있는 표현 있으면 명시, 없으면 "이상 없음"

### 7. 개선 제안
- ROAS/CTR 향상을 위해 강화하거나 수정할 요소

모든 답변은 한국어로. 실제 영상에서 본 내용만 기반으로 작성.`;

  const contents = [{ role: 'user', parts: [{ fileData: { mimeType, fileUri } }, { text: analysisPrompt }] }];
  const genCfg = { temperature: 0.3, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } };

  const candidates = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash-exp'];
  try {
    let last;
    for (const model of candidates) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, generationConfig: genCfg }) }
      );
      const data = await r.json();
      if (r.ok) {
        const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
        if (text) return res.status(200).json({ text, model, fileSizeMB: +(videoBuffer.byteLength / 1024 / 1024).toFixed(1) });
      }
      last = data;
      const msg = data?.error?.message || '';
      if (!/not found|no longer available|not supported/i.test(msg)) break;
    }
    return res.status(502).json({ error: last?.error?.message || '영상 분석 응답이 비어있습니다.' });
  } catch (e) {
    return res.status(502).json({ error: `분석 오류: ${e.message}` });
  }
};
