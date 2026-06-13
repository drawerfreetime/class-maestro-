import { put } from '@vercel/blob';

export default async function handler(request, response) {
  // CORS 에러 방지를 위한 헤더 설정 (Vercel 내부에서 처리되므로 안전장치)
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 프런트엔드에서 보낸 base64 인코딩된 데이터 추출
    const { filename, file } = request.body;
    
    // data:audio/mp3;base64, 이후의 순수 base64 문자열만 추출하여 Buffer로 변환
    const base64Data = file.split(',')[1] || file;
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Vercel Blob 저장소로 파일 업로드 진행 (바이너리 버퍼 전송)
    const blob = await put(filename, buffer, {
      access: 'public', // 학생들이 오디오 링크에 접근하여 들을 수 있도록 공개 설정
      allowOverwrite: true,
    });

    // 업로드가 완료되면 Vercel 저장소에 저장된 실제 오디오 주소(URL)를 리턴
    return response.status(200).json(blob);
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
