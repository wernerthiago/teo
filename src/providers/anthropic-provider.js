/**
 * Anthropic Claude Provider
 * Integration with Anthropic's Claude models
 */

import Anthropic from '@anthropic-ai/sdk'
import BaseAIProvider from './base-provider.js'
import logger from '../core/logger.js'

export class AnthropicProvider extends BaseAIProvider {
  constructor(config) {
    super(config)
    
    if (!config.api_key) {
      throw new Error('Anthropic API key is required')
    }
    
    this.client = new Anthropic({
      apiKey: config.api_key,
      timeout: this.timeout,
      maxRetries: 0 // We handle retries ourselves
    })
    
    logger.debug('Anthropic provider initialized', { model: this.model })
  }

  async analyzeImpact(prompt, options = {}) {
    return this.withRetry(async () => {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        system: 'You are an expert software engineer specializing in test impact analysis. Provide precise, actionable analysis in the requested JSON format.',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })

      const content = response.content[0]?.text
      if (!content) {
        throw new Error('Empty response from Anthropic')
      }

      // Track usage
      this.trackUsage(response.usage)

      return content
    }, { model: this.model })
  }

  async validateConnection() {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Hello' }]
      })
      
      logger.info('Anthropic connection validated', { model: this.model })
      return true
    } catch (error) {
      logger.error('Anthropic connection validation failed', { 
        error: error.message,
        model: this.model
      })
      return false
    }
  }

  getHeaders() {
    return {
      ...super.getHeaders(),
      'x-api-key': this.config.api_key,
      'anthropic-version': '2023-06-01'
    }
  }

  trackUsage(usage) {
    if (usage) {
      this.totalTokens = (this.totalTokens || 0) + (usage.input_tokens || 0) + (usage.output_tokens || 0)
      this.totalRequests = (this.totalRequests || 0) + 1
      
      logger.debug('Anthropic usage tracked', {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.input_tokens + usage.output_tokens
      })
    }
  }

  shouldNotRetry(error) {
    // Anthropic-specific error patterns
    const anthropicNoRetryPatterns = [
      'invalid_api_key',
      'permission_error',
      'not_found_error',
      'rate_limit_error'
    ]
    
    const errorMessage = error.message.toLowerCase()
    const anthropicSpecific = anthropicNoRetryPatterns.some(pattern => 
      errorMessage.includes(pattern)
    )
    
    return anthropicSpecific || super.shouldNotRetry(error)
  }
}

export default AnthropicProvider

