import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const PARTS = [
  { id: 'V1', name: '제1바이올린', group: '현악기' },
  { id: 'V2', name: '제2바이올린', group: '현악기' },
  { id: 'VC', name: '첼로 & 베이스', group: '현악기' },
  { id: 'FL', name: '플루트 & 오보에', group: '목관악기' },
  { id: 'BR', name: '트럼펫 & 호른', group: '금관악기' },
  { id: 'DR', name: '팀파니 & 스네어', group: '타악기' },
  { id: 'PE', name: '트라이앵글 & 피아노', group: '타악기/건반' },
];

export default function Home() {
  const navigate = useNavigate();
  const [studentName, setStudentName] = useState<string>('');
  const [selectedPart, setSelectedPart] = useState<string>('');

  const handleEnterSandbox = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim()) return alert('이름을 입력해주세요!');
    if (!selectedPart) return alert('연주할 파트를 선택해주세요!');

    // 학생 화면으로 이름과 파트 데이터 넘기며 이동
    navigate('/student', { state: { studentName, partId: selectedPart } });
  };

  return (
    <div className="w-full h-screen bg-[#F9FAFB] flex flex-col justify-center items-center p-6 font-sans text-[#1F2937]">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl border border-[#D1D5DB] shadow-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-[#1F2937]">Classroom Maestro</h1>
          <p className="text-sm text-gray-500 mt-2">교실 디지털 오케스트라 지휘 게임</p>
        </div>

        <form onSubmit={handleEnterSandbox} className="space-y-6">
          {/* 이름 입력 */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              이름 입력
            </label>
            <input
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="이름을 입력하세요 (예: 홍길동)"
              className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#D1D5DB] rounded-xl text-base focus:outline-none focus:border-[#1F2937] transition-all"
            />
          </div>

          {/* 파트 선택 */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              악기 파트 선택
            </label>
            <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto border border-[#D1D5DB] rounded-xl p-2 bg-[#F9FAFB]">
              {PARTS.map((part) => (
                <button
                  key={part.id}
                  type="button"
                  onClick={() => setSelectedPart(part.id)}
                  className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-all flex justify-between items-center ${
                    selectedPart === part.id
                      ? 'bg-[#1F2937] text-white shadow-sm'
                      : 'bg-white hover:bg-gray-100 border border-gray-200 text-[#1F2937]'
                  }`}
                >
                  <span>{part.name}</span>
                  <span className={`text-xs ${selectedPart === part.id ? 'text-gray-300' : 'text-gray-400'}`}>
                    {part.group}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 입장 버튼 */}
          <button
            type="submit"
            className="w-full py-4 bg-[#1F2937] text-white font-bold rounded-xl shadow-sm hover:bg-gray-800 transition-all text-base"
          >
            오케스트라 입장하기 ➔
          </button>
        </form>

        {/* 교사용 대시보드 빠른 링크 */}
        <div className="mt-8 pt-4 border-t border-gray-100 text-center">
          <button
            onClick={() => navigate('/teacher')}
            className="text-xs text-gray-400 hover:text-[#1F2937] underline transition-all"
          >
            교사(지휘자) 통제실 대시보드 바로가기
          </button>
        </div>
      </div>
    </div>
  );
}
