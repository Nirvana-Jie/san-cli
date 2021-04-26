/**
 * Copyright (c) Baidu Inc. All rights reserved.
 *
 * This source code is licensed under the MIT license.
 * See LICENSE file in the project root for license information.
 *
 * @file webpack serve
 * @author ksky521
 */

const path = require('path');
const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');
const EventEmitter = require('events').EventEmitter;
// webpack Plugins
const {getDebugLogger} = require('san-cli-utils/ttyLogger');
const {addDevClientToEntry, getWebpackErrorInfoFromStats, getServerParams, initConfig} = require('./utils');

const debug = getDebugLogger('webpack:serve');
module.exports = class Serve extends EventEmitter {
    constructor(webpackConfig = []) {
        super();
        // webpack启动的promise
        this.initPromise = new Promise(resolve => {
            this.initResolve = () => {
                this.initPromise = null;
                resolve();
                debug('Init Promise resolved');
            };
        });
        this.init(webpackConfig);
        // server创建的promise
        this.serverPromise = new Promise(resolve => {
            this.serverResolve = () => {
                this.serverPromise = null;
                resolve();
            };
        });
    }
    async init(webpackConfig) {
        const {config, devServerConfig} = initConfig(webpackConfig);
        const {
            https,
            port,
            host,
            // protocol,
            // publicUrl,
            // urls,
            // networkUrl,
            sockjsUrl
        } = await getServerParams(devServerConfig, devServerConfig.publicPath);
        this.devServerConfig = Object.assign(devServerConfig, {
            https,
            port,
            host
        });
        const devClients = [
            // dev server client
            require.resolve('webpack-dev-server/client') + sockjsUrl,
            // hmr client
            require.resolve(devServerConfig.hotOnly ? 'webpack/hot/dev-server' : 'webpack/hot/only-dev-server')
        ];
        config.forEach(c => {
            // inject dev/hot client
            addDevClientToEntry(c, devClients);
        });

        // create compiler
        debug('start');

        try {
            this.compiler = webpack(config);
            this.initResolve();
        }
        catch (e) {
            // 捕捉参数不正确的错误信息
            this.emit('fail', {err: e, type: 'run'});
        }
    }
    async getCompiler() {
        if (this.initPromise) {
            await this.initPromise;
        }
        return this.compiler;
    }
    async getServer() {
        if (this.serverPromise) {
            await this.serverPromise;
        }
        return this.server;
    }
    async run() {
        if (this.inited) {
            return;
        }
        this.inited = true;
        if (this.initPromise) {
            await this.initPromise;
        }

        const server = new WebpackDevServer(
            this.compiler,
            this.devServerConfig
        );
        this.server = server;
        this.serverResolve();

        let isFirstCompile = true;
        this.compiler.hooks.done.tap('san-cli-serve', stats => {
            this.emit('complete', {stats});
            if (stats.hasErrors()) {
                const errObj = getWebpackErrorInfoFromStats(undefined, stats);
                errObj.type = 'webpack';
                debug(errObj);
                this.emit('fail', errObj);
            }
            else {
                this.emit('success', {
                    stats,
                    server,
                    isFirstCompile,
                    devServerConfig: this.devServerConfig
                });
            }
            if (isFirstCompile) {
                // 重置一下
                isFirstCompile = false;
            }
        });
    }
};
