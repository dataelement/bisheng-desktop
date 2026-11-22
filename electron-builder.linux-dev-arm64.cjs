const development = require('./electron-builder.dev.cjs')

module.exports = {
  ...development,
  linux: {
    ...development.linux,
    target: [{ target: 'deb', arch: ['arm64'] }]
  }
}
