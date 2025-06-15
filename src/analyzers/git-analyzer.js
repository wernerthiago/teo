/**
 * Git Diff Analyzer
 * Advanced git diff analysis using simple-git and tree-sitter for syntax-aware parsing
 */

import { simpleGit } from 'simple-git'
import Parser from 'tree-sitter'
import JavaScript from 'tree-sitter-javascript'
import TypeScript from 'tree-sitter-typescript'
import Python from 'tree-sitter-python'
import path from 'path'
import fs from 'fs'
import logger from '../core/logger.js'

// Change types enum
export const ChangeType = {
  ADDED: 'added',
  MODIFIED: 'modified',
  DELETED: 'deleted',
  RENAMED: 'renamed'
}

// Language detection mapping
const LANGUAGE_EXTENSIONS = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass'
}

// Tree-sitter language parsers
const PARSERS = {
  javascript: JavaScript,
  typescript: TypeScript.typescript,
  python: Python
}

/**
 * Represents a single code change
 */
export class CodeChange {
  constructor({
    filePath,
    changeType,
    oldPath = null,
    linesAdded = 0,
    linesRemoved = 0,
    functionsChanged = [],
    classesChanged = [],
    importsChanged = []
  }) {
    this.filePath = filePath
    this.changeType = changeType
    this.oldPath = oldPath
    this.linesAdded = linesAdded
    this.linesRemoved = linesRemoved
    this.functionsChanged = functionsChanged || []
    this.classesChanged = classesChanged || []
    this.importsChanged = importsChanged || []
  }
}

/**
 * Result of diff analysis
 */
export class DiffAnalysisResult {
  constructor({
    baseCommit,
    headCommit,
    changes = [],
    totalFilesChanged = 0,
    totalLinesAdded = 0,
    totalLinesRemoved = 0,
    languagesAffected = new Set()
  }) {
    this.baseCommit = baseCommit
    this.headCommit = headCommit
    this.changes = changes
    this.totalFilesChanged = totalFilesChanged
    this.totalLinesAdded = totalLinesAdded
    this.totalLinesRemoved = totalLinesRemoved
    this.languagesAffected = languagesAffected
  }
}

/**
 * Git Diff Analyzer class
 */
export class GitDiffAnalyzer {
  constructor(repoPath = '.') {
    this.repoPath = path.resolve(repoPath)
    this.git = simpleGit(this.repoPath)
    this.parsers = new Map()
    
    // Initialize tree-sitter parsers
    this.initializeParsers()
    
    logger.debug('GitDiffAnalyzer initialized', { repoPath: this.repoPath })
  }

  /**
   * Initialize tree-sitter parsers for different languages
   */
  initializeParsers() {
    try {
      for (const [language, parserModule] of Object.entries(PARSERS)) {
        const parser = new Parser()
        parser.setLanguage(parserModule)
        this.parsers.set(language, parser)
        logger.debug(`Initialized ${language} parser`)
      }
    } catch (error) {
      logger.warn('Failed to initialize some tree-sitter parsers', { error: error.message })
    }
  }

  /**
   * Analyze git diff between two references
   */
  async analyzeDiff(baseRef, headRef) {
    const timer = logger.time('Git diff analysis')
    
    try {
      logger.info('Starting git diff analysis', { baseRef, headRef })
      
      // Validate repository
      await this.validateRepository()
      
      // Get commit SHAs
      const baseCommit = await this.resolveRef(baseRef)
      const headCommit = await this.resolveRef(headRef)
      
      logger.debug('Resolved references', { baseCommit, headCommit })
      
      // Get diff summary
      const diffSummary = await this.git.diffSummary([baseCommit, headCommit])
      
      // Analyze each changed file
      const changes = []
      const languagesAffected = new Set()
      
      for (const file of diffSummary.files) {
        try {
          const change = await this.analyzeFileChange(file, baseCommit, headCommit)
          changes.push(change)
          
          // Detect language
          const language = this.detectLanguage(change.filePath)
          if (language) {
            languagesAffected.add(language)
          }
        } catch (error) {
          logger.warn('Failed to analyze file change', { 
            file: file.file, 
            error: error.message 
          })
        }
      }
      
      const result = new DiffAnalysisResult({
        baseCommit,
        headCommit,
        changes,
        totalFilesChanged: diffSummary.files.length,
        totalLinesAdded: diffSummary.insertions,
        totalLinesRemoved: diffSummary.deletions,
        languagesAffected
      })
      
      timer.end({ 
        filesAnalyzed: changes.length,
        languages: Array.from(languagesAffected)
      })
      
      return result
    } catch (error) {
      logger.error('Git diff analysis failed', { error: error.message })
      throw error
    }
  }

