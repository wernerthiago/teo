/**
 * Configuration management system
 * Handles YAML configuration loading, validation, and environment variable substitution
 */

import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { z } from 'zod'
import dotenv from 'dotenv'
import logger from './logger.js'

// Load environment variables
dotenv.config()

// Configuration schema validation
const AIProviderConfigSchema = z.object({
  type: z.enum(['openai', 'azure-openai', 'anthropic', 'google-gemini', 'ollama']),
  api_key: z.string().optional(),
  endpoint: z.string().url().optional(),
  model: z.string(),
  deployment_name: z.string().optional(), // For Azure OpenAI
  api_version: z.string().optional(), // For Azure OpenAI
  temperature: z.number().min(0).max(2).default(0.1),
  max_tokens: z.number().positive().default(2000),
  timeout: z.number().positive().default(30000),
  max_retries: z.number().min(0).default(3)
})

const FeatureMappingSchema = z.object({
  source_patterns: z.array(z.string()),
  test_patterns: z.array(z.string()),
  confidence: z.number().min(0).max(1).default(1.0),
  metadata: z.record(z.any()).optional()
})

const IntegrationConfigSchema = z.object({
  framework: z.string(),
  test_dir: z.string(),
  test_patterns: z.array(z.string()),
  config_file: z.string().optional(),
  parallel_execution: z.boolean().default(true),
  max_workers: z.number().positive().default(4),
  timeout: z.number().positive().default(30000)
})

const FeatureDetectionStrategySchema = z.object({
  type: z.enum(['folder_based', 'file_based', 'annotation_based', 'ast_based']),
  weight: z.number().min(0).max(1),
  enabled: z.boolean().default(true),
  config: z.record(z.any()).optional()
})

const TEOConfigSchema = z.object({
  project_name: z.string(),
  repo_path: z.string().default('.'),
  
  git: z.object({
    default_branch: z.string().default('main'),
    ignore_patterns: z.array(z.string()).default([])
  }).optional(),
  
  feature_detection: z.object({
    strategies: z.array(FeatureDetectionStrategySchema)
  }).optional(),
  
  integrations: z.record(IntegrationConfigSchema).optional(),
  
  ai_providers: z.object({
    primary: AIProviderConfigSchema.optional(),
    fallback: AIProviderConfigSchema.optional(),
    local: AIProviderConfigSchema.optional()
  }).optional(),
  
  features: z.record(FeatureMappingSchema).optional(),
  
  execution_strategies: z.record(z.object({
    description: z.string(),
    confidence_threshold: z.number().min(0).max(1),
    include_integration_tests: z.boolean()
  })).optional(),
  
  default_strategy: z.string().default('balanced'),
  
  cache: z.object({
    enabled: z.boolean().default(true),
    directory: z.string().default('.teo_cache'),
    ttl: z.number().positive().default(3600),
    strategies: z.array(z.string()).default(['git_analysis', 'ai_results'])
  }).optional()
})

export class TEOConfig {
  constructor(config) {
    this.config = config
    this.validated = false
  }

  /**
   * Load configuration from YAML file
   */
  static async fromFile(configPath) {
    try {
      logger.info('Loading configuration', { configPath })
      
      if (!fs.existsSync(configPath)) {
        throw new Error(`Configuration file not found: ${configPath}`)
      }

      const configContent = fs.readFileSync(configPath, 'utf8')
      const rawConfig = yaml.load(configContent)
      
      // Substitute environment variables
      const processedConfig = TEOConfig.substituteEnvVars(rawConfig)
      
      const config = new TEOConfig(processedConfig)
      await config.validate()
      
      logger.info('Configuration loaded successfully')
      return config
    } catch (error) {
      logger.error('Failed to load configuration', { error: error.message })
      throw error
    }
  }

  /**
   * Create default configuration
   */
  static createDefault() {
    const defaultConfig = {
      project_name: 'my-project',
      repo_path: '.',
      
      git: {
        default_branch: 'main',
        ignore_patterns: ['*.log', 'node_modules/**', '.git/**']
      },
      
      feature_detection: {
        strategies: [
          {
            type: 'folder_based',
            weight: 0.3,
            enabled: true
          },
          {
            type: 'file_based',
            weight: 0.4,
            enabled: true
          },
          {
            type: 'annotation_based',
            weight: 0.2,
            enabled: true
          }
        ]
      },
      
      integrations: {
        playwright: {
          framework: 'playwright',
          test_dir: 'tests',
          test_patterns: ['**/*.spec.js', '**/*.test.js'],
          parallel_execution: true,
          max_workers: 4
        }
      },
      
      ai_providers: {
        primary: {
          type: 'openai',
          model: 'gpt-4',
          temperature: 0.1,
          max_tokens: 2000
        }
      },
      
      cache: {
        enabled: true,
        directory: '.teo_cache',
        ttl: 3600
      }
    }
    
    return new TEOConfig(defaultConfig)
  }

  /**
   * Validate configuration against schema
   */
  async validate() {
    try {
      logger.debug('Validating configuration')
      
      const validatedConfig = TEOConfigSchema.parse(this.config)
      this.config = validatedConfig
      this.validated = true
      
      logger.debug('Configuration validation successful')
      return []
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issues = error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code
        }))
        
        logger.error('Configuration validation failed', { issues })
        return issues
      }
      
      logger.error('Configuration validation error', { error: error.message })
      throw error
    }
  }

  /**
   * Substitute environment variables in configuration
   */
  static substituteEnvVars(obj) {
    if (typeof obj === 'string') {
      // Handle ${VAR} and ${VAR:-default} patterns
      return obj.replace(/\$\{([^}]+)\}/g, (match, varExpr) => {
        const [varName, defaultValue] = varExpr.split(':-')
        return process.env[varName] || defaultValue || match
      })
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => TEOConfig.substituteEnvVars(item))
    }
    
    if (obj && typeof obj === 'object') {
      const result = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = TEOConfig.substituteEnvVars(value)
      }
      return result
    }
    
    return obj
  }

  /**
   * Get configuration value by path
   */
  get(path, defaultValue = undefined) {
    const keys = path.split('.')
    let current = this.config
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key]
      } else {
        return defaultValue
      }
    }
    
    return current
  }

  /**
   * Get AI provider configuration
   */
  getAIProvider(type = 'primary') {
    return this.get(`ai_providers.${type}`)
  }

  /**
   * Get integration configuration
   */
  getIntegration(framework) {
    return this.get(`integrations.${framework}`)
  }

  /**
   * Get feature mapping
   */
  getFeature(featureName) {
    return this.get(`features.${featureName}`)
  }

  /**
   * Get all features
   */
  getAllFeatures() {
    return this.get('features', {})
  }

  /**
   * Convert to plain object
   */
  toObject() {
    return { ...this.config }
  }

  /**
   * Save configuration to file
   */
  async saveToFile(filePath) {
    try {
      const yamlContent = yaml.dump(this.config, {
        indent: 2,
        lineWidth: 120,
        noRefs: true
      })
      
      fs.writeFileSync(filePath, yamlContent, 'utf8')
      logger.info('Configuration saved', { filePath })
    } catch (error) {
      logger.error('Failed to save configuration', { error: error.message })
      throw error
    }
  }
}

export default TEOConfig

