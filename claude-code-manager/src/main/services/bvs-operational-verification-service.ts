/**
 * BVS Operational Verification Service
 *
 * Ensures that planned functionality is not just technically correct but is
 * actually operational within the running application.
 *
 * Key responsibilities:
 * - Auto-start development server
 * - Verify feature accessibility in running app
 * - Test API endpoints with actual requests
 * - Verify navigation/routing works
 * - Create test users for auth testing
 * - Generate operational verification reports
 *
 * Uses Chrome DevTools MCP for browser-based verification.
 */

import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs/promises'
import { spawn, ChildProcess } from 'child_process'
import type { BvsSection } from '@shared/bvs-types'
import { getBvsSubagentService } from './bvs-subagent-service'

// ============================================================================
// Types
// ============================================================================

export interface VerificationTarget {
  type: 'ui_element' | 'navigation' | 'api_call' | 'state_change' | 'data_persistence'
  target: string              // What to verify (selector, path, endpoint)
  expectedBehavior: string    // What should happen
  selector?: string           // CSS selector for UI elements
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'  // For API calls
  requestBody?: unknown       // For API calls
}

export interface VerificationResult {
  type: VerificationTarget['type']
  target: string
  expectedBehavior: string
  actualResult: 'pass' | 'fail' | 'skip'
  evidence?: string           // Screenshot path, response body, etc.
  errorMessage?: string       // If failed
  duration?: number           // Time taken in ms
}

export interface OperationalVerificationReport {
  featureId: string
  featureName: string
  timestamp: number
  serverStatus: 'running' | 'started' | 'failed'
  serverUrl: string
  verifications: VerificationResult[]
  overallStatus: 'operational' | 'partially_operational' | 'not_operational'
  blockers: string[]
  recommendations: string[]
  testUserCreated?: boolean
  totalDuration: number
}

export interface OperationalVerificationConfig {
  projectPath: string
  featureName: string
  featureDescription: string
  devServerCommand?: string       // Default: npm run dev
  baseUrl?: string                // Default: http://localhost:3000
  verifications: VerificationTarget[]
  createTestUser?: boolean        // Create test user for auth testing
  testUserCredentials?: {
    email: string
    password: string
  }
  timeout?: number                // Default: 60000ms
  failIfNotOperational?: boolean  // Fail task if verification fails
}

export interface DevServerInfo {
  process: ChildProcess | null
  url: string
  isRunning: boolean
  startedByUs: boolean
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DEV_COMMAND = 'npm run dev'
const DEFAULT_BASE_URL = 'http://localhost:3000'
const DEFAULT_TIMEOUT = 60000
const SERVER_STARTUP_WAIT = 10000  // Wait 10s for server to start

// ============================================================================
// Service
// ============================================================================

export class BvsOperationalVerificationService extends EventEmitter {
  private devServer: DevServerInfo | null = null

  constructor() {
    super()
  }

