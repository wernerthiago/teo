/**
 * Feature Mapper
 * Maps code changes to test features using multiple detection strategies
 */

import path from 'path'
import fs from 'fs'
import { minimatch } from 'minimatch'
import yaml from 'js-yaml'
import logger from '../core/logger.js'

// Mapping strategies enum
export const MappingStrategy = {
  FOLDER_BASED: 'folder_based',
  FILE_BASED: 'file_based',
  ANNOTATION_BASED: 'annotation_based',
  AST_BASED: 'ast_based'
}

/**
 * Represents a mapping between code and test features
 */
export class FeatureMapping {
  constructor({
    featureName,
    sourcePatterns = [],
    testPatterns = [],
    confidence = 1.0,
    strategy = MappingStrategy.FILE_BASED,
    metadata = {}
  }) {
    this.featureName = featureName
    this.sourcePatterns = sourcePatterns
    this.testPatterns = testPatterns
    this.confidence = confidence
    this.strategy = strategy
    this.metadata = metadata
  }
}

/**
 * Represents a feature impacted by code changes
 */
export class ImpactedFeature {
  constructor({
    featureName,
    confidence,
    impactedFiles = [],
    testFiles = [],
    changeSummary = '',
    strategyUsed,
    metadata = {}
  }) {
    this.featureName = featureName
    this.confidence = confidence
    this.impactedFiles = impactedFiles
    this.testFiles = testFiles
    this.changeSummary = changeSummary
    this.strategyUsed = strategyUsed
    this.metadata = metadata
  }
}

/**
 * Base class for mapping strategies
 */
class BaseMappingStrategy {
  constructor(config = {}, repoPath) {
    this.config = config;
    this.repoPath = repoPath; // Store repoPath
    this.weight = config.weight || 1.0;
    this.enabled = config.enabled !== false
  }

  async mapChangesToFeatures(diffResult, existingMappings = {}) {
    throw new Error('Must implement mapChangesToFeatures')
  }
}

/**
 * Folder-based mapping strategy
 * Maps based on directory structure patterns
 */
class FolderBasedStrategy extends BaseMappingStrategy {
  constructor(config, repoPath) {
    super(config, repoPath);
  }

  async mapChangesToFeatures(diffResult, existingMappings = {}) {
    const features = []
    
    for (const change of diffResult.changes) {
      const filePath = change.filePath
      const pathParts = filePath.split(path.sep)
      
      // Extract potential feature names from path
      const potentialFeatures = this.extractFeaturesFromPath(pathParts)
      
      for (const featureName of potentialFeatures) {
        // Look for corresponding test files
        const testFiles = await this.findTestFiles(featureName, filePath)
        
        if (testFiles.length > 0) {
          features.push(new ImpactedFeature({
            featureName,
            confidence: this.weight * 0.8, // Moderate confidence for folder-based
            impactedFiles: [filePath],
            testFiles,
            changeSummary: `Changes in ${featureName} module`,
            strategyUsed: MappingStrategy.FOLDER_BASED
          }))
        }
      }
    }
    
    return features
  }

  extractFeaturesFromPath(pathParts) {
    const features = new Set()
    
    // Common patterns for feature extraction
    const patterns = [
      // src/features/auth/... -> auth
      (parts) => {
        const featuresIndex = parts.indexOf('features')
        if (featuresIndex >= 0 && parts.length > featuresIndex + 1) {
          return parts[featuresIndex + 1]
        }
        return null
      },
      
      // src/auth/... -> auth
      (parts) => {
        if (parts.length >= 2 && parts[0] === 'src') {
          return parts[1]
        }
        return null
      },
      
      // components/Auth/... -> auth
      (parts) => {
        const componentsIndex = parts.indexOf('components')
        if (componentsIndex >= 0 && parts.length > componentsIndex + 1) {
          return parts[componentsIndex + 1].toLowerCase()
        }
        return null
      }
    ]
    
    for (const pattern of patterns) {
      const feature = pattern(pathParts)
      if (feature) {
        features.add(feature)
      }
    }
    
    return Array.from(features)
  }

