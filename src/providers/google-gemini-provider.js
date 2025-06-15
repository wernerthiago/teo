/**
 * Google Gemini Provider
 * Integration with Google's Gemini models
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import BaseAIProvider from './base-provider.js'
import logger from '../core/logger.js'

export class GoogleGeminiProvider extends BaseAIProvider {
  constructor(config) {
    super(config)
    
    if (!config.api_key) {
      throw new Error('Google API key is required')
    }
    
    this.genAI = new GoogleGenerativeAI(config.api_key)
    this.model = config.model || 'gemini-pro'
    
    logger.debug('Google Gemini provider initialized', { model: this.model })
  }

  async analyzeImpact(prompt, options = {}) {
    return this.withRetry(async () => {
      const model = this.genAI.getGenerativeModel({ 
        model: this.model,
        generationConfig: {
          temperature: this.temperature,
          maxOutputTokens: this.maxTokens
        }
      })

      const systemPrompt = 'You are an expert software engineer specializing in test impact analysis. Provide precise, actionable analysis in the requested JSON format.'
      const fullPrompt = `${systemPrompt}\n\n${prompt}`

      const result = await model.generateContent(fullPrompt)
      const response = await result.response
      const content = response.text()

      if (!content) {
        throw new Error('Empty response from Google Gemini')
      }

      // Track usage (Gemini doesn't provide detailed usage stats in the same way)
      this.trackUsage({ totalTokens: content.length / 4 }) // Rough estimate

      return content
    }, { model: this.model })
  }

  async validateConnection() {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.model })
      const result = await model.generateContent('Hello')
      const response = await result.response
      
      logger.info('Google Gemini connection validated', { model: this.model })
      return true
    } catch (error) {
      logger.error('Google Gemini connection validation failed', { 
        error: error.message,
        model: this.model
      })
      return false
    }
  }

  getHeaders() {
    return {
      ...super.getHeaders(),
      'x-goog-api-key': this.config.api_key
    }
  }

  trackUsage(usage) {
    if (usage) {
      this.totalTokens = (this.totalTokens || 0) + (usage.totalTokens || 0)
      this.totalRequests = (this.totalRequests || 0) + 1
      
      logger.debug('Google Gemini usage tracked', {
        estimatedTokens: usage.totalTokens
      })
    }
  }

  shouldNotRetry(error) {
    // Google-specific error patterns
    const googleNoRetryPatterns = [
      'invalid_api_key',
      'permission_denied',
      'not_found',
      'quota_exceeded',
      'safety_settings'
    ]
    
    const errorMessage = error.message.toLowerCase()
    const googleSpecific = googleNoRetryPatterns.some(pattern => 
      errorMessage.includes(pattern)
    )
    
    return googleSpecific || super.shouldNotRetry(error)
  }
}

export default GoogleGeminiProvider

