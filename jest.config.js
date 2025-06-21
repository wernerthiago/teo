export default {
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  testEnvironment: 'node',
  testPathIgnorePatterns: [
    '/node_modules/',
    '/examples/',
    '/logs/',
    '/docs/',
  ],
  // These options help Jest understand your ESM modules
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
};