import { list, del } from '@vercel/blob';

export default async function handler(request, response) {
  // Vercel Cron은 GET 요청으로 호출됨
  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const today = new Date().toDateString(); // 예: "Sat Jun 28 2026"

    // Blob 저장소의 모든 파일 목록 조회
    const { blobs } = await list();

    // 오늘 날짜가 아닌 파일만 필터링
    const oldBlobs = blobs.filter(blob => {
      const uploadedDate = new Date(blob.uploadedAt).toDateString();
      return uploadedDate !== today;
    });

    if (oldBlobs.length === 0) {
      return response.status(200).json({ message: '삭제할 파일 없음', deleted: 0 });
    }

    // 오래된 파일 일괄 삭제
    const urlsToDelete = oldBlobs.map(blob => blob.url);
    await del(urlsToDelete);

    return response.status(200).json({
      message: '정리 완료',
      deleted: oldBlobs.length,
      files: urlsToDelete,
    });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
