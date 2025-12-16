import { spawn, IPty } from 'node-pty'
import { EventEmitter } from 'events'
import { platform } from 'os'
import { basename } from 'path'
import type { Session, SessionStatus, EditedFile, FileAction } from '@shared/types'
import { getMainWindow } from '../index'
import { IPC_CHANNELS } from '@shared/types'

interface PtySession {
  pty: IPty
  session: Session
  promptDetected: boolean
  outputBuffer?: string
}

export class SessionManager extends EventEmitter {
  private sessions: Map<string, PtySession> = new Map()
  private outputParsers: Map<string, OutputParser> = new Map()

  constructor() {
    super()
  }

  create(projectPath: string): Session {
    const id = this.generateId()
    const projectName = basename(projectPath)

    // Determine shell based on platform
    const shell = platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'

    // Spawn PTY
    const pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: projectPath,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      }
    })

    const session: Session = {
      id,
      projectPath,
      projectName,
      status: 'idle',
      editedFiles: [],
      createdAt: Date.now()
    }

    // Create output parser for this session
    const parser = new OutputParser(session)
    this.outputParsers.set(id, parser)

    // Handle PTY output
    pty.onData((data) => {
      // Parse output for file operations
      parser.parse(data)

      // Send to renderer
      const mainWindow = getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.SESSION_OUTPUT, {
          sessionId: id,
          data,
          timestamp: Date.now()
        })

        // Send status updates
        const status = parser.getStatus()
        if (status !== session.status) {
          session.status = status
          mainWindow.webContents.send(IPC_CHANNELS.SESSION_STATUS, {
            sessionId: id,
            status,
            editedFiles: parser.getEditedFiles()
          })
        }
      }

      // Smart auto-launch: detect shell prompt and send cs command
      const ptySession = this.sessions.get(id)
      if (ptySession && !ptySession.promptDetected) {
        // Accumulate output to detect prompt across chunks
        if (!ptySession.outputBuffer) {
          ptySession.outputBuffer = ''
        }
        ptySession.outputBuffer += data

        // Keep buffer manageable
        if (ptySession.outputBuffer.length > 2000) {
          ptySession.outputBuffer = ptySession.outputBuffer.slice(-1000)
        }

        // Debug: log what we're seeing (remove after debugging)
        console.log('[PTY Debug] Buffer ends with:', JSON.stringify(ptySession.outputBuffer.slice(-100)))

        // Detect PowerShell prompt: look for ">" at end after path
        // PowerShell prompt format: "PS C:\path>" possibly with trailing whitespace or escape codes
        const cleanBuffer = ptySession.outputBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // Strip ANSI codes
        const hasPrompt = />\s*$/.test(cleanBuffer) && /PS\s+[A-Za-z]:/.test(cleanBuffer)

        console.log('[PTY Debug] Clean buffer ends:', JSON.stringify(cleanBuffer.slice(-80)))
        console.log('[PTY Debug] hasPrompt:', hasPrompt)

        if (hasPrompt) {
          console.log('[PTY Debug] Prompt detected! Sending cs command...')
          ptySession.promptDetected = true
          // Small delay to ensure prompt is fully rendered
          setTimeout(() => {
            this.write(id, 'cs\r')
          }, 150)
        }
      }
    })

    pty.onExit(({ exitCode }) => {
      session.status = exitCode === 0 ? 'idle' : 'error'
      const mainWindow = getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send(IPC_CHANNELS.SESSION_STATUS, {
          sessionId: id,
          status: session.status,
          editedFiles: parser.getEditedFiles()
        })
      }
    })

    this.sessions.set(id, { pty, session, promptDetected: false })

    // Fallback: if prompt detection doesn't trigger within 3 seconds, send cs anyway
    setTimeout(() => {
      const ptySession = this.sessions.get(id)
      if (ptySession && !ptySession.promptDetected) {
        console.log('[PTY Debug] Fallback timeout - sending cs command')
        ptySession.promptDetected = true
        this.write(id, 'cs\r')
      }
    }, 3000)

    return session
  }

  destroy(id: string): boolean {
    const ptySession = this.sessions.get(id)
    if (!ptySession) return false

    ptySession.pty.kill()
    this.sessions.delete(id)
    this.outputParsers.delete(id)
    return true
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroy(id)
    }
  }

  write(id: string, data: string): boolean {
    const ptySession = this.sessions.get(id)
    if (!ptySession) return false

    ptySession.pty.write(data)
    return true
  }

  resize(id: string, cols: number, rows: number): boolean {
    const ptySession = this.sessions.get(id)
    if (!ptySession) return false

    ptySession.pty.resize(cols, rows)
    return true
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id)?.session
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values()).map(ps => ps.session)
  }

  private generateId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
}

// Output parser to detect Claude's activities
class OutputParser {
  private session: Session
  private currentStatus: SessionStatus = 'idle'
  private editedFiles: EditedFile[] = []
  private buffer: string = ''

  // Patterns to detect Claude's activities
  private patterns = {
    thinking: /(?:Thinking|Analyzing|Processing|Reading|Understanding)/i,
    editing: /(?:Edit(?:ing)?|Writ(?:ing|e)|Creat(?:ing|e)|Modif(?:ying|y))\s+(?:file)?/i,
    reading: /(?:Read(?:ing)?|View(?:ing)?)\s+(?:file)?/i,
    fileOperation: /(?:─|╭|╮|│|╰|╯).*?([\/\w\-\.]+\.\w+)/,
    toolUse: /(?:Using|Running|Executing)\s+(\w+)/i,
    complete: /(?:Done|Complete|Finished|Success)/i
  }

  constructor(session: Session) {
    this.session = session
  }

  parse(data: string): void {
    this.buffer += data

    // Check for various patterns
    if (this.patterns.thinking.test(data)) {
      this.currentStatus = 'thinking'
    }

    if (this.patterns.editing.test(data)) {
      this.currentStatus = 'editing'
    }

    // Detect file operations
    const fileMatch = this.buffer.match(/(?:Edit|Read|Write|Create)\s+([\/\w\-\.]+\.\w+)/i)
    if (fileMatch) {
      const filePath = fileMatch[1]
      const action = this.detectAction(data)
      this.addEditedFile(filePath, action)
    }

    // Check for completion
    if (this.patterns.complete.test(data) || data.includes('$') || data.includes('>')) {
      // Might be back to prompt
      if (!this.patterns.thinking.test(this.buffer.slice(-200))) {
        this.currentStatus = 'idle'
      }
    }

    // Keep buffer manageable
    if (this.buffer.length > 10000) {
      this.buffer = this.buffer.slice(-5000)
    }
  }

  private detectAction(data: string): FileAction {
    if (/edit/i.test(data)) return 'edit'
    if (/write|create/i.test(data)) return 'write'
    if (/read/i.test(data)) return 'read'
    if (/delete|remove/i.test(data)) return 'delete'
    return 'edit'
  }

  private addEditedFile(path: string, action: FileAction): void {
    const existing = this.editedFiles.find(f => f.path === path)
    if (existing) {
      existing.action = action
      existing.timestamp = Date.now()
      existing.status = 'pending'
    } else {
      this.editedFiles.push({
        path,
        action,
        timestamp: Date.now(),
        status: 'pending'
      })
    }

    // Keep only recent files
    if (this.editedFiles.length > 20) {
      this.editedFiles = this.editedFiles.slice(-20)
    }
  }

  getStatus(): SessionStatus {
    return this.currentStatus
  }

  getEditedFiles(): EditedFile[] {
    return [...this.editedFiles]
  }
}
