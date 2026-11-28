const build = require('./package.json').build

module.exports = {
  ...build,
  linux: {
    ...build.linux,
    target: [{ target: 'deb', arch: ['arm64'] }]
  }
}
