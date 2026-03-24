import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import UploadPage from './UploadPage'

// TODO: Remove this landing stub — Kanwar to replace with real landing/auth pages
function Landing() {
  const navigate = useNavigate()
  return (
    <div>
      <button onClick={() => navigate('/upload')}>Go to Upload Workspace</button>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/upload" element={<UploadPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
