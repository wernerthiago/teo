/**
 * Base AI Provider
 * Abstract base class for all AI providers with common functionality
 */

import logger from '../core/logger.js'

// Impact levels enum
export const ImpactLevel = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  NONE: 'none'
}

/**
 * Result of AI-powered impact analysis
 */
export class AIImpactAnalysis {
  constructor({
    featureName,
    impactLevel,
    confidence,
    reasoning,
    affectedComponents = [],
    riskFactors = [],
    recommendedTests = [],
    metadata = {}
  }) {
    this.featureName = featureName
    this.impactLevel = impactLevel
    this.confidence = confidence
    this.reasoning = reasoning
    this.affectedComponents = affectedComponents
    this.riskFactors = riskFactors
    this.recommendedTests = recommendedTests
    this.metadata = metadata
  }
}

/**
 * Base class for AI providers
 */
export class BaseAIProvider {
  constructor(config) {
    this.config = config
    this.type = config.type
    this.model = config.model
    this.temperature = config.temperature || 0.1
    this.maxTokens = config.max_tokens || 2000
    this.timeout = config.timeout || 30000
    this.maxRetries = config.max_retries || 3
    
    logger.debug('AI Provider initialized', { 
      type: this.type, 
      model: this.model 
    })
  }

  /**
   * Analyze code impact using AI model
   * Must be implemented by subclasses
   */
  async analyzeImpact(prompt, options = {}) {
    throw new Error('Must implement analyzeImpact method')
  }

  /**
   * Validate connection to AI service
   * Must be implemented by subclasses
   */
  async validateConnection() {
    throw new Error('Must implement validateConnection method')
  }

