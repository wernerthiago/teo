/**
 * Playwright Integration - Path-Based Approach
 * 
 * This integration focuses on intelligent test selection and path output
 * rather than direct test execution. Users can then use the selected
 * test paths with Playwright's native runner.
 */

import path from 'path'
import fs from 'fs/promises'
import { glob } from 'glob'
import logger from '../core/logger.js'

export class PlaywrightIntegration {
  constructor(config = {}) {
    this.testDir = config.testDir || 'tests'
    this.testPatterns = config.testPatterns || ['**/*.spec.js', '**/*.spec.ts']
    this.configFile = config.configFile || 'playwright.config.js'
    this.projectRoot = config.projectRoot || process.cwd()
    
    logger.info('PlaywrightIntegration initialized', {
      testDir: this.testDir,
      testPatterns: this.testPatterns,
      configFile: this.configFile
    })
  }

  /**
   * Discover all available test files
   * @returns {Promise<string[]>} Array of test file paths
   */
  async discoverTests() {
    try {
      const testFiles = []
      
      for (const pattern of this.testPatterns) {
        const fullPattern = path.join(this.testDir, pattern)
        logger.info(`Discovering Playwright tests with pattern: ${fullPattern}`, {
          projectRoot: this.projectRoot
        })
        const files = await glob(fullPattern, {
          cwd: this.projectRoot,
          absolute: false
        })
        testFiles.push(...files)
      }
      
      // Remove duplicates and sort
      const uniqueFiles = [...new Set(testFiles)].sort()
      
      logger.info('Discovered Playwright tests', {
        totalFiles: uniqueFiles.length,
        patterns: this.testPatterns
      })
      
      return uniqueFiles
    } catch (error) {
      logger.error('Failed to discover Playwright tests', { error: error.message })
      throw new Error(`Test discovery failed: ${error.message}`)
    }
  }

  /**
   * Filter test files based on feature mapping
   * @param {string[]} allTestFiles - All available test files
   * @param {Object[]} impactedFeatures - Features detected by TEO
   * @returns {Promise<Object>} Selected tests with metadata
   */
  async selectTests(allTestFiles, impactedFeatures) {
    try {
      const selectedTests = []
      const selectionReasons = []
      
      for (const feature of impactedFeatures) {
        const featureTests = this.matchTestsToFeature(allTestFiles, feature)
        
        for (const testFile of featureTests) {
          if (!selectedTests.some(t => t.path === testFile)) {
            selectedTests.push({
              path: testFile,
              feature: feature.featureName,
              confidence: feature.confidence,
              strategy: feature.strategyUsed,
              reason: `${feature.featureName} feature impacted (${Math.round(feature.confidence * 100)}% confidence)`
            })
          }
        }
        
        if (featureTests.length > 0) {
          selectionReasons.push({
            feature: feature.featureName,
            confidence: feature.confidence,
            testsSelected: featureTests.length,
            strategy: feature.strategyUsed
          })
        }
      }
      
      logger.info('Selected Playwright tests', {
        totalSelected: selectedTests.length,
        totalAvailable: allTestFiles.length,
        reductionPercentage: Math.round((1 - selectedTests.length / allTestFiles.length) * 100),
        features: selectionReasons
      })
      
      return {
        selectedTests,
        selectionReasons,
        summary: {
          totalAvailable: allTestFiles.length,
          totalSelected: selectedTests.length,
          reductionPercentage: Math.round((1 - selectedTests.length / allTestFiles.length) * 100)
        }
      }
    } catch (error) {
      logger.error('Failed to select Playwright tests', { error: error.message })
      throw new Error(`Test selection failed: ${error.message}`)
    }
  }

  /**
   * Match test files to a specific feature
   * @param {string[]} testFiles - Available test files
   * @param {Object} feature - Feature object with test patterns
   * @returns {string[]} Matching test files
   */
  matchTestsToFeature(testFiles, feature) {
    const matchingTests = []
    
    // If feature has specific test patterns, use those
    if (feature.testFiles && feature.testFiles.length > 0) {
      for (const testPattern of feature.testFiles) {
        const matches = testFiles.filter(file => 
          this.matchesPattern(file, testPattern)
        )
        matchingTests.push(...matches)
      }
    }
    
    // Fallback to feature name matching
    if (matchingTests.length === 0) {
      const featureName = feature.featureName.toLowerCase()
      const matches = testFiles.filter(file => 
        file.toLowerCase().includes(featureName) ||
        file.toLowerCase().includes(featureName.replace(/[_-]/g, ''))
      )
      matchingTests.push(...matches)
    }
    
    return [...new Set(matchingTests)]
  }

  /**
   * Check if a file path matches a pattern
   * @param {string} filePath - File path to check
   * @param {string} pattern - Pattern to match against
   * @returns {boolean} Whether the file matches the pattern
   */
  matchesPattern(filePath, pattern) {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
    
    const regex = new RegExp(regexPattern, 'i')
    return regex.test(filePath)
  }

