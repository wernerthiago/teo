/**
 * TEO Core Engine - Refactored for Path-Based Approach
 * 
 * Main orchestrator that coordinates analysis and test selection
 * without direct test execution.
 */

import GitDiffAnalyzer from '../analyzers/git-analyzer.js'
import FeatureMapper from '../mappers/feature-mapper.js'
import ProviderManager from '../providers/provider-manager.js'
import TestOrchestrator from '../integrations/test-orchestrator.js'
import logger from './logger.js'

export class TEOEngine {
  constructor(config) {
    this.config = config;
    
    const gitConfig = config.get('git', {});
    const basePath = config.get('repo_path', process.cwd());

    // Initialize components that don't require async setup or finalized repoPath
    this.providerManager = new ProviderManager(config.get('ai_providers', {}));

    // Initial GitDiffAnalyzer instantiation (constructor is synchronous)
    this.gitAnalyzer = new GitDiffAnalyzer(gitConfig, basePath);

    // Other components like featureMapper and testOrchestrator will be initialized in _initialize
    // after gitAnalyzer.repoPath is confirmed (especially after potential remote clone)
    this.featureMapper = null; // Initialize as null or with a temporary/dummy instance
    this.testOrchestrator = null;

    logger.info('TEOEngine synchronous constructor completed. Async initialization pending.');
  }

  async _initialize(config) {
    const gitConfig = config.get('git', {});

    // Perform async initialization for GitDiffAnalyzer if remote repo is configured
    if (gitConfig.remote_repository_url) {
      logger.info(`Initializing remote repository: ${gitConfig.remote_repository_url}`);
      try {
        // this.gitAnalyzer.repoPath is the temporary path set by GitDiffAnalyzer's constructor
        await this.gitAnalyzer.initRemoteRepo(gitConfig.remote_repository_url, this.gitAnalyzer.repoPath);
        logger.info(`Remote repository initialized successfully at ${this.gitAnalyzer.repoPath}`);
      } catch (error) {
        logger.error(`Failed to initialize remote repository ${gitConfig.remote_repository_url}: ${error.message}`);
        throw new Error(`Failed to initialize remote repository: ${error.message}`);
      }
    }

    // Initialize components that depend on the finalized gitAnalyzer.repoPath
    this.featureMapper = new FeatureMapper(this.gitAnalyzer.repoPath, config.config);
    // Pass the finalized repoPath to TestOrchestrator
    this.testOrchestrator = new TestOrchestrator(config.config, this.gitAnalyzer.repoPath);

    logger.info('TEOEngine asynchronous initialization completed.');
  }

  static async create(config) {
    const engine = new TEOEngine(config); // Calls synchronous constructor
    await engine._initialize(config);     // Calls async initialization

    logger.info('TEOEngine fully initialized and ready.', {
      repoPath: engine.gitAnalyzer.repoPath,
      remote: !!config.get('git.remote_repository_url'),
      aiProviders: engine.providerManager.getAvailableProviders(),
      // Ensure testOrchestrator is initialized before calling getAvailableFrameworks
      frameworks: engine.testOrchestrator ? engine.testOrchestrator.getAvailableFrameworks() : []
    });
    return engine;
  }

