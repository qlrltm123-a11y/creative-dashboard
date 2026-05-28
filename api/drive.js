module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ error: 'GOOGLE_API_KEY 환경변수 없음' });
  }

  const folderUrl = req.query?.folder || '';
  const folderIdMatch =
    folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/) ||
    folderUrl.match(/^([a-zA-Z0-9_-]{25,})$/);
  const folderId = folderIdMatch?.[1];

  if (!folderId) {
    return res.status(400).json({ error: '폴더 URL에서 ID를 찾을 수 없어요.' });
  }

  // Step 1: 폴더 접근 가능 여부 확인
  try {
    const checkUrl = `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType&key=${GOOGLE_API_KEY}`;
    const checkR = await fetch(checkUrl);
    const checkData = await checkR.json();

    if (!checkR.ok) {
      const code = checkData?.error?.code;
      const msg  = checkData?.error?.message || JSON.stringify(checkData);
      if (code === 403) return res.status(403).json({ error: `접근 거부: 폴더를 "링크 있는 모든 사용자 - 뷰어"로 공유해주세요.\n(${msg})` });
      if (code === 404) return res.status(404).json({ error: `폴더를 찾을 수 없어요. URL을 확인해주세요.\n(${msg})` });
      return res.status(checkR.status).json({ error: `Drive API 오류 [${code}]: ${msg}` });
    }
  } catch (e) {
    return res.status(502).json({ error: `네트워크 오류: ${e.message}` });
  }

  // Step 2: 폴더 내 이미지 파일 목록
  try {
    const q = encodeURIComponent(`'${folderId}' in parents and mimeType contains 'image/' and trashed = false`);
    const fields = encodeURIComponent('files(id,name,mimeType,thumbnailLink,imageMediaMetadata)');
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=50&key=${GOOGLE_API_KEY}`;

    const r = await fetch(listUrl);
    const data = await r.json();

    if (!r.ok) {
      const msg = data?.error?.message || JSON.stringify(data);
      return res.status(r.status).json({ error: `파일 목록 오류: ${msg}` });
    }

    const files = (data.files || []).map(f => ({
      id:    f.id,
      name:  f.name,
      url:   `https://drive.google.com/uc?export=view&id=${f.id}`,
      thumb: f.thumbnailLink?.replace('=s220', '=s400') || null,
    }));

    return res.status(200).json({ count: files.length, files });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
};
