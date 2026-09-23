const packageJson = require('./package.json')

module.exports = {
  ...packageJson.build,
  appId: 'io.bisheng.work.dev',
  productName: 'BISHENG Work Dev',
  protocols: [
    {
      name: 'BISHENG Work Dev Enterprise Login',
      schemes: ['bisheng-work-dev']
    }
  ],
  directories: {
    ...packageJson.build.directories,
    output: 'dist-dev'
  },
  extraMetadata: {
    name: 'dsh-desktop-dev',
    productName: 'BISHENG Work Dev',
    dshDesktopChannel: 'development'
  },
  artifactName: 'dsh-desktop-dev-${os}-${arch}.${ext}',
  nsis: {
    ...packageJson.build.nsis,
    artifactName: 'dsh-desktop-dev-windows-${arch}-setup.${ext}'
  },
  publish: null
}
