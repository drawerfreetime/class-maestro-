import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { ref, onValue, set } from 'firebase/database';
import { db } from '../firebase';

export default function Student() {
  const location = useLocation();
  const navigate = useNavigate();
  const { studentName, partId } = location.state || { studentName: '익명', partId: 'V1' };

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<any>(null);
  const requestRef = useRef<number | null>(null);
  const lastFirebaseUpdate = useRef<number>(0);

  // [수업 제어 상태]
  const [isLive, setIsLive] = useState<boolean>(false); // 교사의 합주 시작 여부
  const [score, setScore] = useState<number>(0);
  const [expression, setExpression] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>('대기 중');

  useEffect(() => {
    if (!location.state?.studentName) {
      navigate('/');
      return;
    }

    // 1. 교사의 [합주 시작 / 중단] 신호를 실시간 데이터베이스에서 감시
    const gameStateRef = ref(db, 'gameState');
    const unsubscribeGame = onValue(gameStateRef, (snapshot) => {
      const data = snapshot.val();
      if (data && data.status === 'playing') {
        setIsLive(true);
        setFeedback('START!');
      } else {
        setIsLive(false);
        setFeedback('대기 중');
        setScore(0);
        setExpression(0);
      }
    });

    // 2. 미디어파이프 및 웹캠 상시 기동 (권한 요청 포함)
    async function initMediaPipeAndCamera() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm'
        );
        landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker_full/float16/1/hand_landmarker_full.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 2
        });

        // 상시 웹캠 스트림 확보 (브라우저 팝업으로 카메라 권한 명확히 요청)
        if (videoRef.current) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
            audio: false
          });
          videoRef.current.srcObject = stream;
          videoRef.current.addEventListener('loadeddata', () => {
            requestRef.current = requestAnimationFrame(renderLoop);
          });
        }
      } catch (err) {
        alert('카메라 권한을 허용해야 지휘 실시간 인식이 가능합니다!');
        console.error(err);
      }
    }

    initMediaPipeAndCamera();

    return () => {
      unsubscribeGame();
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // 무한대(∞) 모양의 4박자 지휘 궤적 수학 공식
  const getInfinityLoopNode = (time: number) => {
    const bpm = 120;
    const duration = (60 / bpm) * 4 * 1000; 
    const t = (time % duration) / duration;
    const angle = t * 2 * Math.PI;

    const scaleX = 220;
    const scaleY = 120;
    const x = 400 + scaleX * Math.sin(angle);
    const y = 300 + scaleY * Math.sin(2 * angle) / 2;

    return { x, y };
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

    // 4박자 점선 가이드라인 그리기 (상시 표시하여 대기 및 연습 유도)
    ctx.strokeStyle = 'rgba(29, 39, 55, 0.3)'; // 어두운 차콜 투명 레이어
    ctx.lineWidth = 4;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const duration = (60 / 120) * 4 * 1000;
      const fakeTime = (i / 100) * duration;
      const pt = getInfinityLoopNode(fakeTime);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // --- [조건부 평가 영역]: 교사가 합주 시작(isLive)을 했을 때만 활성화 ---
    let targetNode = { x: 400, y: 300 }; // 비작동시 중앙 고정
    if (isLive) {
      targetNode = getInfinityLoopNode(timestamp);
      ctx.fillStyle = '#1F2937'; // 타이밍 구슬 등장
      ctx.beginPath();
      ctx.arc(targetNode.x, targetNode.y, 18, 0, 2 * Math.PI);
      ctx.fill();
    }

    let currentBeatScore = 0;
    let currentExpression = 0;

    // 미디어파이프 관절 실시간 오버레이
    const results = landmarkerRef.current.detectVideo(videoRef.current, timestamp);
    if (results.landmarks && results.handedness) {
      results.landmarks.forEach((landmarks: any[]) => {
        // 화면 미러링 기준: 좌측 영역은 왼손(표현), 우측 영역은 오른손(박자)으로 실전 맵핑 처리
        const wristX = (1 - landmarks[0].x) * canvas.width;
        const isRightZone = wristX > canvas.width / 2;

        if (isRightZone) {
          // 오른손 마디마디 기준 포인터 (골드 컬러 램프)
          const mcp = landmarks[9];
          const pointerX = (1 - (landmarks[0].x + mcp.x) / 2) * canvas.width;
          const pointerY = ((landmarks[0].y + mcp.y) / 2) * canvas.height;

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

    if (isLive && currentBeatScore > 0) {
      setScore(prev => Math.round(prev * 0.95 + currentBeatScore * 0.05));
    }

    // 0.5초 주기로 Firebase RTDB 서버에 스로틀링 전송
    if (isLive && timestamp - lastFirebaseUpdate.current > 500) {
      lastFirebaseUpdate.current = timestamp;
      set(ref(db, `scores/${partId}/${studentName}`), {
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
          <p className="text-sm text-gray-500">파트: {partId} | 이름: {studentName}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-400">BPM 120 | 맨손 양손 지휘 가이드</div>
          <div className={`text-lg font-bold ${isLive ? 'text-[#F59E0B] animate-pulse' : 'text-gray-400'}`}>
            {feedback}
          </div>
        </div>
      </div>

      {/* 메인 캔버스 스테이지 (웹캠 화면 상시 전면 배치) */}
      <div className="relative w-[800px] h-[600px] bg-white rounded-2xl shadow-sm border border-[#D1D5DB] overflow-hidden">
        <video ref={videoRef} className="hidden" width="640" height="480" playsInline muted />
        <canvas ref={canvasRef} width="800" height="600" className="w-full h-full" />
        
        {/* 대기 중 안내 오버레이 */}
        {!isLive && (
          <div className="absolute inset-0 bg-black/40 flex justify-center items-center backdrop-blur-xs">
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