  /**
   * Analyze code changes and select relevant tests
   * @param {string} baseRef - Base git reference
   * @param {string} headRef - Head git reference
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Analysis result with selected tests
   */
  async analyze(baseRef=null, headRef=null, options = {}) {
    const startTime = Date.now()
    
    try {
      logger.info('Starting TEO analysis', { baseRef, headRef, options })
      
      // Step 1: Analyze git diff
      if (!options.last24h && (!baseRef || !headRef)) {
        logger.error('Both baseRef and headRef must be provided when last24h option is not set');
        throw new Error('Both baseRef and headRef must be provided when last24h option is not set');
      }
      if (options.last24h) {
        logger.info('Using last 24 hours commit for analysis');
        const lastCommit = await this.gitAnalyzer.getLastCommitWithin24Hours();
        if (!lastCommit) {
          throw new Error('No commits found in the last 24 hours');
        }
        logger.info('Last commit found', { commit: lastCommit });
        baseRef = lastCommit; // Use the last commit as base
        headRef = 'HEAD'; // Use current HEAD as head
      }
      const diffAnalysis = await this.gitAnalyzer.analyzeDiff(baseRef, headRef)
      logger.info('Git diff analysis completed', {
        filesChanged: diffAnalysis.changes?.length || 0,
        languages: Array.from(diffAnalysis.languagesAffected || [])
      })
      
      // Debug: Log the diffAnalysis structure
      logger.debug('Diff analysis result', { 
        hasChanges: !!diffAnalysis.changes,
        changesLength: diffAnalysis.changes?.length,
        diffAnalysisKeys: Object.keys(diffAnalysis)
      })
      
      // Step 2: Map changes to features
      const featureMapping = await this.featureMapper.mapChangesToFeatures(diffAnalysis)
      logger.info('Feature mapping completed', {
        featuresDetected: featureMapping.length
      })
      
      // Step 3: AI-enhanced analysis (if enabled)
      let aiAnalysis = null
      if (options.useAI !== false && featureMapping.length > 0) {
        logger.info('Starting AI analysis', { options: options });
        try {
          aiAnalysis = await this.enhanceWithAI(diffAnalysis, featureMapping)
          logger.info('AI analysis completed')
        } catch (error) {
          logger.warn('AI analysis failed, continuing without AI enhancement', { error: error.message })
        }
      }
      
      // Step 4: Select tests for specified framework
      const framework = options.framework || 'playwright'
      let testSelection = null
      
      if (featureMapping.length > 0) {
        testSelection = await this.testOrchestrator.selectTests(framework, featureMapping)
        logger.info('Test selection completed', {
          framework,
          testsSelected: testSelection.selectedTests.length,
          totalAvailable: testSelection.summary.totalAvailable
        })
      } else {
        logger.info('No features detected, no tests selected')
        testSelection = {
          framework,
          selectedTests: [],
          selectionReasons: [],
          summary: {
            totalAvailable: 0,
            totalSelected: 0,
            reductionPercentage: 0
          }
        }
      }
      
      const duration = Date.now() - startTime
      
      const result = {
        analysis: {
          baseRef,
          headRef,
          timestamp: new Date().toISOString(),
          duration
        },
        diffAnalysis,
        featureMapping,
        aiAnalysis,
        testSelection,
        summary: {
          filesChanged: diffAnalysis.changes.length,
          featuresDetected: featureMapping.length,
          testsSelected: testSelection.selectedTests.length,
          framework,
          reductionPercentage: testSelection.summary.reductionPercentage,
          estimatedTimeSaved: this.calculateTimeSaved(testSelection.summary),
          duration
        }
      }
      
      logger.info('TEO analysis completed', result.summary)
      return result
      
    } catch (error) {
      logger.error('TEO analysis failed', { error: error.message, stack: error.stack })
      throw error
    }
  }

  /**
   * Generate output in specified format
   * @param {Object} analysisResult - Result from analyze()
   * @param {string} format - Output format
   * @returns {string} Formatted output
   */
  generateOutput(analysisResult, format = 'paths') {
    if (!analysisResult.testSelection) {
      throw new Error('No test selection data available')
    }
    
    return this.testOrchestrator.generateOutput(analysisResult.testSelection, format)
  }

  /**
   * Enhance analysis with AI
   * @param {Object} diffAnalysis - Git diff analysis result
   * @param {Object[]} featureMapping - Feature mapping result
   * @param {Object} options - AI options
   * @returns {Promise<Object>} AI analysis result
   */
  async enhanceWithAI(diffAnalysis, featureMapping, options = {}) {
    const provider = this.providerManager.primaryProvider
    logger.info('Provider selected for AI analysis', {
      provider: provider,
    })
    
    const prompt = this.buildAIPrompt(diffAnalysis, featureMapping)
    const aiResult = await provider.analyzeImpact(prompt, {
      maxTokens: options.maxTokens || 2000,
      temperature: options.temperature || 0.1
    })
    
    return {
      provider: provider.constructor.name,
      confidence: aiResult.confidence || 0.8,
      reasoning: aiResult.reasoning,
      recommendations: aiResult.recommendations || [],
      enhancedFeatures: this.enhanceFeatures(featureMapping, aiResult)
    }
  }

