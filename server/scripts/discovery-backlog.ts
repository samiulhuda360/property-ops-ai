// Ranks the discovery task list into an automation backlog and writes it as Excel and Markdown.
//   npx tsx scripts/discovery-backlog.ts
// Score = hours per month x (1 + rework rate x 5) x ease (1 hard .. 3 easy). Rework weighs heavily because a
// mistake in rent or GST costs far more than the minutes it took to make.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'

export interface Task {
  role: string
  task: string
  automationKey: string
  itemsPerMonth: number
  minutesPerItem: number
  reworkRate: number
  ease: number
  notes: string
}

export interface RankedTask extends Task {
  hoursPerMonth: number
  score: number
  rank: number
}

const ROOT = join(__dirname, '..', '..')
export const TIMINGS_CSV = join(ROOT, 'discovery', 'task-timings.csv')

/** Splits one CSV line, honouring double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(field)
      field = ''
    } else field += ch
  }
  out.push(field)
  return out
}

export function loadTasks(path = TIMINGS_CSV): Task[] {
  const [header, ...rows] = readFileSync(path, 'utf8').trim().split(/\r?\n/)
  const cols = splitCsvLine(header)
  return rows.map((row) => {
    const v = Object.fromEntries(splitCsvLine(row).map((value, i) => [cols[i], value]))
    return {
      role: v.role,
      task: v.task,
      automationKey: v.automation_key,
      itemsPerMonth: Number(v.items_per_month),
      minutesPerItem: Number(v.minutes_per_item),
      reworkRate: Number(v.rework_rate),
      ease: Number(v.ease),
      notes: v.notes,
    }
  })
}

export function rank(tasks: Task[]): RankedTask[] {
  return tasks
    .map((t) => {
      const hoursPerMonth = (t.itemsPerMonth * t.minutesPerItem) / 60
      const score = hoursPerMonth * (1 + t.reworkRate * 5) * t.ease
      return { ...t, hoursPerMonth: Math.round(hoursPerMonth * 10) / 10, score: Math.round(score * 10) / 10, rank: 0 }
    })
    .sort((a, b) => b.score - a.score)
    .map((t, i) => ({ ...t, rank: i + 1 }))
}

async function writeOutputs(ranked: RankedTask[]) {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Automation backlog', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = [
    { header: 'Rank', key: 'rank', width: 6 },
    { header: 'Role', key: 'role', width: 18 },
    { header: 'Task', key: 'task', width: 52 },
    { header: 'Items / month', key: 'itemsPerMonth', width: 13 },
    { header: 'Minutes / item', key: 'minutesPerItem', width: 14 },
    { header: 'Hours / month', key: 'hoursPerMonth', width: 13 },
    { header: 'Rework rate', key: 'reworkRate', width: 12, style: { numFmt: '0%' } },
    { header: 'Ease (1-3)', key: 'ease', width: 10 },
    { header: 'Score', key: 'score', width: 9 },
    { header: 'Automated by', key: 'automationKey', width: 22 },
    { header: 'Notes', key: 'notes', width: 70 },
  ]
  ranked.forEach((t) => sheet.addRow(t))
  sheet.getRow(1).font = { bold: true }
  sheet.autoFilter = { from: 'A1', to: 'K1' }
  const method = book.addWorksheet('Method')
  method.addRows([
    ['Score = hours per month x (1 + rework rate x 5) x ease'],
    ['Hours per month = items per month x minutes per item / 60'],
    ['Rework rate = share of items that needed correcting later'],
    ['Ease: 3 = structured input and clear rules, 1 = judgement on site or with people'],
  ])
  method.getColumn(1).width = 80
  await book.xlsx.writeFile(join(ROOT, 'discovery', 'automation-backlog.xlsx'))

  const lines = [
    '| Rank | Role | Task | Hours / month | Rework | Ease | Score | Automated by |',
    '|---|---|---|---|---|---|---|---|',
    ...ranked.map(
      (t) =>
        `| ${t.rank} | ${t.role} | ${t.task} | ${t.hoursPerMonth} | ${Math.round(t.reworkRate * 100)}% | ${t.ease} | ${t.score} | ${t.automationKey ? `\`${t.automationKey}\`` : '-'} |`,
    ),
  ]
  writeFileSync(join(ROOT, 'discovery', 'backlog.md'), lines.join('\n') + '\n')
}

if (require.main === module) {
  const ranked = rank(loadTasks())
  writeOutputs(ranked).then(() => {
    for (const t of ranked) console.log(`${t.rank}. ${t.task} (score ${t.score})`)
  })
}
