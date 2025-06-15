/**
 * Azure OpenAI Provider
 * Integration with Azure OpenAI Service
 */

import { AzureOpenAI } from 'openai'
import BaseAIProvider from './base-provider.js'
import logger from '../core/logger.js'

export class AzureOpenAIProvider extends BaseAIProvider {
  constructor(config) {
    super(config)
    
    if (!config.api_key) {
      throw new Error('Azure OpenAI API key is required')
    }
    
    if (!config.endpoint) {
      throw new Error('Azure OpenAI endpoint is required')
    }
    
    if (!config.deployment_name) {
      throw new Error('Azure OpenAI deployment name is required')
    }
    
    this.endpoint = config.endpoint
    this.deploymentName = config.deployment_name
    this.apiVersion = config.api_version || '2024-02-15-preview'
    
    this.client = new AzureOpenAI({
      apiKey: config.api_key,
      endpoint: config.endpoint,
      apiVersion: this.apiVersion,
      timeout: this.timeout
    })
    
    logger.debug('Azure OpenAI provider initialized', { 
      endpoint: this.endpoint,
      deployment: this.deploymentName,
      apiVersion: this.apiVersion
    })
  }

  toJSON() {
    return {
      type: 'azure-openai',
      endpoint: this.endpoint,
      deploymentName: this.deploymentName,
      model: this.model,
      initialized: !!this.client
    }
  }

  async analyzeImpact(prompt, options = {}) {
    return this.withRetry(async () => {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
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
        max_tokens: this.maxTokens,
        temperature: this.temperature
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('Empty response from Azure OpenAI')
      }

      // Track usage
      this.trackUsage(response.usage)

      return content
    }, { model: this.deploymentName, endpoint: this.endpoint })
  }

  async validateConnection() {
    try {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 5
      })
      
      logger.info('Azure OpenAI connection validated', { 
        endpoint: this.endpoint,
        deployment: this.deploymentName
      })
      return true
    } catch (error) {
      logger.error('Azure OpenAI connection validation failed', { 
        error: error.message,
        endpoint: this.endpoint,
        deployment: this.deploymentName
      })
      return false
    }
  }

  getHeaders() {
    return {
      ...super.getHeaders(),
      'api-key': this.config.api_key,
      'Content-Type': 'application/json'
    }
  }

  trackUsage(usage) {
    if (usage) {
      this.totalTokens = (this.totalTokens || 0) + (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
      this.totalRequests = (this.totalRequests || 0) + 1
      
      logger.debug('Azure OpenAI usage tracked', {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens
      })
    }
  }

  shouldNotRetry(error) {
    // Azure OpenAI specific error patterns
    const azureNoRetryPatterns = [
      'invalid_api_key',
      'invalid_resource_name',
      'deployment_not_found',
      'content_filter',
      'quota_exceeded'
    ]
    
    const errorMessage = error.message.toLowerCase()
    const azureSpecific = azureNoRetryPatterns.some(pattern => 
      errorMessage.includes(pattern)
    )
    
    return azureSpecific || super.shouldNotRetry(error)
  }
}

export default AzureOpenAIProvider

