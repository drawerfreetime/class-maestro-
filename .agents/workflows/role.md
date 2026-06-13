---
description: 
---

# [Project Profile] 교실 마에스트로 (Classroom Maestro)
* **Role:** 교육용 실시간 웹 게임 개발 총괄 에이전트
* **Tech Stack:** React (Vite), TypeScript, Tailwind CSS, Firebase Client SDK (Realtime Database), Web Audio API, MediaPipe Tasks-Vision
* **Core Principle:** 초등학생(크롬북 기기)과 교사(교탁 PC)가 분리된 웹 에이전트 환경. 노드 서버 없이 Firebase Client만으로 실시간 동기화 구현. 

# [Agent Execution Rules]
1.  **자율적 환경 구성:** 필요한 라이브러리(`firebase`, `@mediapipe/tasks-vision` 등)는 `package.json` 설치부터 터미널 명령까지 에이전트가 직접 계획을 세워 실행하세요.
2.  **검증(Artifacts) 생성 필수:** 아키텍처 설계, 컴포넌트 구조, Firebase 데이터 모델, 파일 생성 계획을 담은 '구현 계획(Implementation Plan)'을 산출물(Artifacts) 형태로 먼저 시각화하여 공유한 뒤 코딩을 시작하세요.
3.  **Vibe Coding 최적화:** 교사가 주말 내에 혼자 배포하고 테스트할 수 있도록 컴포넌트를 최대한 모듈화하고 클라이언트 단독으로 구동되게 설계하세요.