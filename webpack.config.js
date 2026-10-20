/* eslint-disable no-undef */

const webpack = require("webpack");
const devCerts = require("office-addin-dev-certs");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");

// Files the PWA service worker pre-caches so the app starts offline.
const PWA_SHELL_FILES = [
  "./",
  "index.html",
  "pwa.js",
  "report-pdf.js",
  "scan3d.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

// New on every build, so each deploy ships a byte-different service worker.
const PWA_BUILD_ID = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);

const urlDev = "https://localhost:3000/";
const urlProd = "https://jakob-sajovic.github.io/DentalExam-Platform/";

async function getHttpsOptions() {
  const httpsOptions = await devCerts.getHttpsServerOptions();
  return { ca: httpsOptions.ca, key: httpsOptions.key, cert: httpsOptions.cert };
}

module.exports = async (env, options) => {
  const dev = options.mode === "development";
  const config = {
    devtool: "source-map",
    entry: {
      polyfill: ["core-js/stable", "regenerator-runtime/runtime"],
      taskpane: ["./src/taskpane/taskpane.ts", "./src/taskpane/taskpane.html"],
      commands: "./src/commands/commands.ts",
      // Polyfills are bundled into the PWA chunk rather than shared: a service
      // worker registered at pwa/ can only intercept requests under pwa/, so
      // every file the app needs offline has to live inside that folder.
      pwa: ["core-js/stable", "regenerator-runtime/runtime", "./src/pwa/pwa.ts", "./src/pwa/pwa.html"],
    },
    output: {
      clean: true,
      filename: (pathData) => (pathData.chunk.name === "pwa" ? "pwa/[name].js" : "[name].js"),
      // On-demand chunks (the PWA's PDF writer) live under pwa/, inside the
      // service worker's scope, with a stable name it can pre-cache.
      chunkFilename: "pwa/[name].js",
    },
    resolve: {
      extensions: [".ts", ".html", ".js"],
    },
    // Keep jsPDF and svg2pdf inside report-pdf.js rather than numbered vendor
    // chunks, so the one pre-cached file is all the PDF export needs offline.
    optimization: { splitChunks: { cacheGroups: { defaultVendors: false, default: false } } },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader"
          },
        },
        {
          test: /\.css$/,
          use: ["style-loader", "css-loader"],
        },
        {
          test: /\.html$/,
          exclude: /node_modules/,
          use: {
            loader: "html-loader",
            options: {
              sources: {
                // The PWA manifest and icons are emitted by CopyWebpackPlugin,
                // so html-loader must leave those references alone.
                urlFilter: (attribute, value) =>
                  !value.startsWith("manifest.webmanifest") && !value.startsWith("icons/"),
              },
            },
          },
        },
        {
          test: /\.(png|jpg|jpeg|gif|ico)$/,
          type: "asset/resource",
          generator: {
            filename: "assets/[name][ext][query]",
          },
        },
      ],
    },
    plugins: [
      // The PWA shows this so a tester can tell at a glance which build is live.
      new webpack.DefinePlugin({
        __PWA_BUILD_ID__: JSON.stringify(PWA_BUILD_ID),
      }),
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/taskpane.html",
        chunks: ["polyfill", "taskpane"],
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: "assets/*",
            to: "assets/[name][ext][query]",
          },
          {
            from: "src/index.html",
            to: "index.html",
          },
          {
            from: "manifest*.xml",
            to: "[name]" + "[ext]",
            transform(content) {
              if (dev) {
                return content;
              } else {
                return content.toString().replace(new RegExp(urlDev, "g"), urlProd);
              }
            },
          },
        ],
      }),
      new HtmlWebpackPlugin({
        filename: "commands.html",
        template: "./src/commands/commands.html",
        chunks: ["polyfill", "commands"],
      }),
      new HtmlWebpackPlugin({
        filename: "pwa/index.html",
        template: "./src/pwa/pwa.html",
        chunks: ["pwa"],
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: "src/pwa/static",
            to: "pwa",
            globOptions: { ignore: ["**/sw.js"] },
          },
          {
            from: "src/pwa/static/sw.js",
            to: "pwa/sw.js",
            transform(content) {
              // Bake the shell file list into the worker so it can pre-cache.
              return content
                .toString()
                .replace(
                  'self.__SHELL_FILES__ || ["./"]',
                  JSON.stringify(PWA_SHELL_FILES)
                )
                .replace('self.__BUILD_ID__ || "dev"', JSON.stringify(PWA_BUILD_ID));
            },
          },
        ],
      }),
    ],
    devServer: {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      server: {
        type: "https",
        options: env.WEBPACK_BUILD || options.https !== undefined ? options.https : await getHttpsOptions(),
      },
      port: process.env.npm_package_config_dev_server_port || 3000,
    },
  };

  return config;
};
