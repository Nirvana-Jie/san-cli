/**
 * @file
 * @author
 */

const rules = require('../rules');
const path = require('path');
const fs = require('fs');
const resolveSync = require('resolve').sync;
const lMerge = require('lodash.merge');
const minify = require('html-minifier-terser').minify;
const {defineVar, ensureRelative} = require('../utils');
const {terserOptions: defaultTerserOptions, htmlMinifyOptions} = require('../defaultOptions');

module.exports = {
    id: 'html',
    schema: joi => ({
        // 多页配置
        pages: joi.object().pattern(
            /\w+/,
            joi.alternatives().try(
                joi.string().required(),
                joi.array().items(joi.string().required()),
                joi
                    .object()
                    .keys({
                        entry: joi
                            .alternatives()
                            .try(joi.string().required(), joi.array().items(joi.string().required()))
                            .required(),
                        chunks: joi
                            .alternatives()
                            .try(joi.string().required(), joi.array().items(joi.string().required()))
                    })
                    .unknown(true)
            )
        ),
        copy: joi.alternatives().try(
            joi.array().items(
                joi
                    .object({
                        compress: joi.bool(),
                        from: joi.string(),
                        to: joi.string(),
                        ignore: joi.alternatives().try(joi.string(), joi.object().instance(RegExp))
                    })
                    .unknown(true)
            ),
            joi
                .object({
                    from: joi.string(),
                    compress: joi.bool(),
                    to: joi.string(),
                    ignore: joi.alternatives().try(joi.string(), joi.object().instance(RegExp))
                })
                .unknown(true)
        )
    }),
    apply(api, projectOptions = {}, options) {
        const {
            loaderOptions = {},
            resolve,
            context,
            resolveLocal,
            isProduction,
            copy
        } = projectOptions;

        api.chainWebpack(chainConfig => {
            // set resolveLoader
            const resolveLoader = chainConfig.resolveLoader.modules
                .add('node_modules')
                .add(resolve('node_modules'))
                .add(resolveLocal('node_modules'));
            //  优先考虑本地安装的html-loader版本，没有的话去全局路径寻找
            try {
                resolveSync('html-loader', {basedir: context});
                // console.log(`Find local htmlLoader at [${htmlLoader}]`);
            } catch (e) {
                // 找到html-loader所在根目录
                let nodeModulesPath = path.dirname(require.resolve('html-loader'));
                nodeModulesPath = nodeModulesPath.substring(0, nodeModulesPath.lastIndexOf('node_modules'))
                    + 'node_modules';
                resolveLoader.add(nodeModulesPath);
            }

            // html, ejs
            [
                ['html', /\.html?$/],
                ['ejs', /\.ejs$/]
            ].forEach(([name, test]) => {
                if (loaderOptions[name] !== false) {
                    rules.createRule(chainConfig, name, test, [[name, loaderOptions[name]]]);
                }
            });

            const isProd = isProduction();
            const outputDir = resolve(projectOptions.outputDir);
            const terserOptions = Object.assign(defaultTerserOptions, projectOptions.terserOptions || {});

            // 1. 判断 pages
            // 2. build 做的事情是判断 serve 对象
            const htmlOptions = {
                inject: true,
                title: projectOptions.pkg.name,
                templateParameters: (compilation, assets, assetTags, options) => {
                    // html-webpack-plugin version>=4
                    // enhance html-webpack-plugin's built in template params
                    let stats;
                    return Object.assign(
                        {
                            // make stats lazy as it is expensive
                            get webpack() {
                                return stats || (stats = compilation.getStats().toJson());
                            },
                            compilation,
                            webpackConfig: compilation.options,
                            htmlWebpackPlugin: {
                                files: assets,
                                tags: assetTags,
                                options
                            }
                        },
                        defineVar(projectOptions, true /* raw */)
                    );
                }
            };

            if (isProd) {
                // 压缩 html
                // 跟 terserOptions 打平
                htmlMinifyOptions.minifyJS = terserOptions;
                lMerge(htmlOptions, {
                    minify: htmlMinifyOptions
                });
            }

            // resolve HTML file(s)
            const multiPageConfig = projectOptions.pages;
            const HTMLPlugin = require('html-webpack-plugin');
            const SanHtmlPlugin = require('san-cli-webpack/lib/HTMLPlugin');
            const htmlPath = resolve('public/index.html');
            // 默认路径
            const defaultHtmlPath = fs.existsSync(htmlPath) ? htmlPath : require.resolve('../public/index.html');
            const publicCopyIgnore = ['index.html', '.DS_Store'];
            let useHtmlPlugin = false;
            if (!multiPageConfig) {
                // default, single page setup.
                htmlOptions.alwaysWriteToDisk = true;
                htmlOptions.inject = true;
                htmlOptions.template = defaultHtmlPath;
                chainConfig.plugin('html').use(HTMLPlugin, [htmlOptions]);
                useHtmlPlugin = true;
            } else {
                // multi-page setup
                /** simple
                 * pages: {
                        index: {
                            entry: 'src/entry-point/index/main.js', //entry for the public page
                            template: 'public/index.html', // source template
                            filename: 'index.html' // output as dist/*
                        },
                        signin: {
                            entry: 'src/entry-point/signin/main.js',
                            template: 'public/signin.html',
                            filename: 'signin.html'
                        }
                    }
                */
                chainConfig.entryPoints.clear();
                const pages = Object.keys(multiPageConfig);
                const normalizePageConfig = c => (typeof c === 'string' ? {entry: c} : c);

                pages.forEach(name => {
                    let pageConfig = normalizePageConfig(multiPageConfig[name]);
                    let {
                        title,
                        entry,
                        template = `public/${name}.html`,
                        filename,
                        // 这里需要跟 mode 里面的 splitChunks 遥相呼应
                        chunks = [name]
                        // chunks = ['common', 'vendors', 'css-common', name]
                    } = pageConfig;
                    if (Array.isArray(chunks) && chunks.indexOf(name) === -1) {
                        chunks.push(name);
                    }

                    // inject entry
                    const entries = Array.isArray(entry) ? entry : [entry];
                    chainConfig.entry(name).merge(entries.map(e => resolve(e)));

                    if (!filename) {
                        // 处理 smarty 情况
                        if (path.extname(template) === '.tpl') {
                            filename = path.basename(template);
                        } else {
                            filename = `${name}.html`;
                        }
                    }
                    // filename = path.join(projectOptions.templateDir, filename);
                    // resolve page index template
                    const hasDedicatedTemplate = fs.existsSync(resolve(template));
                    if (hasDedicatedTemplate) {
                        publicCopyIgnore.push(template);
                    }
                    const templatePath = hasDedicatedTemplate ? template : defaultHtmlPath;

                    // inject html plugin for the page
                    const pageHtmlOptions = Object.assign(
                        {
                            alwaysWriteToDisk: true,
                            scriptLoading: 'blocking'
                        },
                        htmlOptions,
                        pageConfig,
                        {
                            chunks,
                            entry: name,
                            template: templatePath,
                            // add templateDir
                            filename: ensureRelative(outputDir, filename),
                            title
                        }
                    );

                    chainConfig.plugin(`html-${name}`).use(HTMLPlugin, [pageHtmlOptions]);

                    chainConfig.plugin(`san-html-${name}`).use(SanHtmlPlugin);
                });
                useHtmlPlugin = true;
            }
            if (useHtmlPlugin) {
                // 这里插件是依赖 html-webpack-plguin 的，所以不配置 hwp，会报错哦~
                // html-webpack-harddisk-plugin
                chainConfig.plugin('html-webpack-harddisk').use(require('html-webpack-harddisk-plugin'));
            }

            const copyArgs = [];

            // ------ 这里把 copy 拿到这里来处理是为了合并 ignore
            if (copy) {
                const addCopyOptions = options => {
                    let {from, to = './', ignore = [], compress = isProduction()} = options;
                    // smarty 的专属
                    // prettier-ignore
                    const defaultTransformOptions = compress
                        ? {
                            transform: (content, path) => {
                                if (/\.(tpl|html|htm)$/.test(path)) {
                                    return minify(content.toString(), {
                                        minifyCSS: true,
                                        minifyJS: terserOptions,
                                        ignoreCustomFragments: [/{%[\s\S]*?%}/, /<%[\s\S]*?%>/, /<\?[\s\S]*?\?>/]
                                    });
                                }
                                return content;
                            }
                        }
                        : {};

                    // 排除 templte 的情况
                    ignore = publicCopyIgnore.concat(typeof ignore === 'string' ? [ignore] : ignore);
                    if (from && !/[$^*?!]+/.test(from) && fs.existsSync(resolve(from))) {
                        from = resolve(from);
                        // 保证template的相对路径
                        ignore = ignore.map((f, i) => (i > 1 ? ensureRelative(from, resolve(f)) : f));
                        copyArgs.push(
                            Object.assign(defaultTransformOptions, options, {
                                from,
                                to: path.join(outputDir, to),
                                globOptions: {
                                    ignore
                                }
                            })
                        );
                    } else {
                        // 正则的，不处理
                        copyArgs.push(
                            Object.assign(defaultTransformOptions, options, {
                                from,
                                to: path.join(outputDir, to),
                                globOptions: {
                                    ignore
                                }
                            })
                        );
                    }
                };
                if (Array.isArray(copy)) {
                    // 数组就循环吧
                    copy.forEach(addCopyOptions);
                } else {
                    addCopyOptions(copy);
                }
            }
            if (copyArgs.length) {
                chainConfig.plugin('copy-webpack').use(require('copy-webpack-plugin'), [{patterns: copyArgs}]);
            }
        });
    }
};
