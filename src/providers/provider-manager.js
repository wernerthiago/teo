/**
 * AI Provider Factory
 * Creates and manages AI provider instances with fallback support
 */

import OpenAIProvider from './openai-provider.js'
import AzureOpenAIProvider from './azure-openai-provider.js'
import AnthropicProvider from './anthropic-provider.js'
import GoogleGeminiProvider from './google-gemini-provider.js'
import OllamaProvider from './ollama-provider.js'
import logger from '../core/logger.js'

// Provider type constants
export const ProviderType = {
  OPENAI: 'openai',
  AZURE_OPENAI: 'azure-openai',
  ANTHROPIC: 'anthropic',
  GOOGLE_GEMINI: 'google-gemini',
  OLLAMA: 'ollama'
}

/**
 * AI Provider Manager with fallback support
 */
export class AIProviderManager {
  constructor(config) {
    this.config = config
    this.providers = new Map()
    this.primaryProvider = null
    this.fallbackProviders = []
    
    this.initializeProviders()
  }

  /**
   * Initialize all configured providers
   */
  initializeProviders() {
    const aiConfig = this.config || {}
    
    // Initialize primary provider
    if (aiConfig.primary) {
      try {
        this.primaryProvider = this.createProvider(aiConfig.primary)
        this.providers.set('primary', this.primaryProvider)
        logger.info('Primary AI provider initialized', { 
          type: aiConfig.primary.type 
        })
      } catch (error) {
        logger.error('Failed to initialize primary AI provider', { 
          error: error.message 
        })
      }
    }
    
    // Initialize fallback providers
    if (aiConfig.fallback) {
      try {
        const fallbackProvider = this.createProvider(aiConfig.fallback)
        this.fallbackProviders.push(fallbackProvider)
        this.providers.set('fallback', fallbackProvider)
        logger.info('Fallback AI provider initialized', { 
          type: aiConfig.fallback.type 
        })
      } catch (error) {
        logger.error('Failed to initialize fallback AI provider', { 
          error: error.message 
        })
      }
    }
    
    // Initialize local provider
    if (aiConfig.local) {
      try {
        const localProvider = this.createProvider(aiConfig.local)
        this.fallbackProviders.push(localProvider)
        this.providers.set('local', localProvider)
        logger.info('Local AI provider initialized', { 
          type: aiConfig.local.type 
        })
      } catch (error) {
        logger.error('Failed to initialize local AI provider', { 
          error: error.message 
        })
      }
    }
    
    if (this.providers.size === 0) {
      logger.warn('No AI providers initialized - AI analysis will be disabled')
    }
  }

  /**
   * Create provider instance based on configuration
   */
  createProvider(config) {
    switch (config.type) {
      case ProviderType.OPENAI:
        return new OpenAIProvider(config)
      
      case ProviderType.AZURE_OPENAI:
        return new AzureOpenAIProvider(config)
      
      case ProviderType.ANTHROPIC:
        return new AnthropicProvider(config)
      
      case ProviderType.GOOGLE_GEMINI:
        return new GoogleGeminiProvider(config)
      
      case ProviderType.OLLAMA:
        return new OllamaProvider(config)
      
      default:
        throw new Error(`Unknown AI provider type: ${config.type}`)
    }
  }

  /**
   * Analyze impact with automatic fallback
   */
  async analyzeImpact(diffResult, featureMapping, options = {}) {
    const timer = logger.time('AI impact analysis')
    
    try {
      // Try primary provider first
      if (this.primaryProvider) {
        try {
          const prompt = this.primaryProvider.createAnalysisPrompt(
            diffResult, 
            featureMapping, 
            options
          )
          
          const response = await this.primaryProvider.analyzeImpact(prompt, options)
          const analysis = this.primaryProvider.parseAnalysisResponse(
            response, 
            featureMapping?.featureName || 'unknown'
          )
          
          timer.end({ provider: 'primary', success: true })
          return analysis
        } catch (error) {
          logger.warn('Primary AI provider failed', { 
            provider: this.primaryProvider.type,
            error: error.message 
          })
        }
      }
      
      // Try fallback providers
      for (const provider of this.fallbackProviders) {
        try {
          logger.info('Trying fallback AI provider', { type: provider.type })
          
          const prompt = provider.createAnalysisPrompt(
            diffResult, 
            featureMapping, 
            options
          )
          
          const response = await provider.analyzeImpact(prompt, options)
          const analysis = provider.parseAnalysisResponse(
            response, 
            featureMapping?.featureName || 'unknown'
          )
          
          timer.end({ provider: provider.type, success: true })
          return analysis
        } catch (error) {
          logger.warn('Fallback AI provider failed', { 
            provider: provider.type,
            error: error.message 
          })
        }
      }
      
      // All providers failed
      throw new Error('All AI providers failed')
    } catch (error) {
      timer.end({ success: false, error: error.message })
      logger.error('AI impact analysis failed', { error: error.message })
      
      // Return fallback analysis
      return this.createFallbackAnalysis(featureMapping?.featureName || 'unknown')
    }
  }

  /**
   * Create fallback analysis when AI fails
   */
  createFallbackAnalysis(featureName) {
    return {
      featureName,
      impactLevel: 'medium',
      confidence: 0.3,
      reasoning: 'AI analysis unavailable - using fallback heuristics',
      affectedComponents: [],
      riskFactors: ['AI analysis failed'],
      recommendedTests: ['regression tests'],
      metadata: { fallback: true }
    }
  }

  /**
   * Validate all provider connections
   */
  async validateConnections() {
    const results = {}
    
    for (const [name, provider] of this.providers) {
      try {
        const isValid = await provider.validateConnection()
        results[name] = {
          type: provider.type,
          model: provider.model,
          valid: isValid
        }
      } catch (error) {
        results[name] = {
          type: provider.type,
          model: provider.model,
          valid: false,
          error: error.message
        }
      }
    }
    
    return results
  }

  /**
   * Get usage statistics for all providers
   */
  getUsageStats() {
    const stats = {}
    
    for (const [name, provider] of this.providers) {
      stats[name] = provider.getUsageStats()
    }
    
    return stats
  }

  /**
   * Get available providers
   */
  getAvailableProviders() {
    return Array.from(this.providers.keys())
  }

  /**
   * Get specific provider
   */
  getProvider(name) {
    return this.providers.get(name)
  }

  /**
   * Check if AI analysis is available
   */
  isAvailable() {
    return this.providers.size > 0
  }
}

export default AIProviderManager

