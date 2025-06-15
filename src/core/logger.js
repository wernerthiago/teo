/**
 * Logger configuration and setup
 * Provides structured logging with multiple transports
 */

import winston from 'winston'
import path from 'path'

const { combine, timestamp, errors, json, printf, colorize } = winston.format

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, ...meta }) => {
  let output = `${timestamp} [${level}]: ${message}`
  
  if (Object.keys(meta).length > 0) {
    output += ` ${JSON.stringify(meta)}`
  }
  
  return output
})

// Create logger instance
const logger = winston.createLogger({
  level: process.env.TEO_LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    json()
  ),
  defaultMeta: { service: 'teo-js' },
  transports: [
    // Console transport with colors
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'HH:mm:ss' }),
        consoleFormat
      )
    }),
    
    // File transport for errors
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
})

// Create logs directory if it doesn't exist
import fs from 'fs'
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs', { recursive: true })
}

// Add request ID support for tracing
logger.addRequestId = (requestId) => {
  return logger.child({ requestId })
}

// Performance timing helper
logger.time = (label) => {
  const start = Date.now()
  return {
    end: (meta = {}) => {
      const duration = Date.now() - start
      logger.info(`${label} completed`, { duration, ...meta })
      return duration
    }
  }
}

export default logger