  /**
   * Generate output in various formats
   * @param {Object} selectionResult - Result from selectTests()
   * @param {string} format - Output format ('paths', 'script', 'json', 'playwright-args')
   * @returns {string} Formatted output
   */
  generateOutput(selectionResult, format = 'paths') {
    const { selectedTests, selectionReasons, summary } = selectionResult
    
    switch (format) {
      case 'paths':
        if (selectedTests.map(test => test.path).join(' ')) {
          logger.info('Copy and paste the following command to save the paths:')
          console.log(`export TEO_TEST_PATHS="${selectedTests.map(test => test.path).join(' ')}"`)
          logger.info('TEO_TEST_PATHS environment variable must be set', {
            tests: selectedTests.map(test => test.path)
          })
        }
        return selectedTests.map(test => test.path).join(' ')
      
      case 'script':
        return this.generateScript(selectedTests, summary)
      
      case 'json':
        return JSON.stringify({
          summary,
          selectedTests,
          selectionReasons,
          playwrightCommand: `npx playwright test ${selectedTests.map(t => t.path).join(' ')}`
        }, null, 2)
      
      case 'playwright-args':
        return selectedTests.map(test => test.path).join(' ')
      
      case 'table':
        return this.generateTable(selectedTests, summary)
      
      default:
        throw new Error(`Unsupported output format: ${format}`)
    }
  }

  /**
   * Generate executable shell script
   * @param {Object[]} selectedTests - Selected test objects
   * @param {Object} summary - Selection summary
   * @returns {string} Shell script content
   */
  generateScript(selectedTests, summary) {
    const testPaths = selectedTests.map(test => test.path).join(' \\\n  ')
    
    return `#!/bin/bash
# TEO-generated Playwright test execution script
# Generated: ${new Date().toISOString()}
# Tests selected: ${summary.totalSelected}/${summary.totalAvailable} (${summary.reductionPercentage}% reduction)

echo "🎭 Running TEO-selected Playwright tests..."
echo "Selected ${summary.totalSelected} out of ${summary.totalAvailable} tests (${summary.reductionPercentage}% reduction)"
echo ""

npx playwright test \\
  ${testPaths} \\
  --reporter=html \\
  --reporter=line

echo ""
echo "✅ TEO-optimized test execution completed!"
`
  }

  /**
   * Generate formatted table output
   * @param {Object[]} selectedTests - Selected test objects
   * @param {Object} summary - Selection summary
   * @returns {string} Table formatted output
   */
  generateTable(selectedTests, summary) {
    let output = `\n📊 TEO Playwright Test Selection Results\n`
    output += `${'='.repeat(60)}\n`
    output += `Total Available Tests: ${summary.totalAvailable}\n`
    output += `Selected Tests: ${summary.totalSelected}\n`
    output += `Reduction: ${summary.reductionPercentage}%\n\n`
    
    output += `Selected Test Files:\n`
    output += `${'─'.repeat(60)}\n`
    
    for (const test of selectedTests) {
      output += `📁 ${test.path}\n`
      output += `   Feature: ${test.feature} (${Math.round(test.confidence * 100)}% confidence)\n`
      output += `   Reason: ${test.reason}\n\n`
    }
    
    output += `\n🚀 Run with Playwright:\n`
    output += `npx playwright test ${selectedTests.map(t => t.path).join(' ')}\n`
    
    return output
  }

  /**
   * Validate Playwright setup
   * @returns {Promise<Object>} Validation result
   */
  async validate() {
    const result = {
      valid: true,
      errors: [],
      warnings: [],
      info: {}
    }
    
    try {
      // Check if test directory exists
      const testDirPath = path.join(this.projectRoot, this.testDir)
      try {
        await fs.access(testDirPath)
        result.info.testDir = `Test directory found: ${testDirPath}`
      } catch {
        result.errors.push(`Test directory not found: ${testDirPath}`)
        result.valid = false
      }
      
      // Check for Playwright config
      const configPath = path.join(this.projectRoot, this.configFile)
      try {
        await fs.access(configPath)
        result.info.config = `Playwright config found: ${configPath}`
      } catch {
        result.warnings.push(`Playwright config not found: ${configPath}`)
      }
      
      // Check for test files
      const testFiles = await this.discoverTests()
      if (testFiles.length === 0) {
        result.warnings.push('No test files found matching patterns')
      } else {
        result.info.testFiles = `Found ${testFiles.length} test files`
      }
      
      // Check for Playwright installation
      try {
        const packageJsonPath = path.join(this.projectRoot, 'package.json')
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
        const hasPlaywright = packageJson.dependencies?.['@playwright/test'] || 
                             packageJson.devDependencies?.['@playwright/test']
        
        if (hasPlaywright) {
          result.info.playwright = 'Playwright test package found'
        } else {
          result.warnings.push('Playwright test package not found in package.json')
        }
      } catch {
        result.warnings.push('Could not read package.json')
      }
      
    } catch (error) {
      result.errors.push(`Validation failed: ${error.message}`)
      result.valid = false
    }
    
    logger.info('Playwright integration validation completed', result)
    return result
  }
}

export default PlaywrightIntegration

