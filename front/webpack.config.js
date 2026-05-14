const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserWebpackPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: {
    script: './src/script.js',
  },
  devtool: false, // Use source maps without eval
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].bundle.js',
    devtoolModuleFilenameTemplate: (info) => `file:///${info.resourcePath}`,
    clean: true, // Clean output directory before each build
  },
  module: {
    rules: [
      {
        test: /\.js$/, // Target JavaScript files
        exclude: /node_modules/, // Exclude node_modules
        use: {
          loader: 'babel-loader', // Use Babel loader if you want to transpile ES6+
          options: {
            presets: ['@babel/preset-env'], // Specify presets if using Babel
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|jpe?g|gif|svg|woff2?|ttf|eot)$/, // Handle images and fonts
        type: 'asset/resource', // Use the built-in asset module
        generator: {
          filename: './assets/[hash][ext][query]', // Specify output path for assets
        },
      },
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'src/index.html', to: 'index.html' },
        { from: 'src/style.css', to: 'style.css' },

        { from: './src/front.png', to: 'front.png' },
        { from: './src/cover.png', to: 'cover.png' },
        { from: './src/paper.png', to: 'paper.png' },
        // { from: './robots.txt', to: 'robots.txt' },
        // { from: './sitemap.xml', to: 'sitemap.xml' },
        // { from: './locales', to: 'locales' },
        // { from: './assets', to: 'assets' },
      ],
    }),
  ],
  optimization: {
    minimize: false, // Enable minification
    minimizer: [
      new TerserWebpackPlugin({
        extractComments: false,
        terserOptions: {
          compress: {
            drop_console: false, // Remove console logs
          },
          output: {
            comments: false, // Removes comments
          },
        },
      }),
    ],
  },
};