  /**
   * Build AI prompt for impact analysis
   * @param {Object} diffAnalysis - Git diff analysis
   * @param {Object[]} featureMapping - Feature mapping
   * @returns {string} AI prompt
   */
  buildAIPrompt(diffAnalysis, featureMapping) {
    const changedFiles = diffAnalysis.changes.map(c => c.filePath).join(', ')
    const features = featureMapping.map(f => f.featureName).join(', ')
    
    return `Analyze the impact of code changes on test requirements:

Changed Files: ${changedFiles}
Detected Features: ${features}
Languages: ${Array.from(diffAnalysis.languagesAffected).join(', ')}

Please assess:
1. Which features are most likely impacted by these changes?
2. What types of tests should be prioritized?
3. Are there any cross-feature dependencies to consider?
4. Risk level of these changes (low/medium/high)?

Provide a structured analysis with confidence scores.`
  }

  /**
   * Enhance feature mapping with AI insights
   * @param {Object[]} features - Original feature mapping
   * @param {Object} aiResult - AI analysis result
   * @returns {Object[]} Enhanced features
   */
  enhanceFeatures(features, aiResult) {
    return features.map(feature => ({
      ...feature,
      aiConfidence: aiResult.confidence,
      aiReasoning: aiResult.reasoning,
      enhancedConfidence: Math.min(feature.confidence + (aiResult.confidence * 0.2), 1.0)
    }))
  }

  /**
   * Calculate estimated time saved
   * @param {Object} summary - Test selection summary
   * @returns {number} Estimated time saved in milliseconds
   */
  calculateTimeSaved(summary) {
    // Rough estimate: assume each test takes 5 seconds on average
    const avgTestTime = 5000
    const testsSaved = summary.totalAvailable - summary.totalSelected
    return testsSaved * avgTestTime
  }

  /**
   * Validate TEO setup and configuration
   * @returns {Promise<Object>} Validation result
   */
  async validate() {
    const result = {
      overall: { valid: true, errors: [], warnings: [] },
      git: { valid: true, errors: [], warnings: [] },
      config: { valid: true, errors: [], warnings: [] },
      aiProviders: {},
      frameworks: {}
    }
    
    try {
      // Validate git repository
      try {
        await this.gitAnalyzer.validateRepository()
        result.git.info = 'Git repository is valid'
      } catch (error) {
        result.git.valid = false
        result.git.errors.push(error.message)
        result.overall.valid = false
      }
      
      // Validate configuration
      const configValidation = this.config.validate()
      result.config = configValidation
      if (!configValidation.valid) {
        result.overall.valid = false
      }
      
      // Validate AI providers
      const providers = this.providerManager.getAvailableProviders()
      for (const providerName of providers) {
        try {
          const provider = await this.providerManager.getProvider(providerName)
          const validation = await provider.validateConnection()
          result.aiProviders[providerName] = validation
        } catch (error) {
          result.aiProviders[providerName] = {
            valid: false,
            errors: [error.message]
          }
          result.overall.warnings.push(`AI provider ${providerName} validation failed`)
        }
      }
      
      // Validate test frameworks
      result.frameworks = await this.testOrchestrator.validateAll()
      for (const [framework, validation] of Object.entries(result.frameworks)) {
        if (!validation.valid) {
          result.overall.warnings.push(`Framework ${framework} validation failed`)
        }
      }
      
    } catch (error) {
      result.overall.valid = false
      result.overall.errors.push(`Validation failed: ${error.message}`)
    }
    
    logger.info('TEO validation completed', result.overall)
    return result
  }
}

export default TEOEngine