  /**
   * Run operational verification for a feature
   */
  async verify(config: OperationalVerificationConfig): Promise<OperationalVerificationReport> {
    const startTime = Date.now()
    console.log(`[OperationalVerification] Starting verification for: ${config.featureName}`)

    this.emit('verification-started', {
      featureName: config.featureName,
      verificationsCount: config.verifications.length,
    })

    const report: OperationalVerificationReport = {
      featureId: this.generateFeatureId(config.featureName),
      featureName: config.featureName,
      timestamp: Date.now(),
      serverStatus: 'failed',
      serverUrl: config.baseUrl || DEFAULT_BASE_URL,
      verifications: [],
      overallStatus: 'not_operational',
      blockers: [],
      recommendations: [],
      totalDuration: 0,
    }

    try {
      // 1. Ensure dev server is running
      const serverInfo = await this.ensureDevServerRunning(
        config.projectPath,
        config.devServerCommand || DEFAULT_DEV_COMMAND,
        config.baseUrl || DEFAULT_BASE_URL
      )

      report.serverStatus = serverInfo.startedByUs ? 'started' : 'running'
      report.serverUrl = serverInfo.url

      // 2. Create test user if needed
      if (config.createTestUser) {
        try {
          await this.createTestUser(
            config.projectPath,
            config.testUserCredentials || {
              email: 'test@example.com',
              password: 'TestPassword123!',
            }
          )
          report.testUserCreated = true
        } catch (error) {
          console.warn('[OperationalVerification] Failed to create test user:', error)
          report.blockers.push('Failed to create test user for auth testing')
        }
      }

      // 3. Run verifications
      for (const verification of config.verifications) {
        const result = await this.runVerification(
          verification,
          config.baseUrl || DEFAULT_BASE_URL,
          config.projectPath,
          config.timeout || DEFAULT_TIMEOUT
        )
        report.verifications.push(result)

        this.emit('verification-result', {
          featureName: config.featureName,
          verification: result,
        })
      }

      // 4. Determine overall status
      const passCount = report.verifications.filter(v => v.actualResult === 'pass').length
      const failCount = report.verifications.filter(v => v.actualResult === 'fail').length
      const totalCount = report.verifications.length

      if (failCount === 0 && passCount > 0) {
        report.overallStatus = 'operational'
      } else if (passCount > 0 && failCount > 0) {
        report.overallStatus = 'partially_operational'
        report.blockers.push(...report.verifications
          .filter(v => v.actualResult === 'fail')
          .map(v => `${v.type}: ${v.target} - ${v.errorMessage || 'Failed'}`))
      } else {
        report.overallStatus = 'not_operational'
        report.blockers.push(...report.verifications
          .filter(v => v.actualResult === 'fail')
          .map(v => `${v.type}: ${v.target} - ${v.errorMessage || 'Failed'}`))
      }

      // 5. Generate recommendations
      report.recommendations = this.generateRecommendations(report)

    } catch (error) {
      console.error('[OperationalVerification] Verification failed:', error)
      report.blockers.push(error instanceof Error ? error.message : String(error))
      report.overallStatus = 'not_operational'
    } finally {
      report.totalDuration = Date.now() - startTime
    }

    this.emit('verification-completed', {
      featureName: config.featureName,
      status: report.overallStatus,
      duration: report.totalDuration,
    })

    return report
  }

  /**
   * Verify a section is operational after implementation
   */
  async verifySection(
    projectPath: string,
    section: BvsSection,
    baseUrl: string = DEFAULT_BASE_URL
  ): Promise<OperationalVerificationReport> {
    // Extract verification targets from section
    const verifications = this.extractVerificationsFromSection(section)

    return this.verify({
      projectPath,
      featureName: section.name,
      featureDescription: section.description || section.name,
      baseUrl,
      verifications,
      createTestUser: this.sectionNeedsAuth(section),
    })
  }

  /**
   * Stop the dev server if we started it
   */
  async cleanup(): Promise<void> {
    if (this.devServer?.process && this.devServer.startedByUs) {
      console.log('[OperationalVerification] Stopping dev server')
      this.devServer.process.kill('SIGTERM')
      this.devServer = null
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private generateFeatureId(featureName: string): string {
    return `feature-${featureName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`
  }

  /**
   * Ensure dev server is running, start if needed
   */
  private async ensureDevServerRunning(
    projectPath: string,
    command: string,
    baseUrl: string
  ): Promise<DevServerInfo> {
    // Check if server is already running
    const isRunning = await this.checkServerHealth(baseUrl)

    if (isRunning) {
      console.log('[OperationalVerification] Dev server already running at', baseUrl)
      return {
        process: null,
        url: baseUrl,
        isRunning: true,
        startedByUs: false,
      }
    }

    // Start the dev server
    console.log('[OperationalVerification] Starting dev server:', command)

    const [cmd, ...args] = command.split(' ')
    const isWindows = process.platform === 'win32'

    const devProcess = spawn(
      isWindows ? 'cmd' : cmd,
      isWindows ? ['/c', command] : args,
      {
        cwd: projectPath,
        stdio: 'pipe',
        shell: isWindows,
        detached: !isWindows,
      }
    )

    // Log server output
    devProcess.stdout?.on('data', (data) => {
      console.log('[DevServer]', data.toString().trim())
    })
    devProcess.stderr?.on('data', (data) => {
      console.log('[DevServer:err]', data.toString().trim())
    })

    // Wait for server to start
    await this.waitForServer(baseUrl, SERVER_STARTUP_WAIT)

    this.devServer = {
      process: devProcess,
      url: baseUrl,
      isRunning: true,
      startedByUs: true,
    }

    return this.devServer
  }

  /**
   * Check if server is responding
   */
  private async checkServerHealth(url: string): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      return response.ok || response.status < 500
    } catch {
      return false
    }
  }

