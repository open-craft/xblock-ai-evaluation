const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = function webpackConfig(_, argv) {
  const mode = argv.mode || "production";

  return {
    mode: mode,
    target: ["web", "es5"],
    devtool: mode === "development" ? "source-map" : false,
    entry: {
      shortanswer: path.resolve(__dirname, "src/shortanswer/index.js"),
      coding: path.resolve(__dirname, "src/coding/index.js"),
      coaching: path.resolve(__dirname, "src/coaching/index.js"),
      shared: path.resolve(__dirname, "src/shared/index.js"),
    },
    output: {
      filename: "[name].js",
      path: path.resolve(__dirname, "../ai_eval/static/bundles"),
      clean: true,
    },
    optimization: {
      minimizer: [
        new TerserPlugin({
          extractComments: false,
          terserOptions: {
            format: {
              comments: /@license|@preserve|^!/i,
            },
          },
        }),
      ],
    },
    module: {
      rules: [
        {
          test: /\.css$/i,
          use: [MiniCssExtractPlugin.loader, "css-loader"],
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({
        filename: function filename(pathData) {
          if (pathData.chunk && pathData.chunk.name === "shared") {
            return "shared.css";
          }
          return "[name].css";
        },
      }),
    ],
    performance: false,
    stats: "minimal",
  };
};
