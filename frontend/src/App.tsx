import { useState } from 'react'
import UploadPage from './UploadPage'

function App() {
  const [page, setPage] = useState<'landing' | 'upload'>('landing')

  if (page === 'upload') return <UploadPage />

  return (
    // TODO: Remove this landing stub — Kanwar to replace with real landing/auth pages
    <div>
      <button onClick={() => setPage('upload')}>Go to Upload Workspace</button>
    </div>
  )
}

export default App
