/**
 * OpenAI Provider
 * Integration with OpenAI's GPT models
 */

import OpenAI from 'openai'
import BaseAIProvider from './base-provider.js'
import logger from '../core/logger.js'

export class OpenAIProvider extends BaseAIProvider {
  constructor(config) {
    super(config)
    
    if (!config.api_key) {
      throw new Error('OpenAI API key is required')
    }
    
    this.client = new OpenAI({
      apiKey: config.api_key,
      timeout: this.timeout,
      maxRetries: 0 // We handle retries ourselves
    })
    
    logger.debug('OpenAI provider initialized', { model: this.model })
  }

  async analyzeImpact(prompt, options = {}) {
    return this.withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert software engineer specializing in test impact analysis. Provide precise, actionable analysis in the requested JSON format.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        response_format: options.json_mode ? { type: 'json_object' } : undefined
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('Empty response from OpenAI')
      }

      // Track usage
      this.trackUsage(response.usage)

      return content
    }, { model: this.model })
  }

  async validateConnection() {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5
      })
      
      logger.info('OpenAI connection validated', { model: this.model })
      return true
    } catch (error) {
      logger.error('OpenAI connection validation failed', { 
        error: error.message,
        model: this.model
      })
      return false
    }
  }

  getHeaders() {
    return {
      ...super.getHeaders(),
      'Authorization': `Bearer ${this.config.api_key}`,
      'OpenAI-Organization': this.config.organization || undefined
    }
  }

  trackUsage(usage) {
    if (usage) {
      this.totalTokens = (this.totalTokens || 0) + (usage.total_tokens || 0)
      this.totalRequests = (this.totalRequests || 0) + 1
      
      logger.debug('OpenAI usage tracked', {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens
      })
    }
  }
}

export default OpenAIProvider

