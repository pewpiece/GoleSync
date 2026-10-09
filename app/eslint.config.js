const expo = require('eslint-config-expo/flat');

module.exports = [
  ...expo,
  { ignores: ['node_modules/', 'android/', 'ios/', 'dist/', '.expo/', 'coverage/'] },
  // jest.mock() calls are hoisted by babel-jest, so imports after them are intentional
  { files: ['__tests__/**'], rules: { 'import/first': 'off' } },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
