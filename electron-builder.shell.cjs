const packageJson = require('./package.json')

module.exports = {
  ...packageJson.build,
  appId: 'io.bisheng',
  productName: 'BISHENG',
  directories: {
    ...packageJson.build.directories,
    output: 'dist-shell'
  },
  files: packageJson.build.files.map(entry => entry === 'out/**/*' ? 'out-shell/**/*' : entry),
  extraMetadata: {
    name: 'bisheng',
    productName: 'BISHENG',
    main: './out-shell/main/index.js'
  },
  artifactName: 'bisheng-${os}-${arch}.${ext}',
  nsis: {
    ...packageJson.build.nsis,
    artifactName: 'bisheng-windows-${arch}-setup.${ext}'
  },
  publish: null
}
