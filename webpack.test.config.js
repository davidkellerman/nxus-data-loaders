const path = require("path")
const {CleanWebpackPlugin} = require('clean-webpack-plugin')

const context = path.resolve(__dirname, '.')

module.exports = {
  mode: 'production',
  context: context,
  entry: './dist/index.js',
  output: {
    path: path.resolve(context, './__tests__/dist'),
    filename: 'index-webpack.js',
  },
  devtool: 'source-map',
  plugins: [
    new CleanWebpackPlugin()
  ]
}
