import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import SubjectDetail from './pages/SubjectDetail'
import LectureDetail from './pages/LectureDetail'
import { pingBackend } from './api'

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token')
  return token ? children : <Navigate to="/login" />
}

export default function App() {
  const [warming, setWarming] = useState(false)

  useEffect(() => {
    let done = false
    const timer = setTimeout(() => { if (!done) setWarming(true) }, 1500)
    pingBackend().finally(() => {
      done = true
      clearTimeout(timer)
      setWarming(false)
    })
    return () => clearTimeout(timer)
  }, [])

  return (
    <>
      {warming && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: 'rgba(124,58,237,.95)', color: '#fff',
          padding: '8px 16px', textAlign: 'center', fontSize: 13, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        }}>
          <span style={{
            display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,.3)',
            borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite',
          }} />
          Сервер запускается, подождите ~30 сек...
        </div>
      )}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/subjects/:id" element={<PrivateRoute><SubjectDetail /></PrivateRoute>} />
        <Route path="/lectures/:id" element={<PrivateRoute><LectureDetail /></PrivateRoute>} />
      </Routes>
    </>
  )
}