  async findTestFiles(featureName, sourcePath) {
    const testFiles = []
    const testDirs = ['tests', 'test', '__tests__', 'spec', 'e2e']
    
    for (const testDir of testDirs) {
      const patterns = [
        `${testDir}/**/${featureName}*.{test,spec}.{js,ts}`,
        `${testDir}/**/*${featureName}*.{test,spec}.{js,ts}`,
        `${testDir}/${featureName}/**/*.{test,spec}.{js,ts}`
      ]
      
      for (const pattern of patterns) {
        try {
          const { glob } = await import('glob')
          // Use this.repoPath for cwd
          const matches = await glob(pattern, { cwd: this.repoPath, absolute: true, nodir: true })
          testFiles.push(...matches.map(p => path.relative(this.repoPath, p))); // Store relative paths for consistency if desired, or keep absolute
        } catch (error) {
          logger.debug('Glob pattern failed', { pattern, error: error.message })
        }
      }
    }
    
    return [...new Set(testFiles)] // Remove duplicates
  }
}

/**
 * File-based mapping strategy
 * Uses explicit configuration files for mapping
 */
class FileBasedStrategy extends BaseMappingStrategy {
  constructor(config, repoPath) {
    super(config, repoPath);
  }

  async mapChangesToFeatures(diffResult, existingMappings = {}) {
    const features = []
    
    for (const change of diffResult.changes) {
      const filePath = change.filePath
      
      // Check against existing mappings
      for (const [featureName, mapping] of Object.entries(existingMappings)) {
        if (this.matchesPatterns(filePath, mapping.source_patterns || [])) {
          features.push(new ImpactedFeature({
            featureName,
            confidence: this.weight * (mapping.confidence || 1.0),
            impactedFiles: [filePath],
            testFiles: await this.resolveTestPatterns(mapping.test_patterns || []),
            changeSummary: `Changes in ${featureName} feature`,
            strategyUsed: MappingStrategy.FILE_BASED,
            metadata: mapping.metadata || {}
          }))
        }
      }
    }
    
    return features
  }

  matchesPatterns(filePath, patterns) {
    return patterns.some(pattern => minimatch(filePath, pattern))
  }

  async resolveTestPatterns(patterns) {
    const testFiles = []
    
    for (const pattern of patterns) {
      try {
        const { glob } = await import('glob')
        // Use this.repoPath for cwd
        const matches = await glob(pattern, { cwd: this.repoPath, absolute: true, nodir: true })
        testFiles.push(...matches.map(p => path.relative(this.repoPath, p))); // Store relative paths
      } catch (error) {
        logger.debug('Test pattern resolution failed', { pattern, error: error.message })
      }
    }
    
    return [...new Set(testFiles)]
  }
}

/**
 * Annotation-based mapping strategy
 * Reads feature annotations from source code
 */
class AnnotationBasedStrategy extends BaseMappingStrategy {
  constructor(config = {}, repoPath) {
    super(config, repoPath);
    this.annotationPatterns = config.patterns || [
      /@feature:\s*(\w+)/gi,
      /\/\/\s*Feature:\s*(\w+)/gi,
      /#\s*Feature:\s*(\w+)/gi
    ]
  }

  async mapChangesToFeatures(diffResult, existingMappings = {}) {
    const features = []
    
    for (const change of diffResult.changes) {
      if (change.changeType === 'deleted') continue
      
      try {
        const content = await this.readFileContent(change.filePath)
        const annotations = this.extractAnnotations(content)
        
        for (const featureName of annotations) {
          const testFiles = await this.findTestFilesForFeature(featureName)
          
          features.push(new ImpactedFeature({
            featureName,
            confidence: this.weight * 0.9, // High confidence for explicit annotations
            impactedFiles: [change.filePath],
            testFiles,
            changeSummary: `Annotated feature: ${featureName}`,
            strategyUsed: MappingStrategy.ANNOTATION_BASED
          }))
        }
      } catch (error) {
        logger.debug('Annotation extraction failed', { 
          filePath: change.filePath, 
          error: error.message 
        })
      }
    }
    
    return features
  }

  extractAnnotations(content) {
    const features = new Set()
    
    for (const pattern of this.annotationPatterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        features.add(match[1].toLowerCase())
      }
    }
    