  /**
   * Analyze a single file change
   */
  async analyzeFileChange(fileSummary, baseCommit, headCommit) {
    const filePath = fileSummary.file
    
    // Determine change type
    let changeType
    if (fileSummary.binary) {
      changeType = ChangeType.MODIFIED
    } else if (fileSummary.insertions > 0 && fileSummary.deletions === 0) {
      changeType = ChangeType.ADDED
    } else if (fileSummary.insertions === 0 && fileSummary.deletions > 0) {
      changeType = ChangeType.DELETED
    } else {
      changeType = ChangeType.MODIFIED
    }
    
    const change = new CodeChange({
      filePath,
      changeType,
      linesAdded: fileSummary.insertions,
      linesRemoved: fileSummary.deletions
    })
    
    // Perform syntax-aware analysis if possible
    if (!fileSummary.binary && changeType !== ChangeType.DELETED) {
      try {
        await this.performSyntaxAnalysis(change, baseCommit, headCommit)
      } catch (error) {
        logger.debug('Syntax analysis failed for file', { 
          filePath, 
          error: error.message 
        })
      }
    }
    
    return change
  }

  /**
   * Perform syntax-aware analysis using tree-sitter
   */
  async performSyntaxAnalysis(change, baseCommit, headCommit) {
    const language = this.detectLanguage(change.filePath)
    if (!language || !this.parsers.has(language)) {
      return
    }
    
    const parser = this.parsers.get(language)
    
    try {
      // Get file content from both commits
      const [oldContent, newContent] = await Promise.all([
        this.getFileContent(change.filePath, baseCommit).catch(() => ''),
        this.getFileContent(change.filePath, headCommit).catch(() => '')
      ])
      
      // Parse both versions
      const oldTree = oldContent ? parser.parse(oldContent) : null
      const newTree = newContent ? parser.parse(newContent) : null
      
      // Extract functions and classes
      if (newTree) {
        change.functionsChanged = this.extractFunctions(newTree, language)
        change.classesChanged = this.extractClasses(newTree, language)
        change.importsChanged = this.extractImports(newTree, language)
      }
      
      // Compare with old version for more detailed analysis
      if (oldTree && newTree) {
        // This could be enhanced with more sophisticated diff analysis
        logger.debug('Syntax analysis completed', { 
          filePath: change.filePath,
          functions: change.functionsChanged.length,
          classes: change.classesChanged.length
        })
      }
    } catch (error) {
      logger.debug('Syntax analysis error', { 
        filePath: change.filePath, 
        error: error.message 
      })
    }
  }

  /**
   * Extract function names from syntax tree
   */
  extractFunctions(tree, language) {
    const functions = []
    
    const query = this.getFunctionQuery(language)
    if (!query) return functions
    
    try {
      const cursor = tree.walk()
      this.walkTree(cursor, (node) => {
        if (this.isFunctionNode(node, language)) {
          const name = this.extractNodeName(node, language)
          if (name) {
            functions.push(name)
          }
        }
      })
    } catch (error) {
      logger.debug('Function extraction failed', { error: error.message })
    }
    
    return functions
  }

