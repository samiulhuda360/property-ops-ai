import 'dotenv/config'
import { createApp } from './app'

const PORT = Number(process.env.PORT || 3001)

createApp().listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
