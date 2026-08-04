module.exports = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.target = "electron-renderer"
    }
    config.module.rules.push({
      test: /\.node$/,
      use: "node-loader"
    }),
      config.module.rules.push({
        test: /\.html$/,
        use: "html-loader"
      })

    return config
  },
  images: { unoptimized: true },
  // The MED3pa config objects mirror the python API's snake_case keys, which trips
  // the repo's `camelcase` rule. Lint is run on its own (`npm run lint`) rather than
  // gating the build on it.
  eslint: { ignoreDuringBuilds: true }
}
