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
      shortanswer: path.resolve(__dirname, "src/shortanswer/student.tsx"),
      "shortanswer.studio": path.resolve(__dirname, "src/shortanswer/studio.tsx"),
      coding: path.resolve(__dirname, "src/coding/student.tsx"),
      "coding.studio": path.resolve(__dirname, "src/coding/studio.tsx"),
      coaching: path.resolve(__dirname, "src/coaching/student.tsx"),
      "coaching.studio": path.resolve(__dirname, "src/coaching/studio.tsx"),
      shared: path.resolve(__dirname, "src/shared/index.ts"),
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
          test: /\.[jt]sx?$/i,
          exclude: /node_modules/,
          use: {
            loader: "ts-loader",
          },
        },
        {
          test: /\.css$/i,
          use: [MiniCssExtractPlugin.loader, "css-loader"],
          sideEffects: true,
        },
        {
          test: /\.scss$/i,
          include: /node_modules/,
          use: [
            MiniCssExtractPlugin.loader,
            {
              loader: "css-loader",
              options: {
                modules: {
                  auto: true,
                  namedExport: false,
                },
              },
            },
            "sass-loader",
          ],
          sideEffects: true,
        },
        {
          test: /\.svg$/i,
          type: "asset/inline",
        },
      ],
    },
    resolve: {
      extensions: [".tsx", ".ts", ".jsx", ".js"],
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
