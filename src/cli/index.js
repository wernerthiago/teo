#!/usr/bin/env node

/**
 * TEO CLI - Refactored for Path-Based Approach
 * 
 * Command-line interface focused on intelligent test selection
 * and flexible output formats for integration with test runners.
 */

import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import fs from 'fs/promises'
import path from 'path'
import TEOEngine from '../core/engine.js'
import TEOConfig from '../core/config.js'
import logger from '../core/logger.js'
import pkg from '../../package.json' assert { type: 'json' }

const program = new Command()

// Global options
// Read version from package.json

program
  .name('teo')
  .description('Test Execution Optimizer - Intelligent test selection for modern development')
  .version(pkg.version)
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-q, --quiet', 'Suppress non-essential output')
  .option('--config <path>', 'Path to configuration file', 'teo-config.yaml')

/**
 * Initialize TEO configuration
 */
program
  .command('init')
  .description('Initialize TEO configuration')
  .option('--config <path>', 'Configuration file path', 'teo-config.yaml')
  .option('--force', 'Overwrite existing configuration')
  .option('--template <type>', 'Configuration template', 'default')
  .action(async (options) => {
    const spinner = ora('Initializing TEO configuration...').start()
    
    try {
      const configPath = path.resolve(options.config)
      
      // Check if config already exists
      if (!options.force) {
        try {
          await fs.access(configPath)
          spinner.fail('Configuration file already exists. Use --force to overwrite.')
          process.exit(1)
        } catch {
          // File doesn't exist, continue
        }
      }
      
      // Create default configuration
      const config = TEOConfig.createDefault()
      await config.save(configPath)
      
      spinner.succeed(`Configuration initialized: ${configPath}`)
      
      console.log(chalk.green('\n✅ TEO configuration created successfully!'))
      console.log(chalk.blue('\n📝 Next steps:'))
      console.log('1. Edit the configuration file to match your project structure')
      console.log('2. Define your features and test patterns')
      console.log('3. Run: teo validate --config ' + options.config)
      console.log('4. Test analysis: teo analyze --base HEAD~1 --head HEAD')
      
    } catch (error) {
      spinner.fail('Configuration initialization failed')
      console.error(chalk.red('Error:'), error.message)
      if (program.opts().verbose) {
        console.error(error.stack)
      }
      process.exit(1)
    }
  })

/**
 * Analyze code changes and select tests
 */
program
  .command('analyze')
  .description('Analyze code changes and select relevant tests')
  .option('--base <ref>', 'Base git reference', false)
  .option('--head <ref>', 'Head git reference', false)
  .option('--last-24h', 'Gets the difference between the last commit and the last 24h commit', false)
  .option('--framework <name>', 'Test framework to use', 'playwright')
  .option('--output <format>', 'Output format (paths|script|json|table|playwright-args)', 'table')
  .option('--no-ai', 'Disable AI-enhanced analysis')
  .option('--ai-provider <name>', 'Specific AI provider to use')
  .option('--confidence <threshold>', 'Minimum confidence threshold', parseFloat, 0.5)
  .option('--save <file>', 'Save output to file')
  .action(async (options) => {
    const globalOpts = program.opts()
    
    if (globalOpts.verbose) {
      logger.level = 'debug'
    }

    if (globalOpts.quiet && !globalOpts.verbose) {
      logger.level = 'quiet'
    }
    
    const spinner = ora('Analyzing code changes...', { isSilent: globalOpts.quiet }).start()

    try {
      // Validation: Either --last-24h or both --base and --head must be provided, but not both
      if (options.last24h) {
        if (options.base || options.head) {
          spinner.fail('Cannot use --last-24h with --base or --head. Use either --last-24h or both --base and --head.')
          process.exit(1)
        }
      } else {
        if (!options.base || !options.head) {
          spinner.fail('You must provide both --base and --head, or use --last-24h.')
          process.exit(1)
        }
      }
      // Load configuration
      const config = await TEOConfig.fromFile(globalOpts.config)
      const engine = await TEOEngine.create(config)
      
      // Perform analysis
      let analyzeOptions = {
        last24h: options.last24h,
        useAI: options.ai,
        aiProvider: options.aiProvider,
        framework: options.framework,
        confidenceThreshold: options.confidence
      }

      let base = options.base
      let head = options.head

      if (options.last24h) {
        // Let engine handle last24h logic, base/head may be undefined
        base = undefined
        head = undefined
      }

      const result = await engine.analyze(base, head, analyzeOptions)
      
      spinner.succeed('Analysis completed')
      
      // Generate output
      let output
      if (options.output === 'table') {
        output = generateTableOutput(result)
      } else {
        output = engine.generateOutput(result, options.output)
      }
      
      // Save or display output
      if (options.save) {
        await fs.writeFile(options.save, output)
        console.log(chalk.green(`\n✅ Output saved to: ${options.save}`))
      } else if (globalOpts.quiet && options.output === 'paths') {
        // For quiet mode with paths, only output the paths
        console.log(engine.generateOutput(result, 'paths'))
      } else {
        console.log(output)
      }
      
      // Show summary unless quiet
      if (!globalOpts.quiet) {
        displaySummary(result)
      }
      
    } catch (error) {
      spinner.fail('Analysis failed')
      console.error(chalk.red('Error:'), error.message)
      if (globalOpts.verbose) {
        console.error(error.stack)
      }
      process.exit(1)
    }
  })

