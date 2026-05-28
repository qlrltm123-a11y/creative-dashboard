// Vercel 서버리스 함수 — Higgsfield 공식 SDK 사용
import { higgsfield, config } from '@higgsfield/client/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hf-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // API 키: 요청 헤더 → 환경변수 순서
  const apiKey = req.headers['x-hf-key']
    || (req.headers.authorization || '').replace(/^Key\s*/i, '')
    || process.env.HF_CREDENTIALS
    || '';

  if (!apiKey) {
    return res.status(401).json({ error: 'API 키 없음. HF_CREDENTIALS 환경변수를 Vercel에 설정해주세요.' });
  }

  const { prompt, aspect_ratio = '1:1', type = 'image' } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt 필드 필요' });

  // SDK 인증 설정
  config({ credentials: apiKey });

  try {
    let jobSet;

    if (type === 'video') {
      // 영상 생성
      jobSet = await higgsfield.subscribe('dop/image-to-video', {
        input: { prompt, aspect_ratio, safety_tolerance: 2 },
        withPolling: true,
      });
    } else {
      // 이미지 생성
      jobSet = await higgsfield.subscribe('nano_banana_flash/text-to-image', {
        input: { prompt, aspect_ratio, safety_tolerance: 2 },
        withPolling: true,
      });
    }

    // 결과 URL 추출
    const job = jobSet?.jobs?.[0];
    const imageUrl = job?.results?.raw?.url || job?.results?.rawUrl || job?.results?.minUrl;
    const videoUrl = job?.results?.raw?.url || job?.results?.url;
    const resultUrl = type === 'video' ? videoUrl : imageUrl;

    if (!resultUrl) {
      console.error('[HF] No URL in result:', JSON.stringify(jobSet));
      return res.status(500).json({ error: '결과 URL 없음', raw: jobSet });
    }

    return res.status(200).json({ url: resultUrl, type });

  } catch (e) {
    console.error('[HF] SDK Error:', e.message, e.stack);
    return res.status(500).json({ error: e.message, stack: e.stack?.slice(0, 500) });
  }
}
