import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { ref, onValue, set, onDisconnect, remove } from 'firebase/database';
import { db } from '../firebase';

export default function Student() {
  const location = useLocation();
  const navigate = useNavigate();
  const { studentName } = location.state || { studentName: '익명' };

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<any>(null);
  const requestRef = useRef<number | null>(null);
  const lastFirebaseUpdate = useRef<number>(0);
  const beatTypeRef = useRef<string>('4/4');
  const bpmRef = useRef<number>(120);
  const isLiveRef = useRef<boolean>(false);
  const startTimeRef = useRef<number>(0); // 지휘 시작 기준 타임스탬프 (performance.now() 기준)
  const serverStartRef = useRef<number>(0); // Firebase updatedAt (Date.now() 기준)

  // [수업 제어 상태]
  const [isLive, setIsLive] = useState<boolean>(false);
  const [score, setScore] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>('대기 중');
  const [cameraState, setCameraState] = useState<'idle' | 'requesting' | 'granted' | 'error'>('idle');
  const [beatType, setBeatType] = useState<string>('4/4');
  const [bpm, setBpm] = useState<number>(120);

  useEffect(() => {
    if (!location.state?.studentName) {
      navigate('/');
      return;
    }

    // 학생 입장 시 즉시 노드 생성 및 연결 끊김 시 자동 삭제 예약
    const studentScoreRef = ref(db, `scores/${location.state.studentName}`);
    set(studentScoreRef, { beatScore: 0, updatedAt: Date.now() });
    onDisconnect(studentScoreRef).remove();

    // 교사의 [지휘 시작 / 중단] 신호를 실시간 데이터베이스에서 감시
    const gameStateRef = ref(db, 'gameState');
    const unsubscribeGame = onValue(gameStateRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        if (data.beatType) {
          setBeatType(data.beatType);
          beatTypeRef.current = data.beatType;
        }
        if (data.bpm) {
          setBpm(data.bpm);
          bpmRef.current = data.bpm;
        }

        if (data.status === 'playing') {
          setIsLive(true);
          isLiveRef.current = true;
          // Firebase의 updatedAt(서버 기준 ms)과 로컬 performance.now()를 연동
          // 서버가 신호를 보낸 시점을 기준으로 경과 시간을 계산
          const serverAt = data.updatedAt || Date.now();
          const localNow = Date.now();
          const delta = localNow - serverAt; // 서버→클라이언트 수신 딜레이
          // performance.now() 기준으로 서버 시작 시점 추정
          startTimeRef.current = performance.now() - delta;
          serverStartRef.current = serverAt;
          setFeedback('START!');
        } else {
          setIsLive(false);
          isLiveRef.current = false;
          setFeedback('대기 중');
          setScore(0);
        }
      }
    });

    return () => {
      unsubscribeGame();
      remove(studentScoreRef);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
    };
  }, [location.state?.studentName, navigate]);

  // 미디어파이프 및 웹캠 초기화
  const initMediaPipeAndCamera = async () => {
    setCameraState('requesting');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('브라우저가 카메라를 지원하지 않거나 안전하지 않은 연결(HTTP)입니다.');
      }

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm'
      );
      landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numHands: 1
      });

      if (videoRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false
        });
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          requestRef.current = requestAnimationFrame(renderLoop);
          setCameraState('granted');
        };
      }
    } catch (err: any) {
      alert(`카메라 권한을 허용해야 합니다.\n상세오류: ${err.message || err}`);
      console.error(err);
      setCameraState('error');
    }
  };

  // ─────────────────────────────────────────────────────────────────
  // 박자별 지휘 궤적 정밀 교정 (제시된 공식 이미지 흐름 100% 일치 버전)
  // ─────────────────────────────────────────────────────────────────
  const getConductingNode = (time: number, beatType: string, currentBpm: number = 120) => {
    const beatDuration = (60 / currentBpm) * 1000; // 1박 길이(ms)

    // 3차 베지어 곡선 계산 내부 함수
    const getBezier = (p: number, p0: number[], p1: number[], p2: number[], p3: number[]) => {
      const invp = 1 - p;
      const b0 = invp * invp * invp;
      const b1 = 3 * invp * invp * p;
      const b2 = 3 * invp * p * p;
      const b3 = p * p * p;
      return [
        b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0],
        b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1]
      ];
    };

    let bx = 0, by = 0;

    // ── 2/4 박자 (image_545fe2.png 반영) ───────────────────────────
    if (beatType === '2/4') {
      const t = (time % (beatDuration * 2)) / (beatDuration * 2);
      if (t < 0.5) {
        // ① 수직선 하강: 최상단에서 정직하게 수직으로 꽂힙니다.
        const p = t / 0.5;
        const [x, y] = getBezier(p, [0, -150], [0, -50], [0, 50], [0, 150]);
        bx = x; by = y;
      } else {
        // ②, ③ 우측 턴 및 상단 복귀: 바닥에서 튕겨 나와 뾰족한 사선 형태로 우측 상단 정점을 찍고 시작점으로 감아 들어옵니다.
        const p = (t - 0.5) / 0.5;
        const [x, y] = getBezier(p, [0, 150], [40, 100], [140, 40], [0, -150]);
        bx = x; by = y;
      }

    // ── 3/4 박자 (image_545fc3.png 반영) ───────────────────────────
    } else if (beatType === '3/4') {
      const t = (time % (beatDuration * 3)) / (beatDuration * 3);
      if (t < 1/3) {
        // ① 수직 하강: 축이 되는 수직선 하강
        const p = t * 3;
        const [x, y] = getBezier(p, [0, -150], [0, -50], [0, 50], [0, 150]);
        bx = x; by = y;
      } else if (t < 2/3) {
        // ② 우측 스윕 상승: 바닥에서 오른쪽 방향으로 부드러운 포물선을 그리며 우상향 정점(140, 0)까지 상승
        const p = (t - 1/3) * 3;
        const [x, y] = getBezier(p, [0, 150], [40, 150], [120, 100], [140, 0]);
        bx = x; by = y;
      } else {
        // ③ 좌측 상단 복귀: 우측 정점에서 안쪽으로 우아하게 휘어지며 시작점 복귀
        const p = (t - 2/3) * 3;
        const [x, y] = getBezier(p, [140, 0], [130, -80], [60, -150], [0, -150]);
        bx = x; by = y;
      }

    // ── 6/8 박자 (image_5547fe.png 반영) ───────────────────────────
    } else if (beatType === '6/8') {
      const t = (time % (beatDuration * 6)) / (beatDuration * 6);
      if (t < 1/6) {
        // ① 중앙 수직 하강
        const p = t * 6;
        const [x, y] = getBezier(p, [0, -150], [0, -50], [0, 50], [0, 150]);
        bx = x; by = y;
      } else if (t < 2/6) {
        // ② 좌측 내부 루프 진입: 왼쪽 바닥으로 감아 올라가 안쪽 루프 머리를 형성
        const p = (t - 1/6) * 6;
        const [x, y] = getBezier(p, [0, 150], [-60, 150], [-120, 110], [-130, 40]);
        bx = x; by = y;
      } else if (t < 3/6) {
        // ③ 좌측 루프 교차 탈출: 왼쪽 위에서 도돌이표처럼 아래로 사선 교차하여 중앙선 부근 확보
        const p = (t - 2/6) * 6;
        const [x, y] = getBezier(p, [-130, 40], [-140, -20], [-60, 20], [-20, 80]);
        bx = x; by = y;
      } else if (t < 4/6) {
        // ④ 우측 바닥 스윕: 중앙선 부근에서 오른쪽 밑으로 완만하게 밀고 내려가며 호의 시작점 형성
        const p = (t - 3/6) * 6;
        const [x, y] = getBezier(p, [-20, 80], [10, 130], [50, 150], [80, 150]);
        bx = x; by = y;
      } else if (t < 5/6) {
        // ⑤ 우측 외곽 상승: 우측 바닥에서 외곽을 타고 솟구치며 큰 우측 정점 도달
        const p = (t - 4/6) * 6;
        const [x, y] = getBezier(p, [80, 150], [120, 140], [150, 90], [160, -10]);
        bx = x; by = y;
      } else {
        // ⑥ 원점 복귀 곡선: 우측 끝 정점에서 안쪽 포물선을 그리며 안전하게 시작점으로 회생
        const p = (t - 5/6) * 6;
        const [x, y] = getBezier(p, [160, -10], [140, -90], [80, -150], [0, -150]);
        bx = x; by = y;
      }

    // ── 4/4 박자 (검증 완료된 정밀 궤적 고정) ─────────────────────────
    } else {
      const t = (time % (beatDuration * 4)) / (beatDuration * 4);
      if (t < 0.25) {
        const p = t / 0.25;
        const [x, y] = getBezier(p, [0, -150], [0, -50], [0, 50], [0, 150]);
        bx = x; by = y;
      } else if (t < 0.5) {
        const p = (t - 0.25) / 0.25;
        const [x, y] = getBezier(p, [0, 150], [-160, 150], [-160, -30], [-20, 70]);
        bx = x; by = y;
      } else if (t < 0.75) {
        const p = (t - 0.5) / 0.25;
        const [x, y] = getBezier(p, [-20, 70], [40, 150], [130, 140], [150, -30]);
        bx = x; by = y;
      } else {
        const p = (t - 0.75) / 0.25;
        const [x, y] = getBezier(p, [150, -30], [140, -100], [80, -150], [0, -150]);
        bx = x; by = y;
      }
    }

    // 최종 800x450 크기의 센터 기준점 적용 및 크기 밸런스(1.15) 최적화
    return { x: 400 + bx * 1.15, y: 225 + by * 1.15 };
  };

  const renderLoop = (timestamp: number) => {
    if (!videoRef.current || !canvasRef.current || !landmarkerRef.current) {
      requestRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 박자 점선 가이드라인
    ctx.strokeStyle = 'rgba(29, 39, 55, 0.3)';
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      let cycleFactor = 4;
      if (beatTypeRef.current === '2/4') cycleFactor = 2;
      else if (beatTypeRef.current === '3/4') cycleFactor = 3;
      else if (beatTypeRef.current === '6/8') cycleFactor = 6;
      
      const duration = (60 / bpmRef.current) * cycleFactor * 1000;
      const fakeTime = (i / 100) * duration;
      const pt = getConductingNode(fakeTime, beatTypeRef.current, bpmRef.current);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const liveNow = isLiveRef.current;
    let targetNode = { x: 400, y: 225 };
    if (liveNow) {
      // 1박(beatDuration) 오프셋: t=0=위(준비)에서 1박 후 ①도달
      // → 음악 시작(elapsed_raw=0) 시 도트가 ① 위치에 오게 맞춤
      const beatDurationMs = (60 / bpmRef.current) * 1000;
      const elapsed = Math.max(0, timestamp - startTimeRef.current) + beatDurationMs;
      targetNode = getConductingNode(elapsed, beatTypeRef.current, bpmRef.current);
      ctx.fillStyle = '#1F2937';
      ctx.beginPath();
      ctx.arc(targetNode.x, targetNode.y, 18, 0, 2 * Math.PI);
      ctx.fill();
    }

    let currentBeatScore = 0;

    try {
      const results = landmarkerRef.current.detectForVideo(videoRef.current, performance.now());
      if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];

        const indexFingerTip = landmarks[8];
        const pointerX = (1 - indexFingerTip.x) * canvas.width;
        const pointerY = indexFingerTip.y * canvas.height;

        ctx.fillStyle = '#F59E0B';
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#F59E0B';
        ctx.beginPath();
        ctx.arc(pointerX, pointerY, 12, 0, 2 * Math.PI);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (liveNow) {
          const dist = Math.hypot(pointerX - targetNode.x, pointerY - targetNode.y);
          if (dist < 120) {
            currentBeatScore = 100;
            setFeedback('PERFECT!');
          } else if (dist < 220) {
            currentBeatScore = 50;
            setFeedback('GOOD');
          } else {
            currentBeatScore = 0;
            setFeedback('MISS');
          }
        }
      }
    } catch (err) {
      console.warn("MediaPipe detection error:", err);
    }

    if (liveNow && currentBeatScore > 0) {
      setScore(prev => Math.round(prev * 0.95 + currentBeatScore * 0.05));
    }

    // 0.5초 주기로 Firebase RTDB 서버에 스로틀링 전송
    if (liveNow && timestamp - lastFirebaseUpdate.current > 500) {
      lastFirebaseUpdate.current = timestamp;
      set(ref(db, `scores/${studentName}`), {
        beatScore: currentBeatScore,
        updatedAt: timestamp
      });
    }

    requestRef.current = requestAnimationFrame(renderLoop);
  };

  return (
    <div className="w-full h-screen bg-[#F9FAFB] flex flex-col justify-between items-center p-6 font-sans text-[#1F2937]">
      {/* 상단 헤더 */}
      <div className="w-full flex justify-between items-center border-b border-[#D1D5DB] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Student Maestro</h1>
          <p className="text-sm text-gray-500">이름: {studentName}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-400">BPM {bpm} | {beatType} | 지휘 가이드</div>
          <div className={`text-lg font-bold ${isLive ? 'text-[#F59E0B] animate-pulse' : 'text-gray-400'}`}>
            {feedback}
          </div>
        </div>
      </div>

      {/* 메인 캔버스 스테이지 */}
      <div className="relative w-[800px] h-[450px] bg-white rounded-2xl shadow-sm border border-[#D1D5DB] overflow-hidden">
        <video ref={videoRef} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} playsInline muted autoPlay />
        <canvas ref={canvasRef} width="800" height="450" className="w-full h-full" />
        
        {/* 카메라 권한 요청 오버레이 */}
        {cameraState !== 'granted' && (
          <div className="absolute inset-0 bg-black/60 flex flex-col justify-center items-center z-10 backdrop-blur-sm">
            <div className="bg-white px-8 py-6 rounded-2xl shadow-xl text-center max-w-sm">
              <h2 className="text-xl font-bold text-gray-800 mb-2">카메라 연결</h2>
              <p className="text-sm text-gray-500 mb-6">지휘 동작 인식을 위해 카메라 권한이 필요합니다.</p>
              <button
                onClick={initMediaPipeAndCamera}
                disabled={cameraState === 'requesting'}
                className="w-full py-3 bg-[#F59E0B] hover:bg-[#D97706] text-white font-bold rounded-xl transition duration-200 disabled:opacity-50"
              >
                {cameraState === 'requesting' ? '카메라 연결 중...' : '권한 허용 및 카메라 켜기'}
              </button>
            </div>
          </div>
        )}

        {/* 대기 중 안내 오버레이 */}
        {cameraState === 'granted' && !isLive && (
          <div className="absolute inset-0 bg-black/40 flex justify-center items-center backdrop-blur-xs z-0">
            <div className="bg-white px-6 py-4 rounded-xl shadow-lg text-center border border-gray-200">
              <p className="text-base font-bold text-gray-800">지휘 준비 완료 🤍</p>
              <p className="text-xs text-gray-500 mt-1">선생님이 지휘를 시작하면 음악과 평가가 시작됩니다.</p>
            </div>
          </div>
        )}
      </div>

      {/* 실시간 피드백 보드 */}
      <div className="w-full max-w-2xl bg-white p-4 rounded-xl border border-[#D1D5DB] shadow-sm text-center">
        <div className="text-xs text-gray-400 font-semibold uppercase">박자 정확도</div>
        <div className="text-3xl font-bold mt-1 text-[#1F2937]">{score}%</div>
      </div>
    </div>
  );
}
