const packageJson = require('./package.json')

module.exports = {
  ...packageJson.build,
  appId: 'io.bisheng.dev',
  productName: 'BISHENG Dev',
  protocols: [
    {
      name: 'BISHENG Dev Enterprise Login',
      schemes: ['bisheng-dev']
    }
  ],
  directories: {
    ...packageJson.build.directories,
    output: 'dist-dev'
  },
  extraMetadata: {
    name: 'bisheng-dev',
    productName: 'BISHENG Dev',
    dshDesktopChannel: 'development'
  },
  artifactName: 'bisheng-dev-${os}-${arch}.${ext}',
  nsis: {
    ...packageJson.build.nsis,
    artifactName: 'bisheng-dev-windows-${arch}-setup.${ext}'
  },
  publish: null
}
