import api from './client'
import { HoursReport } from '../types/reports'

export const getHoursReport = (month?: string) =>
  api.get<HoursReport>('/reports/hours', { params: month ? { month } : {} }).then((r) => r.data)

/** Downloads the month's table as CSV (the request needs the auth header, so it goes through axios). */
export async function downloadHoursCsv(month: string) {
  const res = await api.get('/reports/hours.csv', { params: { month }, responseType: 'blob' })
  const url = URL.createObjectURL(res.data as Blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `hours-returned-${month}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
