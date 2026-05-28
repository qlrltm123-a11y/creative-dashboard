module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY 환경변수 없음. Vercel 설정 필요.' });
  }

  // 폴더 ID 추출
  const folderUrl = req.query?.folder || '';
  const folderIdMatch = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/) ||
                        folderUrl.match(/^([a-zA-Z0-9_-]{20,})$/);
  const folderId = folderIdMatch?.[1];
  if (!folderId) {
    return res.status(400).json({ error: '폴더 URL에서 ID를 찾을 수 없어요. Drive 폴더 URL을 그대로 붙여넣어 주세요.' });
  }

  try {
    // 폴더 내 이미지 파일 목록 조회 (최대 50개)
    const apiUrl = `https://www.googleapis.com/drive/v3/files` +
      `?q='${folderId}'+in+parents+and+(mimeType+contains+'image/')` +
      `&fields=files(id,name,mimeType,thumbnailLink)` +
      `&pageSize=50` +
      `&key=${GOOGLE_API_KEY}`;

    const r = await fetch(apiUrl);
    const data = await r.json();

    if (!r.ok) {
      const msg = data?.error?.message || JSON.stringify(data);
      return res.status(r.status).json({ error: `Drive API 오류: ${msg}` });
    }

    const files = (data.files || []).map(f => ({
      id:    f.id,
      name:  f.name,
      url:   `https://drive.google.com/uc?export=view&id=${f.id}`,
      thumb: f.thumbnailLink || null,
    }));

    return res.status(200).json({ count: files.length, files });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
};
