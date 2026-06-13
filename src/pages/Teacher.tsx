import React, { useEffect, useRef, useState } from 'react';
import { ref, set, onValue, remove } from 'firebase/database';
import { db } from '../firebase';

export default function Teacher() {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [masterAudioUrl, setMasterAudioUrl] = useState<string>('');
  const [uploadStatus, setUploadStatus] = useState<string>('마스터 음원 파일을 업로드해주세요 (양식: mp3)');
  const [isReady, setIsReady] = useState<boolean>(false);
  const [selectedBeat, setSelectedBeat] = useState<string>('4/4');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [masterBpm, setMasterBpm] = useState<number>(120);

  const changeBeatType = (type: string) => {
    setSelectedBeat(type);
    set(ref(db, 'gameState/beatType'), type);
  };

  const [studentsData, setStudentsData] = useState<Record<string, { beat: number; expr: number }>>({});
  const [globalAverage, setGlobalAverage] = useState<{ beat: number; expr: number; count: number }>({ beat: 0, expr: 0, count: 0 });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  useEffect(() => {
    const scoresRef = ref(db, 'scores');
    const unsubscribe = onValue(scoresRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setStudentsData({});
        setGlobalAverage({ beat: 0, expr: 0, count: 0 });
        return;
      }

      // data is { studentName: { beatScore, expressionScore, updatedAt }, ... }
      const newStudentsData: Record<string, { beat: number; expr: number }> = {};
      let totalBeat = 0;
      let totalExpr = 0;
      let count = 0;

      Object.entries(data).forEach(([studentName, s]: [string, any]) => {
        newStudentsData[studentName] = {
          beat: s.beatScore || 0,
          expr: s.expressionScore || 0,
        };
        totalBeat += s.beatScore || 0;
        totalExpr += s.expressionScore || 0;
        count++;
      });

      const avgBeat = count > 0 ? Math.round(totalBeat / count) : 0;
      const avgExpr = count > 0 ? Math.round(totalExpr / count) : 0;

      setStudentsData(newStudentsData);
      setGlobalAverage({ beat: avgBeat, expr: avgExpr, count });

      if (gainNodeRef.current && audioCtxRef.current) {
        let finalVolume = 0;
        if (count > 0) {
          const baseVolume = (avgBeat / 100);
          const expressionMultiplier = 0.5 + (avgExpr / 200);
          finalVolume = Math.min(Math.max(baseVolume * expressionMultiplier, 0.0), 1.2);
        } else {
          // 학생이 없을 때는 선생님이 모니터링할 수 있도록 기본 볼륨 50% 유지
          finalVolume = 0.5;
        }

        gainNodeRef.current.gain.linearRampToValueAtTime(
          finalVolume, audioCtxRef.current.currentTime + 0.1
        );
      }
    });

    return () => {
      unsubscribe();
      if (audioElementRef.current) audioElementRef.current.pause();
    };
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setPendingFile(files[0]);
    }
    e.target.value = '';
  };

  const confirmUpload = async () => {
    if (!pendingFile) return;
    const fileToUpload = pendingFile;
    setPendingFile(null);

    setUploadStatus('파일 분석 및 Vercel 저장소 업로드 중...');

    try {
      const reader = new FileReader();
      reader.readAsDataURL(fileToUpload);
      reader.onloadend = async () => {
        try {
          const base64Buffer = reader.result;

          const response = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: fileToUpload.name,
              file: base64Buffer,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status} 오류 발생`);
          }

          const data = await response.json();
          setMasterAudioUrl(data.url);
          setIsReady(true);
          setUploadStatus(`🟢 마스터 음원 업로드 완료! 합주 준비 완료. (${masterBpm}bpm)`);
        } catch (error: any) {
          console.error('업로드 실패:', error);
          setUploadStatus(`❌ 업로드 실패: ${error.message}`);
        }
      };
    } catch (error) {
      console.error('파일 읽기 실패:', error);
      setUploadStatus('❌ 파일 읽기 실패. 다시 시도해주세요.');
    }
  };

  const loadAndStartConcert = async (audioUrl: string) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    // 기존 오디오 제거 후 새로 생성
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
    }

    const audio = new Audio(audioUrl);
    audio.loop = true;
    audio.crossOrigin = 'anonymous';

    const source = audioCtxRef.current.createMediaElementSource(audio);
    const gainNode = audioCtxRef.current.createGain();
    gainNode.gain.value = 0.5;
    source.connect(gainNode).connect(audioCtxRef.current.destination);

    audioElementRef.current = audio;
    gainNodeRef.current = gainNode;

    audio.play();
    set(ref(db, 'gameState'), { status: 'playing', bpm: masterBpm, beatType: selectedBeat, updatedAt: Date.now() });
    setIsPlaying(true);
  };

  const startConcert = async () => {
    if (!isReady || !masterAudioUrl) return;
    await loadAndStartConcert(masterAudioUrl);
  };

  const startDemoSong = async () => {
    setMasterBpm(80);
    setSelectedBeat('4/4');
    set(ref(db, 'gameState/beatType'), '4/4');
    setUploadStatus('🎵 테스트용 음원 (작은 별) 재생 중... (4/4박자 80bpm)');
    await loadAndStartConcert('/little-star.mp3');
  };

  const stopConcert = () => {
    if (audioElementRef.current) audioElementRef.current.pause();
    set(ref(db, 'gameState'), { status: 'idle', bpm: masterBpm, beatType: selectedBeat, updatedAt: Date.now() });
    setIsPlaying(false);
  };

  return (
    <div className="w-full h-screen bg-[#F9FAFB] flex flex-col p-6 font-sans text-[#1F2937]">
      <div className="w-full flex justify-between items-center border-b border-[#D1D5DB] pb-4 mb-6">
        <div>
          <div className="flex items-center space-x-3">
            <h1 className="text-2xl font-bold tracking-tight">Teacher Dashboard | 오케스트라 지휘 통제실</h1>
            <button 
              onClick={() => {
                if(window.confirm('모든 학생들의 접속 정보를 초기화하시겠습니까?')) {
                  remove(ref(db, 'scores'));
                }
              }} 
              className="px-3 py-1 bg-red-100 text-red-600 rounded-lg text-xs font-bold hover:bg-red-200 transition-all"
            >
              🔄 전체 학생 초기화
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">{uploadStatus}</p>
        </div>
        
        <div className="flex space-x-2 mr-auto ml-6">
          {['2/4', '3/4', '4/4', '6/8'].map(beat => (
            <button
              key={beat}
              onClick={() => changeBeatType(beat)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                selectedBeat === beat ? 'bg-[#F59E0B] text-white' : 'bg-white text-gray-500 border border-[#D1D5DB] hover:bg-gray-50'
              }`}
            >
              {beat}박자
            </button>
          ))}
        </div>

        {/* 파일 제어 및 지휘 시작 레이아웃 라인 */}
        <div className="flex items-center space-x-4">
          {!isPlaying && (
            <button
              onClick={startDemoSong}
              className="px-4 py-3 bg-amber-50 border border-amber-300 text-amber-700 text-sm font-semibold rounded-xl shadow-sm cursor-pointer hover:bg-amber-100 transition-all flex flex-col items-center leading-tight"
            >
              <span>⭐ 작은 별 음원</span>
              <span className="text-xs text-amber-500 font-normal">(테스트용)</span>
            </button>
          )}

          <label className="px-4 py-3 bg-white border border-[#D1D5DB] text-sm font-semibold rounded-xl shadow-sm cursor-pointer hover:bg-gray-50 transition-all">
            📂 마스터 음원 선택
            <input type="file" accept="audio/*" onChange={handleFileSelect} className="hidden" />
          </label>

          {!isPlaying ? (
            <button
              onClick={startConcert}
              disabled={!isReady}
              className={`px-6 py-3 font-bold rounded-xl shadow-sm transition-all ${
                isReady ? 'bg-[#1F2937] text-white hover:bg-gray-800' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              🎵 지휘 시작 (학생 기기 동시 기동)
            </button>
          ) : (
            <button onClick={stopConcert} className="px-6 py-3 bg-red-600 text-white font-bold rounded-xl shadow-sm hover:bg-red-700 transition-all">
              ⏹️ 지휘 중단
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6 flex-1 overflow-hidden pb-6">
        {/* Global Average Card */}
        <div className="md:w-1/3 bg-white p-6 rounded-2xl border border-[#D1D5DB] shadow-sm flex flex-col justify-center items-center">
          <h2 className="text-xl font-bold mb-2">글로벌 오케스트라 평균</h2>
          <p className="text-sm text-gray-500 mb-6">현재 접속 학생: {globalAverage.count}명</p>
          
          <div className="w-full space-y-6">
            <div>
              <div className="flex justify-between text-sm mb-2 font-medium">
                <span className="text-gray-500">박자 정확도 (기본 볼륨)</span>
                <span className="font-bold text-2xl">{globalAverage.beat}%</span>
              </div>
              <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#1F2937] transition-all duration-300" style={{ width: `${globalAverage.beat}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2 font-medium">
                <span className="text-gray-500">악상 표현 (볼륨 증폭)</span>
                <span className="font-bold text-2xl text-[#F59E0B]">{globalAverage.expr}%</span>
              </div>
              <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#F59E0B] transition-all duration-300" style={{ width: `${globalAverage.expr}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Student List */}
        <div className="md:w-2/3 bg-white p-6 rounded-2xl border border-[#D1D5DB] shadow-sm flex flex-col overflow-hidden">
          <h2 className="text-lg font-bold mb-4">접속 중인 학생 목록</h2>
          <div className="flex-1 overflow-y-auto pr-2 space-y-3">
            {Object.keys(studentsData).length === 0 ? (
              <div className="text-center text-gray-400 py-10">현재 접속한 학생이 없습니다.</div>
            ) : (
              Object.entries(studentsData).map(([name, data]) => (
                <div key={name} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl bg-gray-50">
                  <div className="font-bold text-[#1F2937]">{name}</div>
                  <div className="flex space-x-6">
                    <div className="text-center">
                      <div className="text-xs text-gray-400">박자</div>
                      <div className="font-semibold">{data.beat}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-400">악상</div>
                      <div className="font-semibold text-[#F59E0B]">{data.expr}%</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* BPM Selection Modal */}
      {pendingFile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-80 flex flex-col items-center">
            <h3 className="text-lg font-bold mb-4">음원 BPM 설정</h3>
            <p className="text-sm text-gray-500 mb-4 text-center">선택한 음원의 BPM을 입력해주세요.<br/>(60 ~ 140 사이)</p>
            <input 
              type="number" 
              min="60" 
              max="140" 
              value={masterBpm}
              onChange={(e) => setMasterBpm(Number(e.target.value))}
              className="w-full text-center text-2xl font-bold border border-gray-300 rounded-xl py-3 mb-6 focus:outline-none focus:ring-2 focus:ring-[#F59E0B]"
            />
            <div className="flex space-x-3 w-full">
              <button 
                onClick={() => setPendingFile(null)}
                className="flex-1 py-3 bg-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-300 transition-all"
              >
                취소
              </button>
              <button 
                onClick={confirmUpload}
                className="flex-1 py-3 bg-[#F59E0B] text-white font-bold rounded-xl hover:bg-yellow-600 transition-all"
              >
                완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
