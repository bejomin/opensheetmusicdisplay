const { merge } = require('webpack-merge');
var path = require('path')
var createCommonConfig = require('./webpack.common.js')
var Visualizer = require('webpack-visualizer-plugin2')
var webpack = require('webpack')

const production = {
    output: {
        filename: '[name].min.js',
        path: path.resolve(__dirname, 'build'),
        library: 'opensheetmusicdisplay',
        libraryTarget: 'umd',
        // webpack 5 built-in cleanup, replaces clean-webpack-plugin.
        // keep statistics.html (emitted by webpack-visualizer-plugin2) across rebuilds.
        clean: {
            keep: /^statistics\.html/
        }
    },
    mode: 'production',
    optimization: {
        minimize: true
        // splitChunks: {
        //     chunks: 'all',
        //     name: false
        // }
    },
}

function externalFontPlugin() {
    return new webpack.NormalModuleReplacementPlugin(
        /FontProfileActive$/,
        path.resolve(__dirname, 'src/OpenSheetMusicDisplay/FontProfileExternal.ts')
    )
}

const bundled = merge(createCommonConfig(), production, {
    name: 'bundled',
    plugins: [
        new Visualizer({
            path: path.resolve(__dirname, 'build'),
            filename: './statistics.html'
        })
    ]
})

const core = merge(createCommonConfig({
    includeDemo: false,
    libraryEntryName: 'opensheetmusicdisplay-core'
}), production, {
    name: 'core',
    dependencies: ['bundled'],
    output: {
        clean: false
    },
    plugins: [externalFontPlugin()]
})

const chSongbook = merge(createCommonConfig({
    includeDemo: false,
    libraryEntryName: 'opensheetmusicdisplay-ch-songbook'
}), production, {
    name: 'ch-songbook',
    output: {
        clean: false
    },
    externals: {
        'vexflow/core': {
            commonjs: 'vexflow/core',
            commonjs2: 'vexflow/core',
            amd: 'vexflow/core',
            root: 'VexFlow'
        }
    },
    plugins: [externalFontPlugin()]
})

module.exports = (env = {}) => env.chSongbook ? [chSongbook] : [bundled, core]