  /**
   * Get provider-specific headers
   */
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'User-Agent': 'TEO-JS/1.0.0'
    }
  }

  /**
   * Handle API errors with retry logic
   */
  async withRetry(operation, context = {}) {
    let lastError
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug('AI API attempt', { attempt, provider: this.type, ...context })
        
        const result = await Promise.race([
          operation(),
          this.createTimeoutPromise()
        ])
        
        logger.debug('AI API success', { attempt, provider: this.type })
        return result
      } catch (error) {
        lastError = error
        
        logger.warn('AI API attempt failed', { 
          attempt, 
          provider: this.type, 
          error: error.message,
          ...context
        })
        
        // Don't retry on certain errors
        if (this.shouldNotRetry(error)) {
          break
        }
        
        // Exponential backoff
        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
          await this.sleep(delay)
        }
      }
    }
    
    logger.error('AI API failed after retries', { 
      provider: this.type, 
      attempts: this.maxRetries,
      error: lastError.message
    })
    
    throw lastError
  }

  /**
   * Create timeout promise
   */
  createTimeoutPromise() {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`AI API timeout after ${this.timeout}ms`))
      }, this.timeout)
    })
  }

  /**
   * Check if error should not be retried
   */
  shouldNotRetry(error) {
    const noRetryPatterns = [
      'invalid_api_key',
      'insufficient_quota',
      'model_not_found',
      'invalid_request',
      'authentication',
      'authorization'
    ]
    
    const errorMessage = error.message.toLowerCase()
    return noRetryPatterns.some(pattern => errorMessage.includes(pattern))
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Parse AI response into structured analysis
   */
  parseAnalysisResponse(response, featureName) {
    try {
      // Try to parse as JSON first
      let parsed
      if (typeof response === 'string') {
        // Look for JSON in the response
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0])
        } else {
          // Fallback to text parsing
          parsed = this.parseTextResponse(response)
        }
      } else {
        parsed = response
      }
      
      return new AIImpactAnalysis({
        featureName,
        impactLevel: this.normalizeImpactLevel(parsed.impact_level || parsed.impactLevel),
        confidence: this.normalizeConfidence(parsed.confidence),
        reasoning: parsed.reasoning || parsed.reason || 'No reasoning provided',
        affectedComponents: parsed.affected_components || parsed.affectedComponents || [],
        riskFactors: parsed.risk_factors || parsed.riskFactors || [],
        recommendedTests: parsed.recommended_tests || parsed.recommendedTests || [],
        metadata: parsed.metadata || {}
      })
    } catch (error) {
      logger.warn('Failed to parse AI response', { 
        error: error.message,
        response: typeof response === 'string' ? response.substring(0, 200) : response
      })
      
      // Return fallback analysis
      return new AIImpactAnalysis({
        featureName,
        impactLevel: ImpactLevel.MEDIUM,
        confidence: 0.5,
        reasoning: 'Failed to parse AI response',
        affectedComponents: [],
        riskFactors: ['AI analysis parsing failed'],
        recommendedTests: [],
        metadata: { parseError: error.message }
      })
    }
  }

  /**
   * Parse text response when JSON parsing fails
   */
  parseTextResponse(text) {
    const result = {
      impact_level: ImpactLevel.MEDIUM,
      confidence: 0.5,
      reasoning: text,
      affected_components: [],
      risk_factors: [],
      recommended_tests: []
    }
    
    // Extract impact level
    const impactMatch = text.match(/impact[:\s]*(critical|high|medium|low|none)/i)
    if (impactMatch) {
      result.impact_level = impactMatch[1].toLowerCase()
    }
    
    // Extract confidence
    const confidenceMatch = text.match(/confidence[:\s]*(\d+(?:\.\d+)?)/i)
    if (confidenceMatch) {
      result.confidence = parseFloat(confidenceMatch[1])
      if (result.confidence > 1) result.confidence /= 100 // Convert percentage
    }
    
    // Extract components (look for bullet points or lists)
    const componentMatches = text.match(/(?:components?|modules?|files?)[:\s]*([^\n]+)/i)
    if (componentMatches) {
      result.affected_components = componentMatches[1]
        .split(/[,;]/)
        .map(c => c.trim())
        .filter(c => c.length > 0)
    }
    
    return result
  }

  /**
   * Normalize impact level to enum value
   */
  normalizeImpactLevel(level) {
    if (!level) return ImpactLevel.MEDIUM
    
    const normalized = level.toString().toLowerCase()
    const validLevels = Object.values(ImpactLevel)
    
    return validLevels.includes(normalized) ? normalized : ImpactLevel.MEDIUM
  }

  /**
   * Normalize confidence to 0-1 range
   */
  normalizeConfidence(confidence) {
    if (typeof confidence !== 'number') return 0.5
    
    // Ensure 0-1 range
    if (confidence > 1) return confidence / 100
    if (confidence < 0) return 0
    
    return confidence
  }

  /**
   * Create analysis prompt
   */
  createAnalysisPrompt(diffResult, featureMapping, context = {}) {
    const prompt = `
You are an expert software engineer analyzing code changes to determine their impact on testing requirements.

## Code Changes Analysis

**Changed Files:** ${diffResult.changes.length}
**Lines Added:** ${diffResult.totalLinesAdded}
**Lines Removed:** ${diffResult.totalLinesRemoved}
**Languages:** ${Array.from(diffResult.languagesAffected).join(', ')}

## File Changes:
${diffResult.changes.map(change => `
- **${change.filePath}** (${change.changeType})
  - Lines: +${change.linesAdded}/-${change.linesRemoved}
  - Functions: ${change.functionsChanged.join(', ') || 'none'}
  - Classes: ${change.classesChanged.join(', ') || 'none'}
`).join('')}

## Feature Context:
${featureMapping ? `
**Feature:** ${featureMapping.featureName}
**Source Patterns:** ${featureMapping.sourcePatterns.join(', ')}
**Test Patterns:** ${featureMapping.testPatterns.join(', ')}
**Confidence:** ${featureMapping.confidence}
` : 'No specific feature mapping provided'}

## Analysis Request:

Please analyze these code changes and provide a JSON response with the following structure:

\`\`\`json
{
  "impact_level": "critical|high|medium|low|none",
  "confidence": 0.95,
  "reasoning": "Detailed explanation of why this impact level was chosen",
  "affected_components": ["component1", "component2"],
  "risk_factors": ["risk1", "risk2"],
  "recommended_tests": ["test_type1", "test_type2"],
  "metadata": {
    "complexity": "high|medium|low",
    "test_priority": "critical|high|medium|low"
  }
}
\`\`\`

## Guidelines:

1. **Impact Level:**
   - CRITICAL: Core functionality, security, or data integrity changes
   - HIGH: Major feature changes, API modifications, significant refactoring
   - MEDIUM: Minor feature changes, bug fixes, configuration updates
   - LOW: Documentation, comments, minor styling changes
   - NONE: No functional impact (whitespace, formatting only)

2. **Confidence:** Rate your confidence in this analysis (0.0 to 1.0)

3. **Risk Factors:** Identify potential risks from these changes

4. **Recommended Tests:** Suggest specific types of tests that should be run

Focus on the functional impact and testing implications of these changes.
`

    return prompt.trim()
  }

  /**
   * Get usage statistics
   */
  getUsageStats() {
    return {
      provider: this.type,
      model: this.model,
      totalRequests: this.totalRequests || 0,
      totalTokens: this.totalTokens || 0,
      averageResponseTime: this.averageResponseTime || 0,
      errorRate: this.errorRate || 0
    }
  }
}

export default BaseAIProvider