/**
 * Validate TEO setup and configuration
 */
program
  .command('validate')
  .description('Validate TEO setup and configuration')
  .option('--framework <name>', 'Validate specific framework only')
  .action(async (options) => {
    const globalOpts = program.opts()
    const spinner = ora('Validating TEO setup...', { isSilent: globalOpts.quiet }).start()
    
    try {
      const config = await TEOConfig.fromFile(globalOpts.config)
      const engine = await TEOEngine.create(config)
      
      const validation = await engine.validate()
      
      if (validation.overall.valid) {
        spinner.succeed('Validation completed successfully')
      } else {
        spinner.warn('Validation completed with issues')
      }
      
      displayValidationResults(validation)
      
      if (!validation.overall.valid) {
        process.exit(1)
      }
      
    } catch (error) {
      spinner.fail('Validation failed')
      console.error(chalk.red('Error:'), error.message)
      if (globalOpts.verbose) {
        console.error(error.stack)
      }
      process.exit(1)
    }
  })

/**
 * Generate ready-to-run test execution script
 */
program
  .command('script')
  .description('Generate executable test script')
  .option('--base <ref>', 'Base git reference')
  .option('--head <ref>', 'Head git reference')
  .option('--last-24h', 'Gets the difference between the last commit and the last 24h commit', false)
  .option('--framework <name>', 'Test framework to use', 'playwright')
  .option('--output <file>', 'Output script file', 'run-selected-tests.sh')
  .option('--no-ai', 'Disable AI-enhanced analysis')
  .action(async (options) => {
    const globalOpts = program.opts()
    const spinner = ora('Generating test execution script...', { isSilent: globalOpts.quiet }).start()

    try {
      // Validation: Either --last-24h or both --base and --head must be provided, but not both
      if (options.last24h) {
        if (options.base || options.head) {
          spinner.fail('Cannot use --last-24h with --base or --head. Use either --last-24h or both --base and --head.')
          process.exit(1)
        }
      } else {
        if (!options.base || !options.head) {
          spinner.fail('You must provide both --base and --head, or use --last-24h.')
          process.exit(1)
        }
      }

      const config = await TEOConfig.fromFile(globalOpts.config)
      const engine = await TEOEngine.create(config)

      let analyzeOptions = {
        useAI: options.ai,
        framework: options.framework,
        last24h: options.last24h
      }

      let base = options.base
      let head = options.head

      if (options.last24h) {
        // Let engine handle last24h logic, base/head may be undefined
        base = undefined
        head = undefined
      }

      const result = await engine.analyze(base, head, analyzeOptions)

      const script = engine.generateOutput(result, 'script')
      await fs.writeFile(options.output, script)
      await fs.chmod(options.output, 0o755) // Make executable

      spinner.succeed(`Executable script generated: ${options.output}`)

      console.log(chalk.green('\n✅ Test execution script created!'))
      console.log(chalk.blue(`\n🚀 Run with: ./${options.output}`))

      if (!globalOpts.quiet) {
        displaySummary(result)
      }

    } catch (error) {
      spinner.fail('Script generation failed')
      console.error(chalk.red('Error:'), error.message)
      process.exit(1)
    }
  })

/**
 * Display analysis summary
 */
