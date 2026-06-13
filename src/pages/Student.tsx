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

  // [수업 제어 상태]
  const [isLive, setIsLive] = useState<boolean>(false); // 교사의 합주 시작 여부
  const [score, setScore] = useState<number>(0);
  const [expression, setExpression] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>('대기 중');
  const [cameraState, setCameraState] = useState<'idle' | 'requesting' | 'granted' | 'error'>('idle');
  const [beatType, setBeatType] = useState<string>('4/4');
  const [bpm, setBpm] = useState<number>(120);

  useEffect(() => {
    if (!location.state?.studentName) {
      navigate('/');
      return;
    }

    // 학생 입장 시 즉시 노드 생성 및 연결 끊김(브라우저 종료 등) 시 자동 삭제 예약
    const studentScoreRef = ref(db, `scores/${location.state.studentName}`);
    set(studentScoreRef, { beatScore: 0, expressionScore: 0, updatedAt: Date.now() });
    onDisconnect(studentScoreRef).remove();

    // 1. 교사의 [합주 시작 / 중단] 신호를 실시간 데이터베이스에서 감시
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
          setFeedback('START!');
        } else {
          setIsLive(false);
          setFeedback('대기 중');
          setScore(0);
          setExpression(0);
        }
      }
    });

    return () => {
      unsubscribeGame();
      remove(studentScoreRef); // 정상적으로 컴포넌트 언마운트 시 명시적 삭제
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
    };
  }, [location.state?.studentName, navigate]);

  // 2. 미디어파이프 및 웹캠 상시 기동 (버튼 클릭을 통한 명시적 요청)
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
        numHands: 2
      });

      // 상시 웹캠 스트림 확보 (브라우저 팝업으로 카메라 권한 명확히 요청)
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

  // 박자별 지휘 궤적 수학 공식
  const getConductingNode = (time: number, beatType: string, currentBpm: number = 120) => {
    const beatDuration = (60 / currentBpm) * 1000; // 1박자당 시간(ms)
    
    // 화면 크기 800x450, 중앙점 (400, 225). 기존보다 20% 크기 확대(scale 1.2)
    if (beatType === '2/4') {
      const t = (time % (beatDuration * 2)) / (beatDuration * 2);
      return { x: 400 + 180 * Math.sin(t * 2 * Math.PI), y: 225 + 180 * Math.cos(t * 2 * Math.PI) };
    } else if (beatType === '3/4') {
      const t = (time % (beatDuration * 3)) / (beatDuration * 3);
      return { x: 400 + 240 * Math.sin(t * 2 * Math.PI), y: 225 + 120 * Math.cos(t * 3 * Math.PI) };
    } else if (beatType === '6/8') {
      const t = (time % (beatDuration * 6)) / (beatDuration * 6);
      return { x: 400 + 312 * Math.sin(t * 2 * Math.PI), y: 225 + 120 * Math.sin(t * 4 * Math.PI) };
    } else {
      // [정통 4/4박자 지휘 궤적]: 1박(下) -> 2박(左) -> 3박(右) -> 4박(上)
      const t = (time % (beatDuration * 4)) / (beatDuration * 4); // 0.0 ~ 1.0 순환
      
      let bx = 0;
      let by = 0;
      
      if (t < 0.25) { // 1박: 아래로 내려치기
        const p = t / 0.25;
        bx = 0 - 30 * Math.sin(p * Math.PI);
        by = -120 + 240 * p;
      } else if (t < 0.5) { // 2박: 왼쪽으로 찌르기
        const p = (t - 0.25) / 0.25;
        bx = 0 - 180 * p;
        by = 120 - 100 * Math.sin(p * Math.PI / 2);
      } else if (t < 0.75) { // 3박: 오른쪽으로 길게 뻗기
        const p = (t - 0.5) / 0.25;
        bx = -180 + 360 * p;
        by = 20 + 50 * Math.sin(p * Math.PI);
      } else { // 4박: 원점으로 솟구치며 회귀
        const p = (t - 0.75) / 0.25;
        bx = 180 - 180 * p;
        by = 20 - 140 * p;
      }
      return { x: 400 + bx * 1.2, y: 225 + by * 1.2 };
    }
  };

  const analyzeLeftHand = (landmarks: any[]) => {
    const wrist = landmarks[0];
    const fingerTips = [4, 8, 12, 16, 20];
    let totalDistance = 0;
    fingerTips.forEach(tip => {
      totalDistance += Math.hypot(landmarks[tip].x - wrist.x, landmarks[tip].y - wrist.y);
    });
    const spreadSpread = Math.min(Math.max((totalDistance - 0.5) / 0.8, 0), 1);
    const heightSpread = Math.min(Math.max((0.8 - wrist.y) / 0.6, 0), 1);
    return Math.round(spreadSpread * 40 + heightSpread * 60);
  };

  const renderLoop = (timestamp: number) => {
    if (!videoRef.current || !canvasRef.current || !landmarkerRef.current) {
      requestRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- [기본 렌더링 영역]: 카메라는 상시 구동하여 배경에 뿌림 ---
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 웹캠 거울 반전(미러링) 효과 적용하여 꽉 차게 그리기
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // 박자표가 잘 보이도록 흰색 배경 투명도 40% 오버레이 적용
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 박자 점선 가이드라인 그리기 (상시 표시하여 대기 및 연습 유도)
    ctx.strokeStyle = 'rgba(29, 39, 55, 0.3)'; // 어두운 차콜 투명 레이어
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

    // --- [조건부 평가 영역]: 교사가 합주 시작(isLive)을 했을 때만 활성화 ---
    let targetNode = { x: 400, y: 225 }; // 비작동시 중앙 고정
    if (isLive) {
      targetNode = getConductingNode(timestamp, beatTypeRef.current, bpmRef.current);
      ctx.fillStyle = '#1F2937'; // 타이밍 구슬 등장
      ctx.beginPath();
      ctx.arc(targetNode.x, targetNode.y, 18, 0, 2 * Math.PI);
      ctx.fill();
    }

    let currentBeatScore = 0;
    let currentExpression = 0;

    // 미디어파이프 관절 실시간 오버레이
    try {
      // @mediapipe/tasks-vision 의 비디오 처리 메서드는 detectForVideo 입니다.
      const results = landmarkerRef.current.detectForVideo(videoRef.current, performance.now());
    if (results.landmarks && results.handedness) {
      results.landmarks.forEach((landmarks: any[]) => {
        // 화면 미러링 기준: 좌측 영역은 왼손(표현), 우측 영역은 오른손(박자)으로 실전 맵핑 처리
        const wristX = (1 - landmarks[0].x) * canvas.width;
        const isRightZone = wristX > canvas.width / 2;

        if (isRightZone) {
          // 오직 8번(검지 손가락 끝) 점만 추적 (미러링 적용)
          const indexFingerTip = landmarks[8];
          const pointerX = (1 - indexFingerTip.x) * canvas.width;
          const pointerY = indexFingerTip.y * canvas.height;

          // 예쁘고 선명한 황금빛 포인터 표시
          ctx.fillStyle = '#F59E0B';
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#F59E0B';
          ctx.beginPath();
          ctx.arc(pointerX, pointerY, 12, 0, 2 * Math.PI);
          ctx.fill();
          ctx.shadowBlur = 0;

          // 합주 중일 때만 박자 거리 측정 및 스코어링
          if (isLive) {
            const dist = Math.hypot(pointerX - targetNode.x, pointerY - targetNode.y);
            if (dist < 60) {
              currentBeatScore = 100;
              setFeedback('PERFECT!');
            } else if (dist < 110) {
              currentBeatScore = 50;
              setFeedback('GOOD');
            } else {
              currentBeatScore = 0;
              setFeedback('MISS');
            }
          }
        } else {
          // 왼손 악상 표현용 관절 구조 스켈레톤 실시간 드로잉
          if (isLive) {
            currentExpression = analyzeLeftHand(landmarks);
            setExpression(currentExpression);
          }

          landmarks.forEach(lm => {
            ctx.fillStyle = 'rgba(31, 41, 55, 0.8)';
            ctx.beginPath();
            ctx.arc((1 - lm.x) * canvas.width, lm.y * canvas.height, 5, 0, 2 * Math.PI);
            ctx.fill();
          });
        }
      });
    }
    } catch (err) {
      console.warn("MediaPipe detection error:", err);
    }

    if (isLive && currentBeatScore > 0) {
      setScore(prev => Math.round(prev * 0.95 + currentBeatScore * 0.05));
    }

    // 0.5초 주기로 Firebase RTDB 서버에 스로틀링 전송
    if (isLive && timestamp - lastFirebaseUpdate.current > 500) {
      lastFirebaseUpdate.current = timestamp;
      set(ref(db, `scores/${studentName}`), {
        beatScore: currentBeatScore,
        expressionScore: currentExpression,
        updatedAt: timestamp
      });
    }

    requestRef.current = requestAnimationFrame(renderLoop);
  };

  return (
    <div className="w-full h-screen bg-[#F9FAFB] flex flex-col justify-between items-center p-6 font-sans text-[#1F2937]">
      {/* 상단 헤더 뷰 리포트 */}
      <div className="w-full flex justify-between items-center border-b border-[#D1D5DB] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Student Maestro</h1>
          <p className="text-sm text-gray-500">이름: {studentName}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-400">BPM {bpm} | {beatType} | 맨손 양손 지휘 가이드</div>
          <div className={`text-lg font-bold ${isLive ? 'text-[#F59E0B] animate-pulse' : 'text-gray-400'}`}>
            {feedback}
          </div>
        </div>
      </div>

      {/* 메인 캔버스 스테이지 (웹캠 화면 상시 전면 배치) */}
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
              <p className="text-xs text-gray-500 mt-1">선생님이 합주를 시작하면 음악과 평가가 시작됩니다.</p>
            </div>
          </div>
        )}
      </div>

      {/* 실시간 믹싱 피드백 보드 */}
      <div className="w-full grid grid-cols-2 gap-4 max-w-2xl bg-white p-4 rounded-xl border border-[#D1D5DB] shadow-sm">
        <div className="text-center border-r border-[#D1D5DB]">
          <div className="text-xs text-gray-400 font-semibold uppercase">박자 정확도</div>
          <div className="text-3xl font-bold mt-1 text-[#1F2937]">{score}%</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-400 font-semibold uppercase">왼손 악상크기</div>
          <div className="text-3xl font-bold mt-1 text-[#F59E0B]">{expression}%</div>
        </div>
      </div>
    </div>
  );
}
