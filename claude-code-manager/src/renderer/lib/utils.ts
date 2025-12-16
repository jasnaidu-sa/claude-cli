import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function truncatePath(path: string, maxLength: number = 40): string {
  if (path.length <= maxLength) return path
  const parts = path.split('/')
  if (parts.length <= 2) return path

  const fileName = parts[parts.length - 1]
  const firstPart = parts[0] || parts[1]

  if (fileName.length + firstPart.length + 5 >= maxLength) {
    return `.../${fileName}`
  }

  return `${firstPart}/.../${fileName}`
}

export function getFileIcon(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()

  const iconMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'react',
    js: 'javascript',
    jsx: 'react',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'sass',
    html: 'html',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'terminal',
    bash: 'terminal',
    sql: 'database',
    prisma: 'database',
    env: 'settings',
    gitignore: 'git',
    dockerfile: 'docker',
    lock: 'lock'
  }

  return iconMap[ext || ''] || 'file'
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    idle: 'bg-gray-500',
    running: 'bg-green-500',
    thinking: 'bg-yellow-500',
    editing: 'bg-blue-500',
    error: 'bg-red-500'
  }
  return colors[status] || colors.idle
}
