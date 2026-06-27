import React, { useEffect, useRef, useState } from 'react';
import { ref, set, onValue, remove } from 'firebase/database';
import { db } from '../firebase';
import { analyze } from 'web-audio-beat-detector';

export default function Teacher() {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [masterAudioUrl, setMasterAudioUrl] = useState<string>('');
  const [uploadStatus, setUploadStatus] = useState<string>('음원 파일(mp3)을 업로드해주세요.\n업로드하지 않고 예시로 작은 별 음원을 재생할 수 있습니다.');
  const [isReady, setIsReady] = useState<boolean>(false);
  const [selectedBeat, setSelectedBeat] = useState<string>('');
  const [masterBpm, setMasterBpm] = useState<number>(120);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  // useEffect for pendingFile analysis has been merged into handleFileSelect

  const changeBeatType = (type: string) => {
    setSelectedBeat(type);
    set(ref(db, 'gameState/beatType'), type);
  };

  const [studentsData, setStudentsData] = useState<Record<string, { beat: number }>>({});
  const [globalAverage, setGlobalAverage] = useState<{ beat: number; count: number }>({ beat: 0, count: 0 });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  useEffect(() => {
    const scoresRef = ref(db, 'scores');
    const unsubscribe = onValue(scoresRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setStudentsData({});
        setGlobalAverage({ beat: 0, count: 0 });
        return;
      }

      const newStudentsData: Record<string, { beat: number }> = {};
      let totalBeat = 0;
      let count = 0;

      Object.entries(data).forEach(([studentName, s]: [string, any]) => {
        newStudentsData[studentName] = {
          beat: s.beatScore || 0,
        };
        totalBeat += s.beatScore || 0;
        count++;
      });

      const avgBeat = count > 0 ? Math.round(totalBeat / count) : 0;

      setStudentsData(newStudentsData);
      setGlobalAverage({ beat: avgBeat, count });

      if (gainNodeRef.current && audioCtxRef.current) {
        let finalVolume = 0;
        if (count > 0) {
          // 박자 점수 0~100% → 볼륨 20~100% 선형 매핑
          finalVolume = 0.2 + (avgBeat / 100) * 0.8;
        } else {
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

  const handleBpmChange = (val: number) => {
    const clamped = Math.max(40, Math.min(240, val));
    setMasterBpm(clamped);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileToUpload = files[0];
    e.target.value = ''; // reset

    setUploadStatus('⏳ 음원 분석 중 (BPM 및 박자)...');
    setIsAnalyzing(true);
    let detectedBpm = 120;

    try {
      const arrayBuffer = await fileToUpload.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const tempo = await analyze(audioBuffer);
      detectedBpm = Math.round(tempo);
      setMasterBpm(detectedBpm);
    } catch (error) {
      console.error('BPM 분석 오류:', error);
    } finally {
      setIsAnalyzing(false);
    }

    // 박자는 사용자가 직접 선택하도록 빈 값 유지
    setSelectedBeat('');
    set(ref(db, 'gameState/beatType'), '');

    setUploadStatus(`✅ BPM 분석 완료: ${detectedBpm}bpm. 서버에 업로드 중...`);

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
          setUploadStatus(`🟢 업로드 완료! 박자를 선택한 후 지휘를 시작해주세요. (자동 분석: ${detectedBpm}bpm)`);
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

  // 실제 오디오 재생 + Firebase 신호 발송
  const playAudio = async (audioUrl: string) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

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
    if (!selectedBeat) {
      alert('박자를 먼저 선택해주세요!');
      return;
    }
    await playAudio(masterAudioUrl);
  };

  // 데모 버튼: 음원만 세팅 (재생 X)
  const selectDemoSong = () => {
    setMasterBpm(120);
    setSelectedBeat('4/4');
    set(ref(db, 'gameState/beatType'), '4/4');
    setMasterAudioUrl('/little-star2.mp3');
    setIsReady(true);
    setUploadStatus('⭐ 작은 별 음원 선택됨 (4/4박자 120bpm) — 지휘 시작을 눌러주세요');
  };

  const stopConcert = () => {
    if (audioElementRef.current) audioElementRef.current.pause();
    set(ref(db, 'gameState'), { status: 'idle', bpm: masterBpm, beatType: selectedBeat, updatedAt: Date.now() });
    setIsPlaying(false);
  };

  return (
    <div className="w-full h-screen bg-[#F9FAFB] flex flex-col p-6 font-sans text-[#1F2937]">
      <div className="w-full flex justify-between items-center border-b border-[#D1D5DB] pb-4 mb-6">
        <div className="mr-auto">
          <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-bold tracking-tight">교사 대시보드</h1>
            <p className="text-sm text-gray-500 whitespace-pre-line text-left">{uploadStatus}</p>
          </div>
        </div>

        {/* 파일 제어 및 지휘 시작 레이아웃 라인 */}
        <div className="flex items-center space-x-4">
          {/* BPM 인라인 편집기 */}
          <div className="flex flex-col items-center mr-2">
            <span className="text-[10px] text-gray-400 font-semibold uppercase mb-1">BPM {isAnalyzing && <span className="text-blue-400 animate-pulse">분석 중...</span>}</span>
            <div className={`flex items-center border border-[#D1D5DB] rounded-xl overflow-hidden bg-white shadow-sm h-[72px] ${isPlaying ? 'opacity-50 pointer-events-none' : ''}`}>
              <button
                onClick={() => handleBpmChange(masterBpm - 1)}
                disabled={isAnalyzing}
                className="px-3 h-full text-lg font-bold text-gray-500 hover:bg-gray-100 transition-all select-none flex items-center justify-center"
              >−</button>
              <input
                type="number"
                min={40}
                max={240}
                value={masterBpm}
                disabled={isAnalyzing}
                onChange={(e) => handleBpmChange(Number(e.target.value))}
                className="w-16 h-full text-center text-lg font-bold text-[#1F2937] border-x border-[#D1D5DB] focus:outline-none focus:ring-2 focus:ring-[#F59E0B] disabled:bg-gray-50 disabled:text-gray-400"
              />
              <button
                onClick={() => handleBpmChange(masterBpm + 1)}
                disabled={isAnalyzing}
                className="px-3 h-full text-lg font-bold text-gray-500 hover:bg-gray-100 transition-all select-none flex items-center justify-center"
              >+</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mr-2">
            {['2/4', '3/4', '4/4', '6/8'].map(beat => (
              <button
                key={beat}
                onClick={() => changeBeatType(beat)}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${selectedBeat === beat ? 'bg-[#F59E0B] text-white' : 'bg-white text-gray-500 border border-[#D1D5DB] hover:bg-gray-50'
                  }`}
              >
                {beat}박자
              </button>
            ))}
          </div>

          {!isPlaying && (
            <button
              onClick={selectDemoSong}
              className={`px-4 py-3 text-sm font-semibold rounded-xl shadow-sm cursor-pointer transition-all flex flex-col items-center justify-center leading-tight border ${masterAudioUrl === '/little-star2.mp3' && isReady
                  ? 'bg-amber-100 border-amber-400 text-amber-800'
                  : 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                }`}
            >
              <span>⭐ 작은 별 음원</span>
              <span className="text-xs text-amber-500 font-normal mt-0.5">(테스트용)</span>
            </button>
          )}

          <label className="px-4 py-3 bg-white border border-[#D1D5DB] text-sm font-semibold rounded-xl shadow-sm cursor-pointer hover:bg-gray-50 transition-all whitespace-nowrap">
            📂 음원 선택
            <input type="file" accept="audio/*" onChange={handleFileSelect} className="hidden" />
          </label>

          {!isPlaying ? (
            <button
              onClick={startConcert}
              disabled={!isReady}
              className={`px-6 py-3 font-bold rounded-xl shadow-sm transition-all flex flex-col items-center justify-center leading-tight ${isReady ? 'bg-[#1F2937] text-white hover:bg-gray-800' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
            >
              <span>🎵 지휘 시작</span>
              <span className="text-xs font-normal mt-0.5">(학생 기기 동시 기동)</span>
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
        <div className="relative md:w-1/3 bg-white p-6 rounded-2xl border border-[#D1D5DB] shadow-sm flex flex-col justify-center items-center">
          <button
            onClick={() => {
              if (window.confirm('모든 학생들의 접속 정보를 초기화하시겠습니까?')) {
                remove(ref(db, 'scores'));
              }
            }}
            className="absolute top-4 right-4 px-3 py-1.5 bg-red-100 text-red-600 rounded-lg text-xs font-bold hover:bg-red-200 transition-all whitespace-nowrap"
          >
            전체 학생 초기화
          </button>
          <h2 className="text-xl font-bold mb-2">학생 지휘 점수</h2>
          <p className="text-sm text-gray-500 mb-6">현재 접속 학생: {globalAverage.count}명</p>

          <div className="w-full space-y-6">
            <div>
              <div className="flex justify-between text-sm mb-2 font-medium">
                <span className="text-gray-500">박자 정확도 (볼륨)</span>
                <span className="font-bold text-2xl">{globalAverage.beat}%</span>
              </div>
              <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#1F2937] transition-all duration-300" style={{ width: `${globalAverage.beat}%` }} />
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
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>


    </div>
  );
}
