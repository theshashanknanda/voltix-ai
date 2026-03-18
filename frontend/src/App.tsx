import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="flex items-center justify-center h-screen bg-black">
      <h1 className="text-blue-500 font-bold text-4xl">Voltix-ai</h1>
    </div>
  )
}

export default App
