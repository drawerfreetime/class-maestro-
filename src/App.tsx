import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Student from './pages/Student';
import Teacher from './pages/Teacher';
import Home from './pages/Home';

function App() {
  return (
    <Router>
      <div className="min-h-screen font-sans">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/student" element={<Student />} />
          <Route path="/teacher" element={<Teacher />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