  /**
   * Extract class names from syntax tree
   */
  extractClasses(tree, language) {
    const classes = []
    
    try {
      const cursor = tree.walk()
      this.walkTree(cursor, (node) => {
        if (this.isClassNode(node, language)) {
          const name = this.extractNodeName(node, language)
          if (name) {
            classes.push(name)
          }
        }
      })
    } catch (error) {
      logger.debug('Class extraction failed', { error: error.message })
    }
    
    return classes
  }

  /**
   * Extract import statements from syntax tree
   */
  extractImports(tree, language) {
    const imports = []
    
    try {
      const cursor = tree.walk()
      this.walkTree(cursor, (node) => {
        if (this.isImportNode(node, language)) {
          const importText = node.text
          if (importText) {
            imports.push(importText.trim())
          }
        }
      })
    } catch (error) {
      logger.debug('Import extraction failed', { error: error.message })
    }
    
    return imports
  }

  /**
   * Walk syntax tree and apply callback to each node
   */
  walkTree(cursor, callback) {
    const visit = (cursor) => {
      callback(cursor.currentNode)
      
      if (cursor.gotoFirstChild()) {
        do {
          visit(cursor)
        } while (cursor.gotoNextSibling())
        cursor.gotoParent()
      }
    }
    
    visit(cursor)
  }

  /**
   * Check if node is a function definition
   */
  isFunctionNode(node, language) {
    const functionTypes = {
      javascript: ['function_declaration', 'arrow_function', 'method_definition'],
      typescript: ['function_declaration', 'arrow_function', 'method_definition'],
      python: ['function_definition']
    }
    
    return functionTypes[language]?.includes(node.type) || false
  }

  /**
   * Check if node is a class definition
   */
  isClassNode(node, language) {
    const classTypes = {
      javascript: ['class_declaration'],
      typescript: ['class_declaration'],
      python: ['class_definition']
    }
    
    return classTypes[language]?.includes(node.type) || false
  }

  /**
   * Check if node is an import statement
   */
  isImportNode(node, language) {
    const importTypes = {
      javascript: ['import_statement'],
      typescript: ['import_statement'],
      python: ['import_statement', 'import_from_statement']
    }
    
    return importTypes[language]?.includes(node.type) || false
  }

  /**
   * Extract name from syntax node
   */
  extractNodeName(node, language) {
    try {
      // Look for identifier child nodes
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child.type === 'identifier') {
          return child.text
        }
      }
      return null
    } catch (error) {
      return null
    }
  }

  /**
   * Get function query for language
   */
  getFunctionQuery(language) {
    // This could be enhanced with proper tree-sitter queries
    return null
  }

  /**
   * Detect programming language from file path
   */
  detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    return LANGUAGE_EXTENSIONS[ext] || null
  }

  /**
   * Get file content from specific commit
   */
  async getFileContent(filePath, commit) {
    try {
      const content = await this.git.show([`${commit}:${filePath}`])
      return content
    } catch (error) {
      throw new Error(`Failed to get file content: ${error.message}`)
    }
  }

  /**
   * Resolve git reference to commit SHA
   */
  async resolveRef(ref) {
    try {
      logger.debug(`Resolving reference: ${ref} from repository: ${this.repoPath}`)
      const result = await this.git.revparse([ref])
      return result.trim()
    } catch (error) {
      throw new Error(`Failed to resolve reference '${ref}': ${error.message}`)
    }
  }

  /**
   * Validate that we're in a git repository
   */
  async validateRepository() {
    try {
      await this.git.checkIsRepo()
    } catch (error) {
      throw new Error(`Not a git repository: ${this.repoPath}`)
    }
  }

  /**
   * Get list of changed files between references
   */
  async getChangedFiles(baseRef, headRef) {
    try {
      const diffSummary = await this.git.diffSummary([baseRef, headRef])
      return diffSummary.files.map(file => file.file)
    } catch (error) {
      logger.error('Failed to get changed files', { error: error.message })
      throw error
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch() {
    try {
      const status = await this.git.status()
      return status.current
    } catch (error) {
      logger.error('Failed to get current branch', { error: error.message })
      throw error
    }
  }
}

export default GitDiffAnalyzer