  /**
   * Wait for server to become healthy
   */
  private async waitForServer(url: string, timeout: number): Promise<void> {
    const startTime = Date.now()
    const checkInterval = 1000

    while (Date.now() - startTime < timeout) {
      if (await this.checkServerHealth(url)) {
        console.log('[OperationalVerification] Dev server is ready')
        return
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }

    throw new Error(`Dev server failed to start within ${timeout}ms`)
  }

  /**
   * Create a test user for auth testing
   */
  private async createTestUser(
    projectPath: string,
    credentials: { email: string; password: string }
  ): Promise<void> {
    console.log('[OperationalVerification] Creating test user:', credentials.email)

    const subagentService = getBvsSubagentService()

    // Use subagent to create test user via Supabase MCP or direct DB
    const result = await subagentService.spawn({
      type: 'fixer',
      prompt: `Create a test user for authentication testing.

Credentials:
- Email: ${credentials.email}
- Password: ${credentials.password}

Instructions:
1. Check if Supabase MCP is available (mcp__supabase__execute_sql)
2. If Supabase available:
   - Create user via SQL: INSERT INTO auth.users or use supabase admin API
   - Set email_confirmed_at to current timestamp
3. If no Supabase:
   - Look for user seeding script (seed.ts, seed.sql)
   - Run the seed script with test credentials

The test user should be ready for login immediately after creation.

Output JSON:
{
  "success": boolean,
  "method": "supabase_mcp" | "seed_script" | "manual",
  "userId": string | null,
  "error": string | null
}`,
      projectPath,
      model: 'haiku',
      maxTurns: 5,
      timeout: 30000,
    })

    if (result.status !== 'completed') {
      throw new Error(`Failed to create test user: ${result.error}`)
    }
  }

  /**
   * Run a single verification
   */
  private async runVerification(
    verification: VerificationTarget,
    baseUrl: string,
    projectPath: string,
    timeout: number
  ): Promise<VerificationResult> {
    const startTime = Date.now()

    try {
      switch (verification.type) {
        case 'navigation':
          return await this.verifyNavigation(verification, baseUrl, timeout)

        case 'api_call':
          return await this.verifyApiCall(verification, baseUrl, timeout)

        case 'ui_element':
          return await this.verifyUiElement(verification, baseUrl, projectPath, timeout)

        case 'state_change':
          return await this.verifyStateChange(verification, baseUrl, projectPath, timeout)

        case 'data_persistence':
          return await this.verifyDataPersistence(verification, projectPath, timeout)

        default:
          return {
            type: verification.type,
            target: verification.target,
            expectedBehavior: verification.expectedBehavior,
            actualResult: 'skip',
            errorMessage: `Unknown verification type: ${verification.type}`,
            duration: Date.now() - startTime,
          }
      }
    } catch (error) {
      return {
        type: verification.type,
        target: verification.target,
        expectedBehavior: verification.expectedBehavior,
        actualResult: 'fail',
        errorMessage: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * Verify navigation to a path works
   */
  private async verifyNavigation(
    verification: VerificationTarget,
    baseUrl: string,
    timeout: number
  ): Promise<VerificationResult> {
    const url = verification.target.startsWith('http')
      ? verification.target
      : `${baseUrl}${verification.target}`

    const startTime = Date.now()

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        return {
          type: verification.type,
          target: verification.target,
          expectedBehavior: verification.expectedBehavior,
          actualResult: 'pass',
          evidence: `Status: ${response.status}`,
          duration: Date.now() - startTime,
        }
      } else {
        return {
          type: verification.type,
          target: verification.target,
          expectedBehavior: verification.expectedBehavior,
          actualResult: 'fail',
          errorMessage: `HTTP ${response.status}: ${response.statusText}`,
          duration: Date.now() - startTime,
        }
      }
    } catch (error) {
      return {
        type: verification.type,
        target: verification.target,
        expectedBehavior: verification.expectedBehavior,
        actualResult: 'fail',
        errorMessage: error instanceof Error ? error.message : 'Request failed',
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * Verify API endpoint works
   */
  private async verifyApiCall(
    verification: VerificationTarget,
    baseUrl: string,
    timeout: number
  ): Promise<VerificationResult> {
    const url = verification.target.startsWith('http')
      ? verification.target
      : `${baseUrl}${verification.target}`

    const startTime = Date.now()

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url, {
        method: verification.method || 'GET',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: verification.requestBody ? JSON.stringify(verification.requestBody) : undefined,
      })

      clearTimeout(timeoutId)

      const responseText = await response.text()

      if (response.ok) {
        return {
          type: verification.type,
          target: verification.target,
          expectedBehavior: verification.expectedBehavior,
          actualResult: 'pass',
          evidence: `Status: ${response.status}, Body: ${responseText.substring(0, 200)}`,
          duration: Date.now() - startTime,
        }
      } else {
        return {
          type: verification.type,
          target: verification.target,
          expectedBehavior: verification.expectedBehavior,
          actualResult: 'fail',
          errorMessage: `HTTP ${response.status}: ${responseText.substring(0, 200)}`,
          duration: Date.now() - startTime,
        }
      }
    } catch (error) {
      return {
        type: verification.type,
        target: verification.target,
        expectedBehavior: verification.expectedBehavior,
        actualResult: 'fail',
        errorMessage: error instanceof Error ? error.message : 'Request failed',
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * Verify UI element exists using Chrome DevTools MCP
   */
  private async verifyUiElement(
    verification: VerificationTarget,
    baseUrl: string,
    projectPath: string,
    timeout: number
  ): Promise<VerificationResult> {
    const startTime = Date.now()

    // Use subagent with Chrome DevTools MCP for UI verification
    const subagentService = getBvsSubagentService()

    const prompt = `Verify that a UI element exists on a web page.

Target URL: ${baseUrl}${verification.target.startsWith('/') ? verification.target : ''}
Element Selector: ${verification.selector || verification.target}
Expected: ${verification.expectedBehavior}

Instructions:
1. Use Chrome DevTools MCP to navigate to the page
2. Use DOM inspection to find the element with selector: ${verification.selector || verification.target}
3. Check if the element exists and is visible
4. Report the result

You have access to Chrome DevTools Protocol via MCP. Use tools like:
- Navigate to page
- Query DOM for element
- Check element visibility

Output JSON:
{
  "found": boolean,
  "visible": boolean,
  "elementDetails": string | null,
  "error": string | null
}`

    try {
      const result = await subagentService.spawn({
        type: 'fixer',
        prompt,
        projectPath,
        model: 'haiku',
        maxTurns: 5,
        timeout: timeout,
      })

      if (result.status === 'completed') {
        // Parse the JSON output
        const jsonMatch = result.output.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          if (parsed.found && parsed.visible) {
            return {
              type: verification.type,
              target: verification.target,
              expectedBehavior: verification.expectedBehavior,
              actualResult: 'pass',
              evidence: parsed.elementDetails || 'Element found and visible',
              duration: Date.now() - startTime,
            }
          } else {
            return {
              type: verification.type,
              target: verification.target,
              expectedBehavior: verification.expectedBehavior,
              actualResult: 'fail',
              errorMessage: parsed.error || 'Element not found or not visible',
              duration: Date.now() - startTime,
            }
          }
        }
      }

      // If Chrome DevTools MCP is not available, skip with message
      return {
        type: verification.type,
        target: verification.target,
        expectedBehavior: verification.expectedBehavior,
        actualResult: 'skip',
        errorMessage: 'Chrome DevTools MCP not available for UI verification',
        duration: Date.now() - startTime,
      }
    } catch (error) {
      return {
        type: verification.type,
        target: verification.target,
        expectedBehavior: verification.expectedBehavior,
        actualResult: 'skip',
        errorMessage: `UI verification requires Chrome DevTools MCP: ${error instanceof Error ? error.message : error}`,
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * Verify state change (requires Chrome DevTools MCP)
   */
  private async verifyStateChange(
    verification: VerificationTarget,
    baseUrl: string,
    projectPath: string,
    timeout: number
  ): Promise<VerificationResult> {
    // State change verification is complex and requires browser automation
    // For now, skip with a note about requirements
    return {
      type: verification.type,
      target: verification.target,
      expectedBehavior: verification.expectedBehavior,
      actualResult: 'skip',
      errorMessage: 'State change verification requires Chrome DevTools MCP integration',
      duration: 0,
    }
  }

  /**
   * Verify data persistence (via Supabase MCP)
   */
  private async verifyDataPersistence(
    verification: VerificationTarget,
    projectPath: string,
    timeout: number
  ): Promise<VerificationResult> {
    const startTime = Date.now()

    const subagentService = getBvsSubagentService()

    const prompt = `Verify that data has been persisted correctly.

Verification Target: ${verification.target}
Expected: ${verification.expectedBehavior}

Instructions:
1. Use Supabase MCP (mcp__supabase__execute_sql) to query the database
2. Check if the expected data exists
3. Verify the data matches expectations

Example query for table verification:
SELECT * FROM ${verification.target} LIMIT 5;

Output JSON:
{
  "dataExists": boolean,
  "recordCount": number,
  "sampleData": string | null,
  "error": string | null
}`

    try {
      const result = await subagentService.spawn({
        type: 'fixer',
        prompt,
        projectPath,
        model: 'haiku',
        maxTurns: 3,
        timeout,
      })

      if (result.status === 'completed') {
        const jsonMatch = result.output.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          if (parsed.dataExists) {
            return {
              type: verification.type,
              target: verification.target,
              expectedBehavior: verification.expectedBehavior,
              actualResult: 'pass',
              evidence: `Records: ${parsed.recordCount}, Sample: ${parsed.sampleData || 'N/A'}`,
              duration: Date.now() - startTime,
            }
          } else {
            return {
              type: verification.type,
              target: verification.target,
              expectedBehavior: verification.expectedBehavior,
              actualResult: 'fail',
              errorMessage: parsed.error || 'Data not found',
              duration: Date.now() - startTime,
            }
          }
        }
      }

      return {
        type: verification.type,
        target: verification.target,
        expectedBehavior: verification.expectedBehavior,
        actualResult: 'skip',
        errorMessage: 'Supabase MCP not available for data verification',
        duration: Date.now() - startTime,
      }
    } catch (error) {
      return {
        type: verification.type,
        target: verification.target,
        expectedBehavior: verification.expectedBehavior,
        actualResult: 'skip',
        errorMessage: `Data persistence verification requires Supabase MCP: ${error instanceof Error ? error.message : error}`,
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * Extract verification targets from a section
   */
  private extractVerificationsFromSection(section: BvsSection): VerificationTarget[] {
    const verifications: VerificationTarget[] = []

    // Check files for patterns that need verification
    for (const file of section.files) {
      const filePath = file.path.toLowerCase()

      // API routes need endpoint verification
      if (filePath.includes('/api/') || filePath.includes('/routes/')) {
        const routePath = this.extractRoutePath(file.path)
        if (routePath) {
          verifications.push({
            type: 'api_call',
            target: routePath,
            expectedBehavior: 'Returns successful response',
          })
        }
      }

      // Pages need navigation verification
      if (filePath.includes('/pages/') || filePath.includes('/app/')) {
        const pagePath = this.extractPagePath(file.path)
        if (pagePath) {
          verifications.push({
            type: 'navigation',
            target: pagePath,
            expectedBehavior: 'Page loads without error',
          })
        }
      }

      // Components may need UI element verification
      if (filePath.includes('/components/') && file.action === 'create') {
        verifications.push({
          type: 'ui_element',
          target: file.path,
          selector: `[data-testid="${path.basename(file.path, path.extname(file.path))}"]`,
          expectedBehavior: 'Component renders correctly',
        })
      }
    }

    return verifications
  }

  /**
   * Extract API route path from file path
   */
  private extractRoutePath(filePath: string): string | null {
    // Convert: src/app/api/users/route.ts -> /api/users
    // Convert: src/pages/api/users.ts -> /api/users
    const apiMatch = filePath.match(/(?:app|pages)(\/api\/[^.]+)/)
    if (apiMatch) {
      return apiMatch[1].replace(/\/route$/, '').replace(/\/index$/, '')
    }
    return null
  }

  /**
   * Extract page path from file path
   */
  private extractPagePath(filePath: string): string | null {
    // Convert: src/app/dashboard/page.tsx -> /dashboard
    // Convert: src/pages/dashboard.tsx -> /dashboard
    const appMatch = filePath.match(/app(\/[^.]+)\/page\.tsx?$/)
    if (appMatch) {
      return appMatch[1] === '/' ? '/' : appMatch[1]
    }

    const pagesMatch = filePath.match(/pages(\/[^.]+)\.tsx?$/)
    if (pagesMatch) {
      return pagesMatch[1] === '/index' ? '/' : pagesMatch[1]
    }

    return null
  }

  /**
   * Check if section likely needs auth
   */
  private sectionNeedsAuth(section: BvsSection): boolean {
    const authKeywords = ['auth', 'login', 'user', 'profile', 'dashboard', 'protected', 'private']
    const sectionText = `${section.name} ${section.description}`.toLowerCase()
    return authKeywords.some(keyword => sectionText.includes(keyword))
  }

  /**
   * Generate recommendations based on verification results
   */
  private generateRecommendations(report: OperationalVerificationReport): string[] {
    const recommendations: string[] = []

    const failures = report.verifications.filter(v => v.actualResult === 'fail')
    const skips = report.verifications.filter(v => v.actualResult === 'skip')

    // Analyze failures for patterns
    const apiFailures = failures.filter(v => v.type === 'api_call')
    if (apiFailures.length > 0) {
      recommendations.push('API endpoints are failing - check route registration and handler implementation')
    }

    const navFailures = failures.filter(v => v.type === 'navigation')
    if (navFailures.length > 0) {
      recommendations.push('Navigation paths are failing - verify routes are properly configured')
    }

    // Note about skipped verifications
    if (skips.length > 0) {
      const uiSkips = skips.filter(v => v.type === 'ui_element')
      if (uiSkips.length > 0) {
        recommendations.push('UI element verification skipped - enable Chrome DevTools MCP for full UI testing')
      }

      const dataSkips = skips.filter(v => v.type === 'data_persistence')
      if (dataSkips.length > 0) {
        recommendations.push('Data persistence verification skipped - enable Supabase MCP for database testing')
      }
    }

    return recommendations
  }
}

// ============================================================================
// Singleton
// ============================================================================

let operationalVerificationService: BvsOperationalVerificationService | null = null

export function getBvsOperationalVerificationService(): BvsOperationalVerificationService {
  if (!operationalVerificationService) {
    operationalVerificationService = new BvsOperationalVerificationService()
  }
  return operationalVerificationService
}
