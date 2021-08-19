/**
 * @file
 * @author
 */

const rules = require('../rules');
const {getAssetPath} = require('san-cli-utils/path');
const defaultsDeep = require('lodash.defaultsdeep');

module.exports = {
    id: 'image',
    apply(api, projectOptions = {}, options) {
        const {
            loaderOptions = {},
            filenameHashing,
            assetsDir,
            largeAssetSize = 1024
        } = projectOptions;
        api.chainWebpack(chainConfig => {
            // 使用url-loader 设置 img, media, fonts + svg-url设置svg
            [
                ['image', /\.(png|jpe?g|gif|webp)(\?.*)?$/, 'url']
            ].forEach(([name, test, loader]) => {
                if (loaderOptions[name] !== false) {
                    const options = defaultsDeep(
                        loaderOptions[name] || {},
                        {
                            limit: largeAssetSize,
                            name: getAssetPath(
                                assetsDir,
                                `${name}/[name]${filenameHashing ? '.[contenthash:8]' : ''}.[ext]`
                            )
                        }
                    );

                    rules[loader](
                        chainConfig,
                        name,
                        test,
                        options
                    );
                }
            });
        });
    }
};
