const path = require('path')

module.exports = {
  target: 'electron-renderer',
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    libraryTarget: 'commonjs2',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  externals: {
    '@angular/core': 'commonjs @angular/core',
    '@angular/common': 'commonjs @angular/common',
    '@angular/forms': 'commonjs @angular/forms',
    '@angular/platform-browser': 'commonjs @angular/platform-browser',
    '@angular/animations': 'commonjs @angular/animations',
    rxjs: 'commonjs rxjs',
    'rxjs/operators': 'commonjs rxjs/operators',
    'tabby-core': 'commonjs tabby-core',
    'tabby-terminal': 'commonjs tabby-terminal',
    'tabby-settings': 'commonjs tabby-settings',
  },
  module: {
    rules: [
      { test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ },
    ],
  },
}