    return Array.from(features)
  }

  async readFileContent(filePath) {
    return fs.promises.readFile(filePath, 'utf8')
  }

  async findTestFilesForFeature(featureName) {
    const patterns = [
      `tests/**/*${featureName}*.{test,spec}.{js,ts}`,
      `test/**/*${featureName}*.{test,spec}.{js,ts}`,
      `__tests__/**/*${featureName}*.{test,spec}.{js,ts}`
    ]
    
    const testFiles = []
    for (const pattern of patterns) {
      try {
        const { glob } = await import('glob')
        // Use this.repoPath for cwd
        const matches = await glob(pattern, { cwd: this.repoPath, absolute: true, nodir: true })
        testFiles.push(...matches.map(p => path.relative(this.repoPath, p))); // Store relative paths
      } catch (error) {
        logger.debug('Test file search failed', { pattern, error: error.message })
      }
    }
    
    return [...new Set(testFiles)]
  }
}

/**
 * AST-based mapping strategy
 * Uses syntax tree analysis for intelligent mapping
 */
class ASTBasedStrategy extends BaseMappingStrategy {
  constructor(config, repoPath) {
    super(config, repoPath);
  }

  async mapChangesToFeatures(diffResult, existingMappings = {}) {
    const features = []
    
    for (const change of diffResult.changes) {
      // Use function and class changes from git analyzer
      const changedSymbols = [
        ...change.functionsChanged,
        ...change.classesChanged
      ]
      
      if (changedSymbols.length > 0) {
        // Try to map symbols to features
        const featureNames = this.mapSymbolsToFeatures(changedSymbols, change.filePath)
        
        for (const featureName of featureNames) {
          const testFiles = await this.findTestsForSymbols(changedSymbols, featureName)
          
          features.push(new ImpactedFeature({
            featureName,
            confidence: this.weight * 0.7,
            impactedFiles: [change.filePath],
            testFiles,
            changeSummary: `Symbol changes: ${changedSymbols.join(', ')}`,
            strategyUsed: MappingStrategy.AST_BASED,
            metadata: { changedSymbols }
          }))
        }
      }
    }
    
    return features
  }

  mapSymbolsToFeatures(symbols, filePath) {
    const features = new Set()
    
    // Extract feature names from symbols and file path
    for (const symbol of symbols) {
      // Convert camelCase/PascalCase to feature names
      const featureName = this.extractFeatureFromSymbol(symbol)
      if (featureName) {
        features.add(featureName)
      }
    }
    
    // Also try to extract from file path
    const pathFeature = this.extractFeatureFromPath(filePath)
    if (pathFeature) {
      features.add(pathFeature)
    }
    
    return Array.from(features)
  }

  extractFeatureFromSymbol(symbol) {
    // Convert camelCase/PascalCase to lowercase feature name
    const words = symbol.replace(/([A-Z])/g, ' $1').trim().split(' ')
    if (words.length > 1) {
      return words[0].toLowerCase()
    }
    return symbol.toLowerCase()
  }

  extractFeatureFromPath(filePath) {
    const basename = path.basename(filePath, path.extname(filePath))
    return basename.toLowerCase().replace(/[-_]/g, '')
  }

  async findTestsForSymbols(symbols, featureName) {
    const patterns = symbols.flatMap(symbol => [
      `tests/**/*${symbol}*.{test,spec}.{js,ts}`,
      `test/**/*${symbol}*.{test,spec}.{js,ts}`,
      `tests/**/*${featureName}*.{test,spec}.{js,ts}`
    ])
    
    const testFiles = []
    for (const pattern of patterns) {
      try {
        const { glob } = await import('glob')
        // Use this.repoPath for cwd
        const matches = await glob(pattern, { cwd: this.repoPath, absolute: true, nodir: true })
        testFiles.push(...matches.map(p => path.relative(this.repoPath, p))); // Store relative paths
      } catch (error) {
        logger.debug('Symbol test search failed', { pattern, error: error.message })
      }
    }
    
    return [...new Set(testFiles)]
  }
}

/**
 * Main Feature Mapper class
 */
export class FeatureMapper {
  constructor(repoPath = '.', config = {}) {
    this.repoPath = path.resolve(repoPath)
    this.config = config
    this.strategies = new Map()
    
    // Initialize strategies
    this.initializeStrategies()
    
    logger.debug('FeatureMapper initialized', { repoPath: this.repoPath })
  }

