/**
 * Test Orchestrator - Simplified for Path-Based Approach
 * 
 * Coordinates test selection across different frameworks
 * without direct test execution.
 */

import logger from '../core/logger.js'
import PlaywrightIntegration from './playwright-integration.js'
import path from 'path'; // Import path for path.resolve if needed, though process.cwd() is absolute

export class TestOrchestrator {
  constructor(config = {}, actualRepoPath) {
    this.config = config;
    // Prioritize actualRepoPath, then config.repo_path, then cwd.
    // actualRepoPath is expected to be an absolute path to the final repository location.
    this.actualRepoPath = actualRepoPath || this.config.repo_path || process.cwd();
    this.integrations = new Map();
    
    // Initialize supported integrations
    this.initializeIntegrations();
    
    logger.info('TestOrchestrator initialized', {
      supportedFrameworks: Array.from(this.integrations.keys()),
      actualRepoPath: this.actualRepoPath
    });
  }

  /**
   * Initialize framework integrations
   */
  initializeIntegrations() {
    // Playwright integration
    if (this.config.integrations?.playwright) {
      this.integrations.set('playwright', new PlaywrightIntegration({
        ...this.config.integrations.playwright,
        projectRoot: this.actualRepoPath // Use the determined actualRepoPath
      }));
    }
  }

  /**
   * Get available frameworks
   * @returns {string[]} Array of framework names
   */
  getAvailableFrameworks() {
    return Array.from(this.integrations.keys())
  }

  /**
   * Select tests for a specific framework
   * @param {string} framework - Framework name ('playwright')
   * @param {Object[]} impactedFeatures - Features detected by TEO
   * @returns {Promise<Object>} Test selection result
   */
  async selectTests(framework, impactedFeatures) {
    const integration = this.integrations.get(framework)
    if (!integration) {
      throw new Error(`Unsupported framework: ${framework}`)
    }

    try {
      logger.info(`Selecting tests for ${framework}`, {
        featuresCount: impactedFeatures.length
      })

      // Discover all available tests
      const allTests = await integration.discoverTests()
      
      // Select relevant tests based on impacted features
      const selectionResult = await integration.selectTests(allTests, impactedFeatures)
      
      return {
        framework,
        ...selectionResult,
        integration: framework // For backward compatibility
      }
    } catch (error) {
      logger.error(`Test selection failed for ${framework}`, { error: error.message })
      throw error
    }
  }

  /**
   * Generate output for selected tests
   * @param {Object} selectionResult - Result from selectTests()
   * @param {string} format - Output format
   * @returns {string} Formatted output
   */
  generateOutput(selectionResult, format = 'paths') {
    const { framework } = selectionResult
    const integration = this.integrations.get(framework)
    
    if (!integration) {
      throw new Error(`No integration found for framework: ${framework}`)
    }

    return integration.generateOutput(selectionResult, format)
  }

  /**
   * Validate framework setup
   * @param {string} framework - Framework to validate
   * @returns {Promise<Object>} Validation result
   */
  async validateFramework(framework) {
    const integration = this.integrations.get(framework)
    if (!integration) {
      return {
        valid: false,
        errors: [`Framework not supported: ${framework}`],
        warnings: [],
        info: {}
      }
    }

    return await integration.validate()
  }

  /**
   * Validate all configured frameworks
   * @returns {Promise<Object>} Validation results for all frameworks
   */
  async validateAll() {
    const results = {}
    
    for (const [framework, integration] of this.integrations) {
      try {
        results[framework] = await integration.validate()
      } catch (error) {
        results[framework] = {
          valid: false,
          errors: [`Validation failed: ${error.message}`],
          warnings: [],
          info: {}
        }
      }
    }
    
    return results
  }

  /**
   * Get framework-specific information
   * @param {string} framework - Framework name
   * @returns {Object} Framework information
   */
  getFrameworkInfo(framework) {
    const integration = this.integrations.get(framework)
    if (!integration) {
      return null
    }

    return {
      name: framework,
      testDir: integration.testDir,
      testPatterns: integration.testPatterns,
      configFile: integration.configFile
    }
  }

  /**
   * Register a custom framework integration
   * @param {string} name - Framework name
   * @param {Object} integration - Integration instance
   */
  registerFramework(name, integration) {
    this.integrations.set(name, integration)
    logger.info(`Registered custom framework: ${name}`)
  }
}

export default TestOrchestrator

