[
    'esbuild',
    'ejs',
    'html',
    'url',
    'css',
    'style',
    'less',
    'sass',
    'stylus',
    'postcss',
    'san',
    'san-hot',
    'svg',
    'svg-sprite'
].map(id => {
    exports[id] = require(`./${id}`);
});
