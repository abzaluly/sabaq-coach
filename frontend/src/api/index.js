import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

const api = axios.create({ baseURL: BASE_URL, timeout: 90000 })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auto-retry on Network Error (Render cold start can take 30-60s)
api.interceptors.response.use(
  res => res,
  async (error) => {
    const config = error.config
    if (!config) return Promise.reject(error)
    config._retryCount = config._retryCount || 0
    const isNetworkError = !error.response
    if (isNetworkError && config._retryCount < 4) {
      config._retryCount++
      await new Promise(r => setTimeout(r, 12000))
      return api(config)
    }
    return Promise.reject(error)
  }
)

export const pingBackend = () =>
  axios.get(BASE_URL.replace('/api', '/'), { timeout: 90000 }).catch(() => {})

export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  updateProfile: (userId, data) => api.put(`/auth/profile/${userId}`, data),
}

export const subjectsAPI = {
  getAll: (user_id) => api.get(`/subjects/?user_id=${user_id}`),
  create: (data) => api.post('/subjects/', data),
  delete: (id) => api.delete(`/subjects/${id}`),
}

export const lecturesAPI = {
  getAll: (subject_id) => api.get(`/lectures/?subject_id=${subject_id}`),
  getById: (id) => api.get(`/lectures/${id}`),
  create: (data) => api.post('/lectures/', data),
  delete: (id) => api.delete(`/lectures/${id}`),
}

export const materialsAPI = {
  upload: (formData) => api.post('/materials/upload', formData),
  getAll: (lecture_id) => api.get(`/materials/?lecture_id=${lecture_id}`),
}

export const aiAPI = {
  analyzeNotes: (data) => api.post('/ai/analyze-notes', data),
  explain: (data) => api.post('/ai/explain', data),
  getQuizSvg: (data) => api.post('/ai/quiz-svg', data),
  generatePresentation: (data) => api.post('/ai/generate-presentation', data),
}

export const quizzesAPI = {
  generate: (data) => api.post('/quizzes/generate', data),
  getAll: (lecture_id) => api.get(`/quizzes/?lecture_id=${lecture_id}`),
  getQuestions: (quiz_id) => api.get(`/quizzes/${quiz_id}/questions`),
  getAttempts: (quiz_id) => api.get(`/quizzes/${quiz_id}/attempts`),
  submitAttempt: (data) => api.post('/quizzes/attempt', data),
}

export const progressAPI = {
  getAll: (user_id) => api.get(`/progress/?user_id=${user_id}`),
  update: (data) => api.post('/progress/', data),
}

export default api