function displaySummary(result) {
  const { summary, testSelection } = result
  
  console.log(chalk.blue('\n📊 Analysis Summary'))
  console.log(chalk.blue('═'.repeat(50)))
  console.log(`Files Changed: ${summary.filesChanged}`)
  console.log(`Features Detected: ${summary.featuresDetected}`)
  console.log(`Framework: ${summary.framework}`)
  console.log(`Tests Selected: ${summary.testsSelected}`)
  console.log(`Reduction: ${chalk.green(summary.reductionPercentage + '%')}`)
  console.log(`Estimated Time Saved: ${chalk.green(Math.round(summary.estimatedTimeSaved / 1000) + 's')}`)
  console.log(`Analysis Duration: ${summary.duration}ms`)
  
  if (testSelection.selectionReasons.length > 0) {
    console.log(chalk.blue('\n🎯 Selection Reasons'))
    console.log(chalk.blue('─'.repeat(50)))
    for (const reason of testSelection.selectionReasons) {
      console.log(`${reason.feature}: ${reason.testsSelected} tests (${Math.round(reason.confidence * 100)}% confidence)`)
    }
  }
}

/**
 * Generate table output for analysis results
 */
function generateTableOutput(result) {
  const { testSelection, summary } = result
  
  let output = chalk.blue('\n🎭 TEO Playwright Test Selection\n')
  output += chalk.blue('═'.repeat(60)) + '\n'
  output += `Total Available Tests: ${testSelection.summary.totalAvailable}\n`
  output += `Selected Tests: ${chalk.green(testSelection.summary.totalSelected)}\n`
  output += `Reduction: ${chalk.green(testSelection.summary.reductionPercentage + '%')}\n\n`
  
  if (testSelection.selectedTests.length > 0) {
    output += chalk.blue('Selected Test Files:\n')
    output += chalk.blue('─'.repeat(60)) + '\n'
    
    for (const test of testSelection.selectedTests) {
      output += `📁 ${chalk.cyan(test.path)}\n`
      output += `   Feature: ${test.feature} (${Math.round(test.confidence * 100)}% confidence)\n`
      output += `   Reason: ${test.reason}\n\n`
    }
    
    output += chalk.blue('\n🚀 Run with Playwright:\n')
    output += chalk.green(`npx playwright test ${testSelection.selectedTests.map(t => t.path).join(' ')}\n`)
  } else {
    output += chalk.yellow('No tests selected - no relevant changes detected\n')
  }
  
  return output
}

/**
 * Display validation results
 */
function displayValidationResults(validation) {
  console.log(chalk.blue('\n🔍 Validation Results'))
  console.log(chalk.blue('═'.repeat(50)))
  
  // Overall status
  if (validation.overall.valid) {
    console.log(chalk.green('✅ Overall: Valid'))
  } else {
    console.log(chalk.red('❌ Overall: Invalid'))
  }
  
  // Git validation
  if (validation.git.valid) {
    console.log(chalk.green('✅ Git: Valid'))
  } else {
    console.log(chalk.red('❌ Git: Invalid'))
    for (const error of validation.git.errors) {
      console.log(chalk.red(`   Error: ${error}`))
    }
  }
  
  // Configuration validation
  if (validation.config.valid) {
    console.log(chalk.green('✅ Configuration: Valid'))
  } else {
    console.log(chalk.red('❌ Configuration: Invalid'))
    for (const error of validation.config.errors) {
      console.log(chalk.red(`   Error: ${error}`))
    }
  }
  
  // AI Providers
  console.log(chalk.blue('\n🤖 AI Providers'))
  for (const [provider, result] of Object.entries(validation.aiProviders)) {
    if (result.valid) {
      console.log(chalk.green(`✅ ${provider}: Available`))
    } else {
      console.log(chalk.yellow(`⚠️  ${provider}: Unavailable`))
    }
  }
  
  // Frameworks
  console.log(chalk.blue('\n🧪 Test Frameworks'))
  for (const [framework, result] of Object.entries(validation.frameworks)) {
    if (result.valid) {
      console.log(chalk.green(`✅ ${framework}: Valid`))
    } else {
      console.log(chalk.yellow(`⚠️  ${framework}: Issues detected`))
      for (const error of result.errors) {
        console.log(chalk.red(`   Error: ${error}`))
      }
      for (const warning of result.warnings) {
        console.log(chalk.yellow(`   Warning: ${warning}`))
      }
    }
  }
  
  // Show warnings
  if (validation.overall.warnings.length > 0) {
    console.log(chalk.blue('\n⚠️  Warnings'))
    for (const warning of validation.overall.warnings) {
      console.log(chalk.yellow(`   ${warning}`))
    }
  }
}

// Error handling
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Unhandled error:'), error.message)
  if (program.opts().verbose) {
    console.error(error.stack)
  }
  process.exit(1)
})

// Parse command line arguments
program.parse()

export default program