  initializeStrategies() {
    const strategyConfigs = this.config.feature_detection?.strategies || []
    logger.debug('Initializing strategies', { strategyConfigs: strategyConfigs.length })
    
    for (const strategyConfig of strategyConfigs) {
      logger.debug('Processing strategy config', { type: strategyConfig.type, enabled: strategyConfig.enabled })
      
      if (!strategyConfig.enabled) continue
      
      let strategy
      switch (strategyConfig.type) {
        case MappingStrategy.FOLDER_BASED:
          strategy = new FolderBasedStrategy(strategyConfig, this.repoPath)
          break
        case MappingStrategy.FILE_BASED:
          strategy = new FileBasedStrategy(strategyConfig, this.repoPath)
          break
        case MappingStrategy.ANNOTATION_BASED:
          strategy = new AnnotationBasedStrategy(strategyConfig, this.repoPath)
          break
        case MappingStrategy.AST_BASED:
          strategy = new ASTBasedStrategy(strategyConfig, this.repoPath)
          break
        default:
          logger.warn('Unknown mapping strategy', { type: strategyConfig.type })
          continue
      }
      
      this.strategies.set(strategyConfig.type, strategy)
      logger.debug('Initialized mapping strategy', { type: strategyConfig.type })
    }
  }

  /**
   * Map code changes to impacted features
   */
  async mapChangesToFeatures(diffResult) {
    const timer = logger.time('Feature mapping')
    
    try {
      // Ensure diffResult and changes exist
      if (!diffResult || !diffResult.changes) {
        logger.warn('No diff result or changes provided')
        return []
      }
      
      logger.info('Starting feature mapping', { 
        changedFiles: diffResult.changes.length 
      })
      
      const allFeatures = new Map()
      const existingMappings = this.config.features || {}
      
      // Apply each strategy
      for (const [strategyType, strategy] of this.strategies) {
        try {
          logger.debug('Applying mapping strategy', { strategyType, changedFiles: diffResult.changes.length })
          
          const features = await strategy.mapChangesToFeatures(diffResult, existingMappings)
          logger.debug('Strategy results', { strategyType, featuresFound: features.length })
          
          // Merge features with confidence weighting
          for (const feature of features) {
            const key = feature.featureName
            if (allFeatures.has(key)) {
              const existing = allFeatures.get(key)
              // Combine confidence scores and merge data
              existing.confidence = Math.max(existing.confidence, feature.confidence)
              existing.impactedFiles = [...new Set([...existing.impactedFiles, ...feature.impactedFiles])]
              existing.testFiles = [...new Set([...existing.testFiles, ...feature.testFiles])]
              existing.metadata = { ...existing.metadata, ...feature.metadata }
            } else {
              allFeatures.set(key, feature)
            }
          }
          
          logger.debug('Strategy completed', { 
            strategyType, 
            featuresFound: features.length 
          })
        } catch (error) {
          logger.warn('Strategy failed', { 
            strategyType, 
            error: error.message 
          })
        }
      }
      
      const result = Array.from(allFeatures.values())
        .sort((a, b) => b.confidence - a.confidence) // Sort by confidence
      
      timer.end({ featuresDetected: result.length })
      
      return result
    } catch (error) {
      logger.error('Feature mapping failed', { error: error.message })
      throw error
    }
  }

  /**
   * Get test files for given features
   */
  async getTestFilesForFeatures(features) {
    const allTestFiles = new Set()
    
    for (const feature of features) {
      for (const testFile of feature.testFiles) {
        allTestFiles.add(testFile)
      }
    }
    
    return Array.from(allTestFiles)
  }

  /**
   * Get features by confidence threshold
   */
  filterFeaturesByConfidence(features, threshold = 0.5) {
    return features.filter(feature => feature.confidence >= threshold)
  }

  /**
   * Get summary of feature mapping results
   */
  getSummary(features) {
    const summary = {
      totalFeatures: features.length,
      highConfidence: features.filter(f => f.confidence >= 0.8).length,
      mediumConfidence: features.filter(f => f.confidence >= 0.5 && f.confidence < 0.8).length,
      lowConfidence: features.filter(f => f.confidence < 0.5).length,
      strategiesUsed: [...new Set(features.map(f => f.strategyUsed))],
      totalTestFiles: new Set(features.flatMap(f => f.testFiles)).size
    }
    
    return summary
  }
}

export default FeatureMapper

