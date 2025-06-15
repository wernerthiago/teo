/**
 * Ollama Provider
 * Integration with local Ollama models
 */

import axios from 'axios'
import BaseAIProvider from './base-provider.js'
import logger from '../core/logger.js'

export class OllamaProvider extends BaseAIProvider {
  constructor(config) {
    super(config)
    
    this.endpoint = config.endpoint || 'http://localhost:11434'
    this.model = config.model || 'codellama:7b'
    
    // Ollama typically needs longer timeouts for local inference
    this.timeout = config.timeout || 60000
    
    logger.debug('Ollama provider initialized', { 
      endpoint: this.endpoint,
      model: this.model 
    })
  }

  async analyzeImpact(prompt, options = {}) {
    return this.withRetry(async () => {
      const systemPrompt = 'You are an expert software engineer specializing in test impact analysis. Provide precise, actionable analysis in the requested JSON format.'
      const fullPrompt = `${systemPrompt}\n\n${prompt}`

      const response = await axios.post(
        `${this.endpoint}/api/generate`,
        {
          model: this.model,
          prompt: fullPrompt,
          stream: false,
          options: {
            temperature: this.temperature,
            num_predict: this.maxTokens
          }
        },
        {
          timeout: this.timeout,
          headers: this.getHeaders()
        }
      )

      const content = response.data.response
      if (!content) {
        throw new Error('Empty response from Ollama')
      }

      // Track usage
      this.trackUsage({
        totalTokens: response.data.eval_count || 0,
        promptTokens: response.data.prompt_eval_count || 0
      })

      return content
    }, { model: this.model, endpoint: this.endpoint })
  }

  async validateConnection() {
    try {
      // Check if Ollama is running
      const response = await axios.get(`${this.endpoint}/api/tags`, {
        timeout: 5000
      })
      
      // Check if our model is available
      const models = response.data.models || []
      const modelExists = models.some(m => m.name === this.model)
      
      if (!modelExists) {
        logger.warn('Ollama model not found', { 
          model: this.model,
          availableModels: models.map(m => m.name)
        })
        return false
      }
      
      logger.info('Ollama connection validated', { 
        endpoint: this.endpoint,
        model: this.model
      })
      return true
    } catch (error) {
      logger.error('Ollama connection validation failed', { 
        error: error.message,
        endpoint: this.endpoint,
        model: this.model
      })
      return false
    }
  }

  async listAvailableModels() {
    try {
      const response = await axios.get(`${this.endpoint}/api/tags`)
      return response.data.models || []
    } catch (error) {
      logger.error('Failed to list Ollama models', { error: error.message })
      return []
    }
  }

  async pullModel(modelName) {
    try {
      logger.info('Pulling Ollama model', { model: modelName })
      
      const response = await axios.post(
        `${this.endpoint}/api/pull`,
        { name: modelName },
        { timeout: 300000 } // 5 minutes for model download
      )
      
      logger.info('Ollama model pulled successfully', { model: modelName })
      return true
    } catch (error) {
      logger.error('Failed to pull Ollama model', { 
        model: modelName,
        error: error.message 
      })
      return false
    }
  }

  getHeaders() {
    return {
      ...super.getHeaders(),
      'Accept': 'application/json'
    }
  }

  trackUsage(usage) {
    if (usage) {
      this.totalTokens = (this.totalTokens || 0) + (usage.totalTokens || 0)
      this.totalRequests = (this.totalRequests || 0) + 1
      
      logger.debug('Ollama usage tracked', {
        promptTokens: usage.promptTokens,
        totalTokens: usage.totalTokens
      })
    }
  }

  shouldNotRetry(error) {
    // Ollama-specific error patterns
    const ollamaNoRetryPatterns = [
      'model not found',
      'invalid model',
      'connection refused',
      'service unavailable'
    ]
    
    const errorMessage = error.message.toLowerCase()
    const ollamaSpecific = ollamaNoRetryPatterns.some(pattern => 
      errorMessage.includes(pattern)
    )
    
    return ollamaSpecific || super.shouldNotRetry(error)
  }
}

export default OllamaProvider

