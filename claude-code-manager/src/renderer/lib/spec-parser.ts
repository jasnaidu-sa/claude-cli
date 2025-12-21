/**
 * Spec Parser Utility
 *
 * Parses app_spec.txt files to extract meaningful metadata for workflow naming.
 */

export interface SpecMetadata {
  title: string
  description: string
}

/**
 * Parse spec content to extract title and description
 *
 * Looks for:
 * - Title: "FEATURE SPECIFICATION: X" or "PROJECT SPECIFICATION"
 * - Description: Content from OVERVIEW section
 */
export function parseSpecMetadata(specContent: string): SpecMetadata {
  const lines = specContent.split('\n')

  let title = 'Auto-generated workflow'
  let description = ''

  // Extract title from "FEATURE SPECIFICATION: X" line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Look for feature specification header
    if (line.startsWith('FEATURE SPECIFICATION:')) {
      const titlePart = line.replace('FEATURE SPECIFICATION:', '').trim()
      // Convert "COUNTER COMPONENT" to "Counter Component"
      title = titlePart
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      break
    }
  }

  // Extract description from OVERVIEW section
  let inOverview = false
  let overviewLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Start capturing when we hit OVERVIEW header
    if (line === 'OVERVIEW') {
      inOverview = true
      continue
    }

    // Stop when we hit the next section (all caps heading followed by dashes)
    if (inOverview && line.match(/^[A-Z\s]+$/) && lines[i + 1]?.trim().match(/^-+$/)) {
      break
    }

    // Skip the dashes line under OVERVIEW
    if (inOverview && line.match(/^-+$/)) {
      continue
    }

    // Capture overview content
    if (inOverview && line.length > 0) {
      overviewLines.push(line)
    }
  }

  // Join overview lines and truncate if too long
  if (overviewLines.length > 0) {
    description = overviewLines.join(' ')
    // Truncate at 200 characters if needed
    if (description.length > 200) {
      description = description.substring(0, 197) + '...'
    }
  }

  return { title, description }
}

/**
 * Read and parse a spec file from disk
 */
export async function parseSpecFile(specFilePath: string): Promise<SpecMetadata | null> {
  try {
    const result = await window.electron.files.readFile(specFilePath)
    if (!result.success || !result.content) {
      return null
    }

    return parseSpecMetadata(result.content)
  } catch (error) {
    console.error('Failed to parse spec file:', error)
    return null
  }
}
