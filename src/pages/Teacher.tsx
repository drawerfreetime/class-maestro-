import React, { useEffect, useRef, useState } from 'react';
import { ref, set, onValue } from 'firebase/database';
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db } from '../firebase';

const PARTS = [
  { id: 'V1', name: '제1바이올린', color: 'bg-red-500' },
  { id: 'V2', name: '제2바이올린', color: 'bg-orange-500' },
  { id: 'VC', name: '첼로&베이스', color: 'bg-yellow-500' },
  { id: 'FL', name: '플루트&오보에', color: 'bg-green-500' },
  { id: 'BR', name: '트럼펫&호른', color: 'bg-blue-500' },
  { id: 'DR', name: '팀파니&스네어', color: 'bg-indigo-500' },
  { id: 'PE', name: '트라이앵글&피아노', color: 'bg-purple-500' },
];

export default function Teacher() {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [uploadStatus, setUploadStatus] = useState<string>('음원 파일을 업로드해주세요 (양식: v1.mp3, v2.mp3...)');
  const [isReady, setIsReady] = useState<boolean>(false);

  const [partAverages, setPartAverages] = useState<Record<string, { beat: number; expr: number; count: number }>>({
    V1: { beat: 0, expr: 0, count: 0 }, V2: { beat: 0, expr: 0, count: 0 },
    VC: { beat: 0, expr: 0, count: 0 }, FL: { beat: 0, expr: 0, count: 0 },
    BR: { beat: 0, expr: 0, count: 0 }, DR: { beat: 0, expr: 0, count: 0 },
    PE: { beat: 0, expr: 0, count: 0 },
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement>>({});
  const gainNodesRef = useRef<Record<string, GainNode>>({});

  useEffect(() => {
    const scoresRef = ref(db, 'scores');
    const unsubscribe = onValue(scoresRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const newAverages = { ...partAverages };
      PARTS.forEach((part) => {
        const students = data[part.id];
        if (students) {
          let totalBeat = 0; let totalExpr = 0;
          const studentList = Object.values(students) as any[];
          studentList.forEach((s) => {
            totalBeat += s.beatScore || 0;
            totalExpr += s.expressionScore || 0;
          });
          const count = studentList.length;
          newAverages[part.id] = {
            beat: Math.round(totalBeat / count),
            expr: Math.round(totalExpr / count),
            count: count,
          };

          if (gainNodesRef.current[part.id] && audioCtxRef.current) {
            const baseVolume = (newAverages[part.id].beat / 100);
            const expressionMultiplier = 0.5 + (newAverages[part.id].expr / 200);
            const finalVolume = Math.min(Math.max(baseVolume * expressionMultiplier, 0.0), 1.2);
            gainNodesRef.current[part.id].gain.linearRampToValueAtTime(
              finalVolume, audioCtxRef.current.currentTime + 0.1
            );
          }
        }
      });
      setPartAverages(newAverages);
    });

    return () => {
      unsubscribe();
      Object.values(audioElementsRef.current).forEach((audio) => audio.pause());
    };
  }, [partAverages]);

  // 파일 일괄 업로드 및 자동 분류 로직
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadStatus('파일 분석 및 Firebase Storage 업로드 중...');
    const storage = getStorage();
    const urls: Record<string, string> = { ...audioUrls };

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = file.name.toLowerCase();
      
      // 파일명 매칭 분기 처리 (v1, v2, vc, fl, br, dr, pe)
      let matchedPartId = '';
      if (fileName.includes('v1')) matchedPartId = 'V1';
      else if (fileName.includes('v2')) matchedPartId = 'V2';
      else if (fileName.includes('vc')) matchedPartId = 'VC';
      else if (fileName.includes('fl')) matchedPartId = 'FL';
      else if (fileName.includes('br')) matchedPartId = 'BR';
      else if (fileName.includes('dr')) matchedPartId = 'DR';
      else if (fileName.includes('pe')) matchedPartId = 'PE';

      if (matchedPartId) {
        try {
          const storageRef = sRef(storage, `orchestra/${matchedPartId}.mp3`);
          await uploadBytes(storageRef, file);
          const downloadUrl = await getDownloadURL(storageRef);
          urls[matchedPartId] = downloadUrl;
        } catch (error) {
          console.error('업로드 실패:', error);
        }
      }
    }

    setAudioUrls(urls);
    const uploadedCount = Object.keys(urls).length;
    setUploadStatus(`업로드 완료된 파트: ${uploadedCount} / 7`);

    if (uploadedCount === 7) {
      setIsReady(true);
      setUploadStatus('🟢 7개 모든 음원 매핑 완료! 합주 준비 완료.');
    } else {
      setIsReady(false);
    }
  };

  const startConcert = async () => {
    if (!isReady) return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    PARTS.forEach((part) => {
      if (!audioElementsRef.current[part.id] && audioUrls[part.id]) {
        const audio = new Audio(audioUrls[part.id]);
        audio.loop = true;
        audio.crossOrigin = 'anonymous';

        const source = audioCtxRef.current!.createMediaElementSource(audio);
        const gainNode = audioCtxRef.current!.createGain();
        gainNode.gain.value = 0.0; // 학생이 흔들기 전엔 무음 시작
        source.connect(gainNode).connect(audioCtxRef.current!.destination);

        audioElementsRef.current[part.id] = audio;
        gainNodesRef.current[part.id] = gainNode;
      }
      audioElementsRef.current[part.id]?.play();
    });

    set(ref(db, 'gameState'), { status: 'playing', bpm: 120, updatedAt: Date.now() });
    setIsPlaying(true);
  };

  const stopConcert = () => {
    Object.values(audioElementsRef.current).forEach((audio) => audio.pause());
    set(ref(db, 'gameState'), { status: 'idle', bpm: 120, updatedAt: Date.now() });
    setIsPlaying(false);
  };

  return (
    <div className="w-full h-screen bg-[#F9FAFB] flex flex-col p-6 font-sans text-[#1F2937]">
      <div className="w-full flex justify-between items-center border-b border-[#D1D5DB] pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Teacher Dashboard | 오케스트라 지휘 통제실</h1>
          <p className="text-sm text-gray-500 mt-1">{uploadStatus}</p>
        </div>
        
        {/* 파일 제어 및 합주 시작 레이아웃 라인 */}
        <div className="flex items-center space-x-4">
          <label className="px-4 py-3 bg-white border border-[#D1D5DB] text-sm font-semibold rounded-xl shadow-sm cursor-pointer hover:bg-gray-50 transition-all">
            📂 음원 7개 일괄 선택
            <input type="file" multiple accept="audio/*" onChange={handleFileUpload} className="hidden" />
          </label>

          {!isPlaying ? (
            <button
              onClick={startConcert}
              disabled={!isReady}
              className={`px-6 py-3 font-bold rounded-xl shadow-sm transition-all ${
                isReady ? 'bg-[#1F2937] text-white hover:bg-gray-800' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              🎵 합주 시작 (학생 기기 동시 기동)
            </button>
          ) : (
            <button onClick={stopConcert} className="px-6 py-3 bg-red-600 text-white font-bold rounded-xl shadow-sm hover:bg-red-700 transition-all">
              ⏹️ 합주 중단
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 flex-1 overflow-y-auto pb-6">
        {PARTS.map((part) => {
          const data = partAverages[part.id];
          const hasFile = !!audioUrls[part.id];
          return (
            <div key={part.id} className="bg-white p-5 rounded-2xl border border-[#D1D5DB] shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex justify-between items-center mb-3">
                  <span className={`text-xs px-2 py-1 rounded-md text-white font-bold ${part.color}`}>
                    {part.id}
                  </span>
                  <span className="text-xs font-medium text-gray-400">
                    {hasFile ? '💿 연결됨' : '❌ 파일없음'} | 접속: {data.count}명
                  </span>
                </div>
                <h3 className="text-lg font-bold text-[#1F2937] mb-4">{part.name}</h3>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1 font-medium">
                    <span className="text-gray-500">박자 정확도 (기본 볼륨)</span>
                    <span className="font-bold">{data.beat}%</span>
                  </div>
                  <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[#1F2937] transition-all duration-300" style={{ width: `${data.beat}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1 font-medium">
                    <span className="text-gray-500">왼손 악상 표현 (볼륨 증폭)</span>
                    <span className="font-bold text-[#F59E0B]">{data.expr}%</span>
                  </div>
                  <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[#F59E0B] transition-all duration-300" style={{ width: `${data.expr}%` }